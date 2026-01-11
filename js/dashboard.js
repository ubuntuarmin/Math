import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { tier } from "./utils.js";

const linksEl = document.getElementById("links");
const creditCount = document.getElementById("creditCount");
const tierLabel = document.getElementById("tierLabel");

// Configuration for all link categories
const LINK_GROUPS = [
    { id: 'general', name: 'General', links: [1, 2, 3], cost: 0 },
    { id: 'extra', name: 'Extra', links: [4, 5], cost: 100, individual: true },
    { id: 'silver', name: 'Silver', links: [6, 7, 8, 9, 10], cost: 300 },
    { id: 'gold', name: 'Gold', links: [11, 12, 13], cost: 600 },
    { id: 'vip', name: 'VIP', links: [14, 15, 16], cost: 1000, isDropdown: true }
];

/**
 * Main entry point called by auth.js
 */
export async function updateUI(userData) {
    if (creditCount) creditCount.textContent = userData?.credits || 0;
    if (tierLabel) tierLabel.textContent = tier(userData?.totalEarned || 0);
    if (linksEl) renderLinks(userData);
}

/**
 * Renders the dashboard link grid and dropdowns
 */
async function renderLinks(userData) {
    if (!linksEl) return;
    linksEl.innerHTML = "";

    const unlocked = userData?.unlockedLinks || [];
    const usage = userData?.dailyLinkUsage || 0;
    const rank = tier(userData?.totalEarned || 0);
    
    // Limits based on Rank
    const limits = { "Diamond": 120, "Platinum": 90, "Gold": 60, "Silver": 50, "Basic": 45 };
    const maxMinutes = limits[rank] || 45;
    const maxSeconds = maxMinutes * 60;

    try {
        const snap = await getDocs(collection(db, "linkVotes"));
        const votes = {};
        snap.forEach(d => votes[d.id] = d.data());

        LINK_GROUPS.forEach(group => {
            if (group.isDropdown) {
                // Create VIP Dropdown Container
                const dropHeader = document.createElement("div");
                dropHeader.className = "col-span-full bg-gradient-to-r from-purple-900 to-indigo-900 p-3 rounded-lg cursor-pointer flex justify-between items-center border border-purple-500 mt-4 mb-2 shadow-lg";
                dropHeader.innerHTML = `<span class="font-bold text-purple-200 uppercase tracking-tighter">💎 VIP Exclusive Section</span> <span id="vipArrow" class="text-xs">▼</span>`;
                
                const dropContent = document.createElement("div");
                dropContent.id = "vipContent";
                dropContent.className = "col-span-full hidden grid grid-cols-1 md:grid-cols-3 gap-4 mb-6";
                
                dropHeader.onclick = () => {
                    const isHidden = dropContent.classList.toggle("hidden");
                    document.getElementById("vipArrow").textContent = isHidden ? "▼" : "▲";
                };

                group.links.forEach(num => createLinkCard(num, group, unlocked, usage, maxSeconds, votes, dropContent, userData));
                linksEl.appendChild(dropHeader);
                linksEl.appendChild(dropContent);
            } else {
                group.links.forEach(num => createLinkCard(num, group, unlocked, usage, maxSeconds, votes, linksEl, userData));
            }
        });
    } catch (err) {
        console.error("Dashboard render error:", err);
    }
}

/**
 * Helper to create individual link cards
 */
function createLinkCard(num, group, unlocked, usage, maxSeconds, votes, container, userData) {
    const linkId = `link${num}`;
    const isBought = group.cost === 0 || unlocked.includes(linkId) || (unlocked.includes(group.id) && !group.individual);
    const isOverLimit = usage >= maxSeconds;
    const v = votes[linkId] || { yes: 0, no: 0 };

    const card = document.createElement("div");
    card.className = `p-4 rounded border-2 transition relative flex flex-col justify-between h-32 ${isBought && !isOverLimit ? 'bg-gray-800 border-gray-700 cursor-pointer hover:border-blue-500' : 'bg-gray-900 border-gray-800 opacity-60'}`;
    
    card.innerHTML = `
        <div class="flex justify-between font-bold text-sm items-center">
            <span>${group.name} Link ${num}</span>
            <span class="text-lg">${isBought ? (isOverLimit ? '🛑' : '✅') : '🔒'}</span>
        </div>
        <div class="flex flex-col gap-1">
            <div class="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Community Score</div>
            <div class="text-xs text-gray-400 font-mono">👍 ${v.yes} · 👎 ${v.no}</div>
        </div>
        ${!isBought ? `<button class="mt-2 text-[10px] bg-blue-700 hover:bg-blue-600 py-1 w-full rounded font-bold transition">Unlock (${group.cost} credits)</button>` : ''}
    `;

    card.onclick = () => {
        if (!isBought) handleUnlock(group, linkId, userData);
        else if (!isOverLimit) openIframe(linkId, userData, usage, maxSeconds);
        else alert(`Daily limit of ${maxSeconds/60} minutes reached! Wait until tomorrow.`);
    };
    container.appendChild(card);
}

