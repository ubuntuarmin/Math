import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- 1. TRACKING LOGIC (MOVED HERE) ---
// This runs immediately when the script loads on the landing page.
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');

if (incomingRef && incomingRef !== "NOCODE") {
    console.log("✅ Referral Link Detected:", incomingRef);
    localStorage.setItem("pendingReferral", incomingRef);
    
    // Clean URL so user doesn't see the code
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}
// --------------------------------------

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
 * Sign Up Logic
 */
signUpBtn.addEventListener("click", async () => {
    if (loginError) loginError.textContent = "";
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    // Check localStorage (Captured at top of file) OR Manual Input
    const referralCode = referralInput.value.trim() || localStorage.getItem("pendingReferral");

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        signUpBtn.disabled = true;
        signUpBtn.textContent = "Creating Account...";

        // 1. Create the Auth Account
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        const userDocRef = doc(db, "users", uid);

        // 2. Define Base User Data
        // Base = 20. If referred, we will add +20 more below.
        let baseCredits = 20; 
        let referrerUid = null;

        // 3. Process Referral Rewards (The "Debugged" Section)
        if (referralCode && referralCode !== "NOCODE") {
            console.log("🔍 Processing Referral Code:", referralCode);
            try {
                // Find the owner of the code
                const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    const referrerDoc = snap.docs[0];
                    referrerUid = referrerDoc.id;
                    console.log("✅ Referrer Found:", referrerUid);

                    // A. REWARD THE SHARER (+50 Credits)
                    // Note: This requires Firestore Rules to allow User A to write to User B
                    await updateDoc(doc(db, "users", referrerUid), {
                        credits: increment(50),
                        totalEarned: increment(50),
                        referrals: arrayUnion(email) 
                    });
                    console.log("💰 Referrer Reward Sent (+50)");

                    // B. REWARD THE NEW USER (+20 Credits)
                    baseCredits += 20; 
                    console.log("💰 New User Bonus Applied (+20)");
                } else {
                    console.warn("⚠️ Invalid Referral Code:", referralCode);
                }
            } catch (refErr) {
                // IMPORTANT: If this errors, it is likely PERMISSIONS.
                // The account will still be created, but the reward failed.
                console.error("❌ Referral Payout Failed (Check Firestore Rules):", refErr);
            }
        }

        // 4. Save the New User Document
        const userData = {
            uid: uid,
            email: email,
            firstName: "",
            lastName: "",
            grade: "",
            credits: baseCredits, // Will be 20 (standard) or 40 (referred)
            totalEarned: baseCredits,
            totalMinutes: 0,
            weekMinutes: 0,
            dailyLinkUsage: 0,
            streak: 0,
            redeemedDays: [],
            referrals: [],
            unlockedLinks: [],
            referralCode: uid.slice(0, 6).toUpperCase(),
            referredBy: referrerUid,
            lastVisitDate: new Date().toDateString(),
            createdAt: new Date()
        };

        await setDoc(userDocRef, userData);
        console.log("✅ User Document Created");

        // 5. Cleanup
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
