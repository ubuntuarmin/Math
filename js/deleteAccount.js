import { auth, db } from "./firebase.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { deleteUser } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

/**
 * Completely removes user data from Firebase Auth and Firestore.
 * Order changed to Auth first to prevent "Ghost Logins".
 */
export async function handleDeleteAccount() {
    const user = auth.currentUser;
    if (!user) return;

    // 1. Double Confirmation
    const confirmFirst = confirm("ARE YOU SURE? This will delete your credits, tier progress, and leaderboard stats forever.");
    if (!confirmFirst) return;

    const confirmSecond = confirm("Final warning: This action CANNOT be undone. Delete everything?");
    if (!confirmSecond) return;

    try {
        const uid = user.uid; // Store UID before user object is destroyed

        // 2. Delete Auth Record First
        // If this fails (due to recent login requirement), the catch block handles it.
        // If it succeeds, the user is officially "gone" from your system.
        await deleteUser(user);
        console.log("Auth account deleted.");

        // 3. Delete Firestore Data
        // Now that they can't log back in, we clean up the database.
        try {
            await deleteDoc(doc(db, "users", uid));
            console.log("Firestore document wiped.");
        } catch (dbErr) {
            // If DB delete fails, we log it, but the user is already gone from Auth.
            console.error("Cleanup error (Firestore):", dbErr);
        }

        alert("Account deleted successfully.");
        
        // 4. Hard Redirect
        // Sending to index.html with a clear cache-bust to ensure auth state resets.
        window.location.href = "index.html?loggedout=" + Date.now();

    } catch (err) {
        console.error("Delete Process Error:", err);

        if (err.code === 'auth/requires-recent-login') {
            alert("For security, you must have logged in very recently to delete your account. Please log out, log back in, and try again immediately.");
        } else {
            alert("An error occurred while deleting your account. Please try again later.");
        }
    }
}
