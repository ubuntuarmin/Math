import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  increment,
  serverTimestamp,
  writeBatch,
  addDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const LINK_BONUS = 50;

const form        = document.getElementById("shareForm");
const urlInput    = document.getElementById("shareUrl");
const titleInput  = document.getElementById("shareTitle");
const descInput   = document.getElementById("shareDesc");
const tagsInput   = document.getElementById("shareHashtags");
const submitBtn   = document.getElementById("shareSubmit");
const errorEl     = document.getElementById("shareError");
const successEl   = document.getElementById("shareSuccess");
const charCount   = document.getElementById("descCharCount");

// Live character counter
descInput?.addEventListener("input", () => {
  if (charCount) charCount.textContent = descInput.value.length;
});

// ── Auth guard ────────────────────────────────────────────────────────────────
// Disable the submit button until auth state is confirmed.
if (submitBtn) submitBtn.disabled = true;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // No login modal on this page — redirect to sign-in page
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

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  clearMessages();

  const user = auth.currentUser;
  if (!user) {
    showError("You must be signed in to share a link.");
    return;
  }

  const url   = (urlInput?.value  || "").trim();
  const title = (titleInput?.value || "").trim();
  const desc  = (descInput?.value  || "").trim();
  const hashtags = parseHashtags(tagsInput?.value || "");

  // Validation
  if (!url || !/^https?:\/\//i.test(url)) {
    showError("Please enter a valid URL starting with https://");
    urlInput?.focus();
    return;
  }

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

  let submitted = false;
  try {
    if (submitBtn) {
      submitBtn.disabled    = true;
      submitBtn.textContent = "Sharing…";
    }

    // Fetch (or create) user profile for display name
    const userRef = doc(db, "users", user.uid);
    const snap    = await getDoc(userRef);
    let data      = snap.exists() ? snap.data() : null;

    if (!data) {
      const fallback = {
        uid:        user.uid,
        email:      user.email || "",
        firstName:  "",
        lastName:   "",
        credits:    0,
        totalEarned: 0,
      };
      await setDoc(userRef, fallback, { merge: true });
      data = fallback;
    }

    const displayName =
      [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "Anonymous";

    // Atomic batch: add link + award credits in one operation
    const batch      = writeBatch(db);
    const newLinkRef = doc(collection(db, "sharedLinks"));

    batch.set(newLinkRef, {
      url,
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
    });

    batch.set(userRef, {
      credits:     increment(LINK_BONUS),
      totalEarned: increment(LINK_BONUS),
    }, { merge: true });

    await batch.commit();

    // Inbox notification (non-critical)
    await sendNotification(
      user.uid,
      "Link Shared — Credits Awarded!",
      `Your link "${title}" is now live in the community! You earned +${LINK_BONUS} credits. ` +
      `If 3 or more users report it as fake, your credits will be reversed.`,
      "link"
    );

    submitted = true;
    showSuccess(`Your link is live! +${LINK_BONUS} credits awarded. Redirecting…`);
    form?.reset();
    if (charCount) charCount.textContent = "0";

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);

  } catch (err) {
    console.error("Share link error:", err);
    showError("Failed to share link. Please check your connection and try again.");
  } finally {
    if (!submitted && submitBtn) {
      submitBtn.disabled    = false;
      submitBtn.innerHTML   = `Share Link <span class="text-blue-200">(+${LINK_BONUS} credits)</span>`;
    }
  }
}

if (form) form.addEventListener("submit", handleSubmit);
