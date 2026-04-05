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
import { openProfileModal } from "./links.js";

const leaderboardContainer = document.getElementById("leaderboard");
let timerInterval = null;
let leaderboardRendered = false; // render only once per page load

/**
 * Compute the next bi-monthly reset date (15th or 29th of a month).
 */
function getNextBimonthlyReset() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (day < 15) {
    return new Date(year, month, 15, 0, 0, 0, 0);
  } else if (day < 29) {
    return new Date(year, month, 29, 0, 0, 0, 0);
  } else {
    // Advance to the 15th of the next month
    return new Date(year, month + 1, 15, 0, 0, 0, 0);
  }
}

const SETTINGS_CACHE_KEY = "leaderboardNextReset";
const SETTINGS_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const POST_RESET_REFRESH_DELAY = 10000;     // 10 s — wait for Firestore to propagate resets

/**
 * Helper: Get next reset time:
 * 1. Try sessionStorage cache (1-hour TTL) to reduce Firestore reads
 * 2. Try Firestore settings/leaderboard.nextReset
 * 3. Fallback to next 15th or 29th of the month
 *
 * Dates that are already in the past are always ignored so the countdown
 * can never get permanently stuck on "Resetting…".
 */
async function getNextResetDate() {
  const now = Date.now();

  // Check sessionStorage cache first
  try {
    const cached = sessionStorage.getItem(SETTINGS_CACHE_KEY);
    if (cached) {
      const { value, timestamp } = JSON.parse(cached);
      if (now - timestamp < SETTINGS_CACHE_TTL) {
        const date = new Date(value);
        // Only use cached value if the reset date is still in the future
        if (date.getTime() > now) {
          return date;
        }
        // Stale/past — remove so the next path always fetches fresh data
        try { sessionStorage.removeItem(SETTINGS_CACHE_KEY); } catch (_) {}
      }
    }
  } catch (_) {}

  try {
    const settingsRef = doc(db, "settings", "leaderboard");
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.nextReset) {
        let date;
        // Firestore Timestamp
        if (typeof data.nextReset.toMillis === "function") {
          date = new Date(data.nextReset.toMillis());
        } else {
          // Plain Date/string/number
          date = new Date(data.nextReset);
        }
        // Only use Firestore value if the reset date is still in the future.
        // If the admin hasn't updated settings/leaderboard yet (past date),
        // fall through to the computed fallback so the UI never freezes.
        if (date.getTime() > now) {
          try {
            sessionStorage.setItem(
              SETTINGS_CACHE_KEY,
              JSON.stringify({ value: date.toISOString(), timestamp: now })
            );
          } catch (_) {}
          return date;
        }
      }
    }
  } catch (err) {
    console.warn("Leaderboard: failed to fetch settings/leaderboard:", err);
  }

  // Fallback: compute next 15th or 29th
  return getNextBimonthlyReset();
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
  // Only render once per page load to avoid unnecessary Firestore reads/writes
  // and prevent the leaderboard from flickering on profile updates.
  if (leaderboardRendered) return;
  leaderboardRendered = true;

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
        Resets on the 15th &amp; 29th · Top 10 win bonus credits!
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
  let resetFired = false;
  const updateCountdown = () => {
    const time = getTimeRemainingTo(nextResetDate);
    if (!countdownEl) return;
    if (time.total <= 0) {
      countdownEl.textContent = "Resetting…";
      if (!resetFired) {
        resetFired = true;
        // Clear the cache so the next render fetches the new reset date
        try { sessionStorage.removeItem(SETTINGS_CACHE_KEY); } catch (_) {}
        clearInterval(timerInterval);
        timerInterval = null;
        // Re-render the leaderboard after POST_RESET_REFRESH_DELAY to pick up post-reset data
        setTimeout(() => {
          leaderboardRendered = false;
          renderLeaderboard();
        }, POST_RESET_REFRESH_DELAY);
      }
      return;
    }
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
      entry.className = `relative flex justify-between items-center p-4 rounded-xl border cursor-pointer ${
        rank <= 3
          ? "bg-gray-800/80 border-blue-500/30"
          : "bg-gray-900/40 border-gray-800"
      } hover:border-blue-400/50 transition-colors`;

      const entryUid  = docSnap.id;
      const entryName = data.firstName || "Student";

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
          <div class="text-[10px] text-gray-600 mt-0.5">View Profile →</div>
        </div>
      `;

      listContainer.appendChild(entry);

      // Open profile modal on click
      entry.addEventListener("click", () => openProfileModal(entryUid, entryName));

      rank++;
    });
  } catch (err) {
    console.error("Leaderboard Error:", err);
    listContainer.innerHTML = `<p class="text-red-500 text-xs text-center">Failed to load rankings.</p>`;
  }
}
