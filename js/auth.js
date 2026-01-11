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

const header = document.getElementById("header");
const appContainer = document.getElementById("appContainer");
const logoutBtn = document.getElementById("logoutBtn");

// Force sign-out on page reload
try {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav ? nav.type === 'reload' : (performance?.navigation?.type === 1);
  if (isReload) {
    signOut(auth).catch(() => {});
  }
} catch (e) {}

/**
 * Handles the logic for incrementing the daily streak.
 */
async function handleDailyStreak(uid, userData) {
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  const lastUpdate = userData.lastStreakUpdate?.toMillis() || 0;
  const now = Date.now();

  // If 24 hours have passed since the last streak increase
  if (now - lastUpdate >= DAY_IN_MS) {
    const userRef = doc(db, "users", uid);
    try {
      await updateDoc(userRef, {
        streak: increment(1),
        lastStreakUpdate: serverTimestamp()
      });
      // Fetch updated data to return to the UI
      const snap = await getDoc(userRef);
      return snap.data();
    } catch (err) {
      console.error("Streak update failed:", err);
    }
  }
  return userData;
}

onAuthStateChanged(auth, async user => {
  console.log("Auth state changed:", user ? `signed in (${user.uid})` : "signed out");

  if (!user) {
    header.classList.add("hidden");
    appContainer.classList.add("hidden");
    showLogin();
    return;
  }

  hideLogin();
  header.classList.remove("hidden");
  appContainer.classList.remove("hidden");

  let currentUserData = {};
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    currentUserData = snap.exists() ? snap.data() : {};

    // Check streak progression for returning users
    const justSignedUp = sessionStorage.getItem("justSignedUp");
    if (!justSignedUp && snap.exists()) {
      currentUserData = await handleDailyStreak(user.uid, currentUserData);
    }
  } catch (err) {
    console.error("Failed to fetch user doc:", err);
  }

  // Update modules
  try { updateUI(currentUserData); } catch (e) { console.error("updateUI error:", e); }
  try { renderDaily(currentUserData); } catch (e) { console.error("renderDaily error:", e); }
  try { updateAccount(currentUserData); } catch (e) { console.error("updateAccount error:", e); }
  try { renderLeaderboard(currentUserData); } catch (e) { console.error("renderLeaderboard error:", e); }

  const justSignedUp = sessionStorage.getItem("justSignedUp");
  if (justSignedUp) {
    showOnboarding();
    return;
  }

  try {
    const displayName = user.displayName || currentUserData.firstName || null;
    showWelcome(displayName);
  } catch (e) {
    console.error("welcome animation error:", e);
  }
});

logoutBtn.addEventListener("click", async () => {
  if (auth.currentUser) await signOut(auth);
});
