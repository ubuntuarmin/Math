import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

const DAY_IN_MS = 24 * 60 * 60 * 1000;

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
        const isEarned = i <= streak; // Day is unlocked via streak
        const isRedeemed = redeemed.has(i); // Day has already been claimed
        const isNextToUnlock = i === streak + 1;

        const wrapper = document.createElement("div");
        wrapper.className = "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative min-h-[100px]";

        // Visual Box
        const box = document.createElement("div");
        box.className = `h-10 w-full rounded flex items-center justify-center transition-colors ${
            isRedeemed ? "bg-gray-600 opacity-50" : (isEarned ? "bg-gradient-to-r from-green-500 to-emerald-600 shadow-lg shadow-green-900/20" : "bg-gray-700")
        }`;
        box.innerHTML = `<span class="font-bold text-sm">${i}</span>`;
        wrapper.appendChild(box);

        // Status Label
        const info = document.createElement("div");
        info.className = "text-[10px] uppercase tracking-wider font-medium text-center";
        
        if (isRedeemed) {
            info.textContent = "Claimed";
            info.className += " text-gray-500";
        } else if (isEarned) {
            info.textContent = "Ready!";
            info.className += " text-green-400 animate-pulse";
        } else if (isNextToUnlock) {
            info.id = `timer-${i}`;
            info.textContent = isWaitPeriodOver ? "Available Now" : "Locked";
            info.className += isWaitPeriodOver ? " text-blue-400" : " text-gray-400";
        } else {
            info.textContent = "Locked";
            info.className += " text-gray-600";
        }
        wrapper.appendChild(info);

        // Action Button
        const btn = document.createElement("button");
        btn.className = "redeem-btn w-full mt-auto py-1 text-[10px]";
        btn.disabled = !isEarned || isRedeemed;
        btn.textContent = isRedeemed ? "Done" : (isEarned ? "Redeem +10" : "Locked");

        btn.onclick = async () => {
            if (!uid || btn.disabled) return;
            btn.disabled = true;
            btn.textContent = "...";

            try {
                const userRef = doc(db, "users", uid);
                await updateDoc(userRef, {
                    redeemedDays: arrayUnion(i),
                    credits: increment(10),
                    totalEarned: increment(10)
                });
                // Success: Update UI without full refresh
                window.dispatchEvent(new CustomEvent("userProfileUpdated"));
            } catch (err) {
                console.error("Redemption error:", err);
                btn.disabled = false;
                btn.textContent = "Retry";
            }
        };
        wrapper.appendChild(btn);
        dailyTracker.appendChild(wrapper);

        // Individual Timer for the next day
        if (isNextToUnlock && !isWaitPeriodOver) {
            const timerEl = document.getElementById(`timer-${i}`);
            const interval = setInterval(() => {
                const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
                if (remaining <= 0) {
                    timerEl.textContent = "Refresh to Unlock";
                    timerEl.classList.replace("text-gray-400", "text-blue-400");
                    clearInterval(interval);
                } else {
                    timerEl.textContent = formatTime(remaining);
                }
            }, 1000);
        }
    }

    // Top Header Banner Update
    if (streak < 30) {
        if (isWaitPeriodOver) {
            nextReward.innerHTML = `<span class="text-blue-400 font-bold">New Day Available!</span> Refresh or re-login to progress your streak.`;
        } else {
            const timeLeft = DAY_IN_MS - timeSinceLast;
            nextReward.textContent = `Next streak point in: ${formatTime(timeLeft)}`;
        }
    } else {
        nextReward.textContent = "Monthly streak complete! Great job!";
    }
}
