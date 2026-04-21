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
let leaderboardRendered = false;

const MAX_WEEKLY_MINUTES = 10000;
const SETTINGS_CACHE_KEY = "leaderboardNextReset";
const SETTINGS_CACHE_TTL = 60 * 60 * 1000;
const POST_RESET_REFRESH_DELAY = 10000;

function getUTCWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getNextWeeklyResetUTC() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
    0, 0, 0, 0
  ));
}

function getNextBimonthlyReset() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (day < 15) {
    return new Date(year, month, 15, 0, 0, 0, 0);
  } else if (day < 29) {
    return new Date(year, month, 29, 0, 0, 0, 0);
  }
  return new Date(year, month + 1, 15, 0, 0, 0, 0);
}

async function getNextTimeLeaderboardReset() {
  const now = Date.now();
  try {
    const cached = sessionStorage.getItem(SETTINGS_CACHE_KEY);
    if (cached) {
      const { value, timestamp } = JSON.parse(cached);
      if (now - timestamp < SETTINGS_CACHE_TTL) {
        const date = new Date(value);
        if (date.getTime() > now) return date;
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
        const date = typeof data.nextReset.toMillis === "function"
          ? new Date(data.nextReset.toMillis())
          : new Date(data.nextReset);
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

  return getNextBimonthlyReset();
}

function getTimeRemainingTo(targetDate) {
  const diff = targetDate - new Date();
  if (diff <= 0) return { days: 0, hours: 0, mins: 0, secs: 0, total: 0 };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);
  const secs = Math.floor((diff / 1000) % 60);
  return { days, hours, mins, secs, total: diff };
}

function getTimeLeaderboardReward(rank) {
  if (rank > 10) return 0;
  return 110 - rank * 10;
}

function getReferralLeaderboardReward(rank) {
  if (rank === 1) return 200;
  if (rank === 2) return 150;
  if (rank === 3) return 100;
  if (rank === 4) return 90;
  if (rank === 5) return 80;
  if (rank >= 6 && rank <= 10) return 80 - (rank - 5) * 10;
  return 0;
}

function getReferralRewardLegend() {
  return Array.from({ length: 10 }, (_, idx) => {
    const rank = idx + 1;
    const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
    return `${rank}${suffix} ${getReferralLeaderboardReward(rank)}min`;
  }).join(" · ");
}

const h = React.createElement;

const LeaderboardEntries = React.memo(function LeaderboardEntries({ status, entries, metricSuffix, metricLabel }) {
  return h(
    React.Fragment,
    null,
    status === "loading" &&
      h("div", { className: "flex justify-center py-8" }, h("div", { className: "loader" })),
    status === "empty" &&
      h("p", { className: "text-center py-10 text-gray-500" }, "No activity yet. Be the first!"),
    status === "error" &&
      h("p", { className: "text-red-500 text-xs text-center" }, "Failed to load rankings."),
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
              h("div", { className: "text-[10px] text-emerald-400 font-bold" }, entry.rewardText)
            )
          ),
          h(
            "div",
            { className: "text-right" },
            h(
              "div",
              { className: "text-blue-400 font-black text-lg" },
              `${entry.metric}`,
              h("span", { className: "text-[10px] ml-0.5" }, metricSuffix)
            ),
            h("div", { className: "text-[9px] text-gray-600 uppercase font-bold" }, metricLabel),
            h("div", { className: "text-[10px] text-gray-600 mt-0.5" }, "View Profile →")
          )
        )
      )
  );
});

function LeaderboardView({ state, onTabChange }) {
  const activeIsTime = state.activeTab === "time";
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "flex gap-2 mb-4 rounded-xl bg-gray-950/70 p-1 border border-gray-800" },
      h(
        "button",
        {
          className: `flex-1 text-xs font-black py-2 rounded-lg transition ${activeIsTime ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/80"}`,
          onClick: () => onTabChange("time"),
        },
        "⏱️ Time Leaderboard"
      ),
      h(
        "button",
        {
          className: `flex-1 text-xs font-black py-2 rounded-lg transition ${!activeIsTime ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/80"}`,
          onClick: () => onTabChange("referrals"),
        },
        "👥 Weekly Referrals"
      )
    ),
    activeIsTime &&
      h(
        "div",
        {
          id: "leaderboardHeader",
          className: "mb-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-2xl text-center",
        },
        h("div", { className: "text-[10px] uppercase tracking-[0.2em] text-blue-400 font-black mb-1" }, "Season Ends In"),
        h("div", { className: "text-2xl font-mono font-black text-white" }, state.timeCountdown),
        h("div", { className: "text-[9px] text-gray-500 mt-1 italic" }, "Resets on the 15th & 29th · Top 10 win bonus minutes!")
      ),
    !activeIsTime &&
      h(
        "div",
        { className: "mb-6 p-4 bg-purple-900/20 border border-purple-500/30 rounded-2xl text-center" },
        h("div", { className: "text-[10px] uppercase tracking-[0.2em] text-purple-300 font-black mb-1" }, "Weekly Referral Race"),
        h("div", { className: "text-2xl font-mono font-black text-white" }, state.referralCountdown),
        h("div", { className: "text-[10px] text-purple-200 mt-1 font-semibold" }, getReferralRewardLegend())
      ),
    h(
      "div",
      { className: "space-y-3" },
      activeIsTime
        ? h(LeaderboardEntries, {
            status: state.timeStatus,
            entries: state.timeEntries,
            metricSuffix: "m",
            metricLabel: "This Week",
          })
        : h(LeaderboardEntries, {
            status: state.referralStatus,
            entries: state.referralEntries,
            metricSuffix: "",
            metricLabel: "Referrals This Week",
          })
    )
  );
}

