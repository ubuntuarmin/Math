import { db, auth } from "./firebase.js";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");

// Simple security check (Optional: ask for a password before showing data)
async function initAdmin() {
    // Only fetch if a user is logged in
    auth.onAuthStateChanged(user => {
        if (!user) {
            alert("Please login as admin first");
            window.location.href = "index.html";
        } else {
            loadAllUsers();
        }
    });
}

async function loadAllUsers() {
    userListEl.innerHTML = "";
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        
        querySnapshot.forEach((userDoc) => {
            const u = userDoc.data();
            const row = document.createElement("tr");
            row.className = "border-b border-slate-800 hover:bg-slate-800/50 transition";
            
            row.innerHTML = `
                <td class="p-4 font-bold">${u.firstName || '???'} ${u.lastName || ''}</td>
                <td class="p-4 text-slate-400">${u.grade || 'N/A'}</td>
                <td class="p-4 text-emerald-400 font-mono">${u.credits || 0}</td>
                <td class="p-4 font-mono">${u.totalMinutes || 0}m</td>
                <td class="p-4 text-right">
                    <button class="del-user-btn bg-red-900/30 hover:bg-red-600 text-red-500 hover:text-white px-3 py-1 rounded text-xs transition" data-id="${userDoc.id}">
                        Delete Account
                    </button>
                </td>
            `;
            userListEl.appendChild(row);
        });

        // Attach Delete Listeners
        document.querySelectorAll(".del-user-btn").forEach(btn => {
            btn.onclick = () => deleteUserAccount(btn.dataset.id);
        });

    } catch (err) {
        console.error("Admin fetch error:", err);
        userListEl.innerHTML = `<tr><td colspan="5" class="p-4 text-red-500">Error: Permission Denied. Check Firebase Rules.</td></tr>`;
    }
}

async function deleteUserAccount(userId) {
    if (confirm("Permanently delete this student's data? This cannot be undone.")) {
        await deleteDoc(doc(db, "users", userId));
        loadAllUsers(); // Refresh
    }
}

// Reset Weekly Leaderboard logic
resetBtn.onclick = async () => {
    if (confirm("Reset everyone's Weekly Credits to 0? (Lifetime credits will be saved)")) {
        resetBtn.disabled = true;
        resetBtn.textContent = "Resetting...";
        
        const querySnapshot = await getDocs(collection(db, "users"));
        const promises = [];
        
        querySnapshot.forEach((userDoc) => {
            const userRef = doc(db, "users", userDoc.id);
            promises.push(updateDoc(userRef, { weeklyCredits: 0 }));
        });

        await Promise.all(promises);
        alert("Leaderboard has been reset!");
        resetBtn.disabled = false;
        resetBtn.textContent = "🔄 Reset Weekly Leaderboard";
        loadAllUsers();
    }
};

initAdmin();
