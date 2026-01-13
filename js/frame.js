import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/**
 * Launches the app/link in a fullscreen overlay with timer and voting logic.
 */
export function launchFrame(content, linkId, currentUsage, maxSeconds) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";
    
    // --- SMART DETECTION ---
    let finalSrc = content;
    let isApp = false;

    if (content.trim().startsWith('<')) {
        isApp = true;
        const blob = new Blob([content], { type: 'text/html' });
        finalSrc = URL.createObjectURL(blob);
    }

    overlay.innerHTML = `
        <div class="bg-gray-900 p-2 border-b border-gray-700 flex flex-col gap-1">
            <div class="flex justify-between items-center px-2">
                <span class="text-[10px] text-blue-400 font-mono" id="usageStatus">
                    ${isApp ? '🚀 Launching App...' : '🌐 Loading Link...'}
                </span>
                <div id="promptArea" class="hidden text-sm font-bold text-yellow-400 flex items-center gap-2">
                    Working? 
                    <button id="vYes" class="bg-green-600 px-3 py-0.5 rounded text-white hover:bg-green-500 transition">Yes</button>
                    <button id="vNo" class="bg-red-600 px-3 py-0.5 rounded text-white hover:bg-red-500 transition">No</button>
                </div>
                <button id="closeIframe" class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs text-white font-bold transition">Close X</button>
            </div>
            <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div id="usageBar" class="bg-blue-500 h-full transition-all duration-300" style="width: 0%"></div>
            </div>
        </div>
        <iframe id="activeFrame" src="${finalSrc}" class="flex-1 w-full border-none bg-white shadow-2xl"></iframe>
    `;
    document.body.appendChild(overlay);

    const usageBar = document.getElementById("usageBar");
    const usageStatus = document.getElementById("usageStatus");
    const startTime = Date.now();
    
    // Timer Interval
    const autoKickInterval = setInterval(() => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        const totalUsed = currentUsage + sessionSeconds;
        const progressPct = (totalUsed / maxSeconds) * 100;

        usageBar.style.width = `${Math.min(progressPct, 100)}%`;
        usageStatus.textContent = `Usage: ${Math.floor(totalUsed/60)}m / ${maxSeconds/60}m (${Math.floor(progressPct)}%)`;

        if (totalUsed >= maxSeconds) {
            alert("🚨 DAILY TIME EXPIRED!");
            saveTimeAndClose(sessionSeconds);
        }
    }, 1000);

    // Save and Exit Logic
    const saveTimeAndClose = async (sessionSeconds) => {
        clearInterval(autoKickInterval);
        if (isApp) URL.revokeObjectURL(finalSrc);

        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, { 
                dailyLinkUsage: increment(sessionSeconds),
                totalMinutes: increment(Math.floor(sessionSeconds / 60))
            });
        } catch (e) { console.error("Save error:", e); }
        
        overlay.remove();
        location.reload(); 
    };

    // Voting Logic
    const castVote = async (type) => {
        const promptArea = document.getElementById("promptArea");
        try {
            // Logic: Increment the vote in linkVotes collection
            const voteRef = doc(db, "linkVotes", linkId);
            await setDoc(voteRef, { [type]: increment(1) }, { merge: true });
            
            // UI Feedback
            promptArea.innerHTML = "<span class='text-green-400 animate-pulse'>Vote Recorded!</span>";
            setTimeout(() => promptArea.classList.add("hidden"), 2000);
        } catch (e) { 
            console.error("Vote failed:", e);
            promptArea.innerHTML = "<span class='text-red-400'>Error!</span>";
        }
    };

    // Event Listeners
    document.getElementById("closeIframe").onclick = () => saveTimeAndClose(Math.floor((Date.now() - startTime) / 1000));
    
    document.getElementById("activeFrame").onload = () => {
        setTimeout(() => {
            const prompt = document.getElementById("promptArea");
            if(prompt) prompt.classList.remove("hidden");
        }, 5000); // Show vote prompt after 5 seconds
    };

    document.getElementById("vYes").onclick = () => castVote('yes');
    document.getElementById("vNo").onclick = () => castVote('no');
}
