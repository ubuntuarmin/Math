const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");
const referralArea = document.getElementById("referralArea");

export function updateAccount(userData){
  accountInfo.innerHTML = `
    <div>Name: ${userData?.firstName||""} ${userData?.lastName||""}</div>
    <div>Grade: ${userData?.grade||""}</div>
    <div>Total Earned: ${userData?.totalEarned||0}</div>
  `;
  totalMinutesEl.textContent = userData?.totalMinutes || 0;

  // referral display / copy button
  const code = userData?.referralCode || "";
  if(code){
    referralArea.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-sm">Referral code:</div>
        <div class="text-sm font-mono bg-gray-900 px-2 py-1 rounded">${code}</div>
        <button id="copyReferral" class="text-xs bg-blue-600 px-2 py-1 rounded">Copy</button>
      </div>
      <div class="text-xs text-gray-400 mt-2">Share this code with friends — you'll get rewarded when they sign up.</div>
    `;
    const btn = document.getElementById("copyReferral");
    btn.addEventListener("click", async () => {
      try{
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied!";
        setTimeout(()=>btn.textContent = "Copy", 1500);
      }catch(e){
        console.error("Copy failed", e);
        alert("Could not copy automatically. Code: " + code);
      }
    });
  }else{
    referralArea.innerHTML = `<div class="text-sm text-gray-400">No referral code available.</div>`;
  }
}
