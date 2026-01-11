import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const leaderboard = document.getElementById("leaderboard");

export async function renderLeaderboard() {
    if (!leaderboard) return;
    leaderboard.innerHTML = "<div class='text-center py-4 pulse'>Loading rankings...</div>";

    try {
        const snap = await getDocs(collection(db, "users"));
        const users = [];
        
        snap.forEach(doc => {
            const data = doc.data();
            // Only add users who have actually spent time
            if (data.weekMinutes > 0 || data.totalMinutes > 0) {
                users.push(data);
            }
        });

        // Sort by weekly minutes descending
        users.sort((a, b) => (b.weekMinutes || 0) - (a.weekMinutes || 0));

        leaderboard.innerHTML = "";
        
        if (users.length === 0) {
            leaderboard.innerHTML = "<div class='text-sm text-gray-400 text-center'>No active learners yet this week!</div>";
            return;
        }

        users.slice(0, 10).forEach((u, i) => {
            const isTop3 = i < 3 ? ['text-yellow-400', 'text-gray-300', 'text-orange-400'][i] : 'text-white';
            leaderboard.innerHTML += `
                <div class="flex justify-between items-center bg-gray-900/50 p-3 rounded mb-2 border-l-4 ${i === 0 ? 'border-yellow-500' : 'border-transparent'}">
                    <div class="flex items-center gap-3">
                        <span class="font-bold ${isTop3}">${i + 1}</span>
                        <span class="font-medium capitalize">${u.firstName || "Student"} ${u.lastName ? u.lastName[0] + '.' : ''}</span>
                    </div>
                    <div class="text-blue-400 font-mono font-bold">${u.weekMinutes || 0}m</div>
                </div>`;
        });
    } catch (err) {
        console.error("Leaderboard error:", err);
        leaderboard.innerHTML = "<div class='text-sm text-red-400'>Error loading rankings.</div>";
    }
}
