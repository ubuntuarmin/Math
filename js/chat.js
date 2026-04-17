import { auth, db, rtdb } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  set,
  ref,
  push,
  onChildAdded,
  onValue,
  remove,
  query as rtdbQuery,
  orderByChild,
  endAt,
  limitToFirst,
  get,
  serverTimestamp as rtdbServerTimestamp,
  off,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";
import {
  CHAT_HANDLE_RE,
  ensureUserChatHandle,
  getPreferredChatHandle,
  looksLikeUid,
  normalizeChatHandle,
} from "./chatHandle.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const SIX_HOURS_MS   = 6 * 60 * 60 * 1000;
const MAX_MSG_LEN    = 500;
const MAX_NICKNAME_LEN = 32;
const NOTIFICATION_TEXT_MAX_LEN = 140;
const NOTIFICATION_COOLDOWN_MS = 45 * 1000;
const INVITE_COOLDOWN_MS = 2 * 60 * 1000;
const ACTIVE_RECENTLY_MS = 2 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 30 * 1000;
// Gold tier requires 300+ lifetime credits
const GOLD_MIN_EARNED = 300;

// ── Bad-word list (basic moderation) ─────────────────────────────────────────
// Uses word-boundary matching so partial matches don't trigger false positives.
const BAD_WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "cock",
  "pussy", "nigger", "nigga", "faggot", "retard", "whore", "slut",
  "motherfucker", "motherfucking",
];
const BAD_WORD_RE = new RegExp(
  `\\b(${BAD_WORDS.join("|")})\\b`,
  "i"
);

function containsBadWord(text) {
  return BAD_WORD_RE.test(text);
}

// ── Private room ID ───────────────────────────────────────────────────────────
// Deterministic: sort both UIDs alphabetically so both users always land in the
// same room regardless of who initiates the conversation.
function buildRoomId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ── State ─────────────────────────────────────────────────────────────────────
let _currentUser   = null;
let _userData      = null;
let _myHandle      = null;
let _activeRoomId  = null;
let _activePartnerUid = null;
let _activeRefs = [];
let _myTypingRef = null;
let _myGlobalPresenceRef = null;
let _partnerOnline = false;
let _partnerInActiveRoom = false;
let _typingStopTimer = null;
let _presenceHeartbeatTimer = null;
let _savedChats = [];
let _nicknamesByUid = {};
let _activePartnerBaseLabel = null;
const _notificationLastSentAt = new Map();
const _inviteLastSentAt = new Map();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatLoading    = document.getElementById("chatLoading");
const accessGate     = document.getElementById("accessGate");
const chatApp        = document.getElementById("chatApp");
const myChatIdEl     = document.getElementById("myChatId");
const myUidValueEl   = document.getElementById("myUidValue");
const copyIdBtn      = document.getElementById("copyIdBtn");
const partnerInput   = document.getElementById("partnerIdInput");
const startChatBtn   = document.getElementById("startChatBtn");
const startChatError = document.getElementById("startChatError");
const savedChatsList = document.getElementById("savedChatsList");
const chatRoom       = document.getElementById("chatRoom");
const partnerLabel   = document.getElementById("partnerLabel");
const partnerNicknameInput = document.getElementById("partnerNicknameInput");
const saveNicknameBtn = document.getElementById("saveNicknameBtn");
const chatMessages   = document.getElementById("chatMessages");
const noMessages     = document.getElementById("noMessages");
const chatInput      = document.getElementById("chatInput");
const sendBtn        = document.getElementById("sendBtn");
const closeChatBtn   = document.getElementById("closeChatBtn");
const partnerStatus  = document.getElementById("partnerStatus");
const typingStatus   = document.getElementById("typingStatus");

if (partnerNicknameInput) {
  partnerNicknameInput.maxLength = MAX_NICKNAME_LEN;
}

// ── Check access ──────────────────────────────────────────────────────────────
function hasAccess(userData) {
  const totalEarned  = userData.totalEarned || 0;
  const referralCount = (userData.referrals || []).length;
  return totalEarned >= GOLD_MIN_EARNED || referralCount >= 1;
}

