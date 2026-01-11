import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";

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
    
    if (tierLabel) {
        const userTier = calculateTier(userData?.totalEarned || 0);
        tierLabel.textContent = userTier.name;
        tierLabel.style.color = userTier.color;
    }

    if (linksEl) renderLinks(userData);
}

/**
 * Renders the dashboard link grid
 */
async function renderLinks(userData) {
    if (!linksEl) return;
    linksEl.innerHTML = "";

    const unlocked = userData?.unlockedLinks || [];
    const usageInSeconds = userData?.dailyLinkUsage || 0;
    const userTier = calculateTier(userData?.totalEarned || 0);
    const maxSeconds = userTier.limitMinutes * 60;

    try {
        // Fetch Votes and Destinations from Firestore
        const [voteSnap, destSnap] = await Promise.all([
            getDocs(collection(db, "linkVotes")),
            getDocs(collection(db, "linkDestinations"))
        ]);

        const votes = {};
        voteSnap.forEach(d => votes[d.id] = d.data());

        const destinations = {};
        destSnap.forEach(d => destinations[d.id] = d.data().url);

        LINK_GROUPS.forEach(group => {
            const container = group.isDropdown ? createDropdown(group) : linksEl;
            
            group.links.forEach(num => {
                const linkId = `link${num}`;
                // This 'content' could be a URL or raw HTML code
                const content = destinations[linkId] || "https://www.wikipedia.org";
                createLinkCard(num, group, unlocked, usageInSeconds, maxSeconds, votes, container, userData, content);
            });
        });
    } catch (err) {
        console.error("Dashboard render error:", err);
    }
}

/**
 * Creates VIP Dropdown structure
 */
function createDropdown(group) {
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

    linksEl.appendChild(dropHeader);
    linksEl.appendChild(dropContent);
    return dropContent;
}

/**
 * Creates individual link cards
 */
function createLinkCard(num, group, unlocked, usageInSeconds, maxSeconds, votes, container, userData, content) {
    const linkId = `link${num}`;
    const isBought = group.cost === 0 || unlocked.includes(linkId) || (unlocked.includes(group.id) && !group.individual);
    const isOverLimit = usageInSeconds >= maxSeconds;
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
        else if (!isOverLimit) openIframe(linkId, userData, usageInSeconds, maxSeconds, content);
        else alert(`Daily limit reached! Earn more credits to rank up.`);
    };
    container.appendChild(card);
}

/**
 * The Iframe viewer - Smart Detection for URLs vs HTML Code
 */
function openIframe(linkId, userData, currentUsage, maxSeconds, content) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";
    
    // --- SMART DETECTION ---
    let finalSrc = content;
    let isApp = false;

    // Detect if content is HTML code (starts with <)
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
                <div id="promptArea" class="hidden text-sm font-bold text-yellow-400">
                    Working? 
                    <button id="vYes" class="bg-green-600 px-3 rounded mx-1 text-white hover:bg-green-500">Yes</button>
                    <button id="vNo" class="bg-red-600 px-3 rounded text-white hover:bg-red-500">No</button>
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
    
    const autoKickInterval = setInterval(() => {
        const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
        const totalUsed = currentUsage + sessionSeconds;
        const progressPct = (totalUsed / maxSeconds) * 100;

        usageBar.style.width = `${Math.min(progressPct, 100)}%`;
        usageStatus.textContent = `Usage: ${Math.floor(totalUsed/60)}m / ${maxSeconds/60}m (${Math.floor(progressPct)}%)`;

        if (totalUsed >= maxSeconds) {
            clearInterval(autoKickInterval);
            alert("🚨 DAILY TIME EXPIRED!");
            saveTimeAndClose(sessionSeconds);
        }
    }, 1000);

    const saveTimeAndClose = async (sessionSeconds) => {
        clearInterval(autoKickInterval);
        
        // Cleanup Blob URL if it was an app
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

    document.getElementById("closeIframe").onclick = () => saveTimeAndClose(Math.floor((Date.now() - startTime) / 1000));
    document.getElementById("activeFrame").onload = () => setTimeout(() => document.getElementById("promptArea")?.classList.remove("hidden"), 3000);
    document.getElementById("vYes").onclick = () => castVote(linkId, 'yes');
    document.getElementById("vNo").onclick = () => castVote(linkId, 'no');

    async function castVote(id, type) {
        try {
            await setDoc(doc(db, "linkVotes", id), { [type]: increment(1) }, { merge: true });
            document.getElementById("promptArea").innerHTML = "<span class='text-green-400'>Vote Recorded!</span>";
        } catch (e) { console.error(e); }
    }
}

/**
 * Handle purchasing links
 */
async function handleUnlock(group, linkId, userData) {
    const cost = group.cost;
    if ((userData?.credits || 0) < cost) return alert("You need more credits!");

    if (confirm(`Unlock ${group.individual ? 'this link' : group.name + ' section'} for ${cost} credits?`)) {
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, {
                credits: increment(-cost),
                unlockedLinks: [group.individual ? linkId : group.id, ...(userData.unlockedLinks || [])]
            });
            location.reload();
        } catch (e) { console.error(e); }
    }
}
