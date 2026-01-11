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
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="text-sm">Your referral code:</div>
          <div class="font-mono bg-gray-900 px-3 py-1 rounded">${code}</div>
          <button id="copyReferralBtn" class="text-xs bg-blue-600 px-2 py-1 rounded">Copy</button>
          <button id="shareReferralBtn" class="text-xs bg-green-600 px-2 py-1 rounded">Share</button>
        </div>
        <div class="text-sm text-gray-400">Your credits: <span class="font-semibold text-white">${credits}</span></div>
        <div class="pt-3">
          <div class="text-sm font-semibold">Referrals (${referrals.length})</div>
          <ul id="refList" class="text-sm text-gray-300 mt-2"></ul>
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
      refList.innerHTML = referrals.map(r=>`<li class="py-1">• ${r}</li>`).join("");
    }else{
      refList.innerHTML = `<li class="text-sm text-gray-500">No referrals yet. Share your code!</li>`;
    }
  }catch(err){
    console.error("Failed to load referral data:", err);
    referralContent.innerHTML = `<div class="text-sm text-red-400">Failed to load referral data.</div>`;
  }
}

window.renderReferral = renderReferral;
