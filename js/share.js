import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDocs,
  collection,
  increment,
  serverTimestamp,
  addDoc,
  query,
  where,
  limit,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { normalizeUrlForDedup, buildCanonicalUrlKey } from "./urlDedup.js";

const LINK_BONUS = 50;
const MIN_HTML_LENGTH = 100; // minimum chars for a meaningful HTML submission
const MAX_LINKS_PER_HOUR = 3; // server-enforced via Firestore rules too

const form        = document.getElementById("shareForm");
const urlInput    = document.getElementById("shareUrl");
const htmlInput   = document.getElementById("shareHtml");
const titleInput  = document.getElementById("shareTitle");
const descInput   = document.getElementById("shareDesc");
const tagsInput   = document.getElementById("shareHashtags");
const submitBtn   = document.getElementById("shareSubmit");
const errorEl     = document.getElementById("shareError");
const successEl   = document.getElementById("shareSuccess");
const charCount   = document.getElementById("descCharCount");
const htmlCharCount = document.getElementById("htmlCharCount");
const typeUrlBtn  = document.getElementById("typeUrlBtn");
const typeHtmlBtn = document.getElementById("typeHtmlBtn");
const urlField    = document.getElementById("urlField");
const htmlField   = document.getElementById("htmlField");

let submissionType = "url"; // "url" or "html"

// ── Submission type toggle ────────────────────────────────────────────────────
typeUrlBtn?.addEventListener("click", () => {
  submissionType = "url";
  typeUrlBtn.classList.add("active");
  typeHtmlBtn.classList.remove("active");
  urlField?.classList.remove("hidden");
  htmlField?.classList.add("hidden");
});

typeHtmlBtn?.addEventListener("click", () => {
  submissionType = "html";
  typeHtmlBtn.classList.add("active");
  typeUrlBtn.classList.remove("active");
  htmlField?.classList.remove("hidden");
  urlField?.classList.add("hidden");
});

// Live character counters
descInput?.addEventListener("input", () => {
  if (charCount) charCount.textContent = descInput.value.length;
});

htmlInput?.addEventListener("input", () => {
  if (htmlCharCount) htmlCharCount.textContent = htmlInput.value.length;
});

