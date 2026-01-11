import { auth, db } from "./firebase.js";
import { doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- Time Tracking Logic (Firebase Friendly) ---
let startTime = Date.now();

/**
 * Saves accumulated time to Firebase and resets the local clock.
 * This should be called sparingly to save on Firebase Writes.
 */
export async function syncTime() {
    const user = auth.currentUser;
    if (!user) return;

    const now = Date.now();
    const elapsedMs = now - startTime;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);

    // Only write to Firebase if at least 1 full minute has passed
    if (elapsedMinutes >= 1) {
        try {
            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, {
                totalMinutes: increment(elapsedMinutes)
            });
            // Reset start time so we don't double-count
            startTime = now; 
            console.log(`Synced ${elapsedMinutes} minutes to Firebase.`);
        } catch (err) {
            console.error("Time sync failed:", err);
        }
    }
}

// Sync time when the user closes the tab or refreshes
window.addEventListener("beforeunload", () => {
    syncTime();
});

// --- Existing Utils ---

export function tier(totalEarned) {
    if (totalEarned >= 5000) return "Diamond";
    if (totalEarned >= 2000) return "Platinum";
    if (totalEarned >= 1000) return "Gold";
    if (totalEarned >= 500) return "Silver";
    return "Basic";
}

export function showPage(page) {
    // Before switching pages, sync the time spent on the current page
    syncTime();

    const sections = ["dashboard", "tokens", "account", "leaderboard", "referral"];
    sections.forEach(p => {
        const el = document.getElementById(p + "Page");
        if (el) el.classList.add("hidden");
    });
    
    const target = document.getElementById(page + "Page");
    if (target) target.classList.remove("hidden");

    if (page === 'referral' && window.renderReferral) {
        window.renderReferral();
    }
}
