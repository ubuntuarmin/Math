import { auth, db } from "./firebase.js";
import { doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

let startTime = Date.now();

export async function syncTime() {
    const user = auth.currentUser;
    if (!user) return;

    const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);

    if (elapsedMinutes >= 1) {
        try {
            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, {
                totalMinutes: increment(elapsedMinutes),
                weekMinutes: increment(elapsedMinutes) // Keep leaderboard in sync
            });
            startTime = Date.now(); 
        } catch (err) {
            console.error("Time sync failed:", err);
        }
    }
}

window.addEventListener("beforeunload", syncTime);

export function showPage(page) {
    syncTime(); // Sync time whenever a user navigates
    const sections = ["dashboard", "tokens", "account", "leaderboard"];
    sections.forEach(p => {
        const el = document.getElementById(p + "Page");
        if (el) el.classList.add("hidden");
    });
    const target = document.getElementById(page + "Page");
    if (target) target.classList.remove("hidden");
}
