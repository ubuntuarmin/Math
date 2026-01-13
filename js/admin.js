import { db, auth } from "./firebase.js";
import { 
    collection, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    orderBy, 
    limit, 
    increment 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");

// Your Unique Admin ID
const ADMIN_UID = "bnGhRvqW1YhvGek1JTLuAed6Ib63";

/**
 * Authorization & Initial Load
 */
async function initAdmin() {
    auth.onAuthStateChanged(user => {
        if (!user || user.uid !== ADMIN_UID) {
            console.warn("Unauthorized access. Redirecting...");
            window.location.href = "index.html";
        } else {
            loadAllUsers();
        }
    });
}

/**
 * Helper: Reward Logic
 * Rank 1 = 100, Rank 2 = 90 ... Rank 10 = 10
 */
function getRewardAmount(rank) {
    if (rank > 10) return 0;
    return 110 - (rank * 10);
}

/**
 * THE BIG ACTION: 
 * 1. Distributes Credits to Top 10
 * 2. Resets Weekly Minutes for Everyone
 */
resetBtn.onclick = async () => {
    const confirmAction = confirm(
        "🚨 CRITICAL ACTION 🚨\n\n" +
        "This will:\n" +
        "1. Give bonus credits to the Top 10 (1st: 100, 2nd: 90, etc.)\n" +
        "2. Clear all 'This Week' minutes for every student.\n\n" +
        "Do you want to proceed?"
    );

    if (!confirmAction) return;

    // UI Feedback: Disable button
    resetBtn.disabled = true;
    const originalText = resetBtn.innerHTML;
    resetBtn.innerHTML = `⏳ Processing Rewards...`;

    try {
        // --- STEP 1: Find Top 10 Active Users ---
        const topQuery = query(
            collection(db, "users"), 
            orderBy("weekMinutes", "desc"), 
            limit(10)
        );
        const topSnap = await getDocs(topQuery);
        
        const rewardPromises = [];
        let rank = 1;

        topSnap.forEach((userDoc) => {
            const userData = userDoc.data();
            // Only reward if they actually played (minutes > 0)
            if ((userData.weekMinutes || 0) > 0) {
                const reward = getRewardAmount(rank);
                const userRef = doc(db, "users", userDoc.id);
                
                console.log(`Rewarding Rank ${rank} (${userData.email}): +${reward} 🪙`);
                
                rewardPromises.push(updateDoc(userRef, {
                    credits: increment(reward),
                    totalEarned: increment(reward)
                }));
                rank++;
            }
        });

        // Run all reward updates
        await Promise.all(rewardPromises);
        console.log("✅ Rewards distributed.");

        // --- STEP 2: Global Reset of Weekly Minutes ---
        resetBtn.innerHTML = `🧹 Resetting Leaderboard...`;
        
        const allUsersSnap = await getDocs(collection(db, "users"));
        const resetPromises = allUsersSnap.docs.map(userDoc => {
            return updateDoc(doc(db, "users", userDoc.id), { weekMinutes: 0 });
        });

        await Promise.all(resetPromises);
        
        alert(`Success! Distributed rewards to ${rank - 1} students and reset the leaderboard.`);

    } catch (error) {
        console.error("Critical Reset Error:", error);
        alert("An error occurred. Check the console for details.");
    } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = originalText;
        loadAllUsers(); // Refresh the table
    }
};

/**
 * UI: Fetch and Render User List
 */
async function loadAllUsers() {
    userListEl.innerHTML = `
        <tr>
            <td colspan="6" class="p-10 text-center">
                <div class="flex flex-col items-center gap-2">
                    <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span class="text-xs text-slate-500 uppercase font-bold tracking-widest">Refreshing Students...</span>
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
                <td class="p-4 font-bold user-name text-white">
                    ${u.firstName || '???'} ${u.lastName || ''}
                </td>
                <td class="p-4 text-slate-400 text-xs font-mono">${u.email || 'No Email'}</td>
                <td class="p-4 text-slate-400 font-medium">${u.grade || 'N/A'}</td>
                <td class="p-4 text-emerald-400 font-mono font-bold">${u.credits || 0}</td>
                <td class="p-4 font-mono text-blue-400 font-bold">${u.weekMinutes || 0}m</td>
                <td class="p-4 text-right">
                    <button class="del-user-btn bg-red-900/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                            data-id="${userDoc.id}">
                        Delete
                    </button>
                </td>
            `;
            userListEl.appendChild(row);
        });

        // Re-attach delete listeners
        document.querySelectorAll(".del-user-btn").forEach(btn => {
            btn.onclick = () => deleteUserAccount(btn.dataset.id);
        });

    } catch (err) {
        console.error("Load All Users Error:", err);
        userListEl.innerHTML = `<tr><td colspan="6" class="p-10 text-red-500 text-center font-bold">Access Denied. Check Firestore Rules.</td></tr>`;
    }
}

/**
 * Live Search Filter
 */
if (searchInput) {
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll(".user-row").forEach(row => {
            const name = row.querySelector(".user-name").textContent.toLowerCase();
            const email = row.cells[1].textContent.toLowerCase();
            row.style.display = (name.includes(term) || email.includes(term)) ? "" : "none";
        });
    };
}

/**
 * Permanently Delete Student Data
 */
async function deleteUserAccount(userId) {
    if (confirm("🚨 WARNING: Delete this student's data permanently? This action is irreversible.")) {
        try {
            await deleteDoc(doc(db, "users", userId));
            loadAllUsers();
        } catch (err) {
            console.error("Delete failed:", err);
            alert("Permission denied. Could not delete user.");
        }
    }
}

// Start Admin Check
initAdmin();
