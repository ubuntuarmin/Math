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

    // 2. Weekly Leaderboard Reset
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
            updates.streak = increment(1); 
        } else {
            updates.streak = 1; 
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
        // Not logged in: Clean UI and show login
        header?.classList.add("hidden");
        appContainer?.classList.add("hidden");
        showLogin();
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        let snap = await getDoc(userRef);
        
        // --- RACE CONDITION FIX ---
        // If doc doesn't exist, it's likely a brand new signup still writing to DB.
        // We wait up to 3 seconds before giving up.
        if (!snap.exists()) {
            console.log("New account detected. Waiting for database initialization...");
            await new Promise(res => setTimeout(res, 2500));
            snap = await getDoc(userRef);
        }

        // GUARD: If doc STILL doesn't exist, log out to prevent "broken" session
        if (!snap.exists()) {
            if (!sessionStorage.getItem("justSignedUp")) {
                console.warn("User data missing. Force logging out.");
                await signOut(auth);
                return;
            }
            // If they JUST signed up, let login.js finish its reload/redirect
            return;
        }

        // --- AUTH SUCCESS FLOW ---
        hideLogin();
        header?.classList.remove("hidden");
        appContainer?.classList.remove("hidden");

        let currentUserData = snap.data();
            
        // Reset daily stats if they are an existing user
        if (!sessionStorage.getItem("justSignedUp")) {
            currentUserData = await handleDailyData(user.uid, currentUserData);
        }

        // Refresh all UI components with the final data
        syncAllUI(currentUserData);

        // Handle Overlays (Onboarding vs Welcome)
        if (sessionStorage.getItem("justSignedUp")) {
            showOnboarding();
            // We keep the flag for onboarding.js to handle, then it will remove it.
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

/**
 * Logout Logic
 */
if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        if (auth.currentUser) {
            sessionStorage.clear(); 
            await signOut(auth);
            window.location.reload();
        }
    });
}
