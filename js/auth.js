import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc, updateDoc, increment, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// UI modules
import { updateUI } from "./dashboard.js";
import { renderDaily } from "./tokens.js";
import { updateAccount } from "./account.js";
import { renderLeaderboard } from "./leaderboard.js";
import { showLogin, hideLogin } from "./login.js";
import { showWelcome } from "./welcome.js";
import { showOnboarding } from "./onboarding.js";
import { calculateTier } from "./tier.js";
import { initInbox } from "./inbox.js";

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");
const tierLabel = document.getElementById("tierLabel");

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

async function handleDailyData(uid, userData) {
    const userRef = doc(db, "users", uid);
    const now = new Date();
    const todayStr = now.toDateString();
    const lastVisitDate = userData.lastVisitDate || "";
    
    const updates = {};

    // --- per-day resets ---
    if (lastVisitDate !== todayStr) {
        updates.dailyLinkUsage = 0;
        updates.lastVisitDate = todayStr;
        // clear any per-day extra limit override when a new day starts
        updates.extraLimitMinutesToday = 0;
    }

    // --- weekMinutes reset logic ---
    const lastVisitTimestampVal = userData.lastVisitTimestamp;
    const lastVisitMillis =
        lastVisitTimestampVal && typeof lastVisitTimestampVal.toMillis === "function"
            ? lastVisitTimestampVal.toMillis()
            : 0;

    let diffInDays = 0;
    if (lastVisitMillis > 0) {
        diffInDays = (Date.now() - lastVisitMillis) / (1000 * 60 * 60 * 24);
        if (!Number.isFinite(diffInDays) || diffInDays < 0) {
            diffInDays = 0;
        }
    }

    if (diffInDays > 7 || (now.getDay() === 0 && lastVisitDate !== todayStr)) {
        updates.weekMinutes = 0;
    }

    updates.lastVisitTimestamp = serverTimestamp();

    // --- streak logic (visit-based) ---
    const hasValidStreak =
        typeof userData.streak === "number" && Number.isFinite(userData.streak);
    const currentStreak = hasValidStreak ? userData.streak : 0;

    if (!hasValidStreak) {
        // If streak missing or invalid, initialize to 1 on this visit
        updates.streak = 1;
    } else if (lastVisitDate !== todayStr) {
        // New calendar day; decide if streak continues or resets
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastVisitDate === yesterday.toDateString()) {
            // Consecutive day
            updates.streak = increment(1);
        } else {
            // Missed 1+ days -> reset visit streak to 1
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

// --- MAIN AUTH LISTENER ---
onAuthStateChanged(auth, async user => {
    if (!user) {
        header?.classList.add("hidden");
        appContainer?.classList.add("hidden");
        showLogin();
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        let snap = await getDoc(userRef);
        
        // Race condition waiter
        if (!snap.exists()) {
            console.log("Waiting for database initialization...");
            await new Promise(res => setTimeout(res, 2500));
            snap = await getDoc(userRef);
        }

        // --- SELF-HEALING LOGIC (unchanged) ---
        if (!snap.exists()) {
            if (sessionStorage.getItem("justSignedUp")) {
                return;
            }

            console.warn("Profile missing. Attempting auto-repair...");
            
            const defaultData = {
                uid: user.uid,
                email: user.email,
                firstName: "Student", 
                lastName: "",
                grade: "",
                credits: 20,          
                totalEarned: 20,
                totalMinutes: 0,
                weekMinutes: 0,
                dailyLinkUsage: 0,
                streak: 1,
                unlockedLinks: [],
                referrals: [],
                referralCode: user.uid.slice(0, 6).toUpperCase(),
                lastVisitDate: new Date().toDateString(),
                createdAt: serverTimestamp()
            };

            try {
                await setDoc(userRef, defaultData);
                snap = await getDoc(userRef); 
                console.log("Account repaired successfully.");
            } catch (createErr) {
                console.error("Repair failed:", createErr);
                await signOut(auth);
                return;
            }
        }

        // --- INITIALIZE INBOX ---
        initInbox(user.uid);

        hideLogin();
        header?.classList.remove("hidden");
        appContainer?.classList.remove("hidden");

        let currentUserData = snap.data();
            
        if (!sessionStorage.getItem("justSignedUp")) {
            currentUserData = await handleDailyData(user.uid, currentUserData);
        }

        syncAllUI(currentUserData);

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

function syncAllUI(data) {
    if (!data) return;
    refreshHeaderUI(data);
    updateUI(data);
    renderDaily(data);
    updateAccount(data);
    renderLeaderboard(data);
}

window.addEventListener("userProfileUpdated", (event) => {
    if (event.detail) syncAllUI(event.detail);
});

if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        if (auth.currentUser) {
            sessionStorage.clear(); 
            await signOut(auth);
            window.location.reload();
        }
    });
}
