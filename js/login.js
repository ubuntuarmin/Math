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
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        console.error("Sign in error:", err);
        loginError.textContent = "Invalid email or password.";
    }
});

/**
 * Sign Up Logic
 */
signUpBtn.addEventListener("click", async () => {
    if (loginError) loginError.textContent = "";
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    // BUG FIX: Look in localStorage where we saved the link data
    const referralCode = referralInput.value.trim() || localStorage.getItem("pendingReferral");

    if (!email || !password) {
        loginError.textContent = "Email and password required.";
        return;
    }

    try {
        // 1. Create the Auth Account
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        const userDocRef = doc(db, "users", uid);

        // 2. Prepare User Data (Added 'email' for the Admin Panel)
        const userData = {
            uid: uid,
            email: email, // ADDED THIS for your Admin Panel
            firstName: "",
            lastName: "",
            grade: "",
            credits: 20,
            totalEarned: 20,
            totalMinutes: 0,
            weekMinutes: 0,
            dailyLinkUsage: 0,
            streak: 0,
            redeemedDays: [],
            unlockedLinks: [],
            referralCode: uid.slice(0, 6).toUpperCase(),
            lastVisitDate: new Date().toDateString(),
            createdAt: new Date()
        };

        // 3. Process Referral logic
        if (referralCode && referralCode !== "NOCODE") {
            try {
                const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    const referrerDoc = snap.docs[0];
                    const referrerUid = referrerDoc.id;

                    // Reward the Referrer
                    await updateDoc(doc(db, "users", referrerUid), {
                        credits: increment(50),
                        totalEarned: increment(50),
                        // BUG FIX: Add the new user's email so it shows in the "Activity Feed"
                        referrals: arrayUnion(email) 
                    });

                    // Reward the New User
                    userData.credits += 30;
                    userData.totalEarned += 30;
                    userData.referredBy = referrerUid;
                }
            } catch (refErr) {
                console.warn("Referral failed:", refErr);
            }
        }

        // 4. Save the User Document
        await setDoc(userDocRef, userData);

        // 5. Cleanup
        sessionStorage.setItem("justSignedUp", "1");
        localStorage.removeItem("pendingReferral"); // Clean up used code

    } catch (err) {
        console.error("Sign up error:", err);
        loginError.textContent = err.message || "Sign up failed.";
    }
});
