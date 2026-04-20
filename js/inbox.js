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
const _messageById = new Map();
const FIRESTORE_BATCH_CHUNK_SIZE = 450; // keep below Firestore's 500-op batch write cap
const MAX_MARK_ALL_READ_PASSES = 50; // safety guard against unexpected endless fetch loops
let _initialPageTitle = "";
let _notificationsPrimed = false;
const _knownUnreadById = new Map();
const _shownToastIds = new Set();

export function initInbox() {
  // Guard against duplicate calls (e.g. imported by multiple modules)
  if (_inboxInitialized) return;
  _inboxInitialized = true;
  _initialPageTitle = document.title || "Math Katy";

  onAuthStateChanged(auth, (user) => {
    // Clean up any existing snapshot listener before (re-)initialising
    if (_inboxUnsubscribe) {
      _inboxUnsubscribe();
      _inboxUnsubscribe = null;
    }

    if (!user) {
      _notificationsPrimed = false;
      _knownUnreadById.clear();
      _shownToastIds.clear();
      document.title = _initialPageTitle;
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
      maybeShowRealtimeNotifications(messages);
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
    // Read/update in bounded chunks to avoid unbounded reads on large inboxes.
    let pass = 0;
    while (pass < MAX_MARK_ALL_READ_PASSES) {
      pass += 1;
      const qUnread = query(
        collection(db, "messages"),
        where("to", "==", user.uid),
        where("read", "==", false),
        limit(FIRESTORE_BATCH_CHUNK_SIZE)
      );
      const querySnapshot = await getDocs(qUnread);
      const docs = querySnapshot.docs;
      if (!docs.length) break;

      const batch = writeBatch(db);
      docs.forEach((d) => {
        batch.update(d.ref, { read: true });
      });
      await batch.commit();

      if (docs.length < FIRESTORE_BATCH_CHUNK_SIZE) break;
    }
    if (pass >= MAX_MARK_ALL_READ_PASSES) {
      console.warn(
        `markAllAsRead stopped after reaching max passes (${pass}, ${FIRESTORE_BATCH_CHUNK_SIZE} docs/pass max) to prevent excessive reads.`
      );
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
  document.title = unreadCount > 0 ? `(${unreadCount}) ${_initialPageTitle}` : _initialPageTitle;

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

function maybeShowRealtimeNotifications(messages) {
  const supportsBrowserNotifications = "Notification" in window;
  if (supportsBrowserNotifications && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  const canNotify = supportsBrowserNotifications && Notification.permission === "granted";

  const idsInSnapshot = new Set(messages.map((m) => m.id));
  for (const id of [..._knownUnreadById.keys()]) {
    if (!idsInSnapshot.has(id)) _knownUnreadById.delete(id);
  }

  if (!_notificationsPrimed) {
    messages.forEach((msg) => _knownUnreadById.set(msg.id, !msg.read));
    _notificationsPrimed = true;
    return;
  }

  for (const msg of messages) {
    const prevUnread = _knownUnreadById.get(msg.id) === true;
    const isUnread = !msg.read;
    _knownUnreadById.set(msg.id, isUnread);
    if (!isUnread || prevUnread) continue;

    showInAppNotificationToast(msg);
    if (!canNotify || !document.hidden) continue;

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

function showInAppNotificationToast(msg) {
  if (!msg?.id || _shownToastIds.has(msg.id)) return;
  _shownToastIds.add(msg.id);
  const safeUrl = safeJoinUrl(msg.joinUrl);

  let host = document.getElementById("inboxToastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "inboxToastHost";
    host.className = "fixed top-20 right-4 z-[120] flex flex-col gap-2 max-w-xs";
    document.body.appendChild(host);
  }

  const toast = document.createElement("div");
  toast.className = "rounded-xl border border-blue-500/30 bg-gray-900/95 p-3 shadow-2xl";
  toast.innerHTML = `
    <div class="text-[11px] font-bold text-blue-300 mb-1">${escapeHtml(msg.title || "New message")}</div>
    <div class="text-[11px] text-gray-200 leading-snug">${escapeHtml(msg.text || "")}</div>
    <div class="mt-2 flex justify-end gap-2">
      ${safeUrl ? '<button type="button" class="toast-open text-[10px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white">Open</button>' : ""}
      <button type="button" class="toast-dismiss text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200">Dismiss</button>
    </div>
  `;
  toast.querySelector(".toast-open")?.addEventListener("click", () => {
    window.location.href = safeUrl;
  });
  toast.querySelector(".toast-dismiss")?.addEventListener("click", () => {
    toast.remove();
  });
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

function safeJoinUrl(urlValue) {
  const url = String(urlValue || "").trim();
  if (!url) return "";
  if (!url.startsWith("chat.html?partner=")) return "";
  return url;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Keep this for inbox.html (full page) which imports this file directly
initInbox();
