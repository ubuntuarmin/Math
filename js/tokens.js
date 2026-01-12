import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RESET_LIMIT = 30 * 60 * 60 * 1000; // Hard Mode: 30 hours without claim = Reset

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

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    let streak = userData?.streak || 0;
    let redeemed = new Set(userData?.redeemedDays || []);
    const lastUpdate = userData?.lastStreakUpdate?.toMillis() || 0;
    const now = Date.now();

    // --- HARD MODE LOGIC: RESET AFTER 30 HOURS ---
    if (streak > 0 && lastUpdate > 0 && (now - lastUpdate) > RESET_LIMIT) {
        try {
            const userRef = doc(db, "users", uid);
            await updateDoc(userRef, {
                streak: 0,
                redeemedDays: [] 
            });
            // Reset local variables for the current view
            streak = 0;
            redeemed = new Set();
            console.log("Streak reset: exceeded 30-hour limit.");
        } catch (err) {
            console.error("Failed to reset streak:", err);
        }
    }

    const timeSinceLast = now - lastUpdate;
    const isWaitPeriodOver = timeSinceLast >= DAY_IN_MS;

    for (let i = 1; i <= 30; i++) {
        const isEligible = i <= streak;
        const isRedeemed = redeemed.has(i);
        const isNextDay = i === streak + 1;
        const rewardAmount = (i === 15) ? 100 : 10; // Special Day 15 Reward

        const wrapper = document.createElement("div");
        wrapper.className = "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative min-h-[110px]";

        const box = document.createElement("div");
        box.className = `h-10 w-full rounded flex flex-col items-center justify-center transition-all ${
            isEligible ? "bg-gradient-to-r from-green-400 to-green-500 shadow-md" : "bg-gray-700"
        } ${i === 15 ? "border-2 border-yellow-400" : ""}`;
        
        box.innerHTML = `
            <div class="font-black text-xs">${i}</div>
            <div class="text-[9px] font-bold">${rewardAmount}🪙</div>
        `;
        wrapper.appendChild(box);

        const info = document.createElement("div");
        info.className = "text-[10px] text-gray-300 text-center uppercase font-bold tracking-tighter h-4";
        
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
        btn.className = "redeem-btn w-full mt-auto text-white font-bold py-1 px-1 text-[10px] rounded transition-colors";
        
        if (isRedeemed) {
            btn.textContent = "✓";
            btn.classList.add("bg-gray-600", "cursor-default");
            btn.disabled = true;
        } else if (isEligible || (isNextDay && (isWaitPeriodOver || streak === 0))) {
            btn.textContent = "Claim";
            btn.classList.add("bg-green-600", "hover:bg-green-500", "pulse");
            btn.disabled = false;
        } else {
            btn.textContent = "Wait";
            btn.classList.add("bg-gray-700", "opacity-50", "cursor-not-allowed");
            btn.disabled = true;
        }
        wrapper.appendChild(btn);

        btn.onclick = async () => {
            if (!uid || btn.disabled) return;
            btn.disabled = true;
            btn.textContent = "...";

            try {
                const userRef = doc(db, "users", uid);
                
                await updateDoc(userRef, {
                    redeemedDays: arrayUnion(i),
                    credits: increment(rewardAmount),
                    totalEarned: increment(rewardAmount),
                    streak: increment(1),
                    lastStreakUpdate: serverTimestamp()
                });

                showFloating(wrapper, `+${rewardAmount} 🪙`);
                
                const freshSnap = await getDoc(userRef);
                const newData = freshSnap.data();

                // Sync Global Credits if applicable
                const headerCredits = document.getElementById("creditCount");
                if (headerCredits) headerCredits.textContent = newData.credits || 0;

                renderDaily(newData);
                window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: newData }));

            } catch (err) {
                console.error("Redeem error:", err);
                btn.disabled = false;
                btn.textContent = "Retry";
            }
        };

        dailyTracker.appendChild(wrapper);

        // Timer Logic for the Next Day
        if (isNextDay && !isWaitPeriodOver && lastUpdate > 0) {
            const timerEl = document.getElementById(`timer-${i}`);
            const interval = setInterval(() => {
                const remaining = DAY_IN_MS - (Date.now() - lastUpdate);
                if (remaining <= 0) {
                    clearInterval(interval);
                    getDoc(doc(db, "users", uid)).then(s => renderDaily(s.data()));
                } else if (timerEl) {
                    timerEl.textContent = formatTime(remaining);
                }
            }, 1000);
        }
    }

    // Top Status Banner
    if (nextReward) {
        if (streak < 30) {
            if (isWaitPeriodOver || streak === 0) {
                nextReward.textContent = "Unlock your next reward!";
                nextReward.className = "text-green-400 font-bold animate-pulse";
            } else {
                nextReward.textContent = `Next reward in: ${formatTime(DAY_IN_MS - timeSinceLast)}`;
                nextReward.className = "text-blue-300";
            }
        } else {
            nextReward.textContent = "Daily Streak Complete (30/30)!";
            nextReward.className = "text-yellow-400 font-bold";
        }
    }
}
