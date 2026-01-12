import { db, auth } from "./firebase.js";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");

async function initAdmin() {
    auth.onAuthStateChanged(user => {
        if (!user || user.uid !== 'bnGhRvqW1YhvGek1JTLuAed6Ib63') {
            window.location.href = "index.html";
        } else {
            loadAllUsers();
        }
    });
}

async function loadAllUsers() {
    userListEl.innerHTML = `<tr><td colspan="5" class="p-10 text-center animate-pulse">Fetching users...</td></tr>`;
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        userListEl.innerHTML = "";
        
        querySnapshot.forEach((userDoc) => {
            const u = userDoc.data();
            const row = document.createElement("tr");
            row.className = "border-b border-slate-800 hover:bg-slate-800/50 transition user-row";
            
            row.innerHTML = `
                <td class="p-4 font-bold user-name">${u.firstName || '???'} ${u.lastName || ''}</td>
                <td class="p-4 text-slate-400">${u.grade || 'N/A'}</td>
                <td class="p-4 text-emerald-400 font-mono">${u.credits || 0}</td>
                <td class="p-4 font-mono">${u.weekMinutes || 0}m</td>
                <td class="p-4 text-right">
                    <button class="del-user-btn bg-red-900/30 hover:bg-red-600 text-red-500 hover:text-white px-3 py-1 rounded text-xs transition" data-id="${userDoc.id}">
                        Delete
                    </button>
                </td>
            `;
            userListEl.appendChild(row);
        });

        document.querySelectorAll(".del-user-btn").forEach(btn => {
            btn.onclick = () => deleteUserAccount(btn.dataset.id);
        });

    } catch (err) {
        userListEl.innerHTML = `<tr><td colspan="5" class="p-4 text-red-500 text-center">Permission Denied.</td></tr>`;
    }
}

// RESET WEEKLY TIME (LEADERBOARD)
resetBtn.onclick = async () => {
    const confirmReset = confirm("CRITICAL: This will set everyone's 'This Week' time to 0. Lifetime minutes will not be touched. Continue?");
    if (!confirmReset) return;

    resetBtn.disabled = true;
    resetBtn.innerHTML = `<span class="animate-spin inline-block mr-2">⏳</span> Resetting...`;

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const promises = [];

        querySnapshot.forEach((userDoc) => {
            const userRef = doc(db, "users", userDoc.id);
            // MATCHING YOUR LEADERBOARD FIELD: weekMinutes
            promises.push(updateDoc(userRef, { 
                weekMinutes: 0 
            }));
        });

        await Promise.all(promises);
        alert("Success! The weekly leaderboard is now fresh.");
    } catch (error) {
        console.error("Reset failed:", error);
        alert("Failed to reset leaderboard. See console.");
    } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = `🔄 Reset Weekly Leaderboard`;
        loadAllUsers();
    }
};

// SEARCH LOGIC
if (searchInput) {
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll(".user-row").forEach(row => {
            const name = row.querySelector(".user-name").textContent.toLowerCase();
            row.style.display = name.includes(term) ? "" : "none";
        });
    };
}

async function deleteUserAccount(userId) {
    if (confirm("Permanently delete this student and all their stats?")) {
        try {
            await deleteDoc(doc(db, "users", userId));
            loadAllUsers();
        } catch (err) {
            alert("Could not delete user.");
        }
    }
}

initAdmin();
