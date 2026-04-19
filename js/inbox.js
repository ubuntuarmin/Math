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
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const h = React.createElement;
let inboxRoot = null;

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
  if (!(target instanceof Element)) return;

  // 1. Bell icon toggle — prevent navigation, show dropdown instead
  if (notifBtn.contains(target)) {
    e.stopPropagation();
    e.preventDefault();
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

    // If click was on join button, mark read and open chat
    const joinBtn = target.closest("[data-msg-join]");
    const joinUrl = safeJoinUrl(_messageById.get(msgId)?.joinUrl || "");
    if (joinBtn && joinUrl) {
      e.stopPropagation();
      markRead(msgId).finally(() => {
        window.location.href = joinUrl;
      });
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

let _inboxInitialized = false;
let _inboxUnsubscribe = null;
const _seenMessageIds = new Set();
const _messageById = new Map();

export function initInbox() {
  // Guard against duplicate calls (e.g. imported by multiple modules)
  if (_inboxInitialized) return;
  _inboxInitialized = true;

  onAuthStateChanged(auth, (user) => {
    // Clean up any existing snapshot listener before (re-)initialising
    if (_inboxUnsubscribe) {
      _inboxUnsubscribe();
      _inboxUnsubscribe = null;
    }

    if (!user) {
      // If on a sub-page without a login modal, redirect to index
      const loginModal = document.getElementById("loginModal");
      if (!loginModal) {
        window.location.href = "index.html";
      }
      return;
    }

    // Populate totalEarnedInbox on inbox.html
    const totalEarnedEl = document.getElementById("totalEarnedInbox");
    if (totalEarnedEl) {
      getDoc(doc(db, "users", user.uid))
        .then((snap) => {
          if (snap.exists()) {
            totalEarnedEl.textContent = snap.data().totalEarned ?? 0;
          }
        })
        .catch((err) => console.error("Failed to load totalEarned:", err));
    }

    // --- DATA LISTENER ---
    const q = query(
      collection(db, "messages"),
      where("to", "==", user.uid),
      orderBy("timestamp", "desc"),
      limit(20)
    );

    _inboxUnsubscribe = onSnapshot(q, (snapshot) => {
      const messages = [];
      snapshot.forEach((docSnap) => {
        messages.push({ id: docSnap.id, ...docSnap.data() });
      });
      maybeShowBrowserNotifications(messages);
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
    const docs = querySnapshot.docs;
    if (!docs.length) return;

    // Firestore write batches cap at 500 operations.
    // Keep headroom for safety and commit in chunks.
    const CHUNK_SIZE = 450;
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      chunk.forEach((d) => {
        batch.update(d.ref, { read: true });
      });
      await batch.commit();
    }
  } catch (err) {
    console.error("Error marking all read:", err);
  }
}

/**
 * Individual inbox message row.
 * Data attributes are kept so the existing global click handler still works.
 * React escapes text content automatically so no manual escapeHtml is needed.
 */
function InboxMessage({ msg }) {
  const joinUrl = safeJoinUrl(msg.joinUrl);
  const isChatAction = (msg.type === "chat_message" || msg.type === "chat_invite") && !!joinUrl;
  const chatActionLabel = msg.type === "chat_invite" ? "Accept Chat" : "Open Chat";
  return h("div", {
    className: `p-3 rounded-lg transition border border-transparent ${
      !msg.read ? "bg-blue-500/10 border-blue-500/30" : "bg-gray-800/40"
    } hover:bg-gray-800 flex justify-between gap-3 items-start`,
    "data-msg-id": msg.id,
    style: { cursor: "pointer" },
  },
    h("div", { className: "flex-1" },
      h("div", { className: "flex justify-between items-start mb-1" },
        h("span", { className: "text-[10px] font-bold text-blue-400 uppercase tracking-tighter" },
          msg.fromName || "System"
        ),
        !msg.read && h("span", { className: "w-2 h-2 bg-blue-500 rounded-full" })
      ),
      msg.title && h("p", { className: "text-[11px] text-gray-300 mb-1" }, msg.title),
      h("p", { className: "text-xs text-gray-200 leading-tight" }, msg.text || "")
    ),
    h("div", { className: "flex items-center gap-2 ml-2" },
      isChatAction && h("button", {
        className: "text-[10px] px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-500 text-white",
        "data-msg-join": "true",
      }, chatActionLabel),
      h("button", {
        className: "text-xs text-gray-500 hover:text-red-400",
        title: "Delete",
        "data-msg-delete": "true",
      }, "✕")
    )
  );
}

/**
 * Render the list inside the header dropdown (index.html)
 */
function renderInbox(messages) {
  const inboxList = document.getElementById("inboxList");
  if (!inboxList) return;

  _messageById.clear();
  messages.forEach((msg) => _messageById.set(msg.id, msg));

  if (!inboxRoot) {
    inboxRoot = createRoot(inboxList);
  }

  if (messages.length === 0) {
    inboxRoot.render(
      h("div", { className: "text-center py-8 text-gray-500 text-sm italic" }, "No new messages")
    );
    return;
  }

  inboxRoot.render(
    h(React.Fragment, null,
      ...messages.map((msg) => h(InboxMessage, { key: msg.id, msg }))
    )
  );
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

function maybeShowBrowserNotifications(messages) {
  if (!("Notification" in window)) return;
  const canNotify = Notification.permission === "granted";
  if (!canNotify && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  for (const msg of messages) {
    if (_seenMessageIds.has(msg.id)) continue;
    _seenMessageIds.add(msg.id);
    if (!canNotify) continue;
    if (msg.read) continue;
    if (!document.hidden) continue;
    const title = msg.title || "New message";
    const body = msg.text || "";
    const safeUrl = safeJoinUrl(msg.joinUrl);
    try {
      const n = new Notification(title, { body });
      if (safeUrl) {
        n.onclick = () => {
          window.location.href = safeUrl;
        };
      }
    } catch (_) {}
  }
}

function safeJoinUrl(urlValue) {
  const url = String(urlValue || "").trim();
  if (!url) return "";
  if (!url.startsWith("chat.html?partner=")) return "";
  return url;
}

// Keep this for inbox.html (full page) which imports this file directly
initInbox();
