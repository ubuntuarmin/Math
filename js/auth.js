import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// UI modules
import { updateUI } from "./dashboard.js";
import { renderDaily } from "./tokens.js";
import { updateAccount } from "./account.js";
import { renderLeaderboard } from "./leaderboard.js";
import { showLogin, hideLogin } from "./login.js";
import { showWelcome } from "./welcome.js";
import { showOnboarding } from "./onboarding.js";

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

/**
 * Helper to fetch user data and refresh all UI components.
 * Wrapped in try/catch to ensure one failure doesn't stop the whole app.
 */
async function refreshUserUI(uid) {
    if (!uid) return;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        const userData = snap.exists() ? snap.data() : {};

        // Run UI updates in parallel-safe blocks
        const runUpdate = (fn, name) => {
            try { fn(userData); } catch (e) { console.error(`${name} failed:`, e); }
        };

        runUpdate(updateUI, "Dashboard");
        runUpdate(renderDaily, "Daily Tracker");
        runUpdate(updateAccount, "Account");
        runUpdate(renderLeaderboard, "Leaderboard");

        return userData;
    } catch (err) {
        console.error("Critical error fetching user data:", err);
    }
}

/**
 * Main Auth Observer
 */
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state change detected:", user ? `User: ${user.email}` : "Logged Out");

    if (!user) {
        // 1. Hide the app and show the login screen
        if (header) header.classList.add("hidden");
        if (appContainer) appContainer.classList.add("hidden");
        
        // Hide all page sections to prevent lingering state
        const sections = ["dashboard", "tokens", "account", "leaderboard", "referral"];
        sections.forEach(s => {
            const el = document.getElementById(s + "Page");
            if (el) el.classList.add("hidden");
        });

        showLogin();
        return;
    }

    // 2. User is authenticated. FORCIBLY clear the login UI.
    try {
        // hideLogin clears inputs and hides the modal
        hideLogin(); 
        
        // Final fallback: Ensure the modal is gone if hideLogin fails
        const modal = document.getElementById("loginModal");
        if (modal) {
            modal.classList.add("hidden");
            modal.style.display = "none"; 
        }

        // 3. Reveal the main application
        if (header) header.classList.remove("hidden");
        if (appContainer) appContainer.classList.remove("hidden");

        // 4. Load the user's data
        const userData = await refreshUserUI(user.uid);

        // 5. Determine if we show Onboarding or Welcome
        const justSignedUp = sessionStorage.getItem("justSignedUp");
        
        if (justSignedUp === "1") {
            showOnboarding();
        } else {
            // Show welcome for returning users. Fallback to "Learner" if name is missing.
            const name = userData?.firstName || user.displayName || "Learner";
            showWelcome(name);
        }

    } catch (err) {
        console.error("Error during UI transition:", err);
    }
});

/**
 * Handle Profile Updates (e.g., from Onboarding)
 */
window.addEventListener("userProfileUpdated", async () => {
    const uid = auth.currentUser?.uid;
    if (uid) await refreshUserUI(uid);
});

/**
 * Logout Handler
 */
logoutBtn?.addEventListener("click", async () => {
    try {
        // Clear session flags so we don't accidentally trigger onboarding on next login
        sessionStorage.removeItem("justSignedUp");
        await signOut(auth);
        // Page will refresh/update via onAuthStateChanged
    } catch (err) {
        console.error("Logout failed:", err);
    }
});
