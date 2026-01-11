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

// Force sign-out on page reload (Optional: remove if you want users to stay logged in)
try {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav ? nav.type === 'reload' : (performance?.navigation?.type === 1);
  if (isReload) {
    signOut(auth).catch(() => {});
  }
} catch (e) {}

/**
 * Handles resetting daily limits and updating the streak.
 */
async function handleDailyData(uid, userData) {
  const userRef = doc(db, "users", uid);
  const now = new Date();
  const todayStr = now.toDateString(); // e.g. "Sun Jan 11 2026"
  
  const lastVisitDate = userData.lastVisitDate || "";
  const updates = {};

  // --- 1. DAILY RESET LOGIC (Resets 45-min link timer) ---
  if (lastVisitDate !== todayStr) {
    updates.dailyLinkUsage = 0;
    updates.lastVisitDate = todayStr;
    console.log("New day detected! Resetting link usage timer.");
  }

  // --- 2. WEEKLY RESET LOGIC (Resets leaderboard minutes) ---
  // If today is Sunday (day 0) and the last visit wasn't today
  if (now.getDay() === 0 && lastVisitDate !== todayStr) {
    updates.weekMinutes = 0;
    console.log("New week detected! Resetting leaderboard.");
  }

  // --- 3. STREAK LOGIC ---
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  const lastStreakUpdate = userData.lastStreakUpdate?.toMillis() || 0;
  const currentStreak = userData.streak || 0;
  const timeDiff = Date.now() - lastStreakUpdate;

  if (currentStreak === 0) {
    updates.streak = 1;
    updates.lastStreakUpdate = serverTimestamp();
  } else if (timeDiff >= DAY_IN_MS) {
    // Note: You might want to check if they missed a day to reset streak, 
    // but for now this just increments every 24h.
    updates.streak = increment(1);
    updates.lastStreakUpdate = serverTimestamp();
  }

  // Apply all updates if any exist
  if (Object.keys(updates).length > 0) {
    await updateDoc(userRef, updates);
    const snap = await getDoc(userRef);
    return snap.data();
  }

  return userData;
}

onAuthStateChanged(auth, async user => {
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
    
    if (snap.exists()) {
      currentUserData = snap.data();
      
      const justSignedUp = sessionStorage.getItem("justSignedUp");
      if (!justSignedUp) {
        // Run our reset and streak logic
        currentUserData = await handleDailyData(user.uid, currentUserData);
      }
    } else {
        // Handle case where user exists in Auth but not in Firestore yet
        console.warn("User document not found. Redirecting to onboarding.");
    }
  } catch (err) {
    console.error("Auth State Error:", err);
  }

  // Refresh all UI modules with the latest data
  try { updateUI(currentUserData); } catch (e) {}
  try { renderDaily(currentUserData); } catch (e) {}
  try { updateAccount(currentUserData); } catch (e) {}
  try { renderLeaderboard(currentUserData); } catch (e) {}

  if (sessionStorage.getItem("justSignedUp")) {
    showOnboarding();
    return;
  }

  try {
    const displayName = user.displayName || currentUserData.firstName || "Student";
    showWelcome(displayName);
  } catch (e) {}
});

logoutBtn.addEventListener("click", async () => {
  if (auth.currentUser) await signOut(auth).then(() => location.reload());
});
