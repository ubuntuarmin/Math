import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDoc,
  increment,
  addDoc,
  collection,
  serverTimestamp,
  setDoc,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const SUGGESTION_COST = 20;
const LINK_BONUS      = 50;   // awarded immediately on submission

// ----- Suggestion form elements -----
const form = document.getElementById("suggestionForm");
const typeInput = document.getElementById("suggestionType");
const titleInput = document.getElementById("suggestionTitle");
const textInput = document.getElementById("suggestionText");
const submitBtn = document.getElementById("suggestionSubmit");
const errorEl = document.getElementById("suggestionError");
const successEl = document.getElementById("suggestionSuccess");

// ----- Link submission form elements -----
const linkForm = document.getElementById("linkSubmissionForm");
const linkUrlInput = document.getElementById("linkUrl");
const linkTitleInput = document.getElementById("linkTitle");
const linkNotesInput = document.getElementById("linkNotes");
const linkSubmitBtn = document.getElementById("linkSubmit");
const linkErrorEl = document.getElementById("linkError");
const linkSuccessEl = document.getElementById("linkSuccess");

function buildFallbackProfile(user) {
  return {
    uid: user.uid,
    email: user.email || "",
    firstName: "",
    lastName: "",
    credits: 0,
    totalEarned: 0,
  };
}

// ==================== AUTH GUARD ====================
// Wait for auth state; redirect to index.html if not signed in.
// Disable submit buttons until auth is known.
if (linkSubmitBtn) linkSubmitBtn.disabled = true;
if (submitBtn)     submitBtn.disabled = true;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // No login modal on this page — send the user to sign in first
    window.location.href = "index.html";
    return;
  }
  // Auth is confirmed: enable the submit buttons
  if (linkSubmitBtn) linkSubmitBtn.disabled = false;
  if (submitBtn)     submitBtn.disabled = false;
});

/**
 * Helper: send a notification message to the current user
 */
async function sendSelfNotification(uid, title, text, type = "system") {
  try {
    await addDoc(collection(db, "messages"), {
      to: uid,
      fromName: "System",
      title,
      text,
      type,
      timestamp: serverTimestamp(),
      read: false,
    });
  } catch (err) {
    console.warn("Failed to send notification:", err);
  }
}

// ==================== SUGGESTION HANDLER ====================

async function handleSuggestionSubmit(e) {
  e.preventDefault();
  if (!form || !submitBtn) return;

  if (errorEl) errorEl.textContent = "";
  if (successEl) successEl.textContent = "";

  const user = auth.currentUser;
  if (!user) {
    if (errorEl) errorEl.textContent = "You must be signed in to submit a suggestion.";
    return;
  }

  const type = typeInput?.value || "feature";
  const title = (titleInput?.value || "").trim();
  const text = (textInput?.value || "").trim();

  if (!title || title.length < 4) {
    if (errorEl) errorEl.textContent = "Please provide a short, clear title (at least 4 characters).";
    return;
  }

  if (!text || text.length < 10) {
    if (errorEl) errorEl.textContent = "Please describe your suggestion in more detail (at least 10 characters).";
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    const userRef = doc(db, "users", user.uid);

    // Use a transaction to atomically check credits, deduct them, and create
    // the suggestion so that credits are never lost without a matching record.
    let submitterEmail = "";
    const newSuggestionRef = doc(collection(db, "suggestions"));
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) {
        const err = new Error("User profile not found.");
        err.code = "no_profile";
        throw err;
      }

      const data = snap.data();
      submitterEmail = data.email || user.email || "";
      if ((data.credits || 0) < SUGGESTION_COST) {
        const err = new Error("Insufficient credits.");
        err.code = "no_credits";
        throw err;
      }

      // Deduct credits and create suggestion atomically
      transaction.update(userRef, { credits: increment(-SUGGESTION_COST) });
      transaction.set(newSuggestionRef, {
        userId: user.uid,
        email: submitterEmail,
        type,
        title,
        text,
        status: "pending",
        createdAt: serverTimestamp(),
        reviewedAt: null,
        reviewerUid: null,
        cost: SUGGESTION_COST,
        refundGiven: false,
      });
    });

    // Send confirmation to inbox (non-critical — failure doesn't roll back the suggestion)
    await sendSelfNotification(
      user.uid,
      "Suggestion Submitted",
      `Your ${type === "bug" ? "bug report" : "feature request"} "${title}" was submitted. 20 credits were held as a deposit. If it's helpful, the admin will refund your 20 credits and may give you bonus credits.`,
      "suggestion"
    );

    if (successEl) {
      successEl.textContent =
        "Thank you! Your suggestion was submitted. 20 credits were deducted as a deposit.";
    }
    form.reset();
  } catch (err) {
    if (err.code === "no_profile") {
      if (errorEl) errorEl.textContent = "User profile not found. Please try again later.";
    } else if (err.code === "no_credits") {
      if (errorEl) errorEl.textContent = `You need at least ${SUGGESTION_COST} credits to submit a suggestion.`;
    } else {
      console.error("Suggestion submit error:", err);
      if (errorEl) errorEl.textContent = "Failed to submit suggestion. Please try again.";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = `Submit Suggestion (‑${SUGGESTION_COST} credits)`;
    }
  }
}

