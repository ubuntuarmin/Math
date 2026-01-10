import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// UI modules
import { updateUI } from "./dashboard.js";
import { renderDaily } from "./tokens.js";
import { updateAccount } from "./account.js";
import { renderLeaderboard } from "./leaderboard.js";

const app = initializeApp({
  apiKey:"AIzaSyA32Jc5l0jcWW9iAT3q1gUEUsthN6QkY1k",
  authDomain:"math-katy.firebaseapp.com",
  projectId:"math-katy"
});

export const auth = getAuth(app);
export const db = getFirestore(app);

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// Track intervals so we can clear them on logout
let activeIntervals = [];

onAuthStateChanged(auth, async user => {
  console.log("Auth state changed:", user ? `signed in (${user.uid})` : "signed out");

  if(!user){
    // Keep main UI visible for guests / local testing
    // Hide header (logout / account controls) but do NOT hide appContainer
    header.classList.add("hidden");
    // appContainer.classList.add("hidden");  <-- removed so guest UI stays visible

    // Clear any running intervals
    activeIntervals.forEach(i=>clearInterval(i));
    activeIntervals=[];
    return;
  }

  // Fetch user data
  const snap = await getDoc(doc(db,"users",user.uid));
  const currentUserData = snap.exists()?snap.data():{};

  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  // Pass userData to all modules AFTER auth ready
  updateUI(currentUserData);
  renderDaily(currentUserData);
  updateAccount(currentUserData);
  renderLeaderboard(currentUserData);
});

logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
