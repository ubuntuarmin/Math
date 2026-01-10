// Simple login UI: sign-in + sign-up handlers
import { auth } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

const loginModal = document.getElementById("loginModal");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
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
  if(!email || !password){ loginError.textContent = "Email and password required."; return; }
  try{
    await createUserWithEmailAndPassword(auth, email, password);
    // optionally you could create a user doc in Firestore in auth.js on sign-in
  }catch(err){
    console.error("Sign up error:", err);
    loginError.textContent = err.message || "Sign up failed.";
  }
});
