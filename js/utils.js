import { auth, db } from "./firebase.js";
import { doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

let startTime = Date.now();

/**
 * Saves accumulated minutes to Firestore.
 * Added a check to ensure user is authenticated before attempting sync.
 */
export async function syncTime() {
    try {
        // Safety check: if auth isn't loaded or user isn't logged in, skip
        if (!auth || !auth.currentUser) return;

        const now = Date.now();
        const elapsedMs = now - startTime;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);

        // Only update if at least 1 minute has passed
        if (elapsedMinutes >= 1) {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, {
                totalMinutes: increment(elapsedMinutes),
                weekMinutes: increment(elapsedMinutes)
            });
            
            // Reset the timer start point to NOW
            startTime = now;
            console.log(`Successfully synced ${elapsedMinutes} minutes.`);
        }
    } catch (err) {
        // Catch errors silently so the site doesn't crash if network fails
        console.warn("Time sync skipped or failed:", err.message);
    }
}

/**
 * Switches between section visibility.
 */
export function showPage(pageId) {
    // 1. Attempt to sync time (runs in background)
    syncTime().catch(e => console.error("Navigation sync error:", e));

    // 2. Define all possible page IDs
    const sections = ["dashboard", "tokens", "account", "leaderboard"];
    
    sections.forEach(id => {
        const el = document.getElementById(id + "Page");
        if (el) {
            el.classList.add("hidden");
        }
    });

    // 3. Show the target page
    const target = document.getElementById(pageId + "Page");
    if (target) {
        target.classList.remove("hidden");
    } else {
        console.error(`Page ID "${pageId}Page" not found in HTML.`);
    }
}

// Global helper for the HTML onclick="navigate(...)" calls
window.navigate = (page) => {
    showPage(page);
};

// Sync when tab is closed
window.addEventListener("beforeunload", () => {
    // Note: beforeunload sync is "best effort" and may not always finish
    syncTime();
});
