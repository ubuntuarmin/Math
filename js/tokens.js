import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

// 24 hours
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
 * Small floating "+10" effect
 */
function showFloating(text = "+10 🪙") {
  const el = document.createElement("div");
  el.className = "floating-credit fixed z-50 pointer-events-none text-green-400 font-bold text-xl transition-all duration-700";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.transform = "translate(-50%, -50%)";
  el.textContent = text;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transform = "translate(-50%, calc(-50% - 100px))";
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

  let streak = userData.streak || 0;
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
  // If they haven't visited in > RESET_LIMIT, reset streak and redeemedDays.
  if (streak > 0 && lastUpdate > 0 && now - lastUpdate > RESET_LIMIT) {
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, { streak: 0, redeemedDays: [] });
      streak = 0;
      redeemed = new Set();
    } catch (err) {
      console.error("Streak hard‑reset failed:", err);
    }
  }

  const timeSinceLast = now - (lastUpdate || 0);
  const isWaitPeriodOver = !lastUpdate || timeSinceLast >= DAY_IN_MS;

  // IMPORTANT: clamp streak to [0, 30] for safety
  if (streak < 0) streak = 0;
  if (streak > 30) streak = 30;

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
    wrapper.className =
      "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative min-h-[110px]" +
      (isAlreadyRedeemed ? " opacity-60" : "");

    const box = document.createElement("div");
    box.className =
      "h-10 w-full rounded flex flex-col items-center justify-center transition-all " +
      (isAlreadyRedeemed
        ? "bg-green-600 shadow-inner"
        : canClaim
        ? "bg-blue-600 animate-pulse"
        : "bg-gray-700") +
      (i === 15 ? " border-2 border-yellow-400" : "");

    box.innerHTML = `
      <div class="font-black text-xs">${i}</div>
      <div class="text-[9px] font-bold">${rewardAmount}🪙</div>
    `;
    wrapper.appendChild(box);

    const info = document.createElement("div");
    info.className =
      "text-[10px] text-gray-300 text-center uppercase font-bold h-4";

    if (isAlreadyRedeemed) {
      info.textContent = "Claimed";
    } else if (canClaim) {
      info.textContent = "Ready!";
      info.classList.add("text-blue-400");
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
        info.classList.add("opacity-30");
      }
    }
    wrapper.appendChild(info);

    const btn = document.createElement("button");
    btn.className =
      "redeem-btn w-full mt-auto text-white font-bold py-1 px-1 text-[10px] rounded transition-all";

    if (isAlreadyRedeemed) {
      btn.textContent = "✓";
      btn.classList.add("bg-gray-600");
      btn.disabled = true;
    } else if (canClaim) {
      btn.textContent = "Claim";
      btn.classList.add(
        "bg-green-600",
        "hover:bg-green-500",
        "scale-105"
      );
      btn.disabled = false;
    } else {
      btn.textContent = i <= streak ? "Collected" : "Wait";
      btn.classList.add("bg-gray-700", "cursor-not-allowed");
      btn.disabled = true;
    }

    btn.onclick = async () => {
      if (btn.disabled) return;
      btn.disabled = true;
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
        btn.textContent = "Claim";
      }
    };

    wrapper.appendChild(btn);
    dailyTracker.appendChild(wrapper);

    // Live countdown for the next claim, if needed
    if (isTargetDay && lastUpdate && !isWaitPeriodOver) {
      const timerElId = `timer-${i}`;
      const interval = setInterval(() => {
        const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
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
      nextReward.className = "text-yellow-400 font-bold";
    } else if (streak === 0 || isWaitPeriodOver || !lastUpdate) {
      nextReward.textContent = "Next reward is ready for pickup!";
      nextReward.className = "text-green-400 font-bold animate-bounce";
    } else {
      nextReward.textContent = `Next unlock in: ${formatTime(
        DAY_IN_MS - timeSinceLast
      )}`;
      nextReward.className = "text-blue-300";
    }
  }
}
