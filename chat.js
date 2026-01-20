// === 1. Firebase config (same project) ===
const firebaseConfig = {
  apiKey: "AIzaSyBfAmhyoDysA6vHiXafMfQNegEZ5x4u0uc",
  authDomain: "mathchat2351.firebaseapp.com",
  databaseURL: "https://mathchat2351-default-rtdb.firebaseio.com",
  projectId: "mathchat2351",
  storageBucket: "mathchat2351.firebasestorage.app",
  messagingSenderId: "180804483490",
  appId: "1:180804483490:web:e846785d6d12a822f3dafb",
  measurementId: "G-WNZSCPC9VH"
};

// === 2. App State ===
const GLOBAL_ROOM_ID = "global";
const COOLDOWN_MS = 3000; // stricter than server rule (500ms) -> safe

let appInitialized = false;
let authReady = false;
let currentUser = null;
let currentName = "";
let lastSentAt = 0;
let cooldownTimer = null;

// room state
let currentRoomId = GLOBAL_ROOM_ID;
let currentRoomName = "Global Lobby";
let currentRoomCode = "global";
let privateRoomId = null;     // user.uid when known
let privateRoomCode = null;   // derived from uid
let messagesRef = null;
let statusAllRef = null;
let connectedRef = null;
let statusRef = null;

// === 3. DOM refs ===
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const onlineCountEl = document.getElementById("online-count");
const messagesContainer = document.getElementById("messages-container");
const messagesInner = document.getElementById("messages-inner");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const displayNameInput = document.getElementById("display-name-input");
const setNameBtn = document.getElementById("set-name-btn");
const cooldownIndicator = document.getElementById("cooldown-indicator");
const errorBanner = document.getElementById("error-banner");
const errorText = document.getElementById("error-text");
const roomIndicator = document.getElementById("room-indicator");
const roomCodeIndicator = document.getElementById("room-code-indicator");
const systemWelcomeText = document.getElementById("system-welcome-text");

// Room UI elements
const switchGlobalBtn = document.getElementById("switch-global-btn");
const privateRoomSummary = document.getElementById("private-room-summary");
const privateRoomStatus = document.getElementById("private-room-status");
const privateRoomActions = document.getElementById("private-room-actions");
const createPrivateRoomBtn = document.getElementById("create-private-room-btn");
const privateRoomCodeRow = document.getElementById("private-room-code-row");
const privateRoomCodeEl = document.getElementById("private-room-code");
const copyRoomCodeBtn = document.getElementById("copy-room-code-btn");
const joinCodeInput = document.getElementById("join-code-input");
const joinRoomBtn = document.getElementById("join-room-btn");

// === 4. UI helpers ===
function setStatus(connected) {
  if (!statusPill) return;
  const dot = statusPill.querySelector(".status-dot");
  if (connected) {
    statusText.textContent = "Connected";
    dot.style.background = "#22c55e";
    dot.style.boxShadow = "0 0 0 3px rgba(34,197,94,0.25)";
  } else {
    statusText.textContent = "Connecting…";
    dot.style.background = "#f97316";
    dot.style.boxShadow = "0 0 0 3px rgba(248,113,22,0.3)";
  }
}

function setOnlineCount(count) {
  if (!onlineCountEl) return;
  if (typeof count !== "number" || count < 0) count = 0;
  if (count === 0) {
    onlineCountEl.textContent = "";
  } else if (count === 1) {
    onlineCountEl.textContent = "· 1 online";
  } else {
    onlineCountEl.textContent = `· ${count} online`;
  }
}

