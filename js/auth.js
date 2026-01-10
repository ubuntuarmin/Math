import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// ... (keep your other imports) ...

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// REFRESH UI HELPER
async function refreshUserUI(uid){
    if(!uid) return;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        const currentUserData = snap.exists() ? snap.data() : {};
        
        // Run all updates
        updateUI(currentUserData);
        renderDaily(currentUserData);
        updateAccount(currentUserData);
        renderLeaderboard(currentUserData);
    } catch(err) {
        console.error("Failed to fetch user doc or update UI:", err);
    }
}

// MAIN AUTH OBSERVER
onAuthStateChanged(auth, async user => {
    console.log("Auth State Changed. User:", user ? user.email : "Logged Out");

    if (!user) {
        // User is signed out: Show login, hide app
        header.classList.add("hidden");
        appContainer.classList.add("hidden");
        showLogin();
        return;
    }

    // User is signed in: Setup the app
    try {
        hideLogin();
        header.classList.remove("hidden");
        appContainer.classList.remove("hidden");

        await refreshUserUI(user.uid);

        // Check for Onboarding
        const justSignedUp = sessionStorage.getItem("justSignedUp");
        if (justSignedUp) {
            showOnboarding();
            return; // Stay here until onboarding completes
        }

        // Handle Welcome Message
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? snap.data() : {};
        const nameToShow = data.firstName || user.displayName || "Learner";
        
        showWelcome(nameToShow);

    } catch (error) {
        console.error("Error in Auth State Transition:", error);
    }
});

// LOGOUT HANDLER
logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        sessionStorage.clear();
        window.location.reload(); // Refresh to clean state
    } catch (err) {
        console.error("Logout failed", err);
    }
});
