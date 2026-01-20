import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";
import { launchFrame } from "./frame.js"; // Import our new logic

const linksEl = document.getElementById("links");
const creditCount = document.getElementById("creditCount");
const tierLabel = document.getElementById("tierLabel");

const LINK_GROUPS = [
    { id: "general", name: "General", links: [1, 2, 3], cost: 0 },
    { id: "extra",   name: "Extra",   links: [4, 5], cost: 100, individual: true },
    { id: "silver",  name: "Silver",  links: [6, 7, 8, 9, 10], cost: 300 },
    { id: "gold",    name: "Gold",    links: [11, 12, 13], cost: 600 },
    { id: "vip",     name: "VIP",     links: [14, 15, 16], cost: 1000, isDropdown: true }
];

/**
 * UI-ONLY TITLES (no database change)
 * link1, link2, etc. still exist in Firestore exactly the same;
 * this only changes what the user sees.
 */
const LINK_TITLES = {
    link1: "nodex neo",
    link2: "endiz",
    link3: "gn-math",
    link4: "Pete ZAh",
    link5: "Artic1.0",
    link6: "PETE zah 2",
    link7: "Artic1.0 (2)"
    // others fall back to group/name + number
};

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

    // NEW: per-day extra limit from admin (temp override for today only)
    const extraLimitMinutesToday = userData?.extraLimitMinutesToday || 0;

    // Effective daily limit in minutes for TODAY (tier base + temporary override)
    const effectiveLimitMinutes = (userTier.limitMinutes || 0) + extraLimitMinutesToday;
    const maxSeconds = effectiveLimitMinutes * 60;

    try {
        const [voteSnap, destSnap] = await Promise.all([
            getDocs(collection(db, "linkVotes")),
            getDocs(collection(db, "linkDestinations"))
        ]);

        const votes = {};
        voteSnap.forEach((d) => (votes[d.id] = d.data()));

        const destinations = {};
        destSnap.forEach((d) => (destinations[d.id] = d.data().url));

        LINK_GROUPS.forEach((group) => {
            const container = group.isDropdown ? createDropdown(group) : linksEl;

            group.links.forEach((num) => {
                const linkId = `link${num}`;
                const content = destinations[linkId] || "https://www.wikipedia.org";
                createLinkCard(
                    num,
                    group,
                    unlocked,
                    usageInSeconds,
                    maxSeconds,
                    votes,
                    container,
                    userData,
                    content,
                    effectiveLimitMinutes // pass the effective limit for display/messages
                );
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
    // Check if it already exists to prevent duplicates on re-render
    let dropContent = document.getElementById("vipContent");
    if (dropContent) return dropContent;

    const dropHeader = document.createElement("div");
    dropHeader.className =
        "col-span-full bg-gradient-to-r from-purple-900 to-indigo-900 p-3 rounded-lg cursor-pointer flex justify-between items-center border border-purple-500 mt-4 mb-2 shadow-lg";
    dropHeader.innerHTML = `<span class="font-bold text-purple-200 uppercase tracking-tighter">💎 VIP Exclusive Section</span> <span id="vipArrow" class="text-xs">▼</span>`;

    dropContent = document.createElement("div");
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
function createLinkCard(
    num,
    group,
    unlocked,
    usageInSeconds,
    maxSeconds,
    votes,
    container,
    userData,
    content,
    effectiveLimitMinutes // NEW param – minutes for display/messages
) {
    const linkId = `link${num}`;
    const isBought = group.cost === 0 || unlocked.includes(linkId) || unlocked.includes(group.id);
    const isOverLimit = usageInSeconds >= maxSeconds;
    const v = votes[linkId] || { yes: 0, no: 0 };

    // Use custom UI title if defined, otherwise fallback
    const displayTitle = LINK_TITLES[linkId] || `${group.name} #${num}`;

    const card = document.createElement("div");
    card.className =
        "p-4 rounded border-2 transition relative flex flex-col justify-between h-32 " +
        (isBought && !isOverLimit
            ? "bg-gray-800 border-gray-700 cursor-pointer hover:border-blue-500 shadow-lg hover:shadow-blue-500/20"
            : "bg-gray-900/60 border-gray-800 cursor-pointer hover:border-yellow-500/60");

    card.innerHTML = `
        <div class="flex justify-between font-bold text-sm items-center">
            <span>${displayTitle}</span>
            <span class="text-lg">${isBought ? (isOverLimit ? "🛑" : "✅") : "🔒"}</span>
        </div>
        <div class="flex flex-col gap-1 mt-1">
            <div class="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Score</div>
            <div class="text-xs text-gray-500 font-mono">👍 ${v.yes} · 👎 ${v.no}</div>
        </div>
        ${
            !isBought
                ? `<button class="mt-2 text-[10px] bg-blue-700 hover:bg-blue-600 py-1 w-full rounded font-bold transition">Unlock (${group.cost})</button>`
                : ""
        }
    `;

    card.onclick = (e) => {
        // If not bought, clicking anywhere triggers unlock
        if (!isBought) {
            handleUnlock(group, linkId, userData);
        } else if (!isOverLimit) {
            launchFrame(content, linkId, usageInSeconds, maxSeconds);
        } else {
            // Use effectiveLimitMinutes in the message so it reflects the override
            alert(
                `Daily limit of ${effectiveLimitMinutes} minutes reached! Upgrade your tier or ask your teacher to extend your limit for today.`
            );
        }
    };
    container.appendChild(card);
}

/**
 * Handle purchasing links
 */
async function handleUnlock(group, linkId, userData) {
    const cost = group.cost;
    const currentCredits = userData?.credits || 0;

    if (currentCredits < cost) {
        return alert(`Not enough credits! You need ${cost - currentCredits} more.`);
    }

    const confirmMsg = group.individual
        ? `Unlock Link ${linkId.replace("link", "")} for ${cost} credits?`
        : `Unlock the entire ${group.name} category for ${cost} credits?`;

    if (confirm(confirmMsg)) {
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            const unlockKey = group.individual ? linkId : group.id;

            await updateDoc(userRef, {
                credits: increment(-cost),
                unlockedLinks: [unlockKey, ...(userData.unlockedLinks || [])]
            });

            // Simpler: reload to refresh everything
            location.reload();
        } catch (e) {
            console.error("Unlock Error:", e);
            alert("Transaction failed. Check your connection.");
        }
    }
}
