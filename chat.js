// === 1. Firebase config ===
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "mathchat2351.firebaseapp.com",
  databaseURL: "https://mathchat2351-default-rtdb.firebaseio.com",
  projectId: "mathchat2351",
  storageBucket: "mathchat2351.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// === 2. App State ===
const ROOM_ID = "global";
const COOLDOWN_MS = 3000; // 3s cooldown

let appInitialized = false;
let authReady = false;
let currentUser = null;
let currentName = "";
let lastSentAt = 0;
let cooldownTimer = null;

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
  const diff = Date.now() - lastSentAt;
  const remaining = Math.max(0, COOLDOWN_MS - diff);

  if (remaining <= 0) {
    cooldownIndicator.classList.add("ready");
    cooldownIndicator.innerHTML = "<span>ready</span>";

    // enable only if everything is ready
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

// === 8. Presence ===
function setupPresence(user) {
  const db = firebase.database();
  const statusRef = db.ref(`/status/${user.uid}`);
  const onlineCountRef = db.ref("/onlineCount");

  const statusAllRef = db.ref("/status");
  statusAllRef.on("value", (snap) => {
    let count = 0;
    snap.forEach((child) => {
      const val = child.val();
      if (val && val.state === "online") count++;
    });
    setOnlineCount(count);
    // Keep onlineCount updated (optional)
    onlineCountRef.set(count).catch(() => {});
  });

  const connectedRef = db.ref(".info/connected");
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

    const metaRef = firebase.database().ref(`userMeta/${user.uid}`);
    metaRef.once("value").then((snap) => {
      const meta = snap.val();
      if (meta && meta.name) {
        applyDisplayName(meta.name);
      } else {
        updateCooldownUI();
      }
    });

    attachDatabaseListeners();
    setupPresence(user);
  });
}

// === 10. DB listeners ===
function attachDatabaseListeners() {
  const db = firebase.database();
  const messagesRef = db.ref(`rooms/${ROOM_ID}/messages`).limitToLast(80);
  messagesRef.on("child_added", (snap) => {
    const msg = snap.val();
    renderMessage(snap.key, msg);
  });
}

// === 11. Sending messages ===
function canSendNow() {
  const text = messageInput.value.trim();

  if (!authReady || !currentUser) {
    // show once in a while, not spamming
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
  const msgRef = db.ref(`rooms/${ROOM_ID}/messages`).push();

  const payload = {
    uid: currentUser.uid,
    name: currentName,
    text,
    ts: firebase.database.ServerValue.TIMESTAMP,
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

// === 12. UI events ===
function setupUI() {
  setStatus(false);
  updateCooldownUI();
  setOnlineCount(0);

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
}

// === 13. Boot ===
document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  initFirebaseApp();
});
