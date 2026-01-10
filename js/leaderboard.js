import { db } from "./auth.js";
const leaderboard = document.getElementById("leaderboard");

export async function renderLeaderboard(){
  leaderboard.innerHTML = "";
  const snap = await getDocs(collection(db,"users"));
  const arr=[];
  snap.forEach(d=>arr.push(d.data()));
  arr.sort((a,b)=>(b.weekMinutes||0)-(a.weekMinutes||0));
  arr.slice(0,5).forEach((u,i)=>{
    leaderboard.innerHTML += `<div>${i+1}. ${u.firstName||"User"} — ${u.weekMinutes||0} min</div>`;
  });
}
