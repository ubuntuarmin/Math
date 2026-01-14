import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { 
    collection, 
    query, 
    orderBy, 
    onSnapshot, 
    doc, 
    getDoc,
    updateDoc, 
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const inboxList = document.getElementById("inboxList");
const unreadDisplay = document.getElementById("unreadCount");
const totalEarnedDisplay = document.getElementById("totalEarnedInbox");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "index.html"; // Redirect if not logged in
        return;
    }

    // 1. Fetch User Stats for the top cards
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
        totalEarnedDisplay.textContent = userDoc.data().totalEarned || 0;
    }

    // 2. Listen for Notifications
    const notifRef = collection(db, "users", user.uid, "notifications");
    const q = query(notifRef, orderBy("createdAt", "desc"));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            inboxList.innerHTML = `
                <div class="modern-card p-10 text-center text-gray-500 italic">
                    <div class="text-4xl mb-4">📭</div>
                    Your inbox is empty. Earn credits to see alerts!
                </div>`;
            unreadDisplay.textContent = "0";
            return;
        }

        let unread = 0;
        let html = "";

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.read) unread++;

            const time = data.createdAt?.toDate().toLocaleDateString([], { 
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            }) || "Just now";

            html += `
                <div class="modern-card p-5 group cursor-pointer transition-all ${data.read ? 'opacity-70' : 'border-l-4 border-l-blue-500 bg-blue-500/5'}" 
                     onclick="markAsRead('${docSnap.id}')">
                    <div class="flex justify-between items-start">
                        <div class="flex gap-4">
                            <div class="text-2xl">${data.type === 'reward' ? '🪙' : '📢'}</div>
                            <div>
                                <h3 class="font-bold ${data.read ? 'text-gray-300' : 'text-white'}">${data.title}</h3>
                                <p class="text-sm text-gray-400 mt-1">${data.message}</p>
                                <span class="text-[10px] uppercase tracking-widest text-gray-500 mt-3 block font-bold">${time}</span>
                            </div>
                        </div>
                        ${!data.read ? '<div class="w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>' : ''}
                    </div>
                </div>
            `;
        });

        inboxList.innerHTML = html;
        unreadDisplay.textContent = unread;
    });
});

// Function to mark individual notification as read
window.markAsRead = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, "users", user.uid, "notifications", id);
    await updateDoc(ref, { read: true });
};
