import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier, getNextTierInfo } from "./tier.js"; 
import { handleDeleteAccount } from "./deleteAccount.js"; // Moved to top

const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");
const referralArea = document.getElementById("referralArea");

// Form Elements
const editForm = document.getElementById("editProfileForm");
const showEditBtn = document.getElementById("showEditBtn");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const deleteBtn = document.getElementById("deleteAccountBtn"); // Target the new button

const editFirst = document.getElementById("editFirst");
const editLast = document.getElementById("editLast");
const editGrade = document.getElementById("editGrade");

/**
 * Updates the visual account page with user data and Tier progress
 */
export async function updateAccount(userData) {
    let data = userData || {};

    if (!data.firstName && auth.currentUser) {
        try {
            const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (snap.exists()) data = snap.data();
        } catch (err) {
            console.error("Account Refresh Error:", err);
        }
    }

    // --- Tier Logic ---
    const currentCredits = data.totalEarned || 0;
    const tier = calculateTier(currentCredits);
    const nextTier = getNextTierInfo(currentCredits);

    // Calculate progress bar percentage
    let progressPct = 0;
    if (nextTier.remaining > 0) {
        const goal = currentCredits + nextTier.remaining;
        progressPct = Math.min((currentCredits / goal) * 100, 100);
    } else {
        progressPct = 100; // VIP
    }

    // Update Main Profile & Progress UI
    if (accountInfo) {
        accountInfo.innerHTML = `
            <div class="mb-6">
                <div class="text-2xl font-bold text-white">${data.firstName || "Student"} ${data.lastName || ""}</div>
                <div class="text-gray-400 text-sm">Grade: <span class="text-blue-400">${data.grade || "Not Set"}</span></div>
            </div>

            <div class="bg-gray-900/80 p-5 rounded-2xl border border-gray-700 mb-6 shadow-xl">
                <div class="flex justify-between items-end mb-3">
                    <div>
                        <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Rank Status</div>
                        <div class="text-xl font-black" style="color: ${tier.color}">${tier.name} Tier</div>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Play Limit</div>
                        <div class="text-lg text-white font-bold">${tier.limitMinutes}m / day</div>
                    </div>
                </div>

                <div class="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-gray-700 shadow-inner">
                    <div class="h-full transition-all duration-1000 ease-out" 
                         style="width: ${progressPct}%; background-color: ${tier.color}; box-shadow: 0 0 12px ${tier.color}66;">
                    </div>
                </div>
                
                <div class="mt-3 text-center">
                    <span class="text-xs text-blue-400 italic font-medium">${nextTier.message}</span>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4 mb-2">
                <div class="bg-gray-800/40 p-3 rounded-xl border border-gray-700 text-center">
                    <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Lifetime Credits</div>
                    <div class="text-xl font-bold text-emerald-400">${currentCredits} 🪙</div>
                </div>
                <div class="bg-gray-800/40 p-3 rounded-xl border border-gray-700 text-center">
                    <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Total Minutes</div>
                    <div class="text-xl font-bold text-white">${data.totalMinutes || 0}</div>
                </div>
            </div>
        `;
    }

    // Sync Edit Inputs
    if (editFirst) editFirst.value = data.firstName || "";
    if (editLast) editLast.value = data.lastName || "";
    if (editGrade) editGrade.value = data.grade || "";

    renderReferralUI(data.referralCode);
}

/**
 * Creates the referral link box
 */
function renderReferralUI(code) {
    if (!referralArea) return;
    if (!code) {
        referralArea.innerHTML = `<div class="text-sm text-gray-500 italic">Generating referral code...</div>`;
        return;
    }

    const fullLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

    referralArea.innerHTML = `
        <div class="mt-4 p-4 bg-gray-900/50 rounded-xl border border-gray-700">
            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">Your Invite Link</div>
            <div class="flex items-center gap-2">
                <input readonly value="${fullLink}" class="bg-gray-950 text-xs p-2 rounded border border-gray-800 w-full text-blue-300 font-mono outline-none">
                <button id="copyRefBtn" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded font-bold transition">Copy</button>
            </div>
            <div class="text-[10px] text-gray-500 mt-2">Friends get 50 credits when they join using this link!</div>
        </div>
    `;

    const btn = document.getElementById("copyRefBtn");
    btn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(fullLink);
            btn.textContent = "COPIED!";
            btn.classList.replace("bg-blue-600", "bg-green-600");
            setTimeout(() => {
                btn.textContent = "COPY";
                btn.classList.replace("bg-green-600", "bg-blue-600");
            }, 2000);
        } catch (e) {
            alert("Referral Link: " + fullLink);
        }
    };
}

// --- Event Listeners ---

if (showEditBtn) {
    showEditBtn.onclick = () => {
        editForm?.classList.remove("hidden");
        showEditBtn.classList.add("hidden");
    };
}

if (cancelEditBtn) {
    cancelEditBtn.onclick = () => {
        editForm?.classList.add("hidden");
        showEditBtn?.classList.remove("hidden");
    };
}

if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        if (!auth.currentUser) return;
        const userRef = doc(db, "users", auth.currentUser.uid);

        try {
            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = "Saving...";

            const updatedData = {
                firstName: editFirst.value.trim(),
                lastName: editLast.value.trim(),
                grade: editGrade.value
            };

            await updateDoc(userRef, updatedData);
            const snap = await getDoc(userRef);
            updateAccount(snap.data());

            editForm.classList.add("hidden");
            showEditBtn.classList.remove("hidden");
            
            window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: snap.data() }));

        } catch (err) {
            console.error(err);
            alert("Error saving profile.");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = "Save Changes";
        }
    };
}

// Danger Zone Listener
if (deleteBtn) {
    deleteBtn.onclick = () => handleDeleteAccount();
}
