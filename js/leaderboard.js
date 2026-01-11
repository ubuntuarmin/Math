import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const leaderboardContainer = document.getElementById("leaderboard");

export async function renderLeaderboard() {
    // 1. Check if the element even exists first
    if (!leaderboardContainer) return;
    
    leaderboardContainer.innerHTML = "Loading...";

    try {
        const snap = await getDocs(collection(db, "users"));
        const arr = [];
        snap.forEach(d => arr.push(d.data()));
        
        // Sort
        arr.sort((a, b) => (b.weekMinutes || 0) - (a.weekMinutes || 0));

        leaderboardContainer.innerHTML = "";
        // Only show top 5
        arr.slice(0, 5).forEach((u, i) => {
            const item = document.createElement("div");
            item.className = "p-2 border-b border-gray-700 text-sm";
            item.innerHTML = `${i + 1}. ${u.firstName || "User"} — ${u.weekMinutes || 0} min`;
            leaderboardContainer.appendChild(item);
        });
    } catch (err) {
        console.error("Leaderboard Error:", err);
        leaderboardContainer.innerHTML = "Error loading.";
    }
}
