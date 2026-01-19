import { auth, db } from "./firebase.js";
import {
  doc,
  updateDoc,
  arrayUnion,
  increment,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

// 24 hours between claims
const DAY_IN_MS = 24 * 60 * 60 * 1000;
// 30-hour Hard Mode: if they disappear longer than this, streak resets
const RESET_LIMIT = 30 * 60 * 60 * 1000;

let activeIntervals = [];

/**
 * Clear all running countdown timers before re‑rendering
 */
function clearTimers() {
  activeIntervals.forEach(clearInterval);
  activeIntervals = [];
}

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

/**
 * MAIN ENTRY: Render the daily streak UI
 * Safe for legacy users (missing fields).
 */
export async function renderDaily(userData) {
  if (!dailyTracker) return;

  clearTimers();
  dailyTracker.innerHTML = "";

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
  let streakRaw = userData.streak;
  let streak =
    typeof streakRaw === "number" && Number.isFinite(streakRaw)
      ? streakRaw
      : 0;

  // Never allow negative streak in UI
  if (streak < 0) streak = 0;

  const redeemedDaysArr = Array.isArray(userData.redeemedDays)
    ? userData.redeemedDays
    : [];
  let redeemed = new Set(redeemedDaysArr);

  // lastStreakUpdate is a Firestore Timestamp or missing
  const lastUpdateTs = userData.lastStreakUpdate;
  const lastUpdate =
    lastUpdateTs && typeof lastUpdateTs.toMillis === "function"
      ? lastUpdateTs.toMillis()
      : 0;

  const now = Date.now();

  // --- HARD MODE RESET (30h) ---
  // If they haven't claimed in > RESET_LIMIT, reset streak and redeemedDays.
  if (streak > 0 && lastUpdate > 0 && now - lastUpdate > RESET_LIMIT) {
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, {
        streak: 0,
        redeemedDays: [],
        lastStreakUpdate: null,
      });
      streak = 0;
      redeemed = new Set();
    } catch (err) {
      console.error("Streak hard‑reset failed:", err);
    }
  }

  const timeSinceLast = lastUpdate ? now - lastUpdate : 0;
  const isWaitPeriodOver = !lastUpdate || timeSinceLast >= DAY_IN_MS;

  // IMPORTANT: clamp streak to [0, 30] for safety
  if (streak > 30) streak = 30;

  // --- BUILD 30-DAY GRID ---
  for (let i = 1; i <= 30; i++) {
    const isAlreadyRedeemed = redeemed.has(i);

    // A day is the "current target" only if it is exactly next after current streak
    const isTargetDay = i === streak + 1;

    // Can claim if:
    // - it's the very first day (streak 0) and no timer running
    // - OR there was a previous claim and 24 hours have passed
    const canClaim =
      isTargetDay &&
      (streak === 0 || isWaitPeriodOver || !lastUpdate); // lastUpdate==0 => legacy user first claim

    // Reward table: day 15 = 100, else 10
    const rewardAmount = i === 15 ? 100 : 10;

    const wrapper = document.createElement("div");

    // Modernized base card: subtle 3D/glass effect + transitions
    wrapper.className =
      "day-card relative p-2 rounded-xl flex flex-col items-center gap-2 min-h-[120px] " +
      "bg-gradient-to-b from-gray-800/80 to-gray-900/80 " +
      "border border-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] " +
      "backdrop-blur-sm transition-all duration-300 ease-out " +
      "hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.8)]";

    if (isAlreadyRedeemed) {
      wrapper.className += " opacity-60";
    }

    // Subtle ring/glow for target day
    if (isTargetDay) {
      wrapper.className +=
        " ring-2 ring-blue-500/60 ring-offset-2 ring-offset-gray-900";
    }

    const box = document.createElement("div");
    box.className =
      "h-10 w-full rounded-lg flex flex-col items-center justify-center transition-all duration-300 " +
      "border border-white/10 text-xs font-bold tracking-tight " +
      (isAlreadyRedeemed
        ? "bg-green-600/90 shadow-inner shadow-green-500/40"
        : canClaim
        ? "bg-blue-600/90 animate-pulse shadow-[0_0_18px_rgba(37,99,235,0.8)] scale-[1.02]"
        : "bg-gray-700/80") +
      (i === 15
        ? " border-2 border-yellow-400 shadow-[0_0_18px_rgba(250,204,21,0.7)]"
        : "");

    box.innerHTML = `
      <div class="font-black text-[11px] drop-shadow-sm">${i}</div>
      <div class="text-[9px] font-bold flex items-center gap-1">
        <span>${rewardAmount}</span><span>🪙</span>
      </div>
    `;
    wrapper.appendChild(box);

    const info = document.createElement("div");
    info.className =
      "text-[10px] text-gray-300 text-center uppercase font-bold h-4 flex items-center justify-center";

    if (isAlreadyRedeemed) {
      info.textContent = "Claimed";
    } else if (canClaim) {
      info.textContent = "Ready!";
      info.classList.add("text-blue-300");
    } else if (isTargetDay && lastUpdate && !isWaitPeriodOver) {
      // Only show countdown for the next day, if a previous claim happened
      info.id = `timer-${i}`;
      info.textContent = formatTime(DAY_IN_MS - timeSinceLast);
    } else {
      // Past but not redeemed days = "Collected"
      // Future days = "Locked"
      if (i <= streak) {
        info.textContent = "Collected";
      } else {
        info.textContent = "Locked";
        info.classList.add("opacity-40");
      }
    }
    wrapper.appendChild(info);

    const btn = document.createElement("button");
    btn.className =
      "redeem-btn w-full mt-auto text-white font-bold py-1 px-1 text-[10px] rounded-lg transition-all " +
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900";

    if (isAlreadyRedeemed) {
      btn.textContent = "✓";
      btn.classList.add("bg-gray-600/80");
      btn.disabled = true;
    } else if (canClaim) {
      btn.textContent = "Claim";
      btn.classList.add(
        "bg-green-600",
        "hover:bg-green-500",
        "hover:scale-[1.03]",
        "active:scale-95",
        "shadow-[0_0_15px_rgba(34,197,94,0.8)]"
      );
      btn.disabled = false;
    } else {
      btn.textContent = i <= streak ? "Collected" : "Wait";
      btn.classList.add(
        "bg-gray-700/80",
        "cursor-not-allowed",
        "hover:scale-100",
        "opacity-80"
      );
      btn.disabled = true;
    }

    // Extra safety: prevent double-click glitches
    let isProcessing = false;

    btn.onclick = async () => {
      if (btn.disabled || isProcessing || !canClaim) return;
      isProcessing = true;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "...";

      try {
        const userRef = doc(db, "users", uid);

        // Use serverTimestamp so future comparisons are consistent
        await updateDoc(userRef, {
          redeemedDays: arrayUnion(i),
          credits: increment(rewardAmount),
          totalEarned: increment(rewardAmount),
          streak: increment(1),
          lastStreakUpdate: serverTimestamp(),
        });

        showFloating(`+${rewardAmount} 🪙`);

        // Fetch fresh data and re-render (keeps everything in sync)
        const freshSnap = await getDoc(userRef);
        const freshData = freshSnap.data();
        renderDaily(freshData);

        // Update header credits + propagate to other modules
        const headerCredits = document.getElementById("creditCount");
        if (headerCredits) {
          headerCredits.textContent = freshData.credits || 0;
        }
        window.dispatchEvent(
          new CustomEvent("userProfileUpdated", { detail: freshData })
        );
      } catch (err) {
        console.error("Redeem error:", err);
        btn.disabled = false;
        btn.textContent = originalText;
        isProcessing = false;
      }
    };

    wrapper.appendChild(btn);
    dailyTracker.appendChild(wrapper);

    // Live countdown for the next claim, if needed
    if (isTargetDay && lastUpdate && !isWaitPeriodOver) {
      const timerElId = `timer-${i}`;
      const interval = setInterval(() => {
        const nowLoop = Date.now();
        const elapsed = nowLoop - lastUpdate;
        let remaining = DAY_IN_MS - elapsed;

        // Clamp so it never looks negative
        if (remaining < 0) remaining = 0;

        const timerEl = document.getElementById(timerElId);

        if (!timerEl) {
          clearInterval(interval);
          return;
        }

        if (remaining <= 0) {
          clearInterval(interval);
          // Re‑fetch latest user doc and re‑render to show "Ready!"
          getDoc(doc(db, "users", uid))
            .then((s) => s.exists() && renderDaily(s.data()))
            .catch((err) =>
              console.error("Timer refresh fetch failed:", err)
            );
        } else {
          timerEl.textContent = formatTime(remaining);
        }
      }, 1000);

      activeIntervals.push(interval);
    }
  }

  // --- Top banner under "Next Reward" ---
  if (nextReward) {
    if (streak >= 30) {
      nextReward.textContent = "30-Day Streak Complete!";
      nextReward.className =
        "text-yellow-400 font-bold text-sm md:text-base flex items-center gap-2 " +
        "drop-shadow-[0_0_15px_rgba(250,204,21,0.7)]";
    } else if (streak === 0 || isWaitPeriodOver || !lastUpdate) {
      nextReward.textContent = "Next reward is ready for pickup!";
      nextReward.className =
        "text-green-400 font-bold text-sm md:text-base animate-bounce " +
        "drop-shadow-[0_0_12px_rgba(34,197,94,0.8)]";
    } else {
      nextReward.textContent = `Next unlock in: ${formatTime(
        DAY_IN_MS - timeSinceLast
      )}`;
      nextReward.className =
        "text-blue-300 font-semibold text-sm md:text-base";
    }
  }
}
