import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

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
  if (!dailyTracker) return;
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
    wrapper.className = "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative min-h-[100px]";

    const box = document.createElement("div");
    box.className = `h-10 w-full rounded flex items-center justify-center transition-all ${
      isEligible ? "bg-gradient-to-r from-green-400 to-green-500 shadow-md" : "bg-gray-700"
    }`;
    box.innerHTML = `<div class="font-bold text-sm">${i}</div>`;
    wrapper.appendChild(box);

    const info = document.createElement("div");
    info.className = "text-[10px] text-gray-300 text-center uppercase font-bold tracking-tighter";
    
    if (isRedeemed) {
      info.textContent = "Claimed";
      info.classList.add("opacity-50");
    } else if (isEligible) {
      info.textContent = "Available";
      info.classList.add("text-green-400");
    } else if (isNextDay) {
      if (isWaitPeriodOver || streak === 0) {
        info.textContent = "Ready!";
        info.classList.add("text-blue-400");
      } else {
        info.id = `timer-${i}`;
        info.textContent = "Locked";
      }
    } else {
      info.textContent = "Locked";
      info.classList.add("opacity-30");
    }
    wrapper.appendChild(info);

    const btn = document.createElement("button");
    btn.className = "redeem-btn w-full mt-auto text-white font-bold py-1 px-2 rounded transition-colors";
    
    // Style the button based on state
    if (isRedeemed) {
        btn.textContent = "Claimed";
        btn.classList.add("bg-gray-600", "cursor-default");
        btn.disabled = true;
    } else if (isEligible) {
        btn.textContent = "Claim";
        btn.classList.add("bg-green-600", "hover:bg-green-500");
        btn.disabled = false;
    } else {
        btn.textContent = "Locked";
        btn.classList.add("bg-gray-700", "opacity-50", "cursor-not-allowed");
        btn.disabled = true;
    }
    wrapper.appendChild(btn);

    btn.addEventListener("click", async () => {
      if (!uid || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Processing...";

      try {
        const userRef = doc(db, "users", uid);
        
        // Use field names consistent with your app
        await updateDoc(userRef, {
          redeemedDays: arrayUnion(i),
          credits: increment(10),       // Main balance
          totalEarned: increment(10)   // Lifetime balance
        });

        showFloating(wrapper, "+10 🪙");
        
        // IMPORTANT: Refresh data immediately
        const freshSnap = await getDoc(userRef);
        const newData = freshSnap.data();

        // Update the header credits immediately
        const headerCredits = document.getElementById("creditCount");
        if (headerCredits) headerCredits.textContent = newData.credits || 0;

        // Re-render this page so the button turns to "Claimed"
        renderDaily(newData);

        // Tell other pages (Account/Leaderboard) that data changed
        window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: newData }));

      } catch (err) {
        console.error("Redeem failed:", err);
        btn.disabled = false;
        btn.textContent = "Retry";
      }
    });

    dailyTracker.appendChild(wrapper);

    // Timer logic
    if (isNextDay && !isWaitPeriodOver && lastUpdate > 0) {
      const timerEl = document.getElementById(`timer-${i}`);
      const interval = setInterval(() => {
        const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
        if (remaining <= 0) {
          if (timerEl) {
              timerEl.textContent = "Ready!";
              timerEl.classList.add("text-blue-400");
          }
          // Potentially refresh the UI here
          clearInterval(interval);
        } else if (timerEl) {
          timerEl.textContent = formatTime(remaining);
        }
      }, 1000);
    }
  }

  // Update Top Banner
  if (nextReward) {
      if (streak < 30) {
        if (isWaitPeriodOver || streak === 0) {
          nextReward.textContent = "A new day is ready to be unlocked! Keep learning to increase your streak.";
          nextReward.className = "text-green-400 font-bold pulse";
        } else {
          nextReward.textContent = `Next streak unlock in: ${formatTime(DAY_IN_MS - timeSinceLast)}`;
          nextReward.className = "text-blue-300";
        }
      } else {
          nextReward.textContent = "Maximum streak reached! You are a Math Master.";
          nextReward.className = "text-yellow-400 font-bold";
      }
  }
}
