import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");
const referralArea = document.getElementById("referralArea");

// Form Elements
const editForm = document.getElementById("editProfileForm");
const showEditBtn = document.getElementById("showEditBtn");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const editFirst = document.getElementById("editFirst");
const editLast = document.getElementById("editLast");
const editGrade = document.getElementById("editGrade");

export async function updateAccount(userData) {
  let data = userData || {};

  try {
    if (!data.referralCode && auth.currentUser) {
      const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (snap.exists()) data = snap.data();
    }
  } catch (err) {
    console.error("Account Refresh Error:", err);
  }

  // Display view
  accountInfo.innerHTML = `
    <div class="text-2xl font-bold text-white">${data.firstName || ""} ${data.lastName || ""}</div>
    <div class="text-gray-400">Grade: <span class="text-blue-400">${data.grade || "Not Set"}</span></div>
    <div class="text-sm text-green-500 mt-1">Total Earned: ${data.totalEarned || 0} 🪙</div>
  `;

  if (totalMinutesEl) totalMinutesEl.textContent = data.totalMinutes || 0;

  // Pre-fill inputs for editing
  if (editFirst) editFirst.value = data.firstName || "";
  if (editLast) editLast.value = data.lastName || "";
  if (editGrade) editGrade.value = data.grade || "";

  renderReferral(data.referralCode);
}

// TOGGLE VISIBILITY LOGIC
if (showEditBtn) {
  showEditBtn.onclick = () => {
    editForm.classList.remove("hidden"); // Shows the form
    showEditBtn.classList.add("hidden"); // Hides the "Edit Profile" link
  };
}

if (cancelEditBtn) {
  cancelEditBtn.onclick = () => {
    editForm.classList.add("hidden");    // Hides the form
    showEditBtn.classList.remove("hidden"); // Shows the "Edit Profile" link
  };
}

// SAVE LOGIC
if (saveProfileBtn) {
  saveProfileBtn.onclick = async () => {
    if (!auth.currentUser) return;

    const userRef = doc(db, "users", auth.currentUser.uid);
    
    try {
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = "Saving...";

      await updateDoc(userRef, {
        firstName: editFirst.value.trim(),
        lastName: editLast.value.trim(),
        grade: editGrade.value
      });

      // Refresh data and close form
      const updatedSnap = await getDoc(userRef);
      updateAccount(updatedSnap.data());
      
      editForm.classList.add("hidden");
      showEditBtn.classList.remove("hidden");
      alert("Profile updated!");
    } catch (err) {
      console.error("Update failed:", err);
      alert("Error saving profile.");
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = "Save Changes";
    }
  };
}

function renderReferral(code) {
  if (!referralArea) return;
  if (code) {
    referralArea.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-sm">Referral code:</div>
        <div class="text-sm font-mono bg-gray-900 px-2 py-1 rounded border border-gray-700">${code}</div>
        <button id="copyReferral" class="text-xs bg-blue-600 px-2 py-1 rounded">Copy</button>
      </div>
    `;
    const btn = document.getElementById("copyReferral");
    btn.onclick = async () => {
      await navigator.clipboard.writeText(code);
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "Copy", 1500);
    };
  } else {
    referralArea.innerHTML = `<div class="text-sm text-gray-400">No referral code available.</div>`;
  }
}
