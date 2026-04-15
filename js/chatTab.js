/**
 * chatTab.js — renders the inline 💬 Chat tab on index.html
 * Reads user data from auth.js via the "userProfileUpdated" event.
 * Full chat experience lives on chat.html.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { CHAT_HANDLE_RE, ensureUserChatHandle, getPreferredChatHandle, looksLikeUid, normalizeChatHandle } from "./chatHandle.js";
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const { useState, useCallback } = React;
const h = React.createElement;

const GOLD_MIN_EARNED = 300;
let chatTabRoot = null;

function hasAccess(userData) {
  const totalEarned   = userData.totalEarned || 0;
  const referralCount = (userData.referrals || []).length;
  return totalEarned >= GOLD_MIN_EARNED || referralCount >= 1;
}

// ── Locked view (no interactive state needed) ─────────────────────────────────
function LockedView() {
  return h("div", { className: "surface text-center py-16 max-w-lg mx-auto" },
    h("div", {
      className: "w-16 h-16 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4",
    }, "🔒"),
    h("h2", { className: "text-xl font-black text-white mb-2" }, "Private Chat"),
    h("p", { className: "text-gray-400 text-sm max-w-sm mx-auto mb-5 leading-relaxed" },
      "Chat is available to users with ",
      h("strong", { className: "text-amber-300" }, "Gold rank"),
      " (300+ lifetime credits) or at least ",
      h("strong", { className: "text-emerald-300" }, "1 successful referral"),
      "."
    ),
    h("div", { className: "flex flex-wrap gap-3 justify-center" },
      h("a", {
        href: "share.html",
        className: "px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors",
      }, "🔗 Share a Link (+50 🪙)")
    )
  );
}

// ── Chat tab: controlled inputs + copy-button state via useState ───────────────
function ChatView({ user, myHandle }) {
  const [copied, setCopied]           = useState(false);
  const [partnerInput, setPartnerInput] = useState("");
  const [errorText, setErrorText]     = useState("");

  const myUid = user.uid;

  const handleCopyHandle = useCallback(() => {
    navigator.clipboard.writeText(myHandle).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [myHandle]);

  const doOpenChat = useCallback(() => {
    setErrorText("");
    const partnerId = partnerInput.trim();
    if (!partnerId) {
      setErrorText("Please enter a Chat ID.");
      return;
    }
    const normalized = normalizeChatHandle(partnerId);
    if (partnerId === myUid || normalized === myHandle) {
      setErrorText("You can't chat with yourself.");
      return;
    }
    if (!looksLikeUid(partnerId) && !CHAT_HANDLE_RE.test(normalized)) {
      setErrorText("Use a handle like verb-adjective-123456 or a UID.");
      return;
    }
    window.location.href = `chat.html?partner=${encodeURIComponent(partnerId)}`;
  }, [partnerInput, myUid, myHandle]);

  return h("div", { className: "surface max-w-lg mx-auto" },
    // Header
    h("div", { className: "flex items-center gap-3 mb-6" },
      h("div", {
        className: "w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center text-2xl",
      }, "💬"),
      h("div", null,
        h("h2", { className: "text-xl font-black text-white" }, "Private Chat"),
        h("p", { className: "text-xs text-gray-500" }, "End-to-end private · Auto-deleted after 6 hours")
      )
    ),

    // Chat Handle display + copy button (useState-driven label)
    h("div", { className: "mb-5 p-4 bg-gray-900/60 border border-gray-700 rounded-2xl" },
      h("div", {
        className: "text-xs text-gray-500 uppercase font-bold tracking-widest mb-2",
      }, "Your Chat Handle"),
      h("div", { className: "flex items-center gap-2" },
        h("code", {
          id: "tabMyChatId",
          className: "flex-1 text-sm font-mono text-blue-300 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/30 select-all truncate",
        }, myHandle),
        h("button", {
          id: "tabCopyIdBtn",
          className: "text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors whitespace-nowrap shrink-0",
          onClick: handleCopyHandle,
        }, copied ? "✓ Copied!" : "📋 Copy")
      ),
      h("p", { className: "text-[11px] text-gray-600 mt-2" },
        "Share this handle so people can add you without typing a long UID."
      ),
      h("p", { className: "text-[11px] text-gray-600 mt-1" },
        "Fallback UID: ",
        h("code", { className: "font-mono" }, myUid)
      )
    ),

    // Partner input (controlled) + open chat button
    h("div", null,
      h("label", {
        className: "block text-xs text-gray-400 mb-2 font-semibold uppercase tracking-widest",
      }, "Start a Conversation"),
      h("div", { className: "flex gap-2" },
        h("input", {
          id: "tabPartnerInput",
          type: "text",
          placeholder: "Enter partner handle or UID…",
          value: partnerInput,
          onChange: (e) => setPartnerInput(e.target.value),
          onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); doOpenChat(); } },
          className: "flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 transition font-mono",
        }),
        h("button", {
          id: "tabOpenChatBtn",
          className: "px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors whitespace-nowrap shrink-0",
          onClick: doOpenChat,
        }, "Open Chat →")
      ),
      // Inline error message — no DOM manipulation needed, driven by state
      errorText
        ? h("p", { id: "tabChatError", className: "text-xs text-red-400 mt-2" }, errorText)
        : null
    )
  );
}

// ── renderChatTab: creates/updates the React root ─────────────────────────────
function renderChatTab(user, userData) {
  const container = document.getElementById("chatTabContent");
  if (!container) return;

  if (!chatTabRoot) {
    chatTabRoot = createRoot(container);
  }

  const myHandle = getPreferredChatHandle(userData, user.uid);

  if (!hasAccess(userData)) {
    chatTabRoot.render(h(LockedView, null));
    return;
  }

  chatTabRoot.render(h(ChatView, { user, userData, myHandle }));
}

// ── Init ───────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  let userData = {};
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) userData = snap.data();
  } catch (_) {}
  await ensureUserChatHandle(user.uid, userData);
  userData.chatHandle = getPreferredChatHandle(userData, user.uid);
  userData.chatHandleLower = userData.chatHandle;

  // Initial render
  renderChatTab(user, userData);

  // Re-render if profile updates (e.g. referral added during session)
  window.addEventListener("userProfileUpdated", (e) => {
    renderChatTab(user, e.detail || userData);
  });
});
