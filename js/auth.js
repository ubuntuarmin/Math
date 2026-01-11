import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// UI modules
import { updateUI } from "./dashboard.js";
import { renderDaily } from "./tokens.js";
import { updateAccount } from "./account.js";
import { renderLeaderboard } from "./leaderboard.js";
import { showLogin, hideLogin } from "./login.js";
import { showWelcome } from "./welcome.js";
import { showOnboarding } from "./onboarding.js";

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// Force sign-out on page reload (existing behavior)
try{
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav ? nav.type === 'reload' : (performance?.navigation?.type === 1);
  if(isReload){
    signOut(auth).catch(()=>{});
  }
}catch(e){}

onAuthStateChanged(auth, async user => {
  console.log("Auth state changed:", user ? `signed in (${user.uid})` : "signed out");

  if(!user){
    header.classList.add("hidden");
    appContainer.classList.add("hidden");
    showLogin();
    return;
  }

  // hide login modal and show main UI
  hideLogin();
  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  // Fetch the user doc fresh
  let currentUserData = {};
  try{
    const snap = await getDoc(doc(db,"users",user.uid));
    currentUserData = snap.exists()?snap.data():{};
  }catch(err){
    console.error("Failed to fetch user doc:", err);
    currentUserData = {};
  }

  // Update modules
  try{ updateUI(currentUserData); }catch(e){ console.error("updateUI error:", e); }
  try{ renderDaily(currentUserData); }catch(e){ console.error("renderDaily error:", e); }
  try{ updateAccount(currentUserData); }catch(e){ console.error("updateAccount error:", e); }
  try{ renderLeaderboard(currentUserData); }catch(e){ console.error("renderLeaderboard error:", e); }

  // Decide whether to show onboarding (just signed up) or welcome (returning)
  const justSignedUp = sessionStorage.getItem("justSignedUp");
  if(justSignedUp){
    // show onboarding modal (collect name/grade)
    showOnboarding();
    return;
  }

  // returning user: show full-screen welcome once
  try{
    const displayName = user.displayName || (currentUserData.firstName ? currentUserData.firstName : null);
    showWelcome(displayName);
  }catch(e){
    console.error("welcome animation error:", e);
  }
});

logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
