// Onboarding modal shown after sign-up. Collects first/last name and grade and writes to Firestore.
// Modal is non-dismissible by clicking outside; has validation, loading state, friendly success animation.

import { auth, db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const onboardPanel = document.getElementById("onboardPanel");
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
    saveBtn.setAttribute("aria-busy", _isSaving ? "true" : "false");
  }
  if(firstInput) firstInput.disabled = _isSaving;
  if(lastInput) lastInput.disabled = _isSaving;
  if(gradeSelect) gradeSelect.disabled = _isSaving;
}

// Prevent clicking outside from closing: stopPropagation on panel and overlay clicks do nothing
onboardPanel?.addEventListener("click", (e)=> e.stopPropagation());
onboardModal?.addEventListener("click", (e)=> { e.stopPropagation(); /* intentionally do nothing */ });

export function showOnboarding(){
  if(!onboardModal) return;
  errorEl.textContent = "";
  firstInput.value = "";
  lastInput.value = "";
  gradeSelect.value = "";
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
  // entrance animation
  onboardPanel?.animate([{ transform: "translateY(12px) scale(.98)", opacity: 0 }, { transform: "translateY(0) scale(1)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.9,.3,1)" });
  setTimeout(()=> firstInput?.focus(), 80);
}

export function hideOnboarding(){
  if(!onboardModal) return;
  const panel = onboardPanel;
  if(panel){
    const anim = panel.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.98)" }], { duration: 200, easing: "ease-in" });
    anim.onfinish = () => {
      onboardModal.classList.add("hidden");
      onboardModal.setAttribute("aria-hidden", "true");
    };
  }else{
    onboardModal.classList.add("hidden");
    onboardModal.setAttribute("aria-hidden", "true");
  }
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function showSuccessAndClose(name){
  if(!onboardPanel) return;
  const panel = onboardPanel;
  const successNode = document.createElement("div");
  successNode.style.display = "flex";
  successNode.style.flexDirection = "column";
  successNode.style.alignItems = "center";
  successNode.style.gap = "12px";
  successNode.innerHTML = `
    <div style="width:72px;height:72px;border-radius:16px;background:linear-gradient(135deg,#34d399,#60a5fa);display:flex;align-items:center;justify-content:center;font-size:34px;box-shadow:0 12px 30px rgba(2,6,23,0.4);">✓</div>
    <div style="font-weight:700;font-size:18px">Welcome, ${escapeHtml(name || "Learner")}!</div>
    <div style="opacity:.9;font-size:13px;color:rgba(255,255,255,.9)">You're all set — loading your dashboard...</div>
  `;

  panel.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.96)" }], { duration: 180, easing: "ease-out" })
    .onfinish = () => {
      panel.innerHTML = "";
      panel.appendChild(successNode);
      successNode.animate([{ opacity: 0, transform: "translateY(8px) scale(.98)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1)" });
    };

  setTimeout(()=>{
    try{ sessionStorage.removeItem("justSignedUp"); }catch(e){}
    window.dispatchEvent(new CustomEvent("userProfileUpdated"));
    hideOnboarding();
  }, 1200);
}

saveBtn?.addEventListener("click", async () => {
  errorEl.textContent = "";
  if(_isSaving) return;
  const uid = auth.currentUser?.uid;
  if(!uid){
    errorEl.textContent = "Not signed in. Please refresh and sign in again.";
    return;
  }
  const first = (firstInput.value || "").trim();
  const last = (lastInput.value || "").trim();
  const grade = (gradeSelect.value || "").trim();

  if(!first){
    errorEl.textContent = "Please enter a first name.";
    firstInput.focus();
    return;
  }
  if(first.length > 50 || last.length > 50){
    errorEl.textContent = "Name too long.";
    return;
  }

  setSavingState(true);
  try{
    await updateDoc(doc(db,"users",uid), { firstName: first, lastName: last, grade });
    showSuccessAndClose(first);
  }catch(err){
    console.error("Onboarding save failed:", err);
    const msg = (err && err.message) ? err.message : "Failed to save — please check your connection and try again.";
    errorEl.textContent = msg;
  }finally{
    setSavingState(false);
  }
});

// Enter key submits
[firstInput, lastInput, gradeSelect].forEach(el=>{
  el?.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); saveBtn?.click(); }
  });
});