if (form) {
  form.addEventListener("submit", handleSuggestionSubmit);
}

// ==================== LINK SUBMISSION HANDLER ====================

async function handleLinkSubmit(e) {
  e.preventDefault();
  if (!linkForm || !linkSubmitBtn) return;

  if (linkErrorEl) linkErrorEl.textContent = "";
  if (linkSuccessEl) linkSuccessEl.textContent = "";

  const user = auth.currentUser;
  if (!user) {
    if (linkErrorEl) linkErrorEl.textContent = "You must be signed in to submit a link.";
    return;
  }

  const url   = (linkUrlInput?.value || "").trim();
  const title = (linkTitleInput?.value || "").trim();
  const notes = (linkNotesInput?.value || "").trim();

  // Basic validation
  if (!url || !/^https?:\/\//i.test(url)) {
    if (linkErrorEl) linkErrorEl.textContent = "Please enter a valid URL (must start with http or https).";
    return;
  }

  if (!title || title.length < 3) {
    if (linkErrorEl) linkErrorEl.textContent = "Please give the site a short name (at least 3 characters).";
    return;
  }

  if (!notes || notes.length < 10) {
    if (linkErrorEl) linkErrorEl.textContent =
      "Please add a short description (at least 10 characters).";
    return;
  }

  let submitted = false;
  try {
    linkSubmitBtn.disabled = true;
    linkSubmitBtn.textContent = "Submitting...";

    // Fetch user profile for display name (auto-create minimal profile if missing)
    const userRef = doc(db, "users", user.uid);
    const snap    = await getDoc(userRef);
    let data      = snap.exists() ? snap.data() : null;

    if (!data) {
      const fallbackProfile = buildFallbackProfile(user);
      await setDoc(userRef, fallbackProfile, { merge: true });
      data = fallbackProfile;
    }
    const displayName =
      [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "Anonymous";

    // Use a batch write to atomically add the link and award credits so the
    // link is never live without the corresponding credit reward being given.
    const batch = writeBatch(db);
    const newLinkRef = doc(collection(db, "sharedLinks"));
    batch.set(newLinkRef, {
      url,
      title,
      description:     notes,
      submittedBy:     user.uid,
      submittedByName: displayName,
      status:          "active",
      reportCount:     0,
      reports:         [],
      rewardGiven:     true,
      creditsAwarded:  LINK_BONUS,
      creditsReversed: false,
      createdAt:       serverTimestamp(),
    });
    batch.update(userRef, {
      credits:     increment(LINK_BONUS),
      totalEarned: increment(LINK_BONUS),
    });
    await batch.commit();

    // Inbox confirmation (non-critical — failure doesn't roll back the submission)
    await sendSelfNotification(
      user.uid,
      "Link Shared — Credits Awarded!",
      `Your link "${title}" is now live in the community! You earned +${LINK_BONUS} credits. If 3 or more users report it as fake your credits will be reversed.`,
      "link"
    );

    submitted = true;
    if (linkSuccessEl) {
      linkSuccessEl.textContent =
        `Your link is live! You earned +${LINK_BONUS} credits. Redirecting…`;
    }
    linkForm.reset();

    // Redirect back to the main page after a short delay so the user
    // can see their submitted link appear in the community grid.
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  } catch (err) {
    console.error("Link submit error:", err);
    if (linkErrorEl) linkErrorEl.textContent = "Failed to submit link. Please try again.";
  } finally {
    // Only re-enable the button on failure; on success the page redirects.
    if (!submitted && linkSubmitBtn) {
      linkSubmitBtn.disabled    = false;
      linkSubmitBtn.textContent = `Share Link (+${LINK_BONUS} credits)`;
    }
  }
}

if (linkForm) {
  linkForm.addEventListener("submit", handleLinkSubmit);
}
