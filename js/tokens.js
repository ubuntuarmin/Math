import { auth, db } from "./firebase.js";
import {
  doc,
  updateDoc,
  arrayUnion,
  increment,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const dailyTracker = document.getElementById("dailyTracker");

// 24 hours between claims
const DAY_IN_MS = 24 * 60 * 60 * 1000;
// 30-hour Hard Mode: if they disappear longer than this, streak resets
const RESET_LIMIT = 30 * 60 * 60 * 1000;

const { useState, useEffect, useCallback, memo } = React;
const h = React.createElement;

let dailyRoot = null;

/**
 * Small floating "+10" effect (modernized a bit)
 */
function showFloating(text = "+10 🪙") {
  const el = document.createElement("div");
  el.className =
    "floating-credit fixed z-[9999] pointer-events-none text-green-400 font-extrabold text-2xl " +
    "drop-shadow-[0_0_15px_rgba(34,197,94,0.7)] transition-all duration-700 ease-out";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.transform = "translate(-50%, -50%) scale(0.9)";
  el.style.opacity = "0.95";
  el.textContent = text;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transform = "translate(-50%, calc(-50% - 120px)) scale(1.1)";
    el.style.opacity = "0";
  });

  setTimeout(() => el.remove(), 800);
}

/**
 * Utility: format milliseconds into "Xh Ym Zs"
 */
function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

// ── DayCard: memoized so only the card whose props changed re-renders ──────────
const DayCard = memo(function DayCard({
  day, rewardAmount, isAlreadyRedeemed, isTargetDay, canClaim,
  isLocked, isMilestone, countdown, onClaim,
}) {
  const [claiming, setClaiming] = useState(false);

  const handleClick = async () => {
    if (claiming || !canClaim) return;
    setClaiming(true);
    try {
      await onClaim(day, rewardAmount);
    } catch (_) {
      // restore button on error; on success parent re-renders with new props
      setClaiming(false);
    }
  };

  const wrapperCls = [
    "day-card relative p-2 rounded-xl flex flex-col items-center gap-2 min-h-[120px]",
    "bg-gradient-to-b from-gray-800/80 to-gray-900/80",
    "border border-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.6)]",
    "backdrop-blur-sm transition-all duration-300 ease-out",
    "hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.8)]",
    isAlreadyRedeemed ? "opacity-60" : "",
    isTargetDay ? "ring-2 ring-blue-500/60 ring-offset-2 ring-offset-gray-900" : "",
  ].filter(Boolean).join(" ");

  const boxCls = [
    "h-10 w-full rounded-lg flex flex-col items-center justify-center",
    "transition-all duration-300 border border-white/10 text-xs font-bold tracking-tight",
    isAlreadyRedeemed
      ? "bg-green-600/90 shadow-inner shadow-green-500/40"
      : canClaim
      ? "bg-blue-600/90 animate-pulse shadow-[0_0_18px_rgba(37,99,235,0.8)] scale-[1.02]"
      : "bg-gray-700/80",
    isMilestone ? "border-2 border-yellow-400 shadow-[0_0_18px_rgba(250,204,21,0.7)]" : "",
  ].filter(Boolean).join(" ");

  const btnCls = [
    "redeem-btn w-full mt-auto text-white font-bold py-1 px-1 text-[10px] rounded-lg transition-all",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
    isAlreadyRedeemed
      ? "bg-gray-600/80"
      : canClaim && !claiming
      ? "bg-green-600 hover:bg-green-500 hover:scale-[1.03] active:scale-95 shadow-[0_0_15px_rgba(34,197,94,0.8)]"
      : "bg-gray-700/80 cursor-not-allowed hover:scale-100 opacity-80",
  ].filter(Boolean).join(" ");

  let infoCls =
    "text-[10px] text-gray-300 text-center uppercase font-bold h-4 flex items-center justify-center";
  let infoText = "";
  if (isAlreadyRedeemed) {
    infoText = "Claimed";
  } else if (canClaim) {
    infoText = "Ready!";
    infoCls += " text-blue-300";
  } else if (countdown) {
    infoText = countdown;
  } else if (isLocked) {
    infoText = "Locked";
    infoCls += " opacity-40";
  } else {
    infoText = "Collected";
  }

  const btnText = isAlreadyRedeemed
    ? "✓"
    : claiming
    ? "..."
    : canClaim
    ? "Claim"
    : isLocked
    ? "Wait"
    : "Collected";

  return h("div", { className: wrapperCls },
    h("div", { className: boxCls },
      h("div", { className: "font-black text-[11px] drop-shadow-sm" }, day),
      h("div", { className: "text-[9px] font-bold flex items-center gap-1" },
        h("span", null, rewardAmount),
        h("span", null, "🪙"),
      )
    ),
    h("div", { className: infoCls }, infoText),
    h("button", {
      className: btnCls,
      disabled: isAlreadyRedeemed || !canClaim || claiming,
      onClick: handleClick,
    }, btnText)
  );
});

