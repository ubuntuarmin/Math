// Onboarding modal shown after sign-up. Collects first/last name and grade and writes to Firestore.
import { auth, db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const firstInput = document.getElementById("onboardFirst");
const lastInput = document.getElementById("onboardLast");
const gradeSelect = document.getElementById("onboardGrade");
const saveBtn = document.getElementById("onboardSave");
const errorEl = document.getElementById("onboardError");

export function showOnboarding(){
  if(!onboardModal) return;
  errorEl.textContent = "";
  firstInput.value = "";
  lastInput.value = "";
  gradeSelect.value = "";
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
}

export function hideOnboarding(){
  if(!onboardModal) return;
  onboardModal.classList.add("hidden");
  onboardModal.setAttribute("aria-hidden", "true");
}

// Save onboarding info to Firestore
saveBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  const uid = auth.currentUser?.uid;
  if(!uid){ errorEl.textContent = "Not signed in."; return; }
  const first = firstInput.value.trim();
  const last = lastInput.value.trim();
  const grade = gradeSelect.value || "";
  if(!first){ errorEl.textContent = "Please enter a first name."; return; }

  try{
    await updateDoc(doc(db,"users",uid), {
      firstName: first,
      lastName: last,
      grade
    });
    // clear session flag and hide onboarding
    sessionStorage.removeItem("justSignedUp");
    hideOnboarding();
    // notify other modules by triggering an auth state refresh: fire a fake event by reloading user doc via onAuthStateChanged already running in auth.js
    // to keep it simple we reload the page state by calling a small event
    const ev = new CustomEvent("userProfileUpdated");
    window.dispatchEvent(ev);
  }catch(err){
    console.error("Onboarding save failed:", err);
    errorEl.textContent = "Failed to save — try again.";
  }
});
