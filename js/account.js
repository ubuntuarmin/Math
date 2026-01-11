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

/**
 * Updates the visual account page with user data
 */
export async function updateAccount(userData) {
    let data = userData || {};

    // If data is empty, try to fetch it from the database
    if (!data.firstName && auth.currentUser) {
        try {
            const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (snap.exists()) data = snap.data();
        } catch (err) {
            console.error("Account Refresh Error:", err);
        }
    }

    // Update Header Text
    if (accountInfo) {
        accountInfo.innerHTML = `
            <div class="text-2xl font-bold text-white">${data.firstName || "Student"} ${data.lastName || ""}</div>
            <div class="text-gray-400">Grade: <span class="text-blue-400">${data.grade || "Not Set"}</span></div>
            <div class="text-sm text-green-500 mt-1 font-semibold">Total Earned: ${data.totalEarned || 0} 🪙</div>
        `;
    }

    if (totalMinutesEl) totalMinutesEl.textContent = data.totalMinutes || 0;

    // Sync Edit Inputs
    if (editFirst) editFirst.value = data.firstName || "";
    if (editLast) editLast.value = data.lastName || "";
    if (editGrade) editGrade.value = data.grade || "";

    // IMPORTANT: Render the Link, not just the code
    renderReferralUI(data.referralCode);
}

/**
 * Creates the referral link box with a copy button
 */
function renderReferralUI(code) {
    if (!referralArea) return;
    if (!code) {
        referralArea.innerHTML = `<div class="text-sm text-gray-500 italic">Generating referral code...</div>`;
        return;
    }

    // Construct the full URL for the student
    const fullLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

    referralArea.innerHTML = `
        <div class="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
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

            // Fetch final doc to ensure all fields are local
            const snap = await getDoc(userRef);
            updateAccount(snap.data());

            editForm.classList.add("hidden");
            showEditBtn.classList.remove("hidden");
            
            // Dispatch event so Header and Welcome overlays update names
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