/**
 * The Iframe viewer with Time Tracking, Voting, and Auto-Kick
 */
function openIframe(linkId, userData, currentUsage, maxSeconds) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";
    overlay.innerHTML = `
        <div class="bg-gray-900 p-2 border-b border-gray-700 flex flex-col gap-1">
            <div class="flex justify-between items-center">
                <span class="text-[10px] text-blue-400 font-mono" id="usageStatus tracking-tighter">Preparing...</span>
                <div id="promptArea" class="hidden text-sm font-bold text-yellow-400">Did the link work? 
                    <button id="vYes" class="bg-green-600 px-3 rounded mx-1 text-white hover:bg-green-500">Yes</button>
                    <button id="vNo" class="bg-red-600 px-3 rounded text-white hover:bg-red-500">No</button>
                </div>
                <button id="closeIframe" class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs text-white font-bold transition">Close X</button>
            </div>
            <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div id="usageBar" class="bg-blue-500 h-full transition-all duration-300" style="width: 0%"></div>
            </div>
        </div>
        <iframe id="activeFrame" src="https://en.wikipedia.org" class="flex-1 w-full border-none bg-white"></iframe>
    `;
    document.body.appendChild(overlay);

    const usageBar = document.getElementById("usageBar");
    const usageStatus = document.getElementById("usageStatus");
    const startTime = Date.now();
    
    // --- REAL-TIME WATCHER & AUTO-KICK ---
    const autoKickInterval = setInterval(() => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        const totalUsed = currentUsage + sessionSeconds;
        const progressPct = (totalUsed / maxSeconds) * 100;

        usageBar.style.width = `${Math.min(progressPct, 100)}%`;
        usageStatus.textContent = `Usage: ${Math.floor(totalUsed/60)}m / ${maxSeconds/60}m (${Math.floor(progressPct)}%)`;

        if (totalUsed >= maxSeconds) {
            clearInterval(autoKickInterval);
            alert("🚨 TIME EXPIRED! You have used your daily limit.");
            saveTimeAndClose(sessionSeconds);
        }
    }, 1000);

    const saveTimeAndClose = async (sessionSeconds) => {
        clearInterval(autoKickInterval);
        const userRef = doc(db, "users", auth.currentUser.uid);
        try {
            await updateDoc(userRef, { dailyLinkUsage: increment(sessionSeconds) });
        } catch (e) { console.error("Error saving time:", e); }
        overlay.remove();
        location.reload(); 
    };

    document.getElementById("closeIframe").onclick = () => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        saveTimeAndClose(sessionSeconds);
    };

    document.getElementById("activeFrame").onload = () => {
        // Prompt after 2 seconds
        setTimeout(() => document.getElementById("promptArea")?.classList.remove("hidden"), 2000);
    };

    document.getElementById("vYes").onclick = () => castVote(linkId, 'yes');
    document.getElementById("vNo").onclick = () => castVote(linkId, 'no');

    async function castVote(id, type) {
        try {
            const voteRef = doc(db, "linkVotes", id);
            await setDoc(voteRef, { [type]: increment(1) }, { merge: true });
            const area = document.getElementById("promptArea");
            area.innerHTML = "<span class='text-green-400'>Thanks for voting!</span>";
            setTimeout(() => area?.classList.add("hidden"), 3000);
        } catch (e) { console.error("Voting failed:", e); }
    }
}

/**
 * Logic for purchasing locked links/sections
 */
async function handleUnlock(group, linkId, userData) {
    const cost = group.cost;
    const userCredits = userData?.credits || 0;

    if (userCredits < cost) {
        alert("You need more credits! Earn them by doing math or daily streaks.");
        return;
    }

    const message = group.individual ? `Unlock this link for ${cost} credits?` : `Unlock the ${group.name} section for ${cost} credits?`;
    
    if (confirm(message)) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const unlockKey = group.individual ? linkId : group.id;
        
        try {
            await updateDoc(userRef, {
                credits: increment(-cost),
                unlockedLinks: [unlockKey, ...(userData.unlockedLinks || [])]
            });
            alert("Unlocked successfully!");
            location.reload();
        } catch (e) {
            console.error("Unlock failed:", e);
        }
    }
}
