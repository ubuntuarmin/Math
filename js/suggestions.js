import { auth, db } from "./firebase.js";
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

const form = document.getElementById("suggestionForm");
const typeInput = document.getElementById("suggestionType");
const titleInput = document.getElementById("suggestionTitle");
const textInput = document.getElementById("suggestionText");
const submitBtn = document.getElementById("suggestionSubmit");
const errorEl = document.getElementById("suggestionError");
const successEl = document.getElementById("suggestionSuccess");

/**
 * Helper: send a notification message to the current user
 */
async function sendSelfNotification(uid, text) {
  try {
    await addDoc(collection(db, "messages"), {
      to: uid,
      fromName: "System",
      title: "Suggestion Submitted",
      text,
      type: "suggestion",
      timestamp: serverTimestamp(),
      read: false,
    });
  } catch (err) {
    console.warn("Failed to send suggestion notification:", err);
  }
}

async function handleSubmit(e) {
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
      `Your ${type === "bug" ? "bug report" : "feature request"} "${title}" was submitted. 20 credits were held as a deposit. If it's helpful, the admin will refund your 20 credits and may give you bonus tokens.`
    );

    if (successEl) {
      successEl.textContent = "Thank you! Your suggestion was submitted. 20 credits were deducted as a deposit.";
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
  form.addEventListener("submit", handleSubmit);
}