// ── Auth guard ────────────────────────────────────────────────────────────────
if (submitBtn) submitBtn.disabled = true;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  if (submitBtn) submitBtn.disabled = false;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseHashtags(input) {
  if (!input) return [];
  return input
    .split(/[\s,]+/)
    .map(t => {
      t = t.trim().toLowerCase().replace(/[^a-z0-9_#]/g, "");
      if (t && !t.startsWith("#")) t = "#" + t;
      return t;
    })
    .filter(t => t.length > 1)
    .slice(0, 5);
}

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
  if (successEl) successEl.classList.add("hidden");
}

function showSuccess(msg) {
  if (!successEl) return;
  successEl.textContent = msg;
  successEl.classList.remove("hidden");
  if (errorEl) errorEl.classList.add("hidden");
}

function clearMessages() {
  if (errorEl)   { errorEl.textContent = "";   errorEl.classList.add("hidden");   }
  if (successEl) { successEl.textContent = ""; successEl.classList.add("hidden"); }
}

async function sendNotification(uid, title, text, type = "system") {
  try {
    await addDoc(collection(db, "messages"), {
      to:        uid,
      fromName:  "System",
      title,
      text,
      type,
      timestamp: serverTimestamp(),
      read:      false,
    });
  } catch (err) {
    console.warn("Failed to send notification:", err);
  }
}

// ── Client-side rate limiting ─────────────────────────────────────────────────
// Reads/writes timestamps in localStorage to enforce hourly link submission limit.
// The Firestore rules enforce the same limit server-side.

function getRecentLinkSubmits() {
  const now = Date.now();
  let history;
  try {
    history = JSON.parse(localStorage.getItem("linkSubmitHistory") || "[]");
  } catch (_) {
    history = [];
  }
  return history.filter(t => now - t < 3600000); // last hour only
}

function recordLinkSubmit() {
  const history = getRecentLinkSubmits();
  history.push(Date.now());
  try {
    localStorage.setItem("linkSubmitHistory", JSON.stringify(history));
  } catch (_) {}
}

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  clearMessages();

  const user = auth.currentUser;
  if (!user) {
    showError("You must be signed in to share.");
    return;
  }

  // ── Client-side rate limit check (fast, before any Firestore reads) ──────
  const recentSubmits = getRecentLinkSubmits();
  if (recentSubmits.length >= MAX_LINKS_PER_HOUR) {
    const oldestMs   = recentSubmits[0];
    const waitMins   = Math.ceil((oldestMs + 3600000 - Date.now()) / 60000);
    showError(
      `You've already submitted ${MAX_LINKS_PER_HOUR} links this hour. ` +
      `Please wait ~${waitMins} minute${waitMins !== 1 ? "s" : ""} before sharing again.`
    );
    return;
  }

  const title    = (titleInput?.value || "").trim();
  const desc     = (descInput?.value  || "").trim();
  const hashtags = parseHashtags(tagsInput?.value || "");

  // Common validation
  if (!title || title.length < 3) {
    showError("Please give the site a short name (at least 3 characters).");
    titleInput?.focus();
    return;
  }

  if (!desc || desc.length < 10) {
    showError("Please add a short description (at least 10 characters).");
    descInput?.focus();
    return;
  }

  // Type-specific validation
  let url        = "";
  let htmlContent = "";
  let canonicalUrl = "";
  let canonicalUrlKey = "";

  if (submissionType === "url") {
    url = (urlInput?.value || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      showError("Please enter a valid URL starting with https://");
      urlInput?.focus();
      return;
    }
    canonicalUrl = normalizeUrlForDedup(url);
    if (!canonicalUrl) {
      showError("Please enter a valid URL.");
      urlInput?.focus();
      return;
    }
    canonicalUrlKey = await buildCanonicalUrlKey(canonicalUrl);
  } else {
    htmlContent = (htmlInput?.value || "").trim();
    if (htmlContent.length < MIN_HTML_LENGTH) {
      showError(`Please enter at least ${MIN_HTML_LENGTH} characters of HTML code.`);
      htmlInput?.focus();
      return;
    }
    if (htmlContent.length > 50000) {
      showError("HTML code is too long (max 50,000 characters).");
      htmlInput?.focus();
      return;
    }
  }

  let submitted = false;
  try {
    if (submitBtn) {
      submitBtn.disabled    = true;
      submitBtn.textContent = "Sharing…";
    }

    const userRef = doc(db, "users", user.uid);
    const displayNameFallback = "Anonymous";

    if (submissionType === "url") {
      const [exactMatchSnap, canonicalMatchSnap] = await Promise.all([
        getDocs(query(collection(db, "sharedLinks"), where("url", "==", url), limit(1))),
        getDocs(query(collection(db, "sharedLinks"), where("canonicalUrl", "==", canonicalUrl), limit(1))),
      ]);
      if (!exactMatchSnap.empty || !canonicalMatchSnap.empty) {
        throw Object.assign(new Error("DUPLICATE_LINK"), { code: "duplicate-link" });
      }
    }

    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      let data = userSnap.exists() ? userSnap.data() : null;

      if (!data) {
        const fallback = {
          uid:         user.uid,
          email:       user.email || "",
          firstName:   "",
          lastName:    "",
          credits:     0,
          totalEarned: 0,
        };
        tx.set(userRef, fallback, { merge: true });
        data = fallback;
      }

      const displayName =
        [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || displayNameFallback;

      const newLinkRef = doc(collection(db, "sharedLinks"));
      const linkDoc = {
        title,
        description:     desc,
        hashtags,
        submittedBy:     user.uid,
        submittedByName: displayName,
        status:          "active",
        reportCount:     0,
        reports:         [],
        upvotes:         [],
        upvoteCount:     0,
        rewardGiven:     true,
        creditsAwarded:  LINK_BONUS,
        creditsReversed: false,
        createdAt:       serverTimestamp(),
        type:            submissionType,
      };

      if (submissionType === "url") {
        const idxRef = doc(db, "sharedLinkCanonicalIndex", canonicalUrlKey);
        const idxSnap = await tx.get(idxRef);
        if (idxSnap.exists()) {
          throw Object.assign(new Error("DUPLICATE_LINK"), { code: "duplicate-link" });
        }

        linkDoc.url = url;
        linkDoc.canonicalUrl = canonicalUrl;

        tx.set(idxRef, {
          canonicalUrl,
          firstLinkId:   newLinkRef.id,
          firstCreatedAt: serverTimestamp(),
          submittedBy:   user.uid,
          createdAt:     serverTimestamp(),
          updatedAt:     serverTimestamp(),
        }, { merge: false });
      } else {
        linkDoc.htmlContent = htmlContent;
        // Store a placeholder URL for backwards compat
        linkDoc.url = "";
      }

      tx.set(newLinkRef, linkDoc);

      const now = Date.now();
      const windowStart  = data.hourlyLinkWindowStart || 0;
      const isNewWindow  = (now - windowStart) > 3600000;
      const hourlyUpdate = isNewWindow
        ? { hourlyLinkWindowStart: now, hourlyLinkCount: 1 }
        : { hourlyLinkCount: increment(1) };

      tx.set(userRef, {
        credits:     increment(LINK_BONUS),
        totalEarned: increment(LINK_BONUS),
        ...hourlyUpdate,
      }, { merge: true });
    });

    // Record the submission locally so the client-side guard is immediately accurate
    recordLinkSubmit();

    const typeLabel = submissionType === "html" ? "HTML game" : "link";
    await sendNotification(
      user.uid,
      `${submissionType === "html" ? "HTML Game" : "Link"} Shared — Credits Awarded!`,
      `Your ${typeLabel} "${title}" is now live in the community! You earned +${LINK_BONUS} credits.`,
      "link"
    );

    submitted = true;
    showSuccess(`Your ${typeLabel} is live! +${LINK_BONUS} credits awarded. Redirecting…`);
    form?.reset();
    if (charCount) charCount.textContent = "0";
    if (htmlCharCount) htmlCharCount.textContent = "0";

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);

  } catch (err) {
    console.error("Share error:", err);
    if (err?.code === "duplicate-link" || err?.message === "DUPLICATE_LINK") {
      showError("This link has already been shared. Please submit a different link.");
    } else {
      showError("Failed to share. Please check your connection and try again.");
    }
  } finally {
    if (!submitted && submitBtn) {
      submitBtn.disabled    = false;
      submitBtn.innerHTML   = `Share <span class="text-blue-200">(+${LINK_BONUS} credits)</span>`;
    }
  }
}

if (form) form.addEventListener("submit", handleSubmit);
