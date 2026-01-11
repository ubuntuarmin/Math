// Referral page renderer: shows user's referral code, link, and referrals list
import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const referralContent = document.getElementById("referralContent");
const referralPage = document.getElementById("referralPage");

// Render referral data for current user
export async function renderReferral(){
  if(!auth.currentUser) {
    referralContent.innerHTML = `<div class="text-sm text-gray-400">Sign in to view referrals.</div>`;
    return;
  }
  try{
    const snap = await getDoc(doc(db,"users",auth.currentUser.uid));
    if(!snap.exists()){
      referralContent.innerHTML = `<div class="text-sm text-gray-400">No referral data found.</div>`;
      return;
    }
    const data = snap.data();
    const code = data.referralCode || "(not set)";
    const referrals = data.referrals || [];
    const credits = data.credits || 0;
    const referredBy = data.referredBy || null;

    referralContent.innerHTML = `
      <div class="space-y-6">
        <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
          <div class="text-sm text-slate-400 mb-2 uppercase tracking-wider font-semibold">Your Referral Link</div>
          <div class="flex items-center gap-2 bg-slate-900 p-3 rounded-xl border border-slate-700">
            <input readonly value="${location.origin}${location.pathname}?ref=${code}" class="bg-transparent border-none text-sm w-full outline-none text-slate-300" />
            <button id="copyReferralBtn" class="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-bold transition">Copy</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                <div class="text-sm text-slate-400 mb-1 uppercase tracking-wider font-semibold">Referral Code</div>
                <div class="text-2xl font-mono font-bold text-indigo-400">${code}</div>
            </div>
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col justify-center">
                <button id="shareReferralBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold transition">Share with Friends</button>
            </div>
        </div>

        <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
          <div class="text-sm text-slate-400 mb-4 uppercase tracking-wider font-semibold">Your Referrals (${referrals.length})</div>
          <div id="refList" class="space-y-2"></div>
        </div>
      </div>
    `;
    const copyBtn = document.getElementById("copyReferralBtn");
    const shareBtn = document.getElementById("shareReferralBtn");
    const refList = document.getElementById("refList");

    copyBtn?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = "Copied!";
        setTimeout(()=>copyBtn.textContent = "Copy", 1400);
      }catch(e){
        alert("Copy failed. Code: " + code);
      }
    });

    shareBtn?.addEventListener("click", ()=>{
      const url = `${location.origin}${location.pathname}?ref=${code}`;
      if(navigator.share){
        navigator.share({ title: "Join Katy Math", text: "Use my referral code!", url }).catch(()=>{});
      }else{
        navigator.clipboard.writeText(url).then(()=>{ shareBtn.textContent = "Link copied"; setTimeout(()=>shareBtn.textContent = "Share",1400); }).catch(()=>alert(url));
      }
    });

    if(referrals.length){
      refList.innerHTML = referrals.map(r=>`<div class="flex items-center gap-3 p-3 bg-slate-900/50 rounded-xl border border-slate-700/50">
        <div class="w-8 h-8 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center text-xs font-bold">👤</div>
        <div class="text-sm text-slate-300 font-medium">${r}</div>
      </div>`).join("");
    }else{
      refList.innerHTML = `<div class="text-center py-4 bg-slate-900/30 rounded-xl border border-dashed border-slate-700">
        <div class="text-slate-500 text-sm">No referrals yet. Share your link!</div>
      </div>`;
    }
  }catch(err){
    console.error("Failed to load referral data:", err);
    referralContent.innerHTML = `<div class="text-sm text-red-400">Failed to load referral data.</div>`;
  }
}

window.renderReferral = renderReferral;
