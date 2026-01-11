import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function showFloating(parent, text = "+10") {
  const el = document.createElement("div");
  el.className = "floating-credit";
  el.style.left = "50%";
  el.style.top = "10%";
  el.style.transform = "translate(-50%, 0)";
  el.textContent = text;
  parent.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = "translate(-50%, -80px)";
    el.style.opacity = "0";
  });
  setTimeout(() => el.remove(), 800);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export async function renderDaily(userData) {
  dailyTracker.innerHTML = "";
  const streak = userData?.streak || 0;
  const redeemed = new Set(userData?.redeemedDays || []);
  const lastUpdate = userData?.lastStreakUpdate?.toMillis() || 0;
  const uid = auth.currentUser?.uid;

  const now = Date.now();
  const timeSinceLast = now - lastUpdate;
  const isWaitPeriodOver = timeSinceLast >= DAY_IN_MS;

  for (let i = 1; i <= 30; i++) {
    const isEligible = i <= streak;
    const isRedeemed = redeemed.has(i);
    const isNextDay = i === streak + 1;

    const wrapper = document.createElement("div");
    wrapper.className = "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative";
    wrapper.style.minHeight = "72px";

    const box = document.createElement("div");
    box.className = `h-12 w-full rounded flex items-center justify-center ${
      isEligible ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gray-700"
    }`;
    box.innerHTML = `<div class="font-semibold">${i}</div>`;
    wrapper.appendChild(box);

    const info = document.createElement("div");
    info.className = "text-xs text-gray-300 text-center";
    
    // Set status text/timer
    if (isRedeemed) {
      info.textContent = "Redeemed";
    } else if (isEligible) {
      info.textContent = (i === streak) ? "Today" : "Available";
    } else if (isNextDay) {
      if (isWaitPeriodOver) {
        info.textContent = "Ready!";
      } else {
        info.id = `timer-${i}`;
        info.textContent = "Waiting...";
      }
    } else {
      info.textContent = "Locked";
    }
    wrapper.appendChild(info);

    const btn = document.createElement("button");
    btn.className = "redeem-btn";
    btn.textContent = isRedeemed ? "Redeemed" : (isEligible ? "Redeem +10" : "Locked");
    btn.disabled = !isEligible || isRedeemed || !uid;
    wrapper.appendChild(btn);

    // Click behavior
    btn.addEventListener("click", async () => {
      if (!uid || btn.disabled) return;
      const confirmMsg = `Redeem day ${i} for +10 coins?`;
      if (!confirm(confirmMsg)) return;

      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = "...";

      try {
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
          redeemedDays: arrayUnion(i),
          credits: increment(10),
          totalEarned: increment(10)
        });

        info.textContent = "Redeemed";
        btn.textContent = "Redeemed";
        btn.disabled = true;
        showFloating(wrapper, "+10");
        window.dispatchEvent(new CustomEvent("userProfileUpdated"));
      } catch (err) {
        console.error("Redeem failed:", err);
        btn.disabled = false;
        btn.textContent = prevText;
        alert("Failed to redeem. Try again.");
      }
    });

    dailyTracker.appendChild(wrapper);

    // Live countdown for the next day
    if (isNextDay && !isWaitPeriodOver) {
      const timerEl = document.getElementById(`timer-${i}`);
      const interval = setInterval(() => {
        const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
        if (remaining <= 0) {
          if (timerEl) timerEl.textContent = "Available!";
          clearInterval(interval);
        } else if (timerEl) {
          timerEl.textContent = formatTime(remaining);
        }
      }, 1000);
    }
  }

  // Update Top Banner text
  if (streak < 30) {
    if (isWaitPeriodOver) {
      nextReward.textContent = "Next day unlocked! Log in to progress.";
    } else {
      nextReward.textContent = `Next streak update in: ${formatTime(DAY_IN_MS - timeSinceLast)}`;
    }
  } else {
    nextReward.textContent = "Max streak reached!";
  }
}
