import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    updateDoc, 
    doc, 
    orderBy, 
    limit,
    writeBatch,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/**
 * NEW: Event Delegation Logic
 * This handles the click globally so re-renders don't break the button.
 */
document.addEventListener("click", (e) => {
    const notifBtn = document.getElementById("notifBtn");
    const inboxDropdown = document.getElementById("inboxDropdown");

    if (!notifBtn || !inboxDropdown) return;

    // 1. Check if the user clicked the Bell button (or anything inside it)
    if (notifBtn.contains(e.target)) {
        e.stopPropagation();
        inboxDropdown.classList.toggle("hidden");
        return;
    }

    // 2. Check if the user clicked "Mark All Read"
    if (e.target.id === "markAllRead") {
        markAllAsRead();
        return;
    }

    // 3. Close the menu if clicking outside of it
    if (!inboxDropdown.contains(e.target)) {
        inboxDropdown.classList.add("hidden");
    }
});

export function initInbox() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;

        // --- DATA LISTENER ---
        const q = query(
            collection(db, "messages"),
            where("to", "==", user.uid),
            orderBy("timestamp", "desc"),
            limit(20)
        );

        onSnapshot(q, (snapshot) => {
            const messages = [];
            snapshot.forEach((doc) => {
                messages.push({ id: doc.id, ...doc.data() });
            });
            renderInbox(messages);
            updateBadge(messages);
        });
    });
}

/**
 * Handles marking everything as read
 */
async function markAllAsRead() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const qUnread = query(
            collection(db, "messages"),
            where("to", "==", user.uid),
            where("read", "==", false)
        );
        const querySnapshot = await getDocs(qUnread);
        const batch = writeBatch(db);
        querySnapshot.forEach((d) => {
            batch.update(d.ref, { read: true });
        });
        await batch.commit();
    } catch (err) {
        console.error("Error marking all read:", err);
    }
}

function renderInbox(messages) {
    const inboxList = document.getElementById("inboxList");
    if (!inboxList) return;
    
    if (messages.length === 0) {
        inboxList.innerHTML = `<div class="text-center py-8 text-gray-500 text-sm italic">No new messages</div>`;
        return;
    }

    inboxList.innerHTML = messages.map(msg => `
        <div class="p-3 rounded-lg transition border border-transparent ${!msg.read ? 'bg-blue-500/10 border-blue-500/30' : 'bg-gray-800/40'} hover:bg-gray-800" 
             onclick="window.markRead('${msg.id}')" style="cursor: pointer;">
            <div class="flex justify-between items-start mb-1">
                <span class="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">${msg.fromName || 'System'}</span>
                ${!msg.read ? '<span class="w-2 h-2 bg-blue-500 rounded-full"></span>' : ''}
            </div>
            <p class="text-xs text-gray-200 leading-tight">${msg.text}</p>
        </div>
    `).join('');
}

function updateBadge(messages) {
    const notifBadge = document.getElementById("notifBadge");
    const unreadCount = messages.filter(m => !m.read).length;
    
    if (notifBadge) {
        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.classList.remove("hidden");
            notifBadge.style.display = "block";
        } else {
            notifBadge.classList.add("hidden");
            notifBadge.style.display = "none";
        }
    }
}

window.markRead = async (msgId) => {
    try {
        const msgRef = doc(db, "messages", msgId);
        await updateDoc(msgRef, { read: true });
    } catch (err) {
        console.error("Error marking as read:", err);
    }
};

initInbox();