export async function renderLeaderboard() {
  if (!leaderboardRoot) return;
  if (leaderboardRendered) return;
  leaderboardRendered = true;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  let state = {
    activeTab: "time",
    timeCountdown: "--",
    referralCountdown: "--",
    timeStatus: "loading",
    referralStatus: "loading",
    timeEntries: [],
    referralEntries: [],
  };

  const renderState = (patch = {}) => {
    state = { ...state, ...patch };
    leaderboardRoot.render(h(LeaderboardView, {
      state,
      onTabChange: (tab) => renderState({ activeTab: tab }),
    }));
  };
  renderState();

  const nextTimeReset = await getNextTimeLeaderboardReset();
  const nextReferralReset = getNextWeeklyResetUTC();
  let refreshTriggered = false;

  const updateCountdown = () => {
    const timeRemaining = getTimeRemainingTo(nextTimeReset);
    const referralRemaining = getTimeRemainingTo(nextReferralReset);

    const timeCountdown = timeRemaining.total <= 0
      ? "Refreshing…"
      : (timeRemaining.days === 0 && timeRemaining.hours === 0 && timeRemaining.mins === 0
        ? `${timeRemaining.secs}s`
        : `${timeRemaining.days}d ${timeRemaining.hours}h ${timeRemaining.mins}m`);

    const referralCountdown = referralRemaining.total <= 0
      ? "Refreshing…"
      : (referralRemaining.days === 0 && referralRemaining.hours === 0 && referralRemaining.mins === 0
        ? `${referralRemaining.secs}s`
        : `${referralRemaining.days}d ${referralRemaining.hours}h ${referralRemaining.mins}m`);

    renderState({ timeCountdown, referralCountdown });

    if (!refreshTriggered && (timeRemaining.total <= 0 || referralRemaining.total <= 0)) {
      refreshTriggered = true;
      try { sessionStorage.removeItem(SETTINGS_CACHE_KEY); } catch (_) {}
      clearInterval(timerInterval);
      timerInterval = null;
      setTimeout(() => {
        leaderboardRendered = false;
        renderLeaderboard();
      }, POST_RESET_REFRESH_DELAY);
    }
  };

  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);

  try {
    const timeLeaderboardQuery = query(
      collection(db, "users"),
      where("weekMinutes", ">", 0),
      where("weekMinutes", "<=", MAX_WEEKLY_MINUTES),
      orderBy("weekMinutes", "desc"),
      limit(15)
    );
    const timeSnap = await getDocs(timeLeaderboardQuery);
    const validDocs = timeSnap.docs
      .filter((d) => (d.data().weekMinutes || 0) <= MAX_WEEKLY_MINUTES)
      .slice(0, 10);

    if (validDocs.length === 0) {
      renderState({ timeStatus: "empty", timeEntries: [] });
    } else {
      let rank = 1;
      const entries = validDocs.map((docSnap) => {
        const data = docSnap.data();
        const tier = calculateTier(data.totalEarned || 0);
        const rankBadge =
          rank === 1 ? h("span", null, "🥇") :
          rank === 2 ? h("span", null, "🥈") :
          rank === 3 ? h("span", null, "🥉") :
          h("span", { className: "text-gray-500 font-mono w-6 text-center" }, `${rank}`);
        const entry = {
          uid: docSnap.id,
          name: data.firstName || "Student",
          tierName: tier.name,
          tierColor: tier.color,
          reward: getTimeLeaderboardReward(rank),
          rewardText: `Estimated Reward: +${getTimeLeaderboardReward(rank)} 🪙`,
          rank,
          rankBadge,
          metric: data.weekMinutes || 0,
        };
        rank++;
        return entry;
      });
      renderState({ timeStatus: "ready", timeEntries: entries });
    }
  } catch (err) {
    console.error("Time Leaderboard Error:", err);
    renderState({ timeStatus: "error", timeEntries: [] });
  }

  try {
    const weekKey = getUTCWeekKey();
    const referralLeaderboardQuery = query(
      collection(db, "users"),
      where("referralWeekKey", "==", weekKey),
      where("weeklyReferralCount", ">", 0),
      orderBy("weeklyReferralCount", "desc"),
      limit(10)
    );
    const referralSnap = await getDocs(referralLeaderboardQuery);

    if (referralSnap.empty) {
      renderState({ referralStatus: "empty", referralEntries: [] });
    } else {
      let rank = 1;
      const entries = referralSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        const tier = calculateTier(data.totalEarned || 0);
        const rankBadge =
          rank === 1 ? h("span", null, "🥇") :
          rank === 2 ? h("span", null, "🥈") :
          rank === 3 ? h("span", null, "🥉") :
          h("span", { className: "text-gray-500 font-mono w-6 text-center" }, `${rank}`);
        const entry = {
          uid: docSnap.id,
          name: data.firstName || "Student",
          tierName: tier.name,
          tierColor: tier.color,
          reward: getReferralLeaderboardReward(rank),
          rewardText: `Reward: +${getReferralLeaderboardReward(rank)} min`,
          rank,
          rankBadge,
          metric: Number(data.weeklyReferralCount || 0),
        };
        rank++;
        return entry;
      });
      renderState({ referralStatus: "ready", referralEntries: entries });
    }
  } catch (err) {
    console.error("Referral Leaderboard Error:", err);
    renderState({ referralStatus: "error", referralEntries: [] });
  }
}

function refreshLeaderboard() {
  leaderboardRendered = false;
  renderLeaderboard();
}

document.addEventListener("weekMinutesUpdated", refreshLeaderboard);
