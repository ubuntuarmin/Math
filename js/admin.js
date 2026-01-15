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
    increment,
    addDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");

// Your Unique Admin ID
const ADMIN_UID = "bnGhRvqW1YhvGek1JTLuAed6Ib63";

/**
 * NEW: Send Inbox Message Logic
 */
async function sendNotification(targetUid, title, message, type = "admin") {
    try {
        // Change from a sub-collection to the top-level 'messages' collection
        const messagesRef = collection(db, "messages"); 
        await addDoc(messagesRef, {
            to: targetUid,               // Match the 'to' field in inbox.js
            fromName: "Admin",           // Match the 'fromName' field
            text: message,               // Change 'message' to 'text' to match inbox.js
            title: title,
            type: type, 
            timestamp: serverTimestamp(),
            read: false
        });
        return true;
    } catch (error) {
        console.error("Error sending notification:", error);
        return false;
    }
}

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

function getRewardAmount(rank) {
    if (rank > 10) return 0;
    return 110 - (rank * 10);
}

/**
 * THE BIG ACTION: 
 * 1. Distributes Credits to Top 10
 * 2. Sends Inbox Notifications for the reward
 * 3. Resets Weekly Minutes for Everyone
 */
resetBtn.onclick = async () => {
    const confirmAction = confirm(
        "🚨 CRITICAL ACTION 🚨\n\n" +
        "This will:\n" +
        "1. Give bonus credits to the Top 10\n" +
        "2. Send an Inbox message to winners\n" +
        "3. Clear all 'This Week' minutes.\n\n" +
        "Do you want to proceed?"
    );

    if (!confirmAction) return;

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
        
        const batchPromises = [];
        let rank = 1;

        for (const userDoc of topSnap.docs) {
            const userData = userDoc.data();
            if ((userData.weekMinutes || 0) > 0) {
                const reward = getRewardAmount(rank);
                const userRef = doc(db, "users", userDoc.id);
                
                // Update Credits
                batchPromises.push(updateDoc(userRef, {
                    credits: increment(reward),
                    totalEarned: increment(reward)
                }));

                // Send Inbox Notification
                batchPromises.push(sendNotification(
                    userDoc.id, 
                    "🏆 Leaderboard Reward!", 
                    `Congratulations! You finished Rank #${rank} this week and earned ${reward} credits.`, 
                    "credit"
                ));
                
                rank++;
            }
        }

        await Promise.all(batchPromises);

        // --- STEP 2: Global Reset ---
        resetBtn.innerHTML = `🧹 Resetting Leaderboard...`;
        const allUsersSnap = await getDocs(collection(db, "users"));
        const resetPromises = allUsersSnap.docs.map(userDoc => {
            return updateDoc(doc(db, "users", userDoc.id), { weekMinutes: 0 });
        });

        await Promise.all(resetPromises);
        alert(`Success! Distributed rewards and reset minutes.`);

    } catch (error) {
        console.error("Critical Reset Error:", error);
        alert("An error occurred.");
    } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = originalText;
        loadAllUsers(); 
    }
};

/**
 * UI: Fetch and Render User List
 */
async function loadAllUsers() {
    userListEl.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-white">Loading Students...</td></tr>`;

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
                <td class="p-4 text-right flex gap-2 justify-end">
                    <button class="msg-user-btn bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                            data-id="${userDoc.id}" data-name="${u.firstName}">
                        Message
                    </button>
                    <button class="del-user-btn bg-red-900/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                            data-id="${userDoc.id}">
                        Delete
                    </button>
                </td>
            `;
            userListEl.appendChild(row);
        });

        // Attach Message listeners
        document.querySelectorAll(".msg-user-btn").forEach(btn => {
            btn.onclick = () => manualNotify(btn.dataset.id, btn.dataset.name);
        });

        // Attach delete listeners
        document.querySelectorAll(".del-user-btn").forEach(btn => {
            btn.onclick = () => deleteUserAccount(btn.dataset.id);
        });

    } catch (err) {
        console.error("Load Error:", err);
    }
}

/**
 * Manual Message Trigger
 */
async function manualNotify(userId, userName) {
    const msg = prompt(`Send an inbox message to ${userName}:`);
    if (!msg) return;

    const success = await sendNotification(userId, "Admin Message", msg, "admin");
    if (success) alert("Message delivered!");
}

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

async function deleteUserAccount(userId) {
    if (confirm("🚨 WARNING: Delete permanently?")) {
        try {
            await deleteDoc(doc(db, "users", userId));
            loadAllUsers();
        } catch (err) {
            alert("Delete failed.");
        }
    }
}

initAdmin();
