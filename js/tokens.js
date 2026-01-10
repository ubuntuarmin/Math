import { userData } from "./auth.js";

const dailyTracker = document.getElementById("dailyTracker");
const nextReward = document.getElementById("nextReward");

export function renderDaily(){
  dailyTracker.innerHTML = "";
  const streak = userData?.streak || 0;
  for(let i=1;i<=30;i++){
    dailyTracker.innerHTML += `<div class="h-8 rounded ${i<=streak?"bg-green-500":"bg-gray-700"}"></div>`;
  }
  nextReward.textContent = "Daily login +10 · Referral handled on sign-up";
}
