import { auth, db } from "./firebase.js";
import { doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

let startTime = Date.now();

export async function syncTime() {
    try {
        // Essential check: Don't run if auth isn't ready or user is logged out
        if (!auth || !auth.currentUser) return;

        const now = Date.now();
        const elapsedMs = now - startTime;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);

        if (elapsedMinutes >= 1) {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, {
                totalMinutes: increment(elapsedMinutes),
                weekMinutes: increment(elapsedMinutes)
            });
            startTime = now; // Reset timer locally
            console.log(`Synced ${elapsedMinutes} minutes.`);
        }
    } catch (err) {
        // Silent catch to prevent UI freeze
        console.warn("Sync deferred:", err.message);
    }
}

export function showPage(pageId) {
    // Sync time in the background when navigating
    syncTime();

    const sections = ["dashboard", "tokens", "account", "leaderboard"];
    sections.forEach(id => {
        const el = document.getElementById(id + "Page");
        if (el) el.classList.add("hidden");
    });

    const target = document.getElementById(pageId + "Page");
    if (target) {
        target.classList.remove("hidden");
    }
}

// FIX: Make navigate available to the HTML buttons
window.navigate = (page) => {
    showPage(page);
};

export function tier(totalEarned) {
    if (totalEarned >= 5000) return "Diamond";
    if (totalEarned >= 2000) return "Platinum";
    if (totalEarned >= 1000) return "Gold";
    if (totalEarned >= 500) return "Silver";
    return "Basic";
}

window.addEventListener("beforeunload", syncTime);
