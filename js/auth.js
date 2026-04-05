import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc, updateDoc, increment, serverTimestamp, setDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { deleteInactiveAccount } from "./deleteAccount.js";

// UI modules
import { updateUI } from "./links.js";
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

// Inactivity constants
const INACTIVE_WARN_DAYS  = 30;   // show warning after 30 days
const INACTIVE_DELETE_DAYS = 37;  // mark for deletion after 37 days

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
 * Returns true if a bi-monthly reset date (15th or 29th) has been crossed
 * between lastVisitMillis and now.
 */
function hasCrossedBimonthlyReset(lastVisitMillis, now) {
    if (!lastVisitMillis || lastVisitMillis <= 0) return false;
    const last = new Date(lastVisitMillis);
    const resetDays = [15, 29];
    let cursor = new Date(last.getFullYear(), last.getMonth(), 1);
    let iterations = 0;
    const MAX_MONTHS = 24;
    while (cursor <= now && iterations < MAX_MONTHS) {
        for (const d of resetDays) {
            const resetDate = new Date(cursor.getFullYear(), cursor.getMonth(), d, 0, 0, 0, 0);
            if (resetDate > last && resetDate <= now) {
                return true;
            }
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        iterations++;
    }
    if (iterations >= MAX_MONTHS) return true;
    return false;
}

async function handleDailyData(uid, userData) {
    const userRef = doc(db, "users", uid);
    const now = new Date();
    const todayStr = now.toDateString();
    const lastVisitDate = userData.lastVisitDate || "";
    
    const updates = {};

    if (lastVisitDate !== todayStr) {
        updates.dailyLinkUsage = 0;
        updates.lastVisitDate = todayStr;
        updates.extraLimitMinutesToday = 0;
    }

    const lastVisitTimestampVal = userData.lastVisitTimestamp;
    const lastVisitMillis =
        lastVisitTimestampVal && typeof lastVisitTimestampVal.toMillis === "function"
            ? lastVisitTimestampVal.toMillis()
            : 0;

    const crossedReset = hasCrossedBimonthlyReset(lastVisitMillis, now);
    if (crossedReset) {
        updates.weekMinutes = 0;
    }

    updates.lastVisitTimestamp = serverTimestamp();

    const hasValidStreak =
        typeof userData.streak === "number" && Number.isFinite(userData.streak);
    const currentStreak = hasValidStreak ? userData.streak : 0;

    if (!hasValidStreak) {
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
        // Build the post-update state locally to avoid an extra Firestore read.
        const merged = { ...userData };
        for (const [key, val] of Object.entries(updates)) {
            merged[key] = val;
        }
        // streak may use increment(1) — compute the actual value locally
        if (updates.streak && typeof updates.streak === "object") {
            merged.streak = (userData.streak || 0) + 1;
        }
        // lastVisitTimestamp uses serverTimestamp() — approximate with a local-time
        // compatible shim. Only toMillis() is used downstream (streak/leaderboard checks).
        merged.lastVisitTimestamp = { toMillis: () => Date.now(), toDate: () => new Date() };
        return merged;
    }
    return userData;
}

/**
 * Check if the user qualifies for the monthly quality bonus:
 * >10 link reviews received AND average rating >4.7 across all their links.
 * Awards 50 credits once per calendar month.
 * Uses at most 1 Firestore read per month.
 * Returns true if credits were awarded (so caller can refresh user data).
 */
async function checkMonthlyQualityBonus(uid, userData) {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Already processed this month — skip entirely (no read needed)
    if (userData.qualityBonusMonth === currentMonth) return false;

    try {
        // Fetch all link ratings received by this user (1 read per month max)
        const ratingsSnap = await getDocs(
            query(collection(db, "linkRatings"), where("submittedBy", "==", uid))
        );

        const count = ratingsSnap.size;
        const userRef = doc(db, "users", uid);

        if (count <= 10) {
            // Not more than 10 reviews yet — mark month so we don't re-check until next month
            await updateDoc(userRef, { qualityBonusMonth: currentMonth });
            return false;
        }

        let ratingSum = 0;
        ratingsSnap.forEach(s => { ratingSum += (s.data().score || 0); });
        const avg = ratingSum / count;

        if (avg > 4.7) {
            // Qualifies — award 50 credits and mark the month
            await updateDoc(userRef, {
                credits:           increment(50),
                totalEarned:       increment(50),
                qualityBonusMonth: currentMonth,
            });
            // Send in-app notification
            try {
                await addDoc(collection(db, "messages"), {
                    to:        uid,
                    fromName:  "System",
                    title:     "Monthly Quality Bonus! 🌟",
                    text:      `Your profile has ${count} reviews with an average of ${avg.toFixed(1)} ⭐. You earned +50 bonus credits for maintaining a top-rated profile!`,
                    type:      "system",
                    timestamp: serverTimestamp(),
                    read:      false,
                });
            } catch (_) {}
            return true; // credits were updated — caller should refresh
        } else {
            await updateDoc(userRef, { qualityBonusMonth: currentMonth });
            return false;
        }
    } catch (err) {
        console.warn("Monthly quality bonus check failed:", err);
        return false;
    }
}


function checkInactivity(userData, user) {
    const lastVisitTs = userData.lastVisitTimestamp;
    if (!lastVisitTs || typeof lastVisitTs.toMillis !== "function") return;

    const lastMillis = lastVisitTs.toMillis();
    const nowMillis  = Date.now();
    const diffDays   = (nowMillis - lastMillis) / (1000 * 60 * 60 * 24);

    if (diffDays < INACTIVE_WARN_DAYS) return;

    const modal      = document.getElementById("inactiveWarningModal");
    const daysEl     = document.getElementById("inactiveDays");
    const countdown  = document.getElementById("inactiveCountdown");
    const dismissBtn = document.getElementById("inactiveDismissBtn");
    const deleteBtn  = document.getElementById("inactiveDeleteBtn");
    if (!modal) return;

    const daysRounded = Math.floor(diffDays);
    if (daysEl) daysEl.textContent = daysRounded;

    const isPastThreshold = daysRounded >= INACTIVE_DELETE_DAYS;

    if (isPastThreshold) {
        // Past deletion threshold — user must actively choose to keep or delete account.
        if (countdown) {
            countdown.textContent = "Your account has reached the inactivity limit. Click \"Keep My Account\" to reactivate, or delete it now to free up resources.";
            countdown.classList.remove("text-orange-300");
            countdown.classList.add("text-red-400");
        }
        if (dismissBtn) dismissBtn.textContent = "✅ Keep My Account";
        if (deleteBtn) deleteBtn.classList.remove("hidden");

        // Wire up the delete button — use onclick to avoid accumulating listeners
        // across multiple calls to checkInactivity.
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                modal.classList.add("hidden");
                try {
                    await deleteInactiveAccount(user);
                } catch (err) {
                    console.error("Failed to delete inactive account:", err);
                    alert("An error occurred while deleting your account. Please try again.");
                    return;
                }
                window.location.href = "index.html?deleted=inactive&t=" + Date.now();
            };
        }
    } else {
        const daysUntilDelete = Math.max(0, INACTIVE_DELETE_DAYS - daysRounded);
        if (countdown) {
            countdown.textContent = `You have ${daysUntilDelete} day${daysUntilDelete !== 1 ? "s" : ""} before your account is flagged for deletion. Log in regularly to stay active!`;
        }
        if (deleteBtn) deleteBtn.classList.add("hidden");
    }

    modal.classList.remove("hidden");

    // Use onclick to replace any previous handler and avoid listener accumulation.
    if (dismissBtn) {
        dismissBtn.onclick = () => {
            modal.classList.add("hidden");
        };
    }
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
                bio: "",
                avatarColor: "ocean",
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

        hideLogin();
        header?.classList.remove("hidden");
        appContainer?.classList.remove("hidden");

        let currentUserData = snap.data();
            
        if (!sessionStorage.getItem("justSignedUp")) {
            // Check inactivity BEFORE updating the visit timestamp
            checkInactivity(currentUserData, user);
            currentUserData = await handleDailyData(user.uid, currentUserData);
            // Check monthly quality bonus (at most 1 extra Firestore read per month)
            const bonusAwarded = await checkMonthlyQualityBonus(user.uid, currentUserData);
            if (bonusAwarded) {
                // Re-fetch so the UI shows the updated credit total
                const refreshed = await getDoc(doc(db, "users", user.uid));
                if (refreshed.exists()) currentUserData = refreshed.data();
            }
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
    if (!event.detail) return;
    const data = event.detail;
    // Update header and UI components but skip reloading links to avoid unnecessary
    // re-fetches. The links.js module keeps currentUserData in sync via its own listener.
    refreshHeaderUI(data);
    renderDaily(data);
    updateAccount(data);
    // Leaderboard is intentionally NOT re-rendered here — it only refreshes on full page load
    // to reduce Firestore reads and avoid annoying resets of the scroll position.
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
