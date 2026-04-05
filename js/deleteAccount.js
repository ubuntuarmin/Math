import { auth, db } from "./firebase.js";
import { doc, deleteDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { deleteUser } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

/**
 * Deletes all Firestore data associated with a given uid:
 * - user profile document
 * - shared links submitted by the user
 * - inbox messages addressed to the user
 * - link ratings submitted by the user
 *
 * Uses Promise.allSettled so all cleanup operations are attempted
 * even if one fails.
 */
async function deleteAllUserData(uid) {
    const results = await Promise.allSettled([
        // Delete user profile document (also removes them from the leaderboard,
        // which is a live query on the users collection).
        deleteDoc(doc(db, "users", uid)),

        // Delete shared links submitted by this user
        getDocs(query(collection(db, "sharedLinks"), where("submittedBy", "==", uid)))
            .then(snap => Promise.all(snap.docs.map(d => deleteDoc(d.ref)))),

        // Delete inbox messages addressed to this user
        getDocs(query(collection(db, "messages"), where("to", "==", uid)))
            .then(snap => Promise.all(snap.docs.map(d => deleteDoc(d.ref)))),

        // Delete link ratings submitted by this user
        getDocs(query(collection(db, "linkRatings"), where("ratedBy", "==", uid)))
            .then(snap => Promise.all(snap.docs.map(d => deleteDoc(d.ref)))),
    ]);

    results.forEach((result, i) => {
        const labels = ["users doc", "sharedLinks", "messages", "linkRatings"];
        if (result.status === "rejected") {
            console.error(`Cleanup error (${labels[i]}):`, result.reason);
        }
    });
}

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

        // 3. Delete all Firestore data (profile, shared links, messages)
        await deleteAllUserData(uid);

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

/**
 * Deletes an account due to inactivity (no user confirmation required).
 * Called by auth.js when a user has been inactive past the deletion threshold.
 */
export async function deleteInactiveAccount(user) {
    if (!user) return;
    const uid = user.uid;
    try {
        await deleteUser(user);
        await deleteAllUserData(uid);
        console.log("Inactive account deleted:", uid);
    } catch (err) {
        console.error("Inactive account deletion error:", err);
        throw err;
    }
}

/**
 * Deletes an account that was flagged as hacked/fraudulent (no user confirmation required).
 * Removes the Firebase Auth record and all associated Firestore data — including the
 * user profile (and therefore their leaderboard entry), shared links, messages, and
 * link ratings.
 * Called by auth.js when abuse thresholds are exceeded on login.
 */
export async function deleteHackedAccount(user) {
    if (!user) return;
    const uid = user.uid;
    try {
        await deleteUser(user);
        await deleteAllUserData(uid);
        console.log("Hacked account removed:", uid);
    } catch (err) {
        console.error("Hacked account deletion error:", err);
        throw err;
    }
}
