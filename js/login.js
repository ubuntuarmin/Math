import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- 1. URL TRACKING ---
// Captures ?ref=CODE from the URL immediately upon script load
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');

if (incomingRef && incomingRef !== "NOCODE") {
    localStorage.setItem("pendingReferral", incomingRef.toUpperCase());
    
    // Clean the URL bar so the user sees a clean link
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// DOM Elements
const loginModal = document.getElementById("loginModal");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const referralInput = document.getElementById("referralCodeInput");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const loginError = document.getElementById("loginError");

export function showLogin(message) {
    if (loginError) loginError.textContent = message || "";
    loginModal?.classList.remove("hidden");
}

export function hideLogin() {
    if (loginError) loginError.textContent = "";
    emailInput.value = "";
    passwordInput.value = "";
    referralInput.value = "";
    loginModal?.classList.add("hidden");
}

/**
 * Sign In Logic
 */
signInBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    sessionStorage.removeItem("justSignedUp"); 
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        signInBtn.disabled = true;
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        console.error("Sign in error:", err);
        loginError.textContent = "Invalid email or password.";
        signInBtn.disabled = false;
    }
});

/**
 * Sign Up Logic (With Payouts)
 */
signUpBtn.addEventListener("click", async () => {
    if (loginError) loginError.textContent = "";
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    // Priority: 1. Manual Input field, 2. LocalStorage from URL
    const referralCode = referralInput.value.trim().toUpperCase() || localStorage.getItem("pendingReferral");

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        signUpBtn.disabled = true;
        signUpBtn.textContent = "Creating Account...";

        // 1. Create Auth Account
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        const userDocRef = doc(db, "users", uid);

        let baseCredits = 20; 
        let referrerUid = null;

        // 2. Process Referral Payout
        if (referralCode) {
            try {
                const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    const referrerDoc = snap.docs[0];
                    referrerUid = referrerDoc.id;

                    // PREVENT SELF-REFERRAL
                    if (referrerUid !== uid) {
                        // Reward the Referrer (+50)
                        await updateDoc(doc(db, "users", referrerUid), {
                            credits: increment(50),
                            totalEarned: increment(50),
                            referrals: arrayUnion(email) 
                        });

                        // Reward the New User (+20 additional bonus)
                        baseCredits += 20; 
                    }
                }
            } catch (refErr) {
                console.warn("Referral payout failed (Check Firestore rules):", refErr);
            }
        }

        // 3. Create Final User Data
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
            // Consistent Code Generation: First 6 chars of UID
            referralCode: uid.slice(0, 6).toUpperCase(),
            referredBy: referrerUid,
            lastVisitDate: new Date().toDateString(),
            createdAt: new Date()
        };

        await setDoc(userDocRef, userData);

        // 4. Cleanup and Redirect
        sessionStorage.setItem("justSignedUp", "1");
        localStorage.removeItem("pendingReferral"); 
        window.location.reload();

    } catch (err) {
        console.error("Sign up error:", err);
        loginError.textContent = err.message || "Sign up failed.";
        signUpBtn.disabled = false;
        signUpBtn.textContent = "Sign Up";
    }
});
