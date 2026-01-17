import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";

const leaderboardContainer = document.getElementById("leaderboard");
let timerInterval = null;

/**
 * Helper: Get next reset time:
 * 1. Try Firestore settings/leaderboard.nextReset
 * 2. Fallback to "next Sunday at 00:00" based on now
 */
async function getNextResetDate() {
  try {
    const settingsRef = doc(db, "settings", "leaderboard");
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.nextReset) {
        // Firestore Timestamp
        if (typeof data.nextReset.toMillis === "function") {
          return new Date(data.nextReset.toMillis());
        }
        // Plain Date/string/number
        return new Date(data.nextReset);
      }
    }
  } catch (err) {
    console.warn("Leaderboard: failed to fetch settings/leaderboard:", err);
  }

  // Fallback: compute next Sunday at 00:00
  const now = new Date();
  const nextSunday = new Date();
  nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
  nextSunday.setHours(0, 0, 0, 0);
  return nextSunday;
}

/**
 * Compute the remaining time to a target date
 */
function getTimeRemainingTo(targetDate) {
  const now = new Date();
  const diff = targetDate - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, mins: 0, total: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);

  return { days, hours, mins, total: diff };
}

/**
 * Helper: Reward tier
 */
function getPotentialReward(rank) {
  if (rank > 10) return 0;
  return 110 - rank * 10;
}

/**
 * Render header + list, and keep header timer live‑updating.
 */
export async function renderLeaderboard() {
  if (!leaderboardContainer) return;

  // Stop any previous countdown interval
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Build the shell
  leaderboardContainer.innerHTML = `
    <div id="leaderboardHeader" class="mb-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-2xl text-center">
      <div class="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-black mb-1">
        Season Ends In
      </div>
      <div id="leaderboardCountdown" class="text-2xl font-mono font-black text-white">
        --
      </div>
      <div class="text-[9px] text-gray-500 mt-1 italic">
        Top 10 win bonus credits at reset!
      </div>
    </div>
    <div id="leaderboardList" class="space-y-3">
      <div class="flex justify-center py-8"><div class="loader"></div></div>
    </div>
  `;

  const countdownEl = document.getElementById("leaderboardCountdown");
  const listContainer = document.getElementById("leaderboardList");

  // 1) Figure out target reset date
  const nextResetDate = await getNextResetDate();

  // 2) Start live countdown (self‑correcting each second)
  const updateCountdown = () => {
    const time = getTimeRemainingTo(nextResetDate);
    if (!countdownEl) return;
    countdownEl.textContent = `${time.days}d ${time.hours}h ${time.mins}m`;
  };
  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);

  // 3) Load leaderboard data
  try {
    const leaderboardQuery = query(
      collection(db, "users"),
      where("weekMinutes", ">", 0),
      orderBy("weekMinutes", "desc"),
      limit(10)
    );

    const snap = await getDocs(leaderboardQuery);
    listContainer.innerHTML = "";

    if (snap.empty) {
      listContainer.innerHTML = `<p class="text-center py-10 text-gray-500">No activity yet. Be the first!</p>`;
      return;
    }

    let rank = 1;
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const tier = calculateTier(data.totalEarned || 0);
      const reward = getPotentialReward(rank);

      let rankBadge = `<span class="text-gray-500 font-mono w-6 text-center">${rank}</span>`;
      if (rank === 1) rankBadge = `🥇`;
      if (rank === 2) rankBadge = `🥈`;
      if (rank === 3) rankBadge = `🥉`;

      const entry = document.createElement("div");
      entry.className = `relative flex justify-between items-center p-4 rounded-xl border ${
        rank <= 3
          ? "bg-gray-800/80 border-blue-500/30"
          : "bg-gray-900/40 border-gray-800"
      }`;

      entry.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="text-xl w-8 flex justify-center">${rankBadge}</div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-white capitalize">${
                data.firstName || "Student"
              }</span>
              <span class="text-[8px] px-1 py-0.5 rounded font-bold uppercase"
                    style="color: ${tier.color}; border: 1px solid ${tier.color}44">
                ${tier.name}
              </span>
            </div>
            <div class="text-[10px] text-emerald-400 font-bold">
              Estimated Reward: +${reward} 🪙
            </div>
          </div>
        </div>
        <div class="text-right">
          <div class="text-blue-400 font-black text-lg">
            ${data.weekMinutes || 0}<span class="text-[10px] ml-0.5">m</span>
          </div>
          <div class="text-[9px] text-gray-600 uppercase font-bold">This Week</div>
        </div>
      `;

      listContainer.appendChild(entry);
      rank++;
    });
  } catch (err) {
    console.error("Leaderboard Error:", err);
    listContainer.innerHTML = `<p class="text-red-500 text-xs text-center">Failed to load rankings.</p>`;
  }
}
