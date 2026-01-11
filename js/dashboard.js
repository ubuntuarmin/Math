import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { tier } from "./utils.js";

// ... [Keep updateUI and renderLinks the same as previous response] ...

function openIframe(linkId, userData, currentUsage, maxSeconds) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";
    overlay.innerHTML = `
        <div class="bg-gray-900 p-2 border-b border-gray-700 flex flex-col gap-1">
            <div class="flex justify-between items-center">
                <span class="text-xs text-blue-400 font-mono" id="usageStatus">Calculating usage...</span>
                <div id="promptArea" class="hidden text-sm font-bold text-yellow-400">Did link work? 
                    <button id="vYes" class="bg-green-600 px-2 rounded mx-1">Yes</button>
                    <button id="vNo" class="bg-red-600 px-2 rounded">No</button>
                </div>
                <button id="closeIframe" class="bg-gray-700 px-3 py-1 rounded text-xs">Close X</button>
            </div>
            <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div id="usageBar" class="bg-blue-500 h-full transition-all duration-300" style="width: 0%"></div>
            </div>
        </div>
        <iframe id="activeFrame" src="https://en.wikipedia.org" class="flex-1 w-full border-none"></iframe>
    `;
    document.body.appendChild(overlay);

    const usageBar = document.getElementById("usageBar");
    const usageStatus = document.getElementById("usageStatus");
    const startTime = Date.now();
    
    // --- AUTO-KICK TIMER ---
    const autoKickInterval = setInterval(() => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        const totalUsed = currentUsage + sessionSeconds;
        const progressPct = (totalUsed / maxSeconds) * 100;

        // Update Progress Bar in real-time
        usageBar.style.width = `${Math.min(progressPct, 100)}%`;
        usageStatus.textContent = `Time: ${Math.floor(totalUsed/60)}m / ${maxSeconds/60}m (${Math.floor(progressPct)}%)`;

        // Check if limit hit
        if (totalUsed >= maxSeconds) {
            clearInterval(autoKickInterval);
            handleAutoKick(sessionSeconds);
        }
    }, 1000);

    async function handleAutoKick(sessionSeconds) {
        alert("🚨 TIME EXPIRED! You have used your daily limit for your rank.");
        await saveTimeAndClose(sessionSeconds);
    }

    async function saveTimeAndClose(sessionSeconds) {
        clearInterval(autoKickInterval);
        const userRef = doc(db, "users", auth.currentUser.uid);
        try {
            await updateDoc(userRef, { dailyLinkUsage: increment(sessionSeconds) });
        } catch (e) { console.error(e); }
        overlay.remove();
        location.reload(); // Refresh to lock the dashboard cards
    }

    // Manual Close
    document.getElementById("closeIframe").onclick = () => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        saveTimeAndClose(sessionSeconds);
    };

    // Vote Logic
    document.getElementById("activeFrame").onload = () => {
        setTimeout(() => document.getElementById("promptArea")?.classList.remove("hidden"), 2000);
    };

    document.getElementById("vYes").onclick = () => castVote(linkId, 'yes');
    document.getElementById("vNo").onclick = () => castVote(linkId, 'no');

    async function castVote(id, type) {
        const voteRef = doc(db, "linkVotes", id);
        await setDoc(voteRef, { [type]: increment(1) }, { merge: true });
        const area = document.getElementById("promptArea");
        area.innerHTML = "<span class='text-green-400'>Thanks for voting!</span>";
        setTimeout(() => area?.classList.add("hidden"), 3000);
    }
}
