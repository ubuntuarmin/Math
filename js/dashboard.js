import { db } from "./auth.js";
import { showPage, tier } from "./utils.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const linksEl = document.getElementById("links");
const creditCount = document.getElementById("creditCount");
const tierLabel = document.getElementById("tierLabel");

export function updateUI(userData){
  creditCount.textContent = userData?.credits || 0;
  tierLabel.textContent = tier(userData?.totalEarned || 0);
  renderLinks();
}

async function renderLinks(){
  linksEl.innerHTML = "";
  const snap = await getDocs(collection(db,"linkVotes"));
  const votes = {};
  snap.forEach(d=>votes[d.id]=d.data());

  [1,2,3].forEach(i=>{
    const v = votes["link"+i] || {yes:0,no:0};
    linksEl.innerHTML += `
      <div class="bg-gray-800 p-4 rounded cursor-pointer">
        <div class="font-semibold">General Link ${i}</div>
        <div class="text-xs text-gray-400 mt-2">👍 ${v.yes} · 👎 ${v.no}</div>
      </div>`;
  });
}

window.navigate = showPage;
