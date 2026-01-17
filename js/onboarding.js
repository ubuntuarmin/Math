import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const firstInput = document.getElementById("onboardFirst");
const lastInput = document.getElementById("onboardLast");
const gradeSelect = document.getElementById("onboardGrade");
const saveBtn = document.getElementById("onboardSave");
const errorEl = document.getElementById("onboardError");

let _isSaving = false;

function setSavingState(on) {
  _isSaving = !!on;
  if (saveBtn) {
    saveBtn.disabled = _isSaving;
    saveBtn.textContent = _isSaving ? "Saving…" : "Save & Continue";
  }
}

export function showOnboarding() {
  if (!onboardModal) return;
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
  // Clear any old errors
  if (errorEl) errorEl.textContent = "";
  setTimeout(() => firstInput?.focus(), 50);
}

export function hideOnboarding() {
  if (!onboardModal) return;
  onboardModal.classList.add("hidden");
  onboardModal.setAttribute("aria-hidden", "true");
}

/**
 * Fetch fresh user data and notify rest of app
 */
async function finalizeOnboarding(uid, firstName) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const freshData = snap.data() || {};

    // Remove the signup flag
    sessionStorage.removeItem("justSignedUp");

    // Notify other modules (auth.js listens for this)
    const updateEvent = new CustomEvent("userProfileUpdated", {
      detail: freshData,
    });
    window.dispatchEvent(updateEvent);

    // Show success UX
    showSuccessAndClose(firstName);
  } catch (e) {
    console.error("Finalize error:", e);
    hideOnboarding();
  }
}

function showSuccessAndClose(name) {
  const panel = onboardModal?.querySelector(".panel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="flex flex-col items-center gap-4 py-6">
      <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white text-3xl shadow-lg animate-bounce">
        ✓
      </div>
      <div class="text-xl font-bold">Welcome, ${name || "Student"}!</div>
      <p class="text-gray-400 text-sm text-center max-w-sm">
        Your profile is set. We’ll use this to pick the right links and track your progress.
      </p>
    </div>
  `;

  setTimeout(() => {
    hideOnboarding();
    // No hard reload needed here; auth.js and dashboard react to userProfileUpdated
  }, 1500);
}

async function handleSave() {
  if (_isSaving) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const first = (firstInput?.value || "").trim();
  const last = (lastInput?.value || "").trim();
  const grade = gradeSelect?.value || "";

  if (errorEl) errorEl.textContent = "";

  // VALIDATION
  if (!first || first.length < 2) {
    if (errorEl) errorEl.textContent = "Please enter your first name (at least 2 characters).";
    firstInput?.focus();
    return;
  }

  if (first.length > 20) {
    if (errorEl) errorEl.textContent = "First name is too long (max 20 characters).";
    firstInput?.focus();
    return;
  }

  if (!grade) {
    if (errorEl) errorEl.textContent = "Please select your grade.";
    gradeSelect?.focus();
    return;
  }

  setSavingState(true);

  try {
    await updateDoc(doc(db, "users", uid), {
      firstName: first,
      lastName: last,
      grade: grade,
      onboardingComplete: true,
    });

    await finalizeOnboarding(uid, first);
  } catch (err) {
    console.error("Onboarding save error:", err);
    if (errorEl) errorEl.textContent = "Failed to save. Please try again.";
    setSavingState(false);
  }
}

// Button click
saveBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSave();
});

// Enter key helper
[firstInput, lastInput].forEach((el) => {
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  });
});
