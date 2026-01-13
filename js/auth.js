import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// UI modules
import { updateUI } from "./dashboard.js";
import { renderDaily } from "./tokens.js";
import { updateAccount } from "./account.js";
import { renderLeaderboard } from "./leaderboard.js";
import { showLogin, hideLogin } from "./login.js";
import { showWelcome } from "./welcome.js";
import { showOnboarding } from "./onboarding.js";
import { calculateTier } from "./tier.js";

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");
const tierLabel = document.getElementById("tierLabel");

/**
 * Global Header Refresh
 */
export function refreshHeaderUI(userData) {
    if (!userData) return;
    const creditCount = document.getElementById("creditCount");
    if (creditCount) creditCount.textContent = userData.credits || 0;

    if (tierLabel) {
        const tier = calculateTier(userData.totalEarned || 0);
        tierLabel.textContent = tier.name;
        tierLabel.style.color = tier.color;
    }
}

/**
 * Robust Daily/Weekly Reset Logic
 */
async function handleDailyData(uid, userData) {
    const userRef = doc(db, "users", uid);
    const now = new Date();
    const todayStr = now.toDateString();
    const lastVisitDate = userData.lastVisitDate || "";
    
    const updates = {};

    // 1. Reset Daily Timer
    if (lastVisitDate !== todayStr) {
        updates.dailyLinkUsage = 0;
        updates.lastVisitDate = todayStr;
    }

    // 2. Weekly Leaderboard Reset (Calculates if we are in a new week)
    // Sunday is 0. If last visit was before the most recent Sunday, reset.
    const lastVisitTimestamp = userData.lastVisitTimestamp?.toMillis() || 0;
    const diffInDays = (Date.now() - lastVisitTimestamp) / (1000 * 60 * 60 * 24);
    
    if (diffInDays > 7 || (now.getDay() === 0 && lastVisitDate !== todayStr)) {
        updates.weekMinutes = 0;
    }
    updates.lastVisitTimestamp = serverTimestamp();

    // 3. Calendar-based Streak Logic
    if (!userData.streak) {
        updates.streak = 1;
    } else if (lastVisitDate !== todayStr) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastVisitDate === yesterday.toDateString()) {
            updates.streak = increment(1); // Continued streak
        } else {
            updates.streak = 1; // Broke streak, reset to 1
        }
    }

    if (Object.keys(updates).length > 0) {
        await updateDoc(userRef, updates);
        const snap = await getDoc(userRef);
        return snap.data();
    }
    return userData;
}

/**
 * MAIN AUTH LISTENER
 */
onAuthStateChanged(auth, async user => {
    if (!user) {
        header?.classList.add("hidden");
        appContainer?.classList.add("hidden");
        showLogin();
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        
        // GUARD: If Auth user exists but Firestore doc is gone (Deleted Account)
        if (!snap.exists()) {
            console.warn("User data missing. Force logging out.");
            await signOut(auth);
            return;
        }

        hideLogin();
        header?.classList.remove("hidden");
        appContainer?.classList.remove("hidden");

        let currentUserData = snap.data();
            
        // Handle logic resets
        if (!sessionStorage.getItem("justSignedUp")) {
            currentUserData = await handleDailyData(user.uid, currentUserData);
        }

        // Centralized UI refresh
        syncAllUI(currentUserData);

        // One-time Welcome/Onboarding per session
        if (sessionStorage.getItem("justSignedUp")) {
            showOnboarding();
        } else if (!sessionStorage.getItem("welcomeShown")) {
            const displayName = currentUserData.firstName || "Student";
            showWelcome(displayName);
            sessionStorage.setItem("welcomeShown", "true");
        }

    } catch (err) {
        console.error("Critical Auth/Data Error:", err);
    }
});

/**
 * Syncs all UI components
 */
function syncAllUI(data) {
    if (!data) return;
    refreshHeaderUI(data);
    updateUI(data);
    renderDaily(data);
    updateAccount(data);
    renderLeaderboard(data);
}

/**
 * Global update listener
 */
window.addEventListener("userProfileUpdated", (event) => {
    if (event.detail) syncAllUI(event.detail);
});

logoutBtn?.addEventListener("click", async () => {
    if (auth.currentUser) {
        sessionStorage.clear(); // Clear welcome flags
        await signOut(auth);
        window.location.href = "index.html";
    }
});
