import { db, auth } from "./firebase.js";
import { collection, query, orderBy, onSnapshot, limit } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

export function initInbox(uid) {
    const notifList = document.getElementById("notifList");
    const notifBadge = document.getElementById("notifBadge");
    const dropdown = document.getElementById("notifDropdown");
    const btn = document.getElementById("notifBtn");

    if (!btn || !dropdown) return;

    // --- APPLY INLINE STYLES (Replaces CSS) ---
    // Badge Style
    Object.assign(notifBadge.style, {
        position: 'absolute',
        top: '-5px',
        right: '-5px',
        backgroundColor: '#ef4444',
        color: 'white',
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '50%',
        border: '2px solid white',
        display: 'none' // Hidden by default
    });

    // Dropdown Container Style
    Object.assign(dropdown.style, {
        position: 'absolute',
        right: '0',
        top: '50px',
        width: '300px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
        border: '1px solid #e2e8f0',
        padding: '15px',
        zIndex: '9999',
        display: 'none', // Hidden by default
        maxHeight: '400px',
        overflowY: 'auto',
        color: '#1e293b',
        textAlign: 'left'
    });

    const q = query(
        collection(db, "users", uid, "notifications"),
        orderBy("timestamp", "desc"),
        limit(20)
    );

    onSnapshot(q, (snapshot) => {
        let unreadCount = 0;
        notifList.innerHTML = "";

        if (snapshot.empty) {
            notifList.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">No messages yet</div>`;
            notifBadge.style.display = 'none';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.read) unreadCount++;

            const item = document.createElement("div");
            Object.assign(item.style, {
                padding: '12px',
                borderBottom: '1px solid #f1f5f9',
                borderLeft: data.read ? 'none' : '4px solid #6366f1',
                backgroundColor: data.read ? 'transparent' : '#f8fafc'
            });

            item.innerHTML = `
                <div style="font-weight:600; font-size:14px;">${data.title}</div>
                <div style="font-size:13px; color:#475569;">${data.message}</div>
                <div style="font-size:10px; color:#94a3b8; margin-top:4px;">${data.timestamp?.toDate().toLocaleTimeString() || 'Just now'}</div>
            `;
            notifList.appendChild(item);
        });

        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.style.display = 'block';
        } else {
            notifBadge.style.display = 'none';
        }
    });

    // --- TOGGLE LOGIC ---
    btn.onclick = (e) => {
        e.stopPropagation();
        const isHidden = dropdown.style.display === 'none';
        dropdown.style.display = isHidden ? 'block' : 'none';
    };

    // Close if clicking anywhere else
    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
    });
}
