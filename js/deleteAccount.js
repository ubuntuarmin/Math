import { auth, db } from "./firebase.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { deleteUser } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

/**
 * Completely removes user data from Firestore and Firebase Auth
 */
export async function handleDeleteAccount() {
    const user = auth.currentUser;
    if (!user) return;

    const confirmFirst = confirm("ARE YOU SURE? This will delete your credits, tier progress, and leaderboard stats forever.");
    if (!confirmFirst) return;

    const confirmSecond = confirm("Final warning: This action CANNOT be undone. Delete everything?");
    if (!confirmSecond) return;

    try {
        // 1. Delete Firestore Data
        // This removes them from 'users' (which the leaderboard pulls from)
        await deleteDoc(doc(db, "users", user.uid));
        console.log("Firestore data wiped.");

        // 2. Delete Auth Record
        // This removes their login ability
        await deleteUser(user);
        
        alert("Account deleted successfully.");
        window.location.reload();

    } catch (err) {
        console.error("Delete Error:", err);
        if (err.code === 'auth/requires-recent-login') {
            alert("For security, you must have logged in recently to delete your account. Please logout and log back in, then try again.");
        } else {
            alert("Error deleting account. Please try again later.");
        }
    }
}
