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

  accountInfo.innerHTML = `
    <div>Name: ${data?.firstName||""} ${data?.lastName||""}</div>
    <div>Grade: ${data?.grade||""}</div>
    <div>Total Earned: ${data?.totalEarned||0}</div>
  `;
  totalMinutesEl.textContent = data?.totalMinutes || 0;
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
