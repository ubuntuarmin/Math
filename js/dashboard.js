import { auth, db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";
import { LINK_GROUPS, createDropdown } from "./linkGroups.js";

const linksEl = document.getElementById("links");

/**
 * Renders the dashboard link grid
 */
export async function updateUI(userData) {
  await renderLinks(userData);
}

/**
 * Render all links based on unlocked status and daily usage/limit
 */
async function renderLinks(userData) {
  if (!linksEl) return;
  linksEl.innerHTML = "";

  const unlocked = userData?.unlockedLinks || [];
  const usageInSeconds = userData?.dailyLinkUsage || 0;
  const userTier = calculateTier(userData?.totalEarned || 0);

  // NEW: per-day extra limit from admin
  const extraLimitMinutesToday = userData?.extraLimitMinutesToday || 0;

  // Effective daily limit in minutes for TODAY (tier base + temporary override)
  const effectiveLimitMinutes = userTier.limitMinutes + extraLimitMinutesToday;
  const maxSeconds = effectiveLimitMinutes * 60;

  try {
    const [voteSnap, destSnap] = await Promise.all([
      getDocs(collection(db, "linkVotes")),
      getDocs(collection(db, "linkDestinations")),
    ]);

    const votes = {};
    voteSnap.forEach((d) => (votes[d.id] = d.data()));

    const destinations = {};
    destSnap.forEach((d) => (destinations[d.id] = d.data().url));

    LINK_GROUPS.forEach((group) => {
      const container = group.isDropdown ? createDropdown(group) : linksEl;

      group.links.forEach((num) => {
        const linkId = `link${num}`;
        const url = destinations[linkId];
        if (!url) return;

        const isUnlocked = unlocked.includes(linkId);
        const voteData = votes[linkId] || { up: 0, down: 0 };
        const totalVotes = (voteData.up || 0) - (voteData.down || 0);

        const card = document.createElement("button");
        card.type = "button";
        card.className =
          "card flex flex-col items-start gap-2 text-left w-full" +
          (isUnlocked ? "" : " opacity-60 cursor-not-allowed");

        const label = document.createElement("div");
        label.className = "card-title";
        label.textContent = group.labels?.[num] || `Link ${num}`;

        const meta = document.createElement("div");
        meta.className = "text-xs text-gray-500 flex items-center gap-2";

        const voteChip = document.createElement("span");
        voteChip.className =
          "chip text-[10px] px-2 py-0.5 rounded-full border border-indigo-500/40 text-indigo-300";
        voteChip.textContent = `Score: ${totalVotes}`;
        meta.appendChild(voteChip);

        const tierChip = document.createElement("span");
        tierChip.className =
          "chip text-[10px] px-2 py-0.5 rounded-full border border-slate-500/40 text-slate-300";
        tierChip.textContent = `${effectiveLimitMinutes} min / day`;
        meta.appendChild(tierChip);

        card.appendChild(label);
        card.appendChild(meta);

        if (isUnlocked) {
          card.onclick = () => {
            if (usageInSeconds >= maxSeconds) {
              alert(
                "You reached your daily time limit. Come back tomorrow, or ask your teacher if they can extend your limit for today."
              );
              return;
            }
            window.open(url, "_blank", "noopener,noreferrer");
          };
        } else {
          card.onclick = () =>
            alert(
              "This resource is locked for your account. Ask your teacher if you should have access to it."
            );
        }

        container.appendChild(card);
      });

      if (group.isDropdown) {
        linksEl.appendChild(container);
      }
    });
  } catch (err) {
    console.error("Failed to render links:", err);
    linksEl.innerHTML =
      '<div class="text-center text-red-400 text-sm">Failed to load links. Please reload.</div>';
  }
}