function savedChatsStorageKey(uid) {
  return `mathkaty_saved_chats_${uid}`;
}

function nicknamesStorageKey(uid) {
  return `mathkaty_chat_nicknames_${uid}`;
}

function loadSavedChats(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(savedChatsStorageKey(uid));
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.partnerUid === "string")
      .map((item) => ({
        partnerUid: String(item.partnerUid),
        partnerLabel: String(item.partnerLabel || item.partnerUid),
        lastOpenedAt: Number(item.lastOpenedAt || 0),
      }))
      .slice(0, 25);
  } catch (err) {
    console.warn("Failed to load saved chats:", err);
    return [];
  }
}

function persistSavedChats() {
  if (!_currentUser?.uid) return;
  try {
    localStorage.setItem(
      savedChatsStorageKey(_currentUser.uid),
      JSON.stringify(_savedChats.slice(0, 25))
    );
  } catch (err) {
    console.warn("Failed to save chat list:", err);
  }
}

function loadNicknames(uid) {
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(nicknamesStorageKey(uid));
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    console.warn("Failed to load nicknames:", err);
    return {};
  }
}

function persistNicknames() {
  if (!_currentUser?.uid) return;
  try {
    localStorage.setItem(
      nicknamesStorageKey(_currentUser.uid),
      JSON.stringify(_nicknamesByUid || {})
    );
  } catch (err) {
    console.warn("Failed to save nicknames:", err);
  }
}

function displayNameFor(uid, fallbackLabel = null) {
  const nick = String(_nicknamesByUid?.[uid] || "").trim();
  if (nick) return nick;
  return fallbackLabel || uid;
}

function renderSavedChats() {
  if (!savedChatsList) return;
  if (!_savedChats.length) {
    savedChatsList.innerHTML = `<p class="text-xs text-gray-600">No saved conversations yet.</p>`;
    return;
  }
  savedChatsList.innerHTML = "";
  const ordered = [..._savedChats]
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    .slice(0, 8);

  for (const item of ordered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "w-full text-left px-3 py-2 rounded-xl bg-gray-800/70 hover:bg-gray-700/70 border border-gray-700/70 transition-colors";
    const title = escapeHtml(displayNameFor(item.partnerUid, item.partnerLabel));
    const sub = escapeHtml(item.partnerLabel || item.partnerUid);
    row.innerHTML = `
      <div class="text-sm text-white truncate">${title}</div>
      <div class="text-[11px] text-gray-500 font-mono truncate">${sub}</div>
    `;
    row.addEventListener("click", () => {
      openRoom(item.partnerUid, item.partnerLabel);
    });
    savedChatsList.appendChild(row);
  }
}

function upsertSavedChat(partnerUid, partnerLabel) {
  if (!partnerUid) return;
  const idx = _savedChats.findIndex((x) => x.partnerUid === partnerUid);
  const next = {
    partnerUid,
    partnerLabel: partnerLabel || partnerUid,
    lastOpenedAt: Date.now(),
  };
  if (idx >= 0) {
    _savedChats[idx] = { ..._savedChats[idx], ...next };
  } else {
    _savedChats.push(next);
  }
  _savedChats = _savedChats
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    .slice(0, 25);
  persistSavedChats();
  renderSavedChats();
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  _currentUser = user;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    _userData = snap.exists() ? snap.data() : {};
  } catch (_) {
    _userData = {};
  }
  _myHandle = await ensureUserChatHandle(user.uid, _userData);
  _userData.chatHandle = _myHandle || getPreferredChatHandle(_userData, user.uid);
  _userData.chatHandleLower = _userData.chatHandle;
  _savedChats = loadSavedChats(user.uid);
  _nicknamesByUid = loadNicknames(user.uid);

  chatLoading?.classList.add("hidden");

  if (!hasAccess(_userData)) {
    accessGate?.classList.remove("hidden");
    return;
  }

  setupGlobalPresence();

  // Show chat UI
  chatApp?.classList.remove("hidden");
  if (myChatIdEl) myChatIdEl.textContent = _userData.chatHandle || user.uid;
  if (myUidValueEl) myUidValueEl.textContent = user.uid;
  renderSavedChats();

  // Pre-fill partner from URL param (e.g. chat.html?partner=UID)
  const urlPartner = new URLSearchParams(window.location.search).get("partner");
  if (urlPartner && partnerInput) {
    partnerInput.value = urlPartner;
    openChat({ sendInvite: false });
    // URL partner target takes priority; returning here exits this auth callback so auto-resume does not run.
    return;
  }

  // Auto-resume the most recent saved conversation
  if (_savedChats.length > 0) {
    const recent = _savedChats[0];
    if (recent?.partnerUid) {
      openRoom(recent.partnerUid, recent.partnerLabel || recent.partnerUid, { sendInvite: false });
    }
  }
});

