import { auth, db } from "./firebase.js";
import { 
    collection, 
    query, 
    orderBy, 
    limit, 
    onSnapshot, 
    doc, 
    updateDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const inboxContainer = document.getElementById("inboxList");
const notificationBadge = document.getElementById("notificationBadge");

/**
 * Renders the inbox UI
 */
export function initInbox() {
    if (!auth.currentUser) return;

    const navRef = collection(db, "users", auth.currentUser.uid, "notifications");
    const q = query(navRef, orderBy("createdAt", "desc"), limit(20));

    // Live listener for new notifications
    onSnapshot(q, (snapshot) => {
        if (!inboxContainer) return;

        let unreadCount = 0;
        const html = snapshot.docs.map(docSnap => {
            const item = docSnap.data();
            if (!item.read) unreadCount++;

            return `
                <div class="modern-card p-4 mb-3 ${item.read ? 'opacity-60' : 'border-l-4 border-l-blue-500'} animate-up">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="text-sm font-bold ${item.read ? 'text-gray-400' : 'text-white'}">${item.title}</h4>
                            <p class="text-xs text-gray-400 mt-1">${item.message}</p>
                            <span class="text-[10px] text-gray-500 mt-2 block italic">
                                ${item.createdAt?.toDate().toLocaleTimeString() || 'Just now'}
                            </span>
                        </div>
                        ${!item.read ? `<div class="w-2 h-2 bg-blue-500 rounded-full"></div>` : ''}
                    </div>
                </div>
            `;
        }).join("");

        inboxContainer.innerHTML = html || `<p class="text-center text-gray-500 py-10 italic">Your inbox is empty.</p>`;
        
        // Update notification badge in the UI
        if (notificationBadge) {
            notificationBadge.textContent = unreadCount;
            notificationBadge.classList.toggle("hidden", unreadCount === 0);
        }
    });
}

/**
 * Utility to send a notification (Can be imported and used anywhere)
 */
export async function sendNotification(uid, title, message) {
    try {
        const ref = collection(db, "users", uid, "notifications");
        await addDoc(ref, {
            title: title,
            message: message,
            read: false,
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error("Notification failed to send:", err);
    }
}
