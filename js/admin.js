import { db, auth } from "./firebase.js";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");

// Your Unique Admin ID
const ADMIN_UID = "bnGhRvqW1YhvGek1JTLuAed6Ib63";

/**
 * Initializes the admin panel and checks for authorization
 */
async function initAdmin() {
    auth.onAuthStateChanged(user => {
        if (!user || user.uid !== ADMIN_UID) {
            console.warn("Unauthorized access attempt.");
            window.location.href = "index.html"; // Redirect non-admins
        } else {
            loadAllUsers();
        }
    });
}

/**
 * Fetches all users from Firestore and populates the table
 */
async function loadAllUsers() {
    userListEl.innerHTML = `
        <tr>
            <td colspan="6" class="p-10 text-center">
                <div class="flex flex-col items-center gap-2">
                    <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span class="text-xs text-slate-500 uppercase tracking-widest">Refreshing Database...</span>
                </div>
            </td>
        </tr>
    `;

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        userListEl.innerHTML = "";
        
        querySnapshot.forEach((userDoc) => {
            const u = userDoc.data();
            const row = document.createElement("tr");
            row.className = "border-b border-slate-800 hover:bg-slate-800/50 transition user-row";
            
            row.innerHTML = `
                <td class="p-4 font-bold user-name">${u.firstName || '???'} ${u.lastName || ''}</td>
                <td class="p-4 text-slate-400 text-xs font-mono">${u.email || 'No Email'}</td>
                <td class="p-4 text-slate-400">${u.grade || 'N/A'}</td>
                <td class="p-4 text-emerald-400 font-mono">${u.credits || 0}</td>
                <td class="p-4 font-mono text-blue-400 font-bold">${u.weekMinutes || 0}m</td>
                <td class="p-4 text-right">
                    <button class="del-user-btn bg-red-900/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/50 px-3 py-1 rounded text-[10px] font-bold uppercase transition" data-id="${userDoc.id}">
                        Delete
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
        userListEl.innerHTML = `<tr><td colspan="6" class="p-10 text-red-500 text-center font-bold">PERMISSION DENIED: Check Firebase Rules or UID.</td></tr>`;
    }
}

/**
 * Resets the 'weekMinutes' field to 0 for all users
 */
resetBtn.onclick = async () => {
    const confirmReset = confirm("CRITICAL: Reset all 'This Week' minutes to 0? This will clear the leaderboard rankings.");
    if (!confirmReset) return;

    resetBtn.disabled = true;
    const originalText = resetBtn.innerHTML;
    resetBtn.innerHTML = `⏳ Resetting...`;

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const promises = [];

        querySnapshot.forEach((userDoc) => {
            const userRef = doc(db, "users", userDoc.id);
            // Specifically resets the leaderboard field
            promises.push(updateDoc(userRef, { 
                weekMinutes: 0 
            }));
        });

        await Promise.all(promises);
        alert("Weekly Leaderboard has been reset successfully.");
    } catch (error) {
        console.error("Reset failed:", error);
        alert("Error: Database update failed. Check console.");
    } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = originalText;
        loadAllUsers(); // Refresh the table
    }
};

/**
 * Live Search Filter Logic
 */
if (searchInput) {
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll(".user-row").forEach(row => {
            const name = row.querySelector(".user-name").textContent.toLowerCase();
            const email = row.cells[1].textContent.toLowerCase(); // Check email column too
            
            if (name.includes(term) || email.includes(term)) {
                row.style.display = "";
            } else {
                row.style.display = "none";
            }
        });
    };
}

/**
 * Permanently deletes a user's Firestore document
 */
async function deleteUserAccount(userId) {
    if (confirm("Permanently delete this student's data? This cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "users", userId));
            loadAllUsers();
        } catch (err) {
            console.error("Delete failed:", err);
            alert("Permission denied. Could not delete user.");
        }
    }
}

// Start Admin Session
initAdmin();
