import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const loginModal = document.getElementById("loginModal");
const loginPanel = document.getElementById("loginPanel");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const referralInput = document.getElementById("referralCodeInput");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const loginError = document.getElementById("loginError");

// Stop clicks inside the panel from closing the modal
loginPanel?.addEventListener("click", (e) => e.stopPropagation());

export function showLogin(message) {
    if (loginError) loginError.textContent = message || "";
    loginModal?.classList.remove("hidden");
    loginModal?.setAttribute("aria-hidden", "false");
    emailInput?.focus();
}

export function hideLogin() {
    if (loginError) loginError.textContent = "";
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (referralInput) referralInput.value = "";
    loginModal?.classList.add("hidden");
    loginModal?.setAttribute("aria-hidden", "true");
}

// Helper to toggle button loading state
function setButtonsLoading(isLoading) {
    const btns = [signInBtn, signUpBtn];
    btns.forEach(btn => {
        if (!btn) return;
        btn.disabled = isLoading;
        btn.style.opacity = isLoading ? "0.5" : "1";
        btn.style.cursor = isLoading ? "not-allowed" : "pointer";
    });
}

// SIGN IN LOGIC
signInBtn?.addEventListener("click", async () => {
    loginError.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = "Please enter both email and password.";
        return;
    }

    setButtonsLoading(true);
    sessionStorage.removeItem("justSignedUp");

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // auth.js onAuthStateChanged will handle the rest!
    } catch (err) {
        console.error("Sign in error:", err);
        // Friendly error messages
        if (err.code === 'auth/invalid-credential') {
            loginError.textContent = "Invalid email or password.";
        } else {
            loginError.textContent = err.message;
        }
        setButtonsLoading(false);
    }
});

// SIGN UP LOGIC
signUpBtn?.addEventListener("click", async () => {
    loginError.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const referral = referralInput.value.trim();

    if (!email || !password) {
        loginError.textContent = "Email and password are required.";
        return;
    }

    setButtonsLoading(true);

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        const referralCode = uid.slice(0, 6).toUpperCase();
        const userDocRef = doc(db, "users", uid);

        // 1. Create the user document first
        await setDoc(userDocRef, {
            firstName: "",
            lastName: "",
            grade: "",
            credits: 0,
            totalEarned: 0,
            totalMinutes: 0,
            streak: 0,
            redeemedDays: [],
            referralCode: referralCode,
            createdAt: new Date().toISOString()
        });

        await updateProfile(cred.user, { displayName: "New Learner" });

        // 2. Process Referral if exists
        if (referral) {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("referralCode", "==", referral));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                const refDoc = snap.docs[0];
                const refUid = refDoc.id;
                
                // Reward the referrer
                await updateDoc(doc(db, "users", refUid), {
                    credits: increment(50),
                    totalEarned: increment(50),
                    referrals: arrayUnion(uid)
                });
                
                // Reward the new user
                await updateDoc(userDocRef, {
                    credits: increment(20),
                    totalEarned: increment(20),
                    referredBy: refUid
                });
            }
        }

        sessionStorage.setItem("justSignedUp", "1");
        // auth.js will pick up the state change and show onboarding
    } catch (err) {
        console.error("Sign up error:", err);
        loginError.textContent = err.message;
        setButtonsLoading(false);
    }
});
