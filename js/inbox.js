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
  getDocs,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/**
 * GLOBAL CLICK HANDLER
 * - Toggles bell dropdown
 * - Handles "Mark All Read"
 * - Handles "markRead" and "delete" for individual messages
 */
document.addEventListener("click", (e) => {
  const notifBtn = document.getElementById("notifBtn");
  const inboxDropdown = document.getElementById("inboxDropdown");

  // If bell or dropdown elements don't exist, nothing to do
  if (!notifBtn || !inboxDropdown) return;

  const target = e.target;

  // 1. Bell icon toggle
  if (notifBtn.contains(target)) {
    e.stopPropagation();
    inboxDropdown.classList.toggle("hidden");
    return;
  }

  // 2. "Mark All Read" button
  if (target.id === "markAllRead") {
    e.stopPropagation();
    markAllAsRead();
    return;
  }

  // 3. Individual message click (mark as read)
  // We use data attributes on the message wrapper
  const msgWrapper = target.closest("[data-msg-id]");
  if (msgWrapper && inboxDropdown.contains(msgWrapper)) {
    const msgId = msgWrapper.getAttribute("data-msg-id");

    // If the click was on the delete button, handle delete instead
    const deleteBtn = target.closest("[data-msg-delete]");
    if (deleteBtn) {
      e.stopPropagation();
      deleteMessage(msgId);
      return;
    }

    // Otherwise, mark as read
    e.stopPropagation();
    markRead(msgId);
    return;
  }

  // 4. Click outside dropdown closes it
  if (!inboxDropdown.contains(target)) {
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
      snapshot.forEach((docSnap) => {
        messages.push({ id: docSnap.id, ...docSnap.data() });
      });
      renderInbox(messages);
      updateBadge(messages);
    });
  });
}

/**
 * Mark all messages as read for current user
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

/**
 * Render the list inside the header dropdown (index.html)
 */
function renderInbox(messages) {
  const inboxList = document.getElementById("inboxList");
  if (!inboxList) return;

  if (messages.length === 0) {
    inboxList.innerHTML =
      '<div class="text-center py-8 text-gray-500 text-sm italic">No new messages</div>';
    return;
  }

  inboxList.innerHTML = messages
    .map(
      (msg) => `
      <div 
        class="p-3 rounded-lg transition border border-transparent ${
          !msg.read
            ? "bg-blue-500/10 border-blue-500/30"
            : "bg-gray-800/40"
        } hover:bg-gray-800 flex justify-between gap-3 items-start"
        data-msg-id="${msg.id}"
        style="cursor: pointer;"
      >
        <div class="flex-1">
          <div class="flex justify-between items-start mb-1">
            <span class="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">
              ${msg.fromName || "System"}
            </span>
            ${
              !msg.read
                ? '<span class="w-2 h-2 bg-blue-500 rounded-full"></span>'
                : ""
            }
          </div>
          <p class="text-xs text-gray-200 leading-tight">
            ${msg.text || ""}
          </p>
        </div>
        <button 
          class="text-xs text-gray-500 hover:text-red-400 ml-2" 
          title="Delete"
          data-msg-delete="true"
        >
          ✕
        </button>
      </div>
    `
    )
    .join("");
}

/**
 * Update little red badge on bell
 */
function updateBadge(messages) {
  const notifBadge = document.getElementById("notifBadge");
  const unreadCount = messages.filter((m) => !m.read).length;

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

  // Also update the count on inbox.html if present
  const unreadCountEl = document.getElementById("unreadCount");
  const totalEarnedInbox = document.getElementById("totalEarnedInbox");
  if (unreadCountEl) {
    unreadCountEl.textContent = unreadCount;
  }

  // For totalEarnedInbox you already update elsewhere; leaving as-is.
}

/**
 * Mark a single message as read
 */
async function markRead(msgId) {
  if (!msgId) return;
  try {
    const msgRef = doc(db, "messages", msgId);
    await updateDoc(msgRef, { read: true });
  } catch (err) {
    console.error("Error marking as read:", err);
  }
}

/**
 * Delete a single message
 */
async function deleteMessage(msgId) {
  if (!msgId) return;
  try {
    const msgRef = doc(db, "messages", msgId);
    await deleteDoc(msgRef);
    // onSnapshot will automatically re-render list
  } catch (err) {
    console.error("Error deleting message:", err);
  }
}

// Keep this for inbox.html (full page) which imports this file directly
initInbox();