// ── Copy Chat ID ──────────────────────────────────────────────────────────────
copyIdBtn?.addEventListener("click", () => {
  if (!_currentUser) return;
  navigator.clipboard.writeText(_myHandle || _currentUser.uid).then(() => {
    copyIdBtn.textContent = "✓ Copied!";
    setTimeout(() => { copyIdBtn.textContent = "📋 Copy"; }, 2000);
  });
});

// ── Start / open chat room ────────────────────────────────────────────────────
startChatBtn?.addEventListener("click", openChat);
partnerInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); openChat(); }
});

async function openChat({ sendInvite = true } = {}) {
  if (!_currentUser) return;
  const partnerInputValue = (partnerInput?.value || "").trim();

  if (startChatError) startChatError.classList.add("hidden");

  if (!partnerInputValue) {
    showError("Please enter a chat handle or UID.");
    return;
  }
  if (partnerInputValue === _currentUser.uid || normalizeChatHandle(partnerInputValue) === _myHandle) {
    showError("You can't chat with yourself.");
    return;
  }
  if (!looksLikeUid(partnerInputValue) && !CHAT_HANDLE_RE.test(normalizeChatHandle(partnerInputValue))) {
    showError("Use a handle like verb-adjective-123456 or paste a UID.");
    return;
  }

  const resolved = await resolvePartner(partnerInputValue);
  if (!resolved?.uid) {
    showError("User not found. Check the handle and try again.");
    return;
  }

  await openRoom(resolved.uid, resolved.label, { sendInvite });
}

function showError(msg) {
  if (!startChatError) return;
  startChatError.textContent = msg;
  startChatError.classList.remove("hidden");
}

// ── Open a specific chat room ──────────────────────────────────────────────────
async function resolvePartner(input) {
  const raw = String(input || "").trim();
  const normalized = normalizeChatHandle(raw);
  // Resolve handles before UID fallback; some handles can look UID-like.
  if (CHAT_HANDLE_RE.test(normalized)) {
    const byLower = query(
      collection(db, "users"),
      where("chatHandleLower", "==", normalized),
      limit(1)
    );
    const lowerSnap = await getDocs(byLower);
    if (!lowerSnap.empty) {
      const hit = lowerSnap.docs[0];
      const data = hit.data() || {};
      return { uid: hit.id, label: data.chatHandle || normalized };
    }
    return null;
  }

  else if (looksLikeUid(raw)) {
    return { uid: raw, label: raw };
  }

  return null;
}

function currentRoomPresencePayload() {
  return {
    online: true,
    lastSeen: Date.now(),
    currentRoom: _activeRoomId || null,
  };
}

function setupGlobalPresence() {
  if (!_currentUser?.uid) return;
  if (_presenceHeartbeatTimer) {
    clearInterval(_presenceHeartbeatTimer);
    _presenceHeartbeatTimer = null;
  }

  _myGlobalPresenceRef = ref(rtdb, `presence/${_currentUser.uid}`);
  set(_myGlobalPresenceRef, currentRoomPresencePayload()).catch(() => {});
  onDisconnect(_myGlobalPresenceRef).set({
    online: false,
    lastSeen: rtdbServerTimestamp(),
    currentRoom: null,
  });

  _presenceHeartbeatTimer = setInterval(() => {
    if (!_myGlobalPresenceRef) return;
    set(_myGlobalPresenceRef, currentRoomPresencePayload()).catch(() => {});
  }, PRESENCE_HEARTBEAT_MS);
}

