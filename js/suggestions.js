import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  increment,
  addDoc,
  collection,
  serverTimestamp,
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

    // Get current user data to check credits and email
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      if (errorEl) errorEl.textContent = "User profile not found. Please try again later.";
      return;
    }

    const data = snap.data();
    const currentCredits = data.credits || 0;

    if (currentCredits < SUGGESTION_COST) {
      if (errorEl) errorEl.textContent = `You need at least ${SUGGESTION_COST} credits to submit a suggestion.`;
      return;
    }

    // 1) Deduct credits
    await updateDoc(userRef, {
      credits: increment(-SUGGESTION_COST),
    });

    // 2) Create suggestion document
    await addDoc(collection(db, "suggestions"), {
      userId: user.uid,
      email: data.email || user.email || "",
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

    // 3) Send confirmation to inbox
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
    console.error("Suggestion submit error:", err);
    if (errorEl) errorEl.textContent = "Failed to submit suggestion. Please try again.";
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

  try {
    linkSubmitBtn.disabled = true;
    linkSubmitBtn.textContent = "Submitting...";

    // Fetch user profile for display name
    const userRef = doc(db, "users", user.uid);
    const snap    = await getDoc(userRef);
    const data    = snap.exists() ? snap.data() : {};
    const displayName =
      [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "Anonymous";

    // 1) Add to sharedLinks — auto-approved and immediately live
    await addDoc(collection(db, "sharedLinks"), {
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

    // 2) Award credits immediately
    await updateDoc(userRef, {
      credits:     increment(LINK_BONUS),
      totalEarned: increment(LINK_BONUS),
    });

    // 3) Inbox confirmation
    await sendSelfNotification(
      user.uid,
      "Link Shared — Credits Awarded!",
      `Your link "${title}" is now live in the community! You earned +${LINK_BONUS} credits. If 3 or more users report it as fake your credits will be reversed.`,
      "link"
    );

    if (linkSuccessEl) {
      linkSuccessEl.textContent =
        `Your link is live! You earned +${LINK_BONUS} credits.`;
    }
    linkForm.reset();
  } catch (err) {
    console.error("Link submit error:", err);
    if (linkErrorEl) linkErrorEl.textContent = "Failed to submit link. Please try again.";
  } finally {
    if (linkSubmitBtn) {
      linkSubmitBtn.disabled    = false;
      linkSubmitBtn.textContent = `Share Link (+${LINK_BONUS} credits)`;
    }
  }
}

if (linkForm) {
  linkForm.addEventListener("submit", handleLinkSubmit);
}

