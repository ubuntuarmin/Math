// Simple login UI: sign-in + sign-up handlers with referral support
import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const loginModal = document.getElementById("loginModal");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const referralInput = document.getElementById("referralCodeInput");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const loginError = document.getElementById("loginError");

export function showLogin(message){
  loginError.textContent = message || "";
  loginModal.classList.remove("hidden");
  loginModal.setAttribute("aria-hidden", "false");
}

export function hideLogin(){
  loginError.textContent = "";
  emailInput.value = "";
  passwordInput.value = "";
  referralInput.value = "";
  loginModal.classList.add("hidden");
  loginModal.setAttribute("aria-hidden", "true");
}

signInBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if(!email || !password){ loginError.textContent = "Email and password required."; return; }
  try{
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged in auth.js will handle hiding the modal
  }catch(err){
    console.error("Sign in error:", err);
    loginError.textContent = err.message || "Sign in failed.";
  }
});

signUpBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const referral = referralInput.value.trim();
  if(!email || !password){ loginError.textContent = "Email and password required."; return; }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    // Generate a short referral code from uid (6 chars)
    const referralCode = uid.slice(0,6).toUpperCase();

    // Create the user document with defaults
    const userDocRef = doc(db, "users", uid);
    await setDoc(userDocRef, {
      firstName: "",
      lastName: "",
      grade: "",
      credits: 0,
      totalEarned: 0,
      totalMinutes: 0,
      streak: 0,
      redeemedDays: [],
      referralCode
    });

    // If a referral code was provided, try to find the referring user and award credits
    if(referral){
      try{
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("referralCode", "==", referral));
        const snap = await getDocs(q);
        if(!snap.empty){
          // Use the first match as the referrer
          const refDoc = snap.docs[0];
          const refUid = refDoc.id;
          // award credits to referrer and new user
          await updateDoc(doc(db,"users",refUid), {
            credits: increment(50),
            totalEarned: increment(50),
            referrals: arrayUnion(uid)
          });
          await updateDoc(userDocRef, {
            credits: increment(20),
            totalEarned: increment(20),
            referredBy: refUid
          });
        }else{
          // no referrer; do nothing
        }
      }catch(err){
        console.error("Referral processing failed:", err);
      }
    }

    // onAuthStateChanged will pick up the new user and hide modal
  }catch(err){
    console.error("Sign up error:", err);
    loginError.textContent = err.message || "Sign up failed.";
  }
});
