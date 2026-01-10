import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { updateUI } from "./dashboard.js";

const app = initializeApp({
  apiKey:"AIzaSyA32Jc5l0jcWW9iAT3q1gUEUsthN6QkY1k",
  authDomain:"math-katy.firebaseapp.com",
  projectId:"math-katy"
});
export const auth = getAuth(app);
export const db = getFirestore(app);

export let userData = null;

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// Track intervals so we can clear on logout
let activeIntervals = [];

onAuthStateChanged(auth, async user => {
  if(!user){
    userData = null;

    // Hide UI instead of reloading
    header.classList.add("hidden");
    appContainer.classList.add("hidden");

    // Clear any intervals
    activeIntervals.forEach(i=>clearInterval(i));
    activeIntervals = [];

    return;
  }

  const snap = await getDoc(doc(db,"users",user.uid));
  userData = snap.exists()?snap.data():{};
  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  updateUI();
});

// Logout
logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
