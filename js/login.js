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

// --- 2. EXPORTS ---
export function showLogin(message) {
    const loginModal = document.getElementById("loginModal");
    const loginError = document.getElementById("loginError");
    if (loginError) loginError.textContent = message || "";
    loginModal?.classList.remove("hidden");
}

export function hideLogin() {
    const loginModal = document.getElementById("loginModal");
    if (loginModal) loginModal.classList.add("hidden");
}

// --- 3. INITIALIZATION ---
const initLogin = () => {
    const signInBtn = document.getElementById("signInBtn");
    const signUpBtn = document.getElementById("signUpBtn");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const referralInput = document.getElementById("referralCodeInput");
    const loginError = document.getElementById("loginError");

    if (!signInBtn || !signUpBtn) return;

    console.log("Login system listeners attached.");

    // SIGN IN LOGIC
    signInBtn.onclick = async (e) => {
        e.preventDefault();
        if (loginError) loginError.textContent = "";
        
        const email = emailInput?.value.trim();
        const password = passwordInput?.value;

        if (!email || !password) {
            if (loginError) loginError.textContent = "Email and password required.";
            return;
        }

        try {
            signInBtn.disabled = true;
            signInBtn.textContent = "Checking...";
            await signInWithEmailAndPassword(auth, email, password);
            // Redirection handled by auth.js
        } catch (err) {
            console.error(err);
            if (loginError) loginError.textContent = "Invalid email or password.";
            signInBtn.disabled = false;
            signInBtn.textContent = "Sign In";
        }
    };

    // SIGN UP LOGIC
    signUpBtn.onclick = async (e) => {
        e.preventDefault();
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
            signUpBtn.textContent = "Creating...";

            // 1. Set the flag for auth.js to wait
            sessionStorage.setItem("justSignedUp", "true");

            // 2. Create Auth Account
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            const uid = cred.user.uid;

            let baseCredits = 20; 
            let referrerUid = null;

            // 3. Process Referral Payout (Before creating new user doc)
            if (referralCode) {
                try {
                    const q = query(collection(db, "users"), where("referralCode", "==", referralCode));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        const referrerDoc = snap.docs[0];
                        referrerUid = referrerDoc.id;

                        if (referrerUid !== uid) {
                            // Reward the Referrer
                            await updateDoc(doc(db, "users", referrerUid), {
                                credits: increment(50),
                                totalEarned: increment(50),
                                referrals: arrayUnion(email) 
                            });
                            // Set bonus for new user
                            baseCredits = 40; 
                        }
                    }
                } catch (refErr) {
                    console.warn("Referral system bypassed (Check Firestore index/rules):", refErr);
                }
            }

            // 4. Create New User Document
            await setDoc(doc(db, "users", uid), {
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
            });

            // 5. Cleanup and Refresh
            localStorage.removeItem("pendingReferral"); 
            window.location.reload();

        } catch (err) {
            console.error("Sign up error:", err);
            sessionStorage.removeItem("justSignedUp"); // Clear flag on failure
            if (loginError) {
                loginError.textContent = err.code === 'auth/email-already-in-use' 
                    ? "Email already exists." 
                    : "Sign up failed. Try again.";
            }
            signUpBtn.disabled = false;
            signUpBtn.textContent = "Sign Up";
        }
    };
};

// Start initialization
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLogin);
} else {
    initLogin();
}