// ── DailyTrackerApp: top-level component ─────────────────────────────────────
function DailyTrackerApp({ userData, uid, renderFn }) {
  // Derive all display state from props on each render
  const streak = Math.max(
    0,
    Math.min(
      typeof userData.streak === "number" && Number.isFinite(userData.streak)
        ? userData.streak
        : 0,
      30
    )
  );
  const redeemed = new Set(
    Array.isArray(userData.redeemedDays) ? userData.redeemedDays : []
  );
  const lastUpdateTs = userData.lastStreakUpdate;
  const lastUpdate =
    lastUpdateTs && typeof lastUpdateTs.toMillis === "function"
      ? lastUpdateTs.toMillis()
      : 0;

  // tick drives re-renders every second so countdown text stays live
  const [tick, setTick] = useState(0);

  const now = Date.now();
  const timeSinceLast = lastUpdate ? now - lastUpdate : 0;
  const isWaitPeriodOver = !lastUpdate || timeSinceLast >= DAY_IN_MS;
  const targetDay = streak + 1;
  const needsCountdown = targetDay <= 30 && !!lastUpdate && !isWaitPeriodOver;

  // Single interval replaces the previous array of up to 30 intervals
  useEffect(() => {
    if (!needsCountdown) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [needsCountdown]);

  // Re-fetch and re-render when the countdown reaches zero
  useEffect(() => {
    if (!needsCountdown) return;
    const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
    if (remaining <= 0) {
      getDoc(doc(db, "users", uid))
        .then((s) => s.exists() && renderFn(s.data()))
        .catch((err) => console.error("Timer refresh fetch failed:", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Keep sibling #nextReward banner in sync (outside the React root)
  useEffect(() => {
    const el = document.getElementById("nextReward");
    if (!el) return;
    if (streak >= 30) {
      el.textContent = "30-Day Streak Complete!";
      el.className =
        "text-yellow-400 font-bold text-sm md:text-base flex items-center gap-2 " +
        "drop-shadow-[0_0_15px_rgba(250,204,21,0.7)]";
    } else if (streak === 0 || isWaitPeriodOver || !lastUpdate) {
      el.textContent = "Next reward is ready for pickup!";
      el.className =
        "text-green-400 font-bold text-sm md:text-base animate-bounce " +
        "drop-shadow-[0_0_12px_rgba(34,197,94,0.8)]";
    } else {
      el.textContent = `Next unlock in: ${formatTime(
        Math.max(0, DAY_IN_MS - timeSinceLast)
      )}`;
      el.className = "text-blue-300 font-semibold text-sm md:text-base";
    }
  });

  // Stable claim handler shared across all 30 cards via memo
  const handleClaim = useCallback(
    async (day, rewardAmount) => {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, {
        redeemedDays: arrayUnion(day),
        credits: increment(rewardAmount),
        totalEarned: increment(rewardAmount),
        streak: increment(1),
        lastStreakUpdate: serverTimestamp(),
      });
      showFloating(`+${rewardAmount} 🪙`);
      const freshSnap = await getDoc(userRef);
      const freshData = freshSnap.data();
      renderFn(freshData);
      const headerCredits = document.getElementById("creditCount");
      if (headerCredits) headerCredits.textContent = freshData.credits || 0;
      window.dispatchEvent(
        new CustomEvent("userProfileUpdated", { detail: freshData })
      );
    },
    [uid, renderFn]
  );

  const cards = [];
  for (let i = 1; i <= 30; i++) {
    const isAlreadyRedeemed = redeemed.has(i);
    const isTargetDay = i === targetDay;
    const canClaim =
      isTargetDay && (streak === 0 || isWaitPeriodOver || !lastUpdate);
    const isLocked = i > targetDay;
    const isMilestone = i === 15;
    const rewardAmount = isMilestone ? 100 : 10;
    const countdown =
      isTargetDay && lastUpdate && !isWaitPeriodOver
        ? formatTime(Math.max(0, DAY_IN_MS - timeSinceLast))
        : null;

    cards.push(
      h(DayCard, {
        key: i,
        day: i,
        rewardAmount,
        isAlreadyRedeemed,
        isTargetDay,
        canClaim,
        isLocked,
        isMilestone,
        countdown,
        onClaim: handleClaim,
      })
    );
  }

  return h(React.Fragment, null, ...cards);
}

/**
 * MAIN ENTRY: Render the daily streak UI
 * Safe for legacy users (missing fields).
 */
export async function renderDaily(userData) {
  if (!dailyTracker) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // --- SAFETY for existing users ---
  // If userData is missing or doesn't have streak fields, refresh from DB once.
  if (!userData || typeof userData.streak === "undefined") {
    try {
      const freshSnap = await getDoc(doc(db, "users", uid));
      if (freshSnap.exists()) {
        userData = freshSnap.data();
      } else {
        userData = {};
      }
    } catch (err) {
      console.error("renderDaily: failed to refetch user data", err);
      userData = userData || {};
    }
  }

  // Robust streak normalization
  let streak =
    typeof userData.streak === "number" && Number.isFinite(userData.streak)
      ? userData.streak
      : 0;
  if (streak < 0) streak = 0;

  const lastUpdateTs = userData.lastStreakUpdate;
  const lastUpdate =
    lastUpdateTs && typeof lastUpdateTs.toMillis === "function"
      ? lastUpdateTs.toMillis()
      : 0;

  const now = Date.now();

  // --- HARD MODE RESET (30h) ---
  if (streak > 0 && lastUpdate > 0 && now - lastUpdate > RESET_LIMIT) {
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, {
        streak: 0,
        redeemedDays: [],
        lastStreakUpdate: null,
      });
      userData = { ...userData, streak: 0, redeemedDays: [], lastStreakUpdate: null };
    } catch (err) {
      console.error("Streak hard‑reset failed:", err);
    }
  }

  if (!dailyRoot) {
    dailyRoot = createRoot(dailyTracker);
  }
  dailyRoot.render(h(DailyTrackerApp, { userData, uid, renderFn: renderDaily }));
}
