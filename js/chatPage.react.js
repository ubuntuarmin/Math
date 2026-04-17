import React from "https://esm.sh/react@18.3.1";
import { flushSync } from "https://esm.sh/react-dom@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const CHAT_PAGE_HTML = `
<div class="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
  <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]"></div>
  <div class="absolute bottom-[10%] right-[-5%] w-[30%] h-[30%] bg-purple-600/10 rounded-full blur-[100px]"></div>
</div>

<header class="site-header">
  <nav class="navbar">
    <a href="index.html" class="navbar-brand">
      <span class="navbar-brand-logo">📐</span>
      <span class="navbar-brand-text">Math Katy</span>
    </a>
    <a href="index.html" class="btn-outline text-xs">← Back</a>
  </nav>
</header>

<main class="flex-1">
  <div class="container max-w-2xl py-6">
    <div id="accessGate" class="surface text-center py-16 hidden">
      <div class="w-16 h-16 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🔒</div>
      <h2 class="text-xl font-black text-white mb-2">Gold Rank or 1 Referral Required</h2>
      <p class="text-gray-400 text-sm max-w-sm mx-auto mb-5 leading-relaxed">
        Private chat is available to users with <strong class="text-amber-300">Gold rank</strong> (300+ lifetime credits)
        or at least <strong class="text-emerald-300">1 successful referral</strong>.
      </p>
      <div class="flex flex-wrap gap-3 justify-center">
        <a href="share.html" class="px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors">
          🔗 Share a Link (+50 🪙)
        </a>
        <a href="index.html" class="px-5 py-2.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold text-sm transition-colors">
          ← Back to Dashboard
        </a>
      </div>
    </div>

    <div id="chatLoading" class="text-center py-20">
      <div class="inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p class="mt-4 text-gray-500 text-sm">Loading chat…</p>
    </div>

    <div id="chatApp" class="hidden space-y-4">
      <div class="surface">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-xs text-gray-500 uppercase font-bold tracking-widest mb-1">Your Chat Handle</div>
            <div class="flex items-center gap-2">
              <code id="myChatId" class="text-sm font-mono text-blue-300 bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/30 select-all"></code>
              <button id="copyIdBtn" title="Copy Chat Handle" class="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">📋 Copy</button>
            </div>
            <p class="text-xs text-gray-600 mt-1">Share this handle so people can find you fast (example: verb-adjective-123456).</p>
            <p class="text-[11px] text-gray-600 mt-1">Fallback UID: <code id="myUidValue" class="font-mono"></code></p>
          </div>
          <div class="text-2xl">💬</div>
        </div>
      </div>

      <div class="surface" id="startChatPanel">
        <h3 class="text-sm font-bold text-white mb-3">Start a Private Chat</h3>
        <div class="flex gap-2">
          <input id="partnerIdInput" type="text" placeholder="Enter partner handle or UID…" class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 transition font-mono" />
          <button id="startChatBtn" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors whitespace-nowrap">Open Chat</button>
        </div>
        <p id="startChatError" class="text-xs text-red-400 mt-2 hidden"></p>
        <div class="mt-4 pt-4 border-t border-gray-800">
          <div class="text-[11px] text-gray-500 uppercase tracking-widest font-bold mb-2">Saved Conversations</div>
          <div id="savedChatsList" class="space-y-2">
            <p class="text-xs text-gray-600">No saved conversations yet.</p>
          </div>
        </div>
      </div>

      <div id="chatRoom" class="hidden surface p-0 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <div class="text-xs text-gray-500 uppercase tracking-widest font-bold mb-0.5">Chatting with</div>
            <div id="partnerLabel" class="text-sm font-bold text-white font-mono truncate max-w-[200px]"></div>
            <div id="partnerStatus" class="text-[11px] text-gray-500 mt-1">Offline</div>
            <div class="mt-2 flex items-center gap-2">
              <input id="partnerNicknameInput" type="text" placeholder="Set nickname…" class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500 transition w-36" />
              <button id="saveNicknameBtn" class="text-[11px] px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors">Save</button>
            </div>
          </div>
          <button id="closeChatBtn" class="text-gray-500 hover:text-red-400 text-xs transition-colors px-2 py-1">✕ Close</button>
        </div>

        <div id="chatMessages" class="flex flex-col gap-3 p-4 h-[360px] overflow-y-auto">
          <div class="text-center text-gray-600 text-xs py-8" id="noMessages">No messages yet — say hello! 👋</div>
        </div>
        <div id="typingStatus" class="px-4 py-1 text-[11px] text-gray-500 h-6"></div>

        <div class="px-4 py-1.5 bg-gray-900/50 border-t border-gray-800/50">
          <p class="text-[10px] text-gray-600">Messages are moderated. Keep it respectful 🤝 · Auto-deleted after 6 hours.</p>
        </div>

        <div class="flex items-end gap-2 p-3 border-t border-gray-800">
          <textarea id="chatInput" rows="1" placeholder="Type a message…" maxlength="500" class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white resize-none outline-none focus:border-blue-500 transition min-h-[42px] max-h-[100px]"></textarea>
          <button id="sendBtn" class="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-sm transition-all whitespace-nowrap shrink-0">Send ↑</button>
        </div>
      </div>
    </div>
  </div>
</main>

<footer class="site-footer">
  <div class="site-footer-inner">
    <span>© 2026 Math Katy</span>
  </div>
</footer>
`;

const rootEl = document.getElementById("react-root");
if (rootEl) {
  const root = createRoot(rootEl);
  flushSync(() => {
    root.render(React.createElement("div", {
      dangerouslySetInnerHTML: { __html: CHAT_PAGE_HTML },
    }));
  });
  await import("./chat.js");
}
