import { auth, db } from "./firebase.js";
import { doc, updateDoc, arrayUnion, getDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

/**
 * Render daily streak UI.
 * Each day shows a small box and a redeem button when eligible.
 * userData: Firestore user document data (may be empty)
 */
export async function renderDaily(userData){
  dailyTracker.innerHTML = "";
  const streak = userData?.streak || 0;
  const redeemed = new Set(userData?.redeemedDays || []);
  const uid = auth.currentUser?.uid;

  for(let i=1;i<=30;i++){
    const isEligible = i <= streak;
    const isRedeemed = redeemed.has(i);
    const wrapper = document.createElement("div");
    wrapper.className = "bg-gray-800 p-2 rounded flex flex-col items-center gap-2";

    const box = document.createElement("div");
    box.className = `h-8 w-full rounded ${i<=streak ? "bg-green-500" : "bg-gray-700"}`;
    wrapper.appendChild(box);

    const btn = document.createElement("button");
    btn.className = "redeem-btn";
    btn.textContent = isRedeemed ? "Redeemed" : (isEligible ? "Redeem +10" : "Locked");
    btn.disabled = !isEligible || isRedeemed || !uid;
    btn.addEventListener("click", async () => {
      if(!uid) return;
      btn.disabled = true;
      btn.textContent = "Redeeming...";
      try{
        const userRef = doc(db, "users", uid);
        // Mark day redeemed and credit the user
        await updateDoc(userRef, {
          redeemedDays: arrayUnion(i),
          credits: increment(10),
          totalEarned: increment(10)
        });
        btn.textContent = "Redeemed";
        // update local UI state
        box.className = `h-8 w-full rounded bg-green-500`;
      }catch(err){
        console.error("Redeem failed:", err);
        btn.disabled = false;
        btn.textContent = "Redeem +10";
        alert("Failed to redeem. Try again.");
      }
    });

    wrapper.appendChild(btn);
    dailyTracker.appendChild(wrapper);
  }

  nextReward.textContent = "Daily login +10 · Referral handled on sign-up";
}
