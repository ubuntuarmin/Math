import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, increment, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RESET_LIMIT = 30 * 60 * 60 * 1000; // 30-hour Hard Mode

let activeIntervals = [];

function clearTimers() {
    activeIntervals.forEach(clearInterval);
    activeIntervals = [];
}

function showFloating(parent, text = "+10") {
    const el = document.createElement("div");
    el.className = "floating-credit fixed z-50 pointer-events-none text-green-400 font-bold text-xl transition-all duration-700";
    el.style.left = "50%";
    el.style.top = "50%";
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
        el.style.transform = "translateY(-100px)";
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
    clearTimers(); // Fix memory leak
    dailyTracker.innerHTML = "";

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    let streak = userData?.streak || 0;
    let redeemed = new Set(userData?.redeemedDays || []);
    const lastUpdate = userData?.lastStreakUpdate?.toMillis() || 0;
    const now = Date.now();

    // --- HARD MODE LOGIC ---
    if (streak > 0 && lastUpdate > 0 && (now - lastUpdate) > RESET_LIMIT) {
        try {
            const userRef = doc(db, "users", uid);
            await updateDoc(userRef, { streak: 0, redeemedDays: [] });
            streak = 0;
            redeemed = new Set();
        } catch (err) { console.error("Reset failed:", err); }
    }

    const timeSinceLast = now - lastUpdate;
    const isWaitPeriodOver = timeSinceLast >= DAY_IN_MS;

    for (let i = 1; i <= 30; i++) {
        const isAlreadyRedeemed = redeemed.has(i);
        // BUG FIX: A day is only truly "Ready" if it is the EXACT next day in the streak
        const isTargetDay = i === (streak + 1);
        const canClaim = isTargetDay && (streak === 0 || isWaitPeriodOver);
        
        const rewardAmount = (i === 15) ? 100 : 10;

        const wrapper = document.createElement("div");
        wrapper.className = `day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative min-h-[110px] ${isAlreadyRedeemed ? 'opacity-60' : ''}`;

        const box = document.createElement("div");
        box.className = `h-10 w-full rounded flex flex-col items-center justify-center transition-all ${
            isAlreadyRedeemed ? "bg-green-600 shadow-inner" : (canClaim ? "bg-blue-600 animate-pulse" : "bg-gray-700")
        } ${i === 15 ? "border-2 border-yellow-400" : ""}`;
        
        box.innerHTML = `
            <div class="font-black text-xs">${i}</div>
            <div class="text-[9px] font-bold">${rewardAmount}🪙</div>
        `;
        wrapper.appendChild(box);

        const info = document.createElement("div");
        info.className = "text-[10px] text-gray-300 text-center uppercase font-bold h-4";
        
        if (isAlreadyRedeemed) {
            info.textContent = "Claimed";
        } else if (canClaim) {
            info.textContent = "Ready!";
            info.classList.add("text-blue-400");
        } else if (isTargetDay && !isWaitPeriodOver) {
            info.id = `timer-${i}`;
            info.textContent = formatTime(DAY_IN_MS - timeSinceLast);
        } else {
            info.textContent = "Locked";
            info.classList.add("opacity-30");
        }
        wrapper.appendChild(info);

        const btn = document.createElement("button");
        btn.className = "redeem-btn w-full mt-auto text-white font-bold py-1 px-1 text-[10px] rounded transition-all";
        
        if (isAlreadyRedeemed) {
            btn.textContent = "✓";
            btn.classList.add("bg-gray-600");
            btn.disabled = true;
        } else if (canClaim) {
            btn.textContent = "Claim";
            btn.classList.add("bg-green-600", "hover:bg-green-500", "scale-105");
            btn.disabled = false;
        } else {
            btn.textContent = i <= streak ? "Collected" : "Wait";
            btn.classList.add("bg-gray-700", "cursor-not-allowed");
            btn.disabled = true;
        }
        wrapper.appendChild(btn);

        btn.onclick = async () => {
            if (btn.disabled) return;
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
                renderDaily(freshSnap.data());
                
                // Update UI header
                const headerCredits = document.getElementById("creditCount");
                if (headerCredits) headerCredits.textContent = freshSnap.data().credits || 0;
                window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: freshSnap.data() }));

            } catch (err) {
                console.error("Redeem error:", err);
                btn.disabled = false;
            }
        };

        dailyTracker.appendChild(wrapper);

        // Timer Refresh Logic
        if (isTargetDay && !isWaitPeriodOver && lastUpdate > 0) {
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
            activeIntervals.push(interval);
        }
    }

    // Top Banner
    if (nextReward) {
        if (streak >= 30) {
            nextReward.textContent = "30-Day Streak Complete!";
            nextReward.className = "text-yellow-400 font-bold";
        } else if (isWaitPeriodOver || streak === 0) {
            nextReward.textContent = "Next reward is ready for pickup!";
            nextReward.className = "text-green-400 font-bold animate-bounce";
        } else {
            nextReward.textContent = `Next unlock in: ${formatTime(DAY_IN_MS - timeSinceLast)}`;
            nextReward.className = "text-blue-300";
        }
    }
}
