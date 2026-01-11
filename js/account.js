import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");
const referralArea = document.getElementById("referralArea");

// Edit Profile Elements
const editForm = document.getElementById("editProfileForm");
const showEditBtn = document.getElementById("showEditBtn");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

// Input Fields
const editFirst = document.getElementById("editFirst");
const editLast = document.getElementById("editLast");
const editGrade = document.getElementById("editGrade");

/**
 * Main function to update the Account page UI
 * @param {Object} userData - User data from Firestore
 */
export async function updateAccount(userData) {
  let data = userData || {};

  try {
    // If critical fields are missing, fetch fresh data using current Auth user
    if (!data.referralCode && auth.currentUser) {
      const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (snap.exists()) data = snap.data();
    }
  } catch (err) {
    console.error("Failed to refresh account data:", err);
  }

  // 1. Render Read-Only View
  accountInfo.innerHTML = `
    <div class="text-xl font-bold text-white mb-1">
      ${data.firstName || ""} ${data.lastName || ""}
    </div>
    <div class="text-gray-300">Grade: <span class="text-blue-400 font-medium">${data.grade || "Not Set"}</span></div>
    <div class="text-sm text-green-400 mt-1 italic">Total Earned: ${data.totalEarned || 0} 🪙</div>
  `;

  totalMinutesEl.textContent = data.totalMinutes || 0;

  // 2. Pre-fill the Edit Form with current data
  if (editFirst) editFirst.value = data.firstName || "";
  if (editLast) editLast.value = data.lastName || "";
  if (editGrade) editGrade.value = data.grade || "";

  // 3. Render Referral Section
  renderReferral(data.referralCode);
}

/**
 * Handles the logic for updating the user document in Firestore
 */
async function handleSaveProfile() {
  if (!auth.currentUser) return;

  const userRef = doc(db, "users", auth.currentUser.uid);
  const updatedData = {
    firstName: editFirst.value.trim(),
    lastName: editLast.value.trim(),
    grade: editGrade.value
  };

  try {
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Saving...";

    // Update Firestore
    await updateDoc(userRef, updatedData);

    // Update UI
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      await updateAccount(snap.data());
    }

    alert("Profile updated successfully!");
    editForm.classList.add("hidden");
  } catch (error) {
    console.error("Error updating profile:", error);
    alert("Could not update profile. Please try again.");
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "Save Changes";
  }
}

/**
 * Helper to render the referral code and copy button logic
 */
function renderReferral(code) {
  if (code) {
    referralArea.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-sm">Referral code:</div>
        <div class="text-sm font-mono bg-gray-900 px-2 py-1 rounded border border-gray-700">${code}</div>
        <button id="copyReferral" class="text-xs bg-blue-600 hover:bg-blue-700 transition px-2 py-1 rounded">Copy</button>
      </div>
      <div class="text-xs text-gray-400 mt-2">Share this code with friends — you'll get rewarded when they sign up.</div>
    `;

    const btn = document.getElementById("copyReferral");
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      } catch (e) {
        alert("Referral code: " + code);
      }
    };
  } else {
    referralArea.innerHTML = `<div class="text-sm text-gray-400">No referral code available.</div>`;
  }
}

// Event Listeners for Edit Mode
if (showEditBtn) {
  showEditBtn.onclick = () => editForm.classList.remove("hidden");
}

if (cancelEditBtn) {
  cancelEditBtn.onclick = () => editForm.classList.add("hidden");
}

if (saveProfileBtn) {
  saveProfileBtn.onclick = handleSaveProfile;
}
