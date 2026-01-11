import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const firstInput = document.getElementById("onboardFirst");
const lastInput = document.getElementById("onboardLast");
const gradeSelect = document.getElementById("onboardGrade");
const saveBtn = document.getElementById("onboardSave");
const errorEl = document.getElementById("onboardError");

let _isSaving = false;

function setSavingState(on){
  _isSaving = !!on;
  if(saveBtn){
    saveBtn.disabled = _isSaving;
    saveBtn.textContent = _isSaving ? "Saving…" : "Save & Continue";
  }
}

export function showOnboarding(){
  if(!onboardModal) return;
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
  setTimeout(()=> firstInput?.focus(), 50);
}

export function hideOnboarding(){
  if(!onboardModal) return;
  onboardModal.classList.add("hidden");
  onboardModal.setAttribute("aria-hidden", "true");
}

/**
 * FIXED: Fetches fresh data and tells the rest of the app to update
 */
async function finalizeOnboarding(uid, firstName) {
  try {
    // 1. Get the full fresh document from Firebase
    const snap = await getDoc(doc(db, "users", uid));
    const freshData = snap.data();

    // 2. Remove the signup flag
    sessionStorage.removeItem("justSignedUp");

    // 3. IMPORTANT: Tell auth.js and dashboard.js to re-render with the NEW name
    // We do this by dispatching a custom event that your other files can hear
    const updateEvent = new CustomEvent("userProfileUpdated", { detail: freshData });
    window.dispatchEvent(updateEvent);

    // 4. Show success and close
    showSuccessAndClose(firstName);
  } catch (e) {
    console.error("Finalize error:", e);
    hideOnboarding();
  }
}

function showSuccessAndClose(name){
  const panel = onboardModal.querySelector(".panel");
  if(!panel) return;

  panel.innerHTML = `
    <div class="flex flex-col items-center gap-4 py-6">
      <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white text-3xl shadow-lg animate-bounce">✓</div>
      <div class="text-xl font-bold">Welcome, ${name}!</div>
      <p class="text-gray-400 text-sm">Setting up your dashboard...</p>
    </div>
  `;

  setTimeout(() => {
    hideOnboarding();
    // Refresh page to ensure all modules (Referrals, Dashboard) sync up
    location.reload(); 
  }, 1500);
}

saveBtn?.addEventListener("click", async () => {
  if(_isSaving) return;
  const uid = auth.currentUser?.uid;
  if(!uid) return;

  const first = firstInput.value.trim();
  const last = lastInput.value.trim();
  const grade = gradeSelect.value;

  if(!first){
    errorEl.textContent = "First name is required.";
    return;
  }

  setSavingState(true);

  try {
    // Update the existing document created in login.js
    await updateDoc(doc(db, "users", uid), {
      firstName: first,
      lastName: last,
      grade: grade,
      onboardingComplete: true // Added a flag to help auth.js
    });

    await finalizeOnboarding(uid, first);
  } catch(err) {
    console.error(err);
    errorEl.textContent = "Failed to save. Try again.";
    setSavingState(false);
  }
});

// Helper for Enter Key
[firstInput, lastInput].forEach(el => {
  el?.addEventListener("keydown", e => { if(e.key === "Enter") saveBtn.click(); });
});
