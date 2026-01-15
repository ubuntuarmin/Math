import { db } from "./firebase.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    orderBy, 
    doc, 
    updateDoc, 
    writeBatch 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const inboxBtn = document.getElementById("inboxBtn");
const inboxBadge = document.getElementById("inboxBadge");
const inboxDropdown = document.getElementById("inboxDropdown");
const inboxList = document.getElementById("inboxList");
const markAllReadBtn = document.getElementById("markAllRead");

let currentUserId = null;

/**
 * Initializes the real-time inbox listener for a specific user
 */
export function initInbox(uid) {
    if (!uid) return;
    currentUserId = uid;

    const messagesRef = collection(db, "messages");
    const q = query(
        messagesRef, 
        where("recipientId", "==", uid), 
        orderBy("timestamp", "desc")
    );

    // Listen for real-time updates
    onSnapshot(q, (snapshot) => {
        const messages = [];
        snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
        renderInbox(messages);
    });

    // Toggle dropdown visibility
    if (inboxBtn && inboxDropdown) {
        inboxBtn.onclick = (e) => {
            e.stopPropagation();
            inboxDropdown.classList.toggle("hidden");
        };
    }

    // Mark all as read logic
    if (markAllReadBtn) {
        markAllReadBtn.onclick = async () => {
            const unreadDocs = document.querySelectorAll('.message-item[data-read="false"]');
            if (unreadDocs.length === 0) return;

            const batch = writeBatch(db);
            unreadDocs.forEach(el => {
                const ref = doc(db, "messages", el.dataset.id);
                batch.update(ref, { read: true });
            });
            await batch.commit();
        };
    }
}

/**
 * Renders the messages into the UI
 */
function renderInbox(messages) {
    if (!inboxList || !inboxBadge) return;

    const unreadCount = messages.filter(m => !m.read).length;

    // Update Badge
    if (unreadCount > 0) {
        inboxBadge.textContent = unreadCount;
        inboxBadge.classList.remove("hidden");
    } else {
        inboxBadge.classList.add("hidden");
    }

    // Render List
    if (messages.length === 0) {
        inboxList.innerHTML = `<div class="p-8 text-center text-gray-500 text-xs italic">No messages yet</div>`;
        return;
    }

    inboxList.innerHTML = messages.map(msg => `
        <div class="message-item p-3 rounded-lg border border-gray-800 transition-all cursor-pointer hover:bg-gray-800/50 ${msg.read ? 'opacity-60' : 'bg-blue-900/10 border-blue-900/30'}" 
             data-id="${msg.id}" 
             data-read="${msg.read}">
            <div class="flex justify-between items-start mb-1">
                <span class="text-[10px] font-bold uppercase tracking-wider ${msg.read ? 'text-gray-500' : 'text-blue-400'}">
                    ${msg.type || 'Notification'}
                </span>
                <span class="text-[9px] text-gray-600">
                    ${msg.timestamp?.toDate().toLocaleDateString() || 'Recently'}
                </span>
            </div>
            <div class="text-xs text-gray-200 leading-relaxed">${msg.text}</div>
            ${!msg.read ? `<div class="mt-2 text-[9px] text-blue-500 font-bold uppercase">Click to dismiss</div>` : ''}
        </div>
    `).join('');

    // Add click-to-read listeners to individual messages
    document.querySelectorAll('.message-item').forEach(item => {
        item.onclick = async () => {
            if (item.dataset.read === "false") {
                const msgRef = doc(db, "messages", item.dataset.id);
                await updateDoc(msgRef, { read: true });
            }
        };
    });
}

// Global click listener to close dropdown when clicking outside
document.addEventListener("click", () => {
    if (inboxDropdown) inboxDropdown.classList.add("hidden");
});

if (inboxDropdown) {
    inboxDropdown.onclick = (e) => e.stopPropagation();
}
