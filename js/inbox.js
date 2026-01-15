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

// DOM Elements from your index.html
const notifBtn = document.getElementById("notifBtn");
const notifBadge = document.getElementById("notifBadge");
const inboxDropdown = document.getElementById("inboxDropdown");
const inboxList = document.getElementById("inboxList");
const markAllReadBtn = document.getElementById("markAllRead");

export function initInbox() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;

        // --- 1. UI TOGGLE LOGIC ---
        if (notifBtn && inboxDropdown) {
            notifBtn.onclick = (e) => {
                e.stopPropagation(); // Stops the document click listener from closing it instantly
                const isHidden = inboxDropdown.classList.contains("hidden");
                
                // Close all other potential dropdowns here if you have them
                inboxDropdown.classList.toggle("hidden");
                
                console.log("Inbox toggled. Current state hidden:", !isHidden);
            };

            // Close when clicking outside
            document.addEventListener("click", (e) => {
                if (!inboxDropdown.contains(e.target) && e.target !== notifBtn) {
                    inboxDropdown.classList.add("hidden");
                }
            });
        }

        // --- 2. DATA LISTENER ---
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

        // --- 3. MARK ALL AS READ LOGIC ---
        if (markAllReadBtn) {
            markAllReadBtn.onclick = async () => {
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
            };
        }
    });
}

/**
 * Renders the HTML inside the inboxList
 */
function renderInbox(messages) {
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

/**
 * Updates the red badge on the bell icon
 */
function updateBadge(messages) {
    const unreadCount = messages.filter(m => !m.read).length;
    if (notifBadge) {
        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.classList.remove("hidden");
            notifBadge.style.display = "block"; // Ensure Tailwind 'hidden' is overridden
        } else {
            notifBadge.classList.add("hidden");
            notifBadge.style.display = "none";
        }
    }
}

/**
 * Global function for individual message clicks
 */
window.markRead = async (msgId) => {
    try {
        const msgRef = doc(db, "messages", msgId);
        await updateDoc(msgRef, { read: true });
    } catch (err) {
        console.error("Error marking as read:", err);
    }
};

// Start the module
initInbox();
