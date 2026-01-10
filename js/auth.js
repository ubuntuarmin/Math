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
const logoutBtn = document.getElementById("logoutBtn");

onAuthStateChanged(auth, async user => {
  if(!user){
    userData = null;
    header.classList.add("hidden");
    location.reload(); // clean state on logout
    return;
  }

  const snap = await getDoc(doc(db,"users",user.uid));
  userData = snap.exists()?snap.data():{};
  header.classList.remove("hidden");
  updateUI();
});

logoutBtn.addEventListener("click", async () => {
  if(auth.currentUser) await signOut(auth);
});
