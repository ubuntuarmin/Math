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
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const leaderboardContainer = document.getElementById("leaderboard");
const leaderboardRoot = leaderboardContainer ? createRoot(leaderboardContainer) : null;
let timerInterval = null;
let leaderboardRendered = false; // render only once per page load

// Must match the Firestore security rule cap on weekMinutes
const MAX_WEEKLY_MINUTES = 10000;

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
    return { days: 0, hours: 0, mins: 0, secs: 0, total: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);
  const secs = Math.floor((diff / 1000) % 60);

  return { days, hours, mins, secs, total: diff };
}

/**
 * Helper: Reward tier
 */
function getPotentialReward(rank) {
  if (rank > 10) return 0;
  return 110 - rank * 10;
}

const h = React.createElement;

const LeaderboardEntries = React.memo(function LeaderboardEntries({ status, entries }) {
  return h(
    React.Fragment,
    null,
    status === "loading" &&
      h(
        "div",
        { className: "flex justify-center py-8" },
        h("div", { className: "loader" })
      ),
    status === "empty" &&
      h(
        "p",
        { className: "text-center py-10 text-gray-500" },
        "No activity yet. Be the first!"
      ),
    status === "error" &&
      h(
        "p",
        { className: "text-red-500 text-xs text-center" },
        "Failed to load rankings."
      ),
    status === "ready" &&
      entries.map((entry) =>
        h(
          "div",
          {
            key: entry.uid,
            className: `relative flex justify-between items-center p-4 rounded-xl border cursor-pointer ${
              entry.rank === 1
                ? "bg-yellow-900/20 border-yellow-500/40 shadow-lg shadow-yellow-900/20"
                : entry.rank === 2
                ? "bg-gray-700/30 border-gray-400/30"
                : entry.rank === 3
                ? "bg-amber-900/20 border-amber-700/40"
                : "bg-gray-900/40 border-gray-800"
            } hover:border-blue-400/50 transition-colors`,
            onClick: () => openProfileModal(entry.uid, entry.name),
          },
          h(
            "div",
            { className: "flex items-center gap-4" },
            h("div", { className: "text-xl w-8 flex justify-center" }, entry.rankBadge),
            h(
              "div",
              null,
              h(
                "div",
                { className: "flex items-center gap-2" },
                h("span", { className: "font-bold text-white capitalize" }, entry.name),
                h(
                  "span",
                  {
                    className: "text-[8px] px-1 py-0.5 rounded font-bold uppercase",
                    style: {
                      color: entry.tierColor,
                      border: `1px solid ${entry.tierColor}44`,
                    },
                  },
                  entry.tierName
                )
              ),
              h(
                "div",
                { className: "text-[10px] text-emerald-400 font-bold" },
                `Estimated Reward: +${entry.reward} 🪙`
              )
            )
          ),
          h(
            "div",
            { className: "text-right" },
            h(
              "div",
              { className: "text-blue-400 font-black text-lg" },
              `${entry.weekMinutes}`,
              h("span", { className: "text-[10px] ml-0.5" }, "m")
            ),
            h(
              "div",
              { className: "text-[9px] text-gray-600 uppercase font-bold" },
              "This Week"
            ),
            h(
              "div",
              { className: "text-[10px] text-gray-600 mt-0.5" },
              "View Profile →"
            )
          )
        )
      )
  );
});

function LeaderboardView({ countdown, status, entries }) {
  return h(
    React.Fragment,
    null,
    h(
      "div",
      {
        id: "leaderboardHeader",
        className:
          "mb-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-2xl text-center",
      },
      h(
        "div",
        {
          className:
            "text-[10px] uppercase tracking-[0.2em] text-blue-400 font-black mb-1",
        },
        "Season Ends In"
      ),
      h(
        "div",
        {
          id: "leaderboardCountdown",
          className: "text-2xl font-mono font-black text-white",
        },
        countdown
      ),
      h(
        "div",
        { className: "text-[9px] text-gray-500 mt-1 italic" },
        "Resets on the 15th & 29th · Top 10 win bonus credits!"
      )
    ),
    h(
      "div",
      { id: "leaderboardList", className: "space-y-3" },
      h(LeaderboardEntries, { status, entries })
    )
  );
}

/**
 * Render header + list, and keep header timer live‑updating.
 */
export async function renderLeaderboard() {
  if (!leaderboardRoot) return;
  // Only render once per page load to avoid unnecessary Firestore reads/writes
  // and prevent the leaderboard from flickering on profile updates.
  if (leaderboardRendered) return;
  leaderboardRendered = true;

  // Stop any previous countdown interval
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  let uiState = { countdown: "--", status: "loading", entries: [] };
  const renderState = (patch = {}) => {
    uiState = { ...uiState, ...patch };
    leaderboardRoot.render(h(LeaderboardView, uiState));
  };
  renderState();

  // 1) Figure out target reset date
  const nextResetDate = await getNextResetDate();

  // 2) Start live countdown (self‑correcting each second)
  let resetFired = false;
  const updateCountdown = () => {
    const time = getTimeRemainingTo(nextResetDate);
    if (time.total <= 0) {
      renderState({ countdown: "Resetting…" });
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
    if (time.days === 0 && time.hours === 0 && time.mins === 0) {
      renderState({ countdown: `${time.secs}s` });
    } else {
      renderState({ countdown: `${time.days}d ${time.hours}h ${time.mins}m` });
    }
  };
  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);

  // 3) Load leaderboard data
  try {
    const leaderboardQuery = query(
      collection(db, "users"),
      where("weekMinutes", ">", 0),
      where("weekMinutes", "<=", MAX_WEEKLY_MINUTES),
      orderBy("weekMinutes", "desc"),
      limit(15)
    );

    const snap = await getDocs(leaderboardQuery);
    // Client-side guard: exclude any doc that somehow exceeds the cap
    const validDocs = snap.docs.filter(d => (d.data().weekMinutes || 0) <= MAX_WEEKLY_MINUTES).slice(0, 10);

    if (validDocs.length === 0) {
      renderState({ status: "empty", entries: [] });
      return;
    }

    let rank = 1;
    const entries = validDocs.map((docSnap) => {
      const data = docSnap.data();
      const tier = calculateTier(data.totalEarned || 0);
      const reward = getPotentialReward(rank);

      let rankBadge = h(
        "span",
        { className: "text-gray-500 font-mono w-6 text-center" },
        `${rank}`
      );
      if (rank === 1) rankBadge = h("span", null, "🥇");
      if (rank === 2) rankBadge = h("span", null, "🥈");
      if (rank === 3) rankBadge = h("span", null, "🥉");

      const entryUid  = docSnap.id;
      const entryName = data.firstName || "Student";
      const entry = {
        uid: entryUid,
        name: entryName,
        tierName: tier.name,
        tierColor: tier.color,
        reward,
        rank,
        rankBadge,
        weekMinutes: data.weekMinutes || 0,
      };
      rank++;
      return entry;
    });
    renderState({ status: "ready", entries });
  } catch (err) {
    console.error("Leaderboard Error:", err);
    renderState({ status: "error", entries: [] });
  }
}

/**
 * Refresh the leaderboard by clearing the rendered flag and re-rendering.
 * Called after weekMinutes is updated so the new score is reflected.
 */
function refreshLeaderboard() {
  leaderboardRendered = false;
  renderLeaderboard();
}

// Re-render the leaderboard whenever the user finishes a study session
// (links.js dispatches this event after updating weekMinutes).
document.addEventListener("weekMinutesUpdated", refreshLeaderboard);
