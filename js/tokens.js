import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, getDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

// helper: small floating +10 animation
function showFloating(parent, text="+10"){
  const el = document.createElement("div");
  el.className = "floating-credit";
  el.style.left = "50%";
  el.style.top = "10%";
  el.style.transform = "translate(-50%, 0)";
  el.textContent = text;
  parent.appendChild(el);
  requestAnimationFrame(()=> {
    el.style.transform = "translate(-50%, -80px)";
    el.style.opacity = "0";
  });
  setTimeout(()=>el.remove(), 800);
}

/**
 * Render daily streak UI.
 * Each day shows a small box and a redeem button when eligible.
 */
export async function renderDaily(userData) {
    if (!dailyTracker) return;
    dailyTracker.innerHTML = "";
  const streak = userData?.streak || 0;
  const redeemed = new Set(userData?.redeemedDays || []);
  const uid = auth.currentUser?.uid;

  // compute "today's" index for UI hint — use streak as last earned day
  const todaysIndex = streak; // e.g., if streak=3 then day 3 is latest

  for(let i=1;i<=30;i++){
    const isEligible = i <= streak;
    const isRedeemed = redeemed.has(i);
    const wrapper = document.createElement("div");
    wrapper.className = "day-card bg-gray-800 p-2 rounded flex flex-col items-center gap-2 relative";
    wrapper.style.minHeight = "72px";

    const box = document.createElement("div");
    box.className = `h-12 w-full rounded flex items-center justify-center ${i<=streak ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gray-700"}`;
    box.innerHTML = `<div class="font-semibold">${i}</div>`;
    wrapper.appendChild(box);

    const info = document.createElement("div");
    info.className = "text-xs text-gray-300";
    info.textContent = isRedeemed ? "Redeemed" : (isEligible ? (i===todaysIndex ? "Today" : "Available") : "Locked");
    wrapper.appendChild(info);

    const btn = document.createElement("button");
    btn.className = "redeem-btn";
    btn.textContent = isRedeemed ? "Redeemed" : (isEligible ? "Redeem +10" : "Locked");
    btn.disabled = !isEligible || isRedeemed || !uid;
    wrapper.appendChild(btn);

    // click behavior: interactive confirmation + animation
    btn.addEventListener("click", async (ev) => {
      if(!uid || btn.disabled) return;
      // small confirm overlay (window.confirm is simplest)
      const confirmMsg = `Redeem day ${i} for +10 coins?`;
      if(!confirm(confirmMsg)) return;
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = "Redeeming...";
      try{
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
          redeemedDays: arrayUnion(i),
          credits: increment(10),
          totalEarned: increment(10)
        });
        // update UI instantly
        isRedeemed = true;
        info.textContent = "Redeemed";
        box.className = `h-12 w-full rounded flex items-center justify-center bg-gradient-to-r from-green-400 to-green-500`;
        btn.textContent = "Redeemed";
        btn.disabled = true;
        // floating animation
        showFloating(wrapper, "+10");
        // refresh account and header via dispatch so other modules can pick up change
        window.dispatchEvent(new CustomEvent("userProfileUpdated"));
      }catch(err){
        console.error("Redeem failed:", err);
        btn.disabled = false;
        btn.textContent = prevText;
        alert("Failed to redeem. Try again.");
      }
    });

    dailyTracker.appendChild(wrapper);
  }

  nextReward.textContent = "Daily login +10 · Refer friends for bonus";
}
