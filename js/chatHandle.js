import { db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const VERBS = [
  "dash", "build", "solve", "spark", "jump", "play", "orbit", "code", "drive", "dream",
  "trace", "shift", "climb", "focus", "learn", "share", "zoom", "glide", "craft", "grow",
];

const ADJECTIVES = [
  "brave", "swift", "bright", "calm", "cosmic", "lucky", "bold", "neon", "golden", "chill",
  "wild", "stellar", "frosty", "sunny", "proud", "silent", "rapid", "smart", "kind", "epic",
];

export const CHAT_HANDLE_RE = /^[a-z]+-[a-z]+-\d{6}$/;

export function normalizeChatHandle(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

export function looksLikeUid(value) {
  return /^[a-zA-Z0-9_\-]{20,128}$/.test(String(value || "").trim());
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildChatHandleFromUid(uid) {
  const h = hashString(String(uid || ""));
  const verb = VERBS[h % VERBS.length];
  const adjective = ADJECTIVES[(h >>> 7) % ADJECTIVES.length];
  const number = String((h >>> 12) % 1000000).padStart(6, "0");
  return `${verb}-${adjective}-${number}`;
}

export function getPreferredChatHandle(userData, uid) {
  const existing = normalizeChatHandle(userData?.chatHandle || userData?.chatHandleLower || "");
  if (CHAT_HANDLE_RE.test(existing)) return existing;
  return buildChatHandleFromUid(uid);
}

export async function ensureUserChatHandle(uid, userData) {
  if (!uid) return null;
  const handle = getPreferredChatHandle(userData, uid);
  const currentHandle = normalizeChatHandle(userData?.chatHandle || "");
  const currentLower = normalizeChatHandle(userData?.chatHandleLower || "");
  if (currentHandle === handle && currentLower === handle) return handle;
  try {
    await updateDoc(doc(db, "users", uid), {
      chatHandle: handle,
      chatHandleLower: handle,
    });
  } catch (_) {}
  return handle;
}