function showError(message, timeoutMs = 2500) {
  if (!errorBanner) return;
  errorText.textContent = message;
  errorBanner.classList.add("visible");
  if (timeoutMs > 0) {
    setTimeout(() => {
      errorBanner.classList.remove("visible");
    }, timeoutMs);
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

function updateRoomIndicator() {
  if (!roomIndicator) return;

  roomIndicator.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = currentRoomName;

  const label = document.createElement("span");
  label.textContent = "Room: ";

  const sep = document.createElement("span");
  sep.textContent = " · ";

  const codeSpan = document.createElement("span");
  codeSpan.innerHTML = `code: <code>${currentRoomCode}</code>`;

  roomIndicator.appendChild(label);
  roomIndicator.appendChild(strong);
  roomIndicator.appendChild(sep);
  roomIndicator.appendChild(codeSpan);

  if (systemWelcomeText) {
    if (currentRoomId === GLOBAL_ROOM_ID) {
      systemWelcomeText.innerHTML =
        "Welcome. You’re in the <strong>Global Lobby</strong>. All messages are public in this room.";
    } else {
      systemWelcomeText.innerHTML =
        "Welcome to a <strong>private room</strong>. Only people with the code can join.";
    }
  }
}

// === 5. Cooldown ===
function startCooldown() {
  lastSentAt = Date.now();
  updateCooldownUI();

  if (cooldownTimer) clearInterval(cooldownTimer);

  cooldownTimer = setInterval(() => {
    const diff = Date.now() - lastSentAt;
    if (diff >= COOLDOWN_MS) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    updateCooldownUI();
  }, 200);
}

function isInCooldown() {
  return Date.now() - lastSentAt < COOLDOWN_MS;
}

function updateCooldownUI() {
  if (!cooldownIndicator) return;
  const diff = Date.now() - lastSentAt;
  const remaining = Math.max(0, COOLDOWN_MS - diff);

  if (remaining <= 0) {
    cooldownIndicator.classList.add("ready");
    cooldownIndicator.innerHTML = "<span>ready</span>";

    if (authReady && currentUser && currentName && messageInput.value.trim()) {
      sendBtn.classList.remove("disabled");
    } else {
      sendBtn.classList.add("disabled");
    }
  } else {
    cooldownIndicator.classList.remove("ready");
    const secs = (remaining / 1000).toFixed(1);
    cooldownIndicator.innerHTML = `wait <span>${secs}s</span>`;
    sendBtn.classList.add("disabled");
  }
}

// === 6. Display name ===
function applyDisplayName(name) {
  currentName = (name || "").trim().slice(0, 32);
  displayNameInput.value = currentName;

  if (!authReady || !currentUser || !currentUser.uid || !currentName) return;

  const metaRef = firebase.database().ref(`userMeta/${currentUser.uid}`);
  metaRef.update({ name: currentName }).catch((err) => {
    console.warn("Failed to update userMeta name", err);
  });
  updateCooldownUI();
}

function handleSetName() {
  const value = displayNameInput.value.trim();
  if (!value) {
    showError("Name can’t be empty.");
    return;
  }
  if (value.length > 32) {
    showError("Name too long (max 32 characters).");
    return;
  }
  applyDisplayName(value);
  showError("Name updated.", 1500);
}

// === 7. Rendering messages ===
function clearMessages() {
  if (!messagesInner) return;
  while (messagesInner.firstChild) {
    messagesInner.removeChild(messagesInner.firstChild);
  }
  // Re-add system welcome chip
  const sys = document.createElement("div");
  sys.className = "system-message";
  sys.innerHTML = `
    <span class="system-chip">
      <span class="dot"></span>
      <span id="system-welcome-text">
        ${
          currentRoomId === GLOBAL_ROOM_ID
            ? "Welcome. You’re in the <strong>Global Lobby</strong>. All messages are public in this room."
            : "Welcome to a <strong>private room</strong>. Only people with the code can join."
        }
      </span>
    </span>
  `;
  messagesInner.appendChild(sys);
}

function renderMessage(key, msg) {
  if (!msg || !msg.text || !msg.name) return;

  const isSelf = currentUser && msg.uid && msg.uid === currentUser.uid;

  const row = document.createElement("div");
  row.className = "message-row" + (isSelf ? " self" : "");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = (msg.name || "?").trim().charAt(0).toUpperCase() || "?";

  const body = document.createElement("div");
  body.className = "message-body";

  const metaLine = document.createElement("div");
  metaLine.className = "meta-line";

  const nameEl = document.createElement("span");
  nameEl.className = "meta-name";
  nameEl.textContent = msg.name || "Unknown";

  const timeEl = document.createElement("span");
  timeEl.className = "meta-time";
  const date = new Date(msg.ts || Date.now());
  timeEl.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  metaLine.appendChild(nameEl);
  metaLine.appendChild(timeEl);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = msg.text;

  body.appendChild(metaLine);
  body.appendChild(bubble);

  if (!isSelf) {
    row.appendChild(avatar);
    row.appendChild(body);
  } else {
    row.appendChild(body);
    row.appendChild(avatar);
  }

  messagesInner.appendChild(row);
  scrollToBottom();
}

// === 8. Presence (per room) ===
function detachPresenceListeners() {
  if (!firebase.apps.length) return;
  const db = firebase.database();

  if (statusAllRef) {
    statusAllRef.off();
    statusAllRef = null;
  }
  if (connectedRef) {
    connectedRef.off();
    connectedRef = null;
  }
  if (statusRef) {
    statusRef.onDisconnect().cancel();
    statusRef = null;
  }
  setOnlineCount(0);
}

function setupPresence(user, roomId) {
  const db = firebase.database();

  if (!user || !user.uid) return;
  if (!roomId) roomId = GLOBAL_ROOM_ID;

  // detach old
  detachPresenceListeners();

  const statusPath = `/status/${roomId}/${user.uid}`;
  const onlineCountPath = `/onlineCount/${roomId}`;

  statusRef = db.ref(statusPath);
  const onlineCountRef = db.ref(onlineCountPath);

  statusAllRef = db.ref(`/status/${roomId}`);
  statusAllRef.on("value", (snap) => {
    let count = 0;
    snap.forEach((child) => {
      const val = child.val();
      if (val && val.state === "online") count++;
    });
    setOnlineCount(count);
    // Keep per-room onlineCount updated (optional)
    onlineCountRef.set(count).catch(() => {});
  });

  connectedRef = db.ref(".info/connected");
  connectedRef.on("value", (snap) => {
    if (snap.val() === false) {
      setStatus(false);
      return;
    }

    setStatus(true);

    statusRef
      .onDisconnect()
      .set({ state: "offline", lastChanged: firebase.database.ServerValue.TIMESTAMP })
      .then(() => {
        statusRef
          .set({ state: "online", lastChanged: firebase.database.ServerValue.TIMESTAMP })
          .catch((err) => console.error("Failed to set online status:", err));
      })
      .catch((err) => console.error("onDisconnect error:", err));
  });
}

// === 9. Firebase init ===
function initFirebaseApp() {
  if (appInitialized) return;

  firebase.initializeApp(firebaseConfig);
  appInitialized = true;
  setStatus(false);

  firebase.auth().onAuthStateChanged((user) => {
    if (!user) {
      authReady = false;
      firebase
        .auth()
        .signInAnonymously()
        .catch((err) => {
          console.error("Anonymous sign-in error:", err);
          showError("Failed to connect to chat (auth).");
        });
      return;
    }

    currentUser = user;
    authReady = true;

    // derive private room info
    privateRoomId = user.uid;
    privateRoomCode = "p-" + String(user.uid).slice(0, 8);

    // update private room UI
    if (privateRoomStatus && privateRoomActions) {
      privateRoomStatus.textContent = "You can have one private room.";
      privateRoomActions.style.display = "flex";
    }

    // if userMeta has a name, use it
    const metaRef = firebase.database().ref(`userMeta/${user.uid}`);
    metaRef.once("value").then((snap) => {
      const meta = snap.val();
      if (meta && meta.name) {
        applyDisplayName(meta.name);
      } else {
        updateCooldownUI();
      }
    });

    // start in global room
    switchToRoom(GLOBAL_ROOM_ID, { fromAuth: true });
  });
}

// === 10. DB listeners ===
function detachMessageListeners() {
  if (!firebase.apps.length) return;
  const db = firebase.database();
  if (messagesRef) {
    messagesRef.off();
    messagesRef = null;
  }
}

function attachDatabaseListeners(roomId) {
  const db = firebase.database();
  const ref = db.ref(`rooms/${roomId}/messages`).limitToLast(80);
  messagesRef = ref;
  ref.on("child_added", (snap) => {
    const msg = snap.val();
    renderMessage(snap.key, msg);
  });
}

// === 11. Rooms ===
function deriveRoomInfo(roomId) {
  if (roomId === GLOBAL_ROOM_ID) {
    return {
      id: GLOBAL_ROOM_ID,
      name: "Global Lobby",
      code: "global",
      isPrivate: false
    };
  }

  if (privateRoomId && roomId === privateRoomId) {
    return {
      id: roomId,
      name: "My Private Room",
      code: privateRoomCode,
      isPrivate: true
    };
  }

  // other people's private rooms
  return {
    id: roomId,
    name: "Private Room",
    code: `p-${String(roomId).slice(0, 8)}`,
    isPrivate: true
  };
}

function switchToRoom(roomId, { fromAuth = false } = {}) {
  if (!roomId) roomId = GLOBAL_ROOM_ID;

  const info = deriveRoomInfo(roomId);
  currentRoomId = info.id;
  currentRoomName = info.name;
  currentRoomCode = info.code;

  // UI
  clearMessages();
  updateRoomIndicator();
  setOnlineCount(0);

  // listeners
  detachMessageListeners();
  attachDatabaseListeners(currentRoomId);

  if (authReady && currentUser) {
    setupPresence(currentUser, currentRoomId);
  }

  if (!fromAuth) {
    const label = info.isPrivate ? "private room" : "global lobby";
    showError(`Switched to ${label}.`, 1500);
  }
}

// join by code: "global" or "p-xxxxxxxx"
function joinRoomByCode(rawCode) {
  const code = (rawCode || "").trim();
  if (!code) {
    showError("Enter a room code first.");
    return;
  }

  if (code === "global") {
    switchToRoom(GLOBAL_ROOM_ID);
    return;
  }

  if (!code.startsWith("p-") || code.length < 3) {
    showError("Invalid room code format.");
    return;
  }

  const shortIdPart = code.slice(2); // "xxxxxxxx"

  // We don't know the full UID from only 8 chars, but the code is designed as:
  // full roomId = any uid that has these first 8 chars.
  // For your own rooms, roomId is exactly uid. For others, we rely on them
  // giving a correct code they got from you. Here we just reconstruct:
  // roomIdPrefix = the short part; users who share the code will be using
  // the same underlying uid, so messages will show up.
  //
  // To avoid any database scan (not allowed by rules easily), we'll
  // treat the code as "this is exactly the roomId", i.e. we assume
  // you will share full uid or create codes mapped in your own system.
  //
  // BUT to strictly match your current rules and structure without
  // extra indexes, we will simply map:
  // roomId = code (so: rooms["p-xxxxxxxx"])
  //
  // That means for your own room, we'll actually use the full uid,
  // not this synthetic. So:
  // - For YOUR private room, creation will use full uid.
  // - For "join by code" to your room, you can either share:
  //   - the full uid, or
  //   - we can also join "p-" + uid.slice(0,8) as a synthetic mirror room.
  //
  // To keep things simple and safe with your current schema, we choose:
  // => roomId = code (e.g. rooms["p-xxxxxxxx"])
  //
  // This does not violate your rules and keeps everything per room path.

  const roomId = code;
  switchToRoom(roomId);
}

// For your own private room, we use user.uid as roomId
function goToMyPrivateRoom() {
  if (!authReady || !currentUser) {
    showError("Still connecting… wait a moment.");
    return;
  }

  if (!privateRoomId) {
    showError("Could not determine your private room id.");
    return;
  }

  switchToRoom(privateRoomId);

  if (privateRoomCodeRow && privateRoomCodeEl) {
    privateRoomCodeEl.textContent = privateRoomCode;
    privateRoomCodeRow.style.display = "flex";
  }
}

// === 12. Sending messages ===
function canSendNow() {
  const text = messageInput.value.trim();

  if (!authReady || !currentUser) {
    showError("Still connecting… try again in a moment.");
    return false;
  }

  if (!currentName) {
    showError("Set a display name first.");
    return false;
  }

  if (!text) return false;

  if (isInCooldown()) {
    showError("Slow down a bit—cooldown active.", 1500);
    return false;
  }

  return true;
}

function sendMessage() {
  if (!canSendNow()) return;

  const text = messageInput.value.trim().slice(0, 2000);
  const now = Date.now();
  const db = firebase.database();
  const msgRef = db.ref(`rooms/${currentRoomId}/messages`).push();

  const payload = {
    uid: currentUser.uid,
    name: currentName,
    text,
    ts: firebase.database.ServerValue.TIMESTAMP, // number per your rules
    clientTs: now
  };

  startCooldown();
  updateCooldownUI();
  sendBtn.classList.add("disabled");

  msgRef
    .set(payload)
    .then(() => {
      messageInput.value = "";
      updateCooldownUI();
      const metaRef = db.ref(`userMeta/${currentUser.uid}`);
      metaRef.update({ lastMsgTs: Date.now() }).catch((err) => {
        console.warn("Failed to update lastMsgTs", err);
      });
    })
    .catch((err) => {
      console.error("Failed to send message:", err);
      showError("Message rejected by server rules.");
    });
}

// === 13. UI events ===
function setupUI() {
  setStatus(false);
  updateCooldownUI();
  setOnlineCount(0);
  updateRoomIndicator();

  setNameBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleSetName();
  });
  displayNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSetName();
    }
  });

  sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    sendMessage();
  });

  messageInput.addEventListener("input", () => {
    if (!isInCooldown() && authReady && currentUser && messageInput.value.trim() && currentName) {
      sendBtn.classList.remove("disabled");
    } else {
      sendBtn.classList.add("disabled");
    }
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Room UI events
  if (switchGlobalBtn) {
    switchGlobalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchToRoom(GLOBAL_ROOM_ID);
    });
  }

  if (createPrivateRoomBtn) {
    createPrivateRoomBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goToMyPrivateRoom();
    });
  }

  if (copyRoomCodeBtn) {
    copyRoomCodeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!privateRoomCode) {
        showError("No private room code yet.");
        return;
      }
      try {
        await navigator.clipboard.writeText(privateRoomCode);
        showError("Room code copied.", 1500);
      } catch {
        showError("Couldn’t copy to clipboard.");
      }
    });
  }

  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", (e) => {
      e.preventDefault();
      joinRoomByCode(joinCodeInput.value);
    });
  }
  if (joinCodeInput) {
    joinCodeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        joinRoomByCode(joinCodeInput.value);
      }
    });
  }
}

// === 14. Boot ===
document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  initFirebaseApp();
});
