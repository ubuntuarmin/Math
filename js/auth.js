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

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// Track intervals so we can clear them on logout
let activeIntervals = [];

// Force sign-out on page reload so session does not persist across refresh
try{
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav ? nav.type === 'reload' : (performance?.navigation?.type === 1);
  if(isReload){
    // best-effort sign out; ignore errors
    signOut(auth).catch(()=>{});
  }
}catch(e){
  // ignore
}

onAuthStateChanged(auth, async user => {
  console.log("Auth state changed:", user ? `signed in (${user.uid})` : "signed out");

  if(!user){
    // Require sign-in: show login modal and hide app
    header.classList.add("hidden");
    appContainer.classList.add("hidden");
    showLogin();
    activeIntervals.forEach(i=>clearInterval(i));
    activeIntervals=[];
    return;
  }

  // hide login modal and show main UI
  hideLogin();
  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  // Fetch user data (guard with try/catch)
  let currentUserData = {};
  try{
    const snap = await getDoc(doc(db,"users",user.uid));
    currentUserData = snap.exists()?snap.data():{};
  }catch(err){
    console.error("Failed to fetch user doc:", err);
    currentUserData = {};
  }

  // Pass userData to all modules AFTER auth ready
  try{ updateUI(currentUserData); }catch(e){ console.error("updateUI error:", e); }
  try{ renderDaily(currentUserData); }catch(e){ console.error("renderDaily error:", e); }
  try{ updateAccount(currentUserData); }catch(e){ console.error("updateAccount error:", e); }
  try{ renderLeaderboard(currentUserData); }catch(e){ console.error("renderLeaderboard error:", e); }

  // Show welcome animation once after successful login
  try{ showWelcome(user.displayName || (currentUserData.firstName ? `${currentUserData.firstName}` : "Learner")); }catch(e){ console.error("welcome animation error:", e); }
});

logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
