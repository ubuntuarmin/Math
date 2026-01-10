import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
const leaderboard = document.getElementById("leaderboard");

export async function renderLeaderboard(userData){
  leaderboard.innerHTML = "";
  try{
    const snap = await getDocs(collection(db,"users"));
    const arr=[];
    snap.forEach(d=>arr.push(d.data()));
    arr.sort((a,b)=>(b.weekMinutes||0)-(a.weekMinutes||0));
    arr.slice(0,5).forEach((u,i)=>{
      leaderboard.innerHTML += `<div>${i+1}. ${u.firstName||"User"} — ${u.weekMinutes||0} min</div>`;
    });
  }catch(err){
    console.error("Failed to load leaderboard:", err);
    leaderboard.innerHTML = "<div class='text-sm text-gray-400'>Leaderboard unavailable.</div>";
  }
}
