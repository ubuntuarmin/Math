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

// NEW: Tier logic
import { calculateTier } from "./tier.js";

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");
const tierLabel = document.getElementById("tierLabel");

/**
 * NEW: Global Header Refresh
 * Updates credits and Tier label across the app
 */
export function refreshHeaderUI(userData) {
    if (!userData) return;

    // Update Credits display
    const creditCount = document.getElementById("creditCount");
    if (creditCount) creditCount.textContent = userData.credits || 0;

    // Update Tier display
    if (tierLabel) {
        const tier = calculateTier(userData.totalEarned || 0);
        tierLabel.textContent = tier.name;
        tierLabel.style.color = tier.color; // Changes to Gold, Silver, etc.
    }
}

/**
 * Handles daily reset of time limits and streaks
 */
async function handleDailyData(uid, userData) {
    const userRef = doc(db, "users", uid);
    const now = new Date();
    const todayStr = now.toDateString();
    
    const lastVisitDate = userData.lastVisitDate || "";
    const updates = {};

    // 1. Reset Daily Link Usage (Timer)
    if (lastVisitDate !== todayStr) {
        updates.dailyLinkUsage = 0;
        updates.lastVisitDate = todayStr;
    }

    // 2. Weekly Leaderboard Reset (Sundays)
    if (now.getDay() === 0 && lastVisitDate !== todayStr) {
        updates.weekMinutes = 0;
    }

    // 3. Streak Logic
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    const lastStreakUpdate = userData.lastStreakUpdate?.toMillis() || 0;
    const timeDiff = Date.now() - lastStreakUpdate;

    if (!userData.streak || userData.streak === 0) {
        updates.streak = 1;
        updates.lastStreakUpdate = serverTimestamp();
    } else if (timeDiff >= DAY_IN_MS) {
        updates.streak = increment(1);
        updates.lastStreakUpdate = serverTimestamp();
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

    hideLogin();
    header?.classList.remove("hidden");
    appContainer?.classList.remove("hidden");

    let currentUserData = {};
    try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        
        if (snap.exists()) {
            currentUserData = snap.data();
            
            // Only handle resets for returning users, not brand new signups
            if (!sessionStorage.getItem("justSignedUp")) {
                currentUserData = await handleDailyData(user.uid, currentUserData);
            }
        }
    } catch (err) {
        console.error("Auth Data Error:", err);
    }

    // NEW: Centralized UI refresh
    syncAllUI(currentUserData);

    // Handle initial routing
    if (sessionStorage.getItem("justSignedUp")) {
        showOnboarding();
    } else {
        const displayName = user.displayName || currentUserData.firstName || "Student";
        showWelcome(displayName);
    }
});

/**
 * Syncs all UI parts with the provided user data
 */
function syncAllUI(data) {
    try { refreshHeaderUI(data); } catch(e){}
    try { updateUI(data); } catch (e) {}
    try { renderDaily(data); } catch (e) {}
    try { updateAccount(data); } catch (e) {}
    try { renderLeaderboard(data); } catch (e) {}
}

/**
 * NEW: Event Listener for manual profile updates
 * Listens for "userProfileUpdated" event triggered by Onboarding or Account pages
 */
window.addEventListener("userProfileUpdated", (event) => {
    if (event.detail) {
        syncAllUI(event.detail);
    }
});

logoutBtn?.addEventListener("click", async () => {
    if (auth.currentUser) {
        await signOut(auth);
        location.reload();
    }
});
