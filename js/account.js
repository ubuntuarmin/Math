import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");

export async function updateAccount(userData){
  let data = userData || {};
  try{
    if(!data.referralCode && auth.currentUser){
      const snap = await getDoc(doc(db,"users",auth.currentUser.uid));
      if(snap.exists()) data = snap.data();
    }
  }catch(err){
    console.error("Failed to refresh account data:", err);
  }

  if (accountInfo) {
      accountInfo.innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-2xl">👤</div>
            <div>
                <h3 id="accountName" class="text-xl font-bold">${data?.firstName||""} ${data?.lastName||""}</h3>
                <p id="accountEmail" class="text-slate-400">${auth.currentUser?.email || ""}</p>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800">
            <div class="bg-slate-800/50 p-4 rounded-xl">
                <div class="text-xs text-slate-400 uppercase">Current Credits</div>
                <div id="accountCredits" class="text-2xl font-bold text-yellow-500">${data?.credits || 0}</div>
            </div>
            <div class="bg-slate-800/50 p-4 rounded-xl">
                <div class="text-xs text-slate-400 uppercase">Referral Code</div>
                <div id="accountRefCode" class="text-xl font-mono font-bold text-indigo-400">${data?.referralCode || "------"}</div>
            </div>
        </div>
        <div class="pt-4 border-t border-slate-800">
            <div class="text-xs text-slate-400 uppercase mb-1">Grade</div>
            <div class="text-lg font-semibold">${data?.grade || "Not set"}</div>
        </div>
      `;
  }
}

// listen for profile updates so referral/account UI updates immediately
window.addEventListener("userProfileUpdated", async ()=>{
  try{
    const uid = auth.currentUser?.uid;
    if(!uid) return;
    const snap = await getDoc(doc(db,"users",uid));
    const data = snap.exists() ? snap.data() : {};
    updateAccount(data);
  }catch(e){
    console.error("account refresh failed", e);
  }
});
