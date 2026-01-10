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

// Determine if this navigation is a reload; if so we will force the login page
let forceLoginOnLoad = false;
try{
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav ? nav.type === 'reload' : (performance?.navigation?.type === 1);
  if(isReload){
    forceLoginOnLoad = true;
    // best-effort sign out so the session does not persist on reload
    signOut(auth).catch(()=>{});
  }
}catch(e){
  // ignore
}

// Helper to fetch and re-render modules (used on profile updates)
async function refreshUserUI(uid){
  if(!uid) return;
  let currentUserData = {};
  try{
    const snap = await getDoc(doc(db,"users",uid));
    currentUserData = snap.exists()?snap.data():{};
  }catch(err){
    console.error("Failed to fetch user doc:", err);
    currentUserData = {};
  }

  try{ updateUI(currentUserData); }catch(e){ console.error("updateUI error:", e); }
  try{ renderDaily(currentUserData); }catch(e){ console.error("renderDaily error:", e); }
  try{ updateAccount(currentUserData); }catch(e){ console.error("updateAccount error:", e); }
  try{ renderLeaderboard(currentUserData); }catch(e){ console.error("renderLeaderboard error:", e); }
}

onAuthStateChanged(auth, async user => {
  console.log("Auth state changed:", user ? `signed in (${user.uid})` : "signed out", "forceLoginOnLoad=", forceLoginOnLoad);

  // If this is a reload, show the login screen regardless (user was signed-out above).
  if(forceLoginOnLoad || !user){
    // show login (force landing page)
    header.classList.add("hidden");
    appContainer.classList.add("hidden");
    showLogin();
    return;
  }

  // hide login modal and show main UI
  hideLogin();
  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  // fetch user doc and render UI
  await refreshUserUI(user.uid);

  // Decide whether to show onboarding (just signed up) or welcome (returning)
  const justSignedUp = sessionStorage.getItem("justSignedUp");
  if(justSignedUp){
    // show onboarding modal (collect name/grade)
    showOnboarding();
    return;
  }

  // Show welcome for returning users only. Use a safe display name fallback.
  let displayName = user.displayName;
  if(!displayName || displayName === "null"){
    // fallback to Firestore firstName if present
    try{
      const snap = await getDoc(doc(db,"users",user.uid));
      const data = snap.exists()?snap.data():{};
      displayName = data?.firstName || null;
    }catch(e){
      displayName = null;
    }
  }
  // Only show welcome when we have no forceLoginOnLoad and displayName may be null -> fallback to "Learner"
  showWelcome(displayName || "Learner");
});

// Refresh UI when onboarding or profile updates happen
window.addEventListener("userProfileUpdated", async () => {
  const uid = auth.currentUser?.uid;
  if(uid) await refreshUserUI(uid);
});

logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
