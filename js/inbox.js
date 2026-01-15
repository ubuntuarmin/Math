import { db, auth } from "./firebase.js";
import { collection, query, orderBy, onSnapshot, limit } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

export function initInbox(uid) {
    const notifList = document.getElementById("notifList");
    const notifBadge = document.getElementById("notifBadge");
    
    const q = query(
        collection(db, "users", uid, "notifications"),
        orderBy("timestamp", "desc"),
        limit(20)
    );

    onSnapshot(q, (snapshot) => {
        let unreadCount = 0;
        notifList.innerHTML = "";

        if (snapshot.empty) {
            notifList.innerHTML = '<p class="empty-msg">Your inbox is clear!</p>';
            notifBadge.classList.add("hidden");
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.read) unreadCount++;

            const item = document.createElement("div");
            item.className = `notif-item ${data.read ? '' : 'unread'}`;
            item.innerHTML = `
                <strong>${data.title}</strong>
                <p>${data.message}</p>
                <small>${data.timestamp?.toDate().toLocaleTimeString() || 'Just now'}</small>
            `;
            notifList.appendChild(item);
        });

        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.classList.remove("hidden");
        } else {
            notifBadge.classList.add("hidden");
        }
    });
}

// Toggle visibility
document.getElementById("notifBtn")?.addEventListener("click", () => {
    document.getElementById("notifDropdown").classList.toggle("hidden");
});
