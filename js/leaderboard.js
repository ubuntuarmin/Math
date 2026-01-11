import { db } from "./firebase.js";
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const leaderboardContainer = document.getElementById("leaderboard");

/**
 * Fetches the top 10 users by weekly minutes.
 * This is "Free Plan Friendly" because it only reads 10 documents.
 */
export async function renderLeaderboard() {
    if (!leaderboardContainer) return;

    leaderboardContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8">
            <div class="loader mb-4"></div>
            <div class="text-gray-400 animate-pulse italic">Calculating rankings...</div>
        </div>
    `;

    try {
        // 1. Create a query that sorts by weekMinutes descending and limits to top 10
        const leaderboardQuery = query(
            collection(db, "users"),
            orderBy("weekMinutes", "desc"),
            limit(10)
        );

        const snap = await getDocs(leaderboardQuery);
        leaderboardContainer.innerHTML = "";

        if (snap.empty) {
            leaderboardContainer.innerHTML = `
                <div class="text-center py-10 text-gray-500">
                    <div class="text-4xl mb-2">🧊</div>
                    <p>No activity recorded this week yet.</p>
                </div>
            `;
            return;
        }

        let rank = 1;
        snap.forEach((doc) => {
            const data = doc.data();
            
            // Only show users who have actually spent at least 1 minute
            if ((data.weekMinutes || 0) > 0) {
                const isTopThree = rank <= 3;
                const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-orange-400' : 'text-gray-500';
                
                const entry = document.createElement("div");
                entry.className = `flex justify-between items-center p-4 rounded-lg mb-2 transition-all hover:bg-gray-700/50 ${isTopThree ? 'bg-gray-800 border-l-4 border-blue-500' : 'bg-gray-900/40'}`;
                
                entry.innerHTML = `
                    <div class="flex items-center gap-4">
                        <span class="text-lg font-black font-mono w-6 ${rankColor}">${rank}</span>
                        <div>
                            <div class="font-bold text-gray-100 capitalize">${data.firstName || "Student"} ${data.lastName ? data.lastName[0] + '.' : ''}</div>
                            <div class="text-[10px] text-gray-500 uppercase tracking-widest">${data.grade ? 'Grade ' + data.grade : 'Member'}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-blue-400 font-bold font-mono">${data.weekMinutes || 0}m</div>
                        <div class="text-[10px] text-gray-600">This Week</div>
                    </div>
                `;
                leaderboardContainer.appendChild(entry);
                rank++;
            }
        });

        // If after filtering 0-minute users the list is empty
        if (leaderboardContainer.innerHTML === "") {
             leaderboardContainer.innerHTML = `<div class="text-center py-10 text-gray-500">Waiting for first active student...</div>`;
        }

    } catch (err) {
        console.error("Leaderboard Load Failed:", err);
        // If you see a link in the console error, click it to create the Firestore Index
        leaderboardContainer.innerHTML = `
            <div class="bg-red-900/20 border border-red-900/50 p-4 rounded text-red-400 text-sm">
                <strong>Error:</strong> Failed to load leaderboard. 
                <p class="text-xs mt-1 opacity-70">This usually happens if the database index is still building.</p>
            </div>
        `;
    }
}
