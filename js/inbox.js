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
    limit 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// Mapping the IDs from your HTML
const notifBtn = document.getElementById("notifBtn");
const notifBadge = document.getElementById("notifBadge");
const inboxDropdown = document.getElementById("inboxDropdown");
const inboxList = document.getElementById("inboxList");
const markAllReadBtn = document.getElementById("markAllRead");

export function initInbox() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;

        // 1. UI TOGGLE LOGIC
        if (notifBtn && inboxDropdown) {
            notifBtn.addEventListener("click", (e) => {
                e.stopPropagation(); // Prevents immediate closing
                inboxDropdown.classList.toggle("hidden");
            });

            // Close dropdown when clicking anywhere else
            document.addEventListener("click", (e) => {
                if (!inboxDropdown.contains(e.target) && e.target !== notifBtn) {
                    inboxDropdown.classList.add("hidden");
                }
            });
        }

        // 2. FIREBASE REAL-TIME LISTENER
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

function renderInbox(messages) {
    if (!inboxList) return;
    
    if (messages.length === 0) {
        inboxList.innerHTML = `<p class="text-xs text-gray-500 text-center py-4 italic">No new messages</p>`;
        return;
    }

    inboxList.innerHTML = messages.map(msg => `
        <div class="p-3 rounded-lg transition ${!msg.read ? 'bg-blue-500/10 border-l-2 border-blue-500' : 'bg-gray-800/40'}" 
             onclick="markRead('${msg.id}')" style="cursor: pointer;">
            <div class="flex justify-between items-start mb-1">
                <span class="text-[10px] font-bold text-blue-400 uppercase">${msg.fromName || 'System'}</span>
            </div>
            <p class="text-xs text-gray-200">${msg.text}</p>
        </div>
    `).join('');
}

function updateBadge(messages) {
    const unreadCount = messages.filter(m => !m.read).length;
    if (notifBadge) {
        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.classList.remove("hidden");
        } else {
            notifBadge.classList.add("hidden");
        }
    }
}

// Global function so the onclick in HTML works
window.markRead = async (msgId) => {
    try {
        const msgRef = doc(db, "messages", msgId);
        await updateDoc(msgRef, { read: true });
    } catch (err) {
        console.error("Error marking as read:", err);
    }
};

// Start the listener
initInbox();