function updateGlobalPresenceRoom() {
  if (!_myGlobalPresenceRef) return;
  set(_myGlobalPresenceRef, currentRoomPresencePayload()).catch(() => {});
}

async function maybeSendChatInvite(partnerUid) {
  if (!_currentUser?.uid || !partnerUid) return;
  const roomId = buildRoomId(_currentUser.uid, partnerUid);
  const now = Date.now();
  const lastInviteAt = _inviteLastSentAt.get(roomId) || 0;
  if (now - lastInviteAt < INVITE_COOLDOWN_MS) return;

  try {
    const existingMessageSnap = await get(
      rtdbQuery(ref(rtdb, `chats/${roomId}/messages`), limitToFirst(1))
    );
    if (existingMessageSnap.exists()) return;

    _inviteLastSentAt.set(roomId, now);
    await addDoc(collection(db, "messages"), {
      to: partnerUid,
      fromName: _myHandle || "Chat",
      title: "New chat request",
      text: "Tap Accept Chat to open this private conversation.",
      type: "chat_invite",
      joinUrl: `chat.html?partner=${encodeURIComponent(_currentUser.uid)}`,
      read: false,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("Failed to send chat invite:", err);
  }
}

function applyPartnerStatus(state) {
  if (!partnerStatus) return;
  const isOnline = !!state?.online;
  const isInRoom = isOnline && state?.currentRoom === _activeRoomId;
  const lastSeen = Number(state?.lastSeen || 0);
  const activeRecently = !isOnline && lastSeen > 0 && (Date.now() - lastSeen) < ACTIVE_RECENTLY_MS;

  _partnerOnline = isOnline;
  _partnerInActiveRoom = isInRoom;

  if (isInRoom) {
    partnerStatus.textContent = "In chat now";
    partnerStatus.className = "text-[11px] mt-1 text-emerald-400";
    return;
  }
  if (isOnline) {
    partnerStatus.textContent = "Online";
    partnerStatus.className = "text-[11px] mt-1 text-emerald-500";
    return;
  }
  if (activeRecently) {
    partnerStatus.textContent = "Active recently";
    partnerStatus.className = "text-[11px] mt-1 text-amber-400";
    return;
  }
  partnerStatus.textContent = "Offline";
  partnerStatus.className = "text-[11px] mt-1 text-gray-500";
}

async function openRoom(partnerId, partnerDisplayLabel = null, { sendInvite = false } = {}) {
  // Detach any previous listener
  detachListener();

  _activeRoomId = buildRoomId(_currentUser.uid, partnerId);
  _activePartnerUid = partnerId;
  _activePartnerBaseLabel = partnerDisplayLabel || partnerId;
  _partnerOnline = false;
  _partnerInActiveRoom = false;
  updateGlobalPresenceRoom();

  if (partnerLabel) partnerLabel.textContent = displayNameFor(partnerId, _activePartnerBaseLabel);
  if (partnerStatus) partnerStatus.textContent = "Offline";
  if (typingStatus) typingStatus.textContent = "";
  if (partnerNicknameInput) {
    partnerNicknameInput.value = String(_nicknamesByUid?.[partnerId] || "");
  }
  if (chatMessages) {
    chatMessages.innerHTML = "";
    if (noMessages) {
      noMessages.textContent = "No messages yet — say hello! 👋";
      chatMessages.appendChild(noMessages);
    }
  }

  chatRoom?.classList.remove("hidden");
  upsertSavedChat(partnerId, _activePartnerBaseLabel);
  if (sendInvite) {
    maybeSendChatInvite(partnerId);
  }

  // Subscribe to new messages
  const messagesRef = ref(rtdb, `chats/${_activeRoomId}/messages`);
  const renderedIds = new Set();

  _activeRefs.push(messagesRef);
  onChildAdded(messagesRef, (snapshot) => {
    const msgId = snapshot.key;
    if (renderedIds.has(msgId)) return;
    renderedIds.add(msgId);

    const data = snapshot.val();
    if (!data || !data.text) return;

    // Hide "no messages" placeholder
    if (noMessages && chatMessages.contains(noMessages)) {
      chatMessages.removeChild(noMessages);
    }

    appendMessage(data);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // Partner presence listener
  const partnerPresenceRef = ref(rtdb, `presence/${_activePartnerUid}`);
  _activeRefs.push(partnerPresenceRef);
  onValue(partnerPresenceRef, (snap) => {
    applyPartnerStatus(snap.val() || {});
  });

  // Partner typing listener
  const partnerTypingRef = ref(rtdb, `chats/${_activeRoomId}/typing/${_activePartnerUid}`);
  _activeRefs.push(partnerTypingRef);
  onValue(partnerTypingRef, (snap) => {
    if (!typingStatus) return;
    typingStatus.textContent = snap.val() ? "Typing…" : "";
  });

  _myTypingRef = ref(rtdb, `chats/${_activeRoomId}/typing/${_currentUser.uid}`);
  set(_myTypingRef, false).catch(() => {});
  onDisconnect(_myTypingRef).remove();
}

function detachListener() {
  if (_typingStopTimer) {
    clearTimeout(_typingStopTimer);
    _typingStopTimer = null;
  }
  if (_myTypingRef) {
    set(_myTypingRef, false).catch(() => {});
  }
  for (const roomRef of _activeRefs) {
    off(roomRef);
  }
  _activeRefs = [];
  _activeRoomId = null;
  _activePartnerUid = null;
  _activePartnerBaseLabel = null;
  _myTypingRef = null;
  _partnerOnline = false;
  _partnerInActiveRoom = false;
  updateGlobalPresenceRoom();
}

// ── Render a message bubble ───────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendMessage(data) {
  if (!chatMessages) return;
  const isMe = data.senderId === _currentUser?.uid;
  const timeStr = data.timestamp
    ? new Date(data.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const wrapper = document.createElement("div");
  wrapper.className = `flex ${isMe ? "justify-end" : "justify-start"}`;
  wrapper.innerHTML = `
    <div class="max-w-[75%]">
      <div class="${isMe ? "msg-bubble-me text-white" : "msg-bubble-them text-gray-100"} px-4 py-2.5 text-sm leading-relaxed">
        ${escapeHtml(data.text)}
      </div>
      <div class="text-[10px] text-gray-600 mt-1 ${isMe ? "text-right" : "text-left"} px-1">${timeStr}</div>
    </div>`;
  chatMessages.appendChild(wrapper);
}

// ── Send a message ────────────────────────────────────────────────────────────
sendBtn?.addEventListener("click", sendMessage);
chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Simple client-side rate limit: max 20 messages per minute
const _sendLog = [];
function isRateLimited() {
  const now = Date.now();
  // Remove entries older than 60 seconds
  while (_sendLog.length && now - _sendLog[0] > 60000) _sendLog.shift();
  if (_sendLog.length >= 20) return true;
  _sendLog.push(now);
  return false;
}

async function sendMessage() {
  if (!_currentUser || !_activeRoomId || !_activePartnerUid) return;

  const text = (chatInput?.value || "").trim();
  if (!text) return;

  if (text.length > MAX_MSG_LEN) {
    alert(`Message too long (max ${MAX_MSG_LEN} characters).`);
    return;
  }

  if (containsBadWord(text)) {
    alert("Your message contains inappropriate language. Please keep the conversation respectful. 🤝");
    return;
  }

  if (isRateLimited()) {
    alert("You're sending messages too fast. Please wait a moment.");
    return;
  }

  if (sendBtn) sendBtn.disabled = true;

  try {
    const messagesRef = ref(rtdb, `chats/${_activeRoomId}/messages`);
    await push(messagesRef, {
      text,
      senderId: _currentUser.uid,
      timestamp: Date.now(), // client-time used for ordering; server timestamp isn't available as a value in RTDB push
    });

    const now = Date.now();
    const lastNotifAt = _notificationLastSentAt.get(_activeRoomId) || 0;
    if (!_partnerInActiveRoom && now - lastNotifAt >= NOTIFICATION_COOLDOWN_MS) {
      _notificationLastSentAt.set(_activeRoomId, now);
      await addDoc(collection(db, "messages"), {
        to: _activePartnerUid,
        fromName: _myHandle || "Chat",
        title: "New chat message",
        text: text.length > NOTIFICATION_TEXT_MAX_LEN
          ? `${text.slice(0, NOTIFICATION_TEXT_MAX_LEN)}…`
          : text,
        type: "chat_message",
        joinUrl: `chat.html?partner=${encodeURIComponent(_currentUser.uid)}`,
        read: false,
        timestamp: serverTimestamp(),
      });
    }

    if (chatInput) chatInput.value = "";
    if (typingStatus) typingStatus.textContent = "";
    if (_myTypingRef) set(_myTypingRef, false).catch(() => {});

    // Immediately prune messages older than 6 hours
    pruneOldMessages(_activeRoomId);
  } catch (err) {
    console.error("Send error:", err);
    alert("Failed to send message. Please try again.");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    chatInput?.focus();
  }
}

// ── Prune messages older than 6 hours ────────────────────────────────────────
async function pruneOldMessages(roomId) {
  if (!roomId) return;
  const cutoff = Date.now() - SIX_HOURS_MS;
  try {
    const oldRef = rtdbQuery(
      ref(rtdb, `chats/${roomId}/messages`),
      orderByChild("timestamp"),
      endAt(cutoff)
    );
    const snapshot = await get(oldRef);
    if (!snapshot.exists()) return;

    const deletions = [];
    snapshot.forEach((child) => {
      deletions.push(remove(child.ref));
    });
    await Promise.all(deletions);
  } catch (err) {
    // Non-critical — log and continue
    console.warn("Prune error:", err);
  }
}

// ── Close chat room ───────────────────────────────────────────────────────────
closeChatBtn?.addEventListener("click", () => {
  detachListener();
  chatRoom?.classList.add("hidden");
  if (chatMessages) chatMessages.innerHTML = "";
  if (partnerStatus) partnerStatus.textContent = "Offline";
  if (typingStatus) typingStatus.textContent = "";
});

saveNicknameBtn?.addEventListener("click", () => {
  if (!_activePartnerUid) return;
  const next = String(partnerNicknameInput?.value || "").trim().slice(0, MAX_NICKNAME_LEN);
  if (next) _nicknamesByUid[_activePartnerUid] = next;
  else delete _nicknamesByUid[_activePartnerUid];
  persistNicknames();
  if (partnerLabel) {
    partnerLabel.textContent = displayNameFor(_activePartnerUid, _activePartnerBaseLabel || _activePartnerUid);
  }
  renderSavedChats();
});

partnerNicknameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveNicknameBtn?.click();
  }
});

// ── Auto-resize textarea ──────────────────────────────────────────────────────
chatInput?.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
  if (!_activeRoomId || !_myTypingRef) return;
  const hasText = !!chatInput.value.trim();
  set(_myTypingRef, hasText).catch(() => {});
  if (_typingStopTimer) clearTimeout(_typingStopTimer);
  if (hasText) {
    _typingStopTimer = setTimeout(() => {
      if (_myTypingRef) set(_myTypingRef, false).catch(() => {});
    }, 1200);
  }
});

chatInput?.addEventListener("blur", () => {
  if (_myTypingRef) set(_myTypingRef, false).catch(() => {});
});

window.addEventListener("beforeunload", () => {
  if (_presenceHeartbeatTimer) {
    clearInterval(_presenceHeartbeatTimer);
    _presenceHeartbeatTimer = null;
  }
  if (_myGlobalPresenceRef) {
    set(_myGlobalPresenceRef, {
      online: false,
      lastSeen: Date.now(),
      currentRoom: null,
    }).catch(() => {});
  }
});
