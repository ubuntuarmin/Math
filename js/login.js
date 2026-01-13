import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- 1. URL TRACKING ---
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');

if (incomingRef && incomingRef !== "NOCODE") {
    localStorage.setItem("pendingReferral", incomingRef.toUpperCase());
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// Wrap in DOMContentLoaded to ensure the HTML is loaded before looking for buttons
document.addEventListener("DOMContentLoaded", () => {
    
    // DOM Elements
    const loginModal = document.getElementById("loginModal");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const referralInput = document.getElementById("referralCodeInput");
    const signInBtn = document.getElementById("signInBtn");
    const signUpBtn = document.getElementById("signUpBtn");
    const loginError = document.getElementById("loginError");

    console.log("Login System Initialized");

    /**
     * SIGN IN LOGIC
     */
    if (signInBtn) {
        signInBtn.addEventListener("click", async (e) => {
            e.preventDefault(); // CRITICAL: Prevents accidental form submission/refresh
            console.log("Sign In Attempt Started");
            
            if (loginError) loginError.textContent = "";
            
            const email = emailInput?.value.trim();
            const password = passwordInput?.value;

            if (!email || !password) {
                if (loginError) loginError.textContent = "Email and password required.";
                return;
            }

            try {
                signInBtn.disabled = true;
                const originalText = signInBtn.textContent;
                signInBtn.textContent = "Checking...";

                await signInWithEmailAndPassword(auth, email, password);
                console.log("Sign In Successful");
                
                // Redirection is handled by auth.js onAuthStateChanged
            } catch (err) {
                console.error("Sign in error:", err);
                if (loginError) loginError.textContent = "Invalid email or password.";
                signInBtn.disabled = false;
                signInBtn.textContent = "Sign In";
            }
        });
    }

    /**
     * SIGN UP LOGIC
     */
    if (signUpBtn) {
        signUpBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            console.log("Sign Up Attempt Started");
            
            if (loginError) loginError.textContent = "";
            
            const email = emailInput?.value.trim();
            const password = passwordInput?.value;
            const referralCode = referralInput?.value.trim().toUpperCase() || localStorage.getItem("pendingReferral");

            if (!email || !password) {
                if (loginError) loginError.textContent = "Email and password required.";
                return;
            }

            try {
                signUpBtn.disabled = true;
                signUpBtn.textContent = "Creating Account...";

                const cred = await createUserWithEmailAndPassword(auth, email, password);
                const uid = cred.user.uid;
                const userDocRef = doc(db, "users", uid);

                let baseCredits = 20; 
                let referrerUid = null;

                // Process Referral (Wrapped in internal try/catch so it doesn't kill the signup)
                if (referralCode) {
                    try {
                        const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                        const snap = await getDocs(q);

                        if (!snap.empty) {
                            const referrerDoc = snap.docs[0];
                            referrerUid = referrerDoc.id;

                            if (referrerUid !== uid) {
                                await updateDoc(doc(db, "users", referrerUid), {
                                    credits: increment(50),
                                    totalEarned: increment(50),
                                    referrals: arrayUnion(email) 
                                });
                                baseCredits += 20; 
                            }
                        }
                    } catch (refErr) {
                        console.warn("Referral system error (Rules or Index?):", refErr);
                    }
                }

                // Create User Document
                const userData = {
                    uid: uid,
                    email: email,
                    firstName: "",
                    lastName: "",
                    grade: "",
                    credits: baseCredits,
                    totalEarned: baseCredits,
                    totalMinutes: 0,
                    weekMinutes: 0,
                    dailyLinkUsage: 0,
                    streak: 0,
                    unlockedLinks: [],
                    referrals: [],
                    referralCode: uid.slice(0, 6).toUpperCase(),
                    referredBy: referrerUid,
                    lastVisitDate: new Date().toDateString(),
                    createdAt: new Date()
                };

                await setDoc(userDocRef, userData);

                sessionStorage.setItem("justSignedUp", "1");
                localStorage.removeItem("pendingReferral"); 
                window.location.reload();

            } catch (err) {
                console.error("Sign up error:", err);
                if (loginError) {
                    // Cleaner error messages
                    if (err.code === 'auth/email-already-in-use') {
                        loginError.textContent = "Email already in use.";
                    } else if (err.code === 'auth/weak-password') {
                        loginError.textContent = "Password is too weak (min 6 chars).";
                    } else {
                        loginError.textContent = "Sign up failed. Try again.";
                    }
                }
                signUpBtn.disabled = false;
                signUpBtn.textContent = "Sign Up";
            }
        });
    }
});
