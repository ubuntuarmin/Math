import { db, auth } from "./firebase.js";
import { tier } from "./utils.js";
import { doc, getDoc, updateDoc, increment, collection, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const linksEl = document.getElementById("links");
const creditCount = document.getElementById("creditCount");
const tierLabel = document.getElementById("tierLabel");

export async function updateUI(userData) {
    if (creditCount) creditCount.textContent = userData?.credits || 0;
    if (tierLabel) tierLabel.textContent = tier(userData?.totalEarned || 0);
    if (linksEl) renderLinks(userData);
}

const LINK_GROUPS = [
    { id: 'general', name: 'General', links: [1, 2, 3], cost: 0 },
    { id: 'extra', name: 'Extra', links: [4, 5], cost: 100, individual: true },
    { id: 'silver', name: 'Silver', links: [6, 7, 8, 9, 10], cost: 300 },
    { id: 'gold', name: 'Gold', links: [11, 12, 13], cost: 600 },
    { id: 'vip', name: 'VIP', links: [14, 15, 16], cost: 1000 }
];

async function renderLinks(userData) {
    linksEl.innerHTML = "";
    const unlocked = userData?.unlockedLinks || [];
    
    // Check Daily Limit (45 mins = 2700 seconds for Basic)
    const usage = userData?.dailyLinkUsage || 0;
    const rank = tier(userData?.totalEarned || 0);
    const limits = { "Diamond": 120, "Platinum": 90, "Gold": 60, "Silver": 50, "Basic": 45 };
    const maxMinutes = limits[rank] || 45;
    const isOverLimit = usage >= (maxMinutes * 60);

    try {
        const snap = await getDocs(collection(db, "linkVotes"));
        const votes = {};
        snap.forEach(d => votes[d.id] = d.data());

        LINK_GROUPS.forEach(group => {
            group.links.forEach(num => {
                const linkId = `link${num}`;
                const isBought = group.cost === 0 || unlocked.includes(linkId) || (unlocked.includes(group.id) && !group.individual);
                const v = votes[linkId] || { yes: 0, no: 0 };

                const card = document.createElement("div");
                card.className = `p-4 rounded border-2 transition relative ${isBought && !isOverLimit ? 'bg-gray-800 cursor-pointer hover:border-blue-500' : 'bg-gray-900 opacity-60'}`;
                
                card.innerHTML = `
                    <div class="flex justify-between">
                        <span class="font-bold">${group.name} ${num}</span>
                        <span>${isBought ? (isOverLimit ? '🛑' : '✅') : '🔒'}</span>
                    </div>
                    <div class="text-[10px] mt-2 text-gray-400">👍 ${v.yes} · 👎 ${v.no}</div>
                    ${isBought && isOverLimit ? `<div class="text-[10px] text-red-500 font-bold mt-1">Daily Limit Reached</div>` : ''}
                    ${!isBought ? `<button class="mt-2 text-[10px] bg-blue-700 py-1 w-full rounded">Unlock</button>` : ''}
                `;

                card.onclick = () => {
                    if (!isBought) handleUnlock(group, linkId, userData);
                    else if (!isOverLimit) openIframe(linkId, userData);
                    else alert(`You have used your ${maxMinutes} minute daily limit for your rank!`);
                };
                linksEl.appendChild(card);
            });
        });
    } catch (err) { console.error(err); }
}

function openIframe(linkId, userData) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";
    overlay.innerHTML = `
        <div class="bg-gray-900 p-2 flex justify-between items-center border-b border-gray-700">
            <span class="text-xs text-gray-400">Browsing Link...</span>
            <div id="promptArea" class="hidden animate-bounce text-sm font-bold text-blue-400">Did the link work? 
                <button id="vYes" class="bg-green-600 px-2 rounded ml-2 text-white">Yes</button>
                <button id="vNo" class="bg-red-600 px-2 rounded text-white">No</button>
            </div>
            <button id="closeIframe" class="bg-gray-700 px-3 py-1 rounded text-xs">Close X</button>
        </div>
        <iframe id="activeFrame" src="https://en.wikipedia.org" class="flex-1 w-full border-none"></iframe>
    `;
    document.body.appendChild(overlay);

    const frame = document.getElementById("activeFrame");
    const startTime = Date.now();

    // 1. Trigger Vote Prompt 2 seconds after load
    frame.onload = () => {
        setTimeout(() => {
            document.getElementById("promptArea").classList.remove("hidden");
        }, 2000);
    };

    // 2. Track time spent
    document.getElementById("closeIframe").onclick = async () => {
        const timeSpentSeconds = Math.floor((Date.now() - startTime) / 1000);
        overlay.remove();
        
        // Update user's daily usage in Firebase
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
            dailyLinkUsage: increment(timeSpentSeconds)
        });
    };

    document.getElementById("vYes").onclick = () => castVote(linkId, 'yes', document.getElementById("promptArea"));
    document.getElementById("vNo").onclick = () => castVote(linkId, 'no', document.getElementById("promptArea"));
}

async function castVote(linkId, type, area) {
    const voteRef = doc(db, "linkVotes", linkId);
    await setDoc(voteRef, { [type]: increment(1) }, { merge: true });
    area.innerHTML = "Thanks for voting!";
    setTimeout(() => area.classList.add("hidden"), 2000);
}

async function handleUnlock(group, linkId, userData) {
    const cost = group.cost;
    if ((userData?.credits || 0) < cost) return alert("Not enough credits!");

    if (confirm(`Unlock for ${cost} credits?`)) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const unlockKey = group.individual ? linkId : group.id;
        await updateDoc(userRef, {
            credits: increment(-cost),
            unlockedLinks: [unlockKey, ...(userData.unlockedLinks || [])]
        });
        location.reload(); // Refresh to update cards
    }
}
