// === 1. Firebase config ===
// Replace this with your project's config from the Firebase console.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// === 2. App State ===
const ROOM_ID = "global";                // single global room
const COOLDOWN_MS = 3000;                // 3 second client cooldown

let appInitialized = false;
let currentUser = null;
let currentName = "";
let lastSentAt = 0;
let cooldownTimer = null;

// === 3. DOM references ===
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const messagesContainer = document.getElementById("messages-container");
const messagesInner = document.getElementById("messages-inner");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const displayNameInput = document.getElementById("display-name-input");
const setNameBtn = document.getElementById("set-name-btn");
const cooldownIndicator = document.getElementById("cooldown-indicator");
const errorBanner = document.getElementById("error-banner");
const errorText = document.getElementById("error-text");

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

function showError(message, timeoutMs = 3000) {
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

// === 4. Cooldown handling ===
function startCooldown() {
  lastSentAt = Date.now();
  updateCooldownUI();

  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }

  cooldownTimer = setInterval(() => {
    const now = Date.now();
    const diff = now - lastSentAt;
    if (diff >= COOLDOWN_MS) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    updateCooldownUI();
  }, 200);
}

function isInCooldown() {
  const diff = Date.now() - lastSentAt;
  return diff < COOLDOWN_MS;
}

function updateCooldownUI() {
  const diff = Date.now() - lastSentAt;
  const remaining = Math.max(0, COOLDOWN_MS - diff);

  if (remaining <= 0) {
    cooldownIndicator.classList.add("ready");
    cooldownIndicator.innerHTML = "<span>ready</span>";
    if (messageInput.value.trim() && currentName) {
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

// === 5. Name handling ===
function applyDisplayName(name) {
  currentName = (name || "").trim().slice(0, 32);
  displayNameInput.value = currentName;

  if (!currentUser || !currentUser.uid) return;

  if (!currentName) return;

  // Save to userMeta so rules can read consistent name
  const metaRef = firebase.database().ref(`userMeta/${currentUser.uid}`);
  metaRef.update({ name: currentName }).catch((err) => {
    console.error("Failed to update userMeta name", err);
  });
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
  updateCooldownUI();
}

// === 6. Message rendering ===
function renderMessage(msgKey, msg) {
  if (!msg || !msg.text || !msg.uid || !msg.name) return;

  const isSelf = currentUser && msg.uid === currentUser.uid;

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

// === 7. Firebase initialization & listeners ===
function initFirebaseApp() {
  if (appInitialized) return;
  firebase.initializeApp(firebaseConfig);
  appInitialized = true;

  setStatus(false);

  // Anonymous auth
  firebase.auth().onAuthStateChanged((user) => {
    if (!user) {
      firebase.auth().signInAnonymously().catch((err) => {
        console.error("Anonymous sign-in error:", err);
        showError("Failed to sign in anonymously.");
      });
      return;
    }

    currentUser = user;

    // Try to load existing name
    const metaRef = firebase.database().ref(`userMeta/${user.uid}`);
    metaRef.once("value").then((snap) => {
      const meta = snap.val();
      if (meta && meta.name) {
        applyDisplayName(meta.name);
      }
    });

    attachDatabaseListeners();
  });
}

function attachDatabaseListeners() {
  const db = firebase.database();

  // Connection status
  const connectedRef = db.ref(".info/connected");
  connectedRef.on("value", (snap) => {
    const conn = snap.val() === true;
    setStatus(conn);
  });

  // Messages for the global room
  const messagesRef = db.ref(`rooms/${ROOM_ID}/messages`).limitToLast(80);
  messagesRef.on("child_added", (snap) => {
    const msg = snap.val();
    renderMessage(snap.key, msg);
  });
}

// === 8. Sending a message ===
function canSendNow() {
  const text = messageInput.value.trim();
  if (!currentUser) {
    showError("Not signed in yet. Please wait…");
    return false;
  }
  if (!currentName) {
    showError("Set a display name first.");
    return false;
  }
  if (!text) {
    return false;
  }
  if (isInCooldown()) {
    // Let UI show the remaining cooldown
    showError("Slow down a bit—cooldown active.", 1500);
    return false;
  }
  return true;
}

function sendMessage() {
  if (!canSendNow()) {
    return;
  }

  const text = messageInput.value.trim().slice(0, 2000);
  const now = Date.now();

  const db = firebase.database();
  const msgRef = db.ref(`rooms/${ROOM_ID}/messages`).push();

  const payload = {
    uid: currentUser.uid,
    name: currentName,
    text,
    ts: firebase.database.ServerValue.TIMESTAMP,
    clientTs: now
  };

  // Optimistic cooldown
  startCooldown();
  updateCooldownUI();
  sendBtn.classList.add("disabled");

  msgRef
    .set(payload)
    .then(() => {
      // Clear the input only after a successful send
      messageInput.value = "";
      updateCooldownUI();

      // Update userMeta.lastMsgTs so rules can enforce future spacing
      const metaRef = db.ref(`userMeta/${currentUser.uid}`);
      metaRef.update({ lastMsgTs: Date.now() }).catch((err) => {
        console.warn("Failed to update lastMsgTs", err);
      });
    })
    .catch((err) => {
      console.error("Failed to send message:", err);
      showError("Message rejected by server rules.");
      // roll back cooldown timer if you want (optional)
    });
}

// === 9. Event bindings ===
function setupUI() {
  setStatus(false);
  updateCooldownUI();

  setNameBtn.addEventListener("click", handleSetName);
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
    // Only enable send if not in cooldown and we have text + name
    if (!isInCooldown() && messageInput.value.trim() && currentName) {
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
}

// === 10. Boot ===
document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  initFirebaseApp();
});
