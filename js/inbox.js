import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    updateDoc, 
    doc, 
    addDoc, 
    serverTimestamp, 
    orderBy, 
    getDocs, 
    limit 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const inboxList = document.getElementById("inboxList");
const msgCount = document.getElementById("msgCount");

/**
 * Listens for new messages/notifications for the current user
 */
export function initInbox() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;

        // Query: Messages where recipient is current user
        const q = query(
            collection(db, "messages"),
            where("to", "==", user.uid),
            orderBy("timestamp", "desc"),
            limit(50)
        );

        onSnapshot(q, (snapshot) => {
            const messages = [];
            snapshot.forEach((doc) => {
                messages.push({ id: doc.id, ...doc.data() });
            });
            renderInbox(messages);
            updateUnreadCount(messages);
        });
    });
}

/**
 * Renders the inbox UI
 */
function renderInbox(messages) {
    if (!inboxList) return;
    
    if (messages.length === 0) {
        inboxList.innerHTML = `
            <div class="p-8 text-center text-gray-500">
                <div class="text-4xl mb-2">📩</div>
                <p class="text-sm">Your inbox is empty.</p>
            </div>
        `;
        return;
    }

    inboxList.innerHTML = messages.map(msg => `
        <div class="p-4 border-b border-gray-800 hover:bg-gray-800/50 transition cursor-pointer ${!msg.read ? 'bg-blue-900/10' : ''}" 
             onclick="markAsRead('${msg.id}')">
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-bold text-blue-400 uppercase tracking-widest">${msg.fromName || 'System'}</span>
                <span class="text-[10px] text-gray-500">${formatTime(msg.timestamp)}</span>
            </div>
            <p class="text-sm text-gray-200 leading-relaxed">${msg.text}</p>
        </div>
    `).join('');
}

/**
 * Updates the global notification badge
 */
function updateUnreadCount(messages) {
    const unread = messages.filter(m => !m.read).length;
    if (msgCount) {
        msgCount.textContent = unread;
        msgCount.style.display = unread > 0 ? "flex" : "none";
    }
}

/**
 * Marks a message as read in Firestore
 */
window.markAsRead = async (msgId) => {
    try {
        const msgRef = doc(db, "messages", msgId);
        await updateDoc(msgRef, { read: true });
    } catch (err) {
        console.error("Error marking as read:", err);
    }
};

/**
 * Send Message Helper (System or Admin)
 */
export async function sendMessage(toUid, fromName, text) {
    try {
        await addDoc(collection(db, "messages"), {
            to: toUid,
            fromName: fromName,
            text: text,
            timestamp: serverTimestamp(),
            read: false
        });
    } catch (err) {
        console.error("Send Message Error:", err);
    }
}

function formatTime(ts) {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Auto-init if the container exists
if (inboxList) {
    initInbox();
}
