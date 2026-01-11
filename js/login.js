import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const loginModal = document.getElementById("loginModal");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const referralInput = document.getElementById("referralCodeInput");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const loginError = document.getElementById("loginError");

/**
 * UI Controls
 */
export function showLogin(message) {
    if (loginError) loginError.textContent = message || "";
    loginModal.classList.remove("hidden");
    loginModal.setAttribute("aria-hidden", "false");
}

export function hideLogin() {
    if (loginError) loginError.textContent = "";
    emailInput.value = "";
    passwordInput.value = "";
    referralInput.value = "";
    loginModal.classList.add("hidden");
    loginModal.setAttribute("aria-hidden", "true");
}

/**
 * Sign In Logic
 */
signInBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    // Clear flag on explicit sign-in to avoid accidental onboarding
    sessionStorage.removeItem("justSignedUp"); 
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        console.error("Sign in error:", err);
        loginError.textContent = "Invalid email or password.";
    }
});

/**
 * Sign Up Logic (With Referral & Timer Support)
 */
signUpBtn.addEventListener("click", async () => {
    if (loginError) loginError.textContent = "";
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    // Check for a typed code OR an automatic code caught from a link
    const referralCode = referralInput.value.trim() || sessionStorage.getItem("pendingReferral");

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        // 1. Create the Auth Account
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        const userDocRef = doc(db, "users", uid);

        // 2. Prepare User Data Object with ALL required fields
        const userData = {
            uid: uid,
            firstName: "",
            lastName: "",
            grade: "",
            credits: 20,         // Basic starter credits
            totalEarned: 20,
            totalMinutes: 0,
            weekMinutes: 0,      // Required for Leaderboard
            dailyLinkUsage: 0,   // Required for 45-min link timer
            streak: 0,
            redeemedDays: [],
            unlockedLinks: [],   // Required for Dashboard state
            referralCode: uid.slice(0, 6).toUpperCase(),
            lastVisitDate: new Date().toDateString(),
            createdAt: new Date()
        };

        // 3. Process Referral logic if a code exists
        if (referralCode) {
            try {
                const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    const referrerDoc = snap.docs[0];
                    const referrerUid = referrerDoc.id;

                    // Reward the Referrer (Give 50 credits)
                    await updateDoc(doc(db, "users", referrerUid), {
                        credits: increment(50),
                        totalEarned: increment(50),
                        referrals: arrayUnion(uid)
                    });

                    // Reward the New User (Add 30 more for 50 total)
                    userData.credits += 30;
                    userData.totalEarned += 30;
                    userData.referredBy = referrerUid;
                    console.log("Referral rewards successfully processed.");
                }
            } catch (refErr) {
                console.warn("Referral processing failed, but account creation continued:", refErr);
            }
        }

        // 4. Save the User Document
        await setDoc(userDocRef, userData);

        // 5. Success: Trigger Onboarding via session flag
        sessionStorage.setItem("justSignedUp", "1");
        sessionStorage.removeItem("pendingReferral"); // Clean up the used link code

    } catch (err) {
        console.error("Sign up error:", err);
        loginError.textContent = err.message || "Sign up failed.";
    }
});
