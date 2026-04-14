/**
 * chatTab.js — renders the inline 💬 Chat tab on index.html
 * Reads user data from auth.js via the "userProfileUpdated" event.
 * Full chat experience lives on chat.html.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const GOLD_MIN_EARNED = 300;

function hasAccess(userData) {
  const totalEarned   = userData.totalEarned || 0;
  const referralCount = (userData.referrals || []).length;
  return totalEarned >= GOLD_MIN_EARNED || referralCount >= 1;
}

function renderChatTab(user, userData) {
  const container = document.getElementById("chatTabContent");
  if (!container) return;

  if (!hasAccess(userData)) {
    container.innerHTML = `
      <div class="surface text-center py-16 max-w-lg mx-auto">
        <div class="w-16 h-16 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🔒</div>
        <h2 class="text-xl font-black text-white mb-2">Private Chat</h2>
        <p class="text-gray-400 text-sm max-w-sm mx-auto mb-5 leading-relaxed">
          Chat is available to users with <strong class="text-amber-300">Gold rank</strong>
          (300+ lifetime credits) or at least <strong class="text-emerald-300">1 successful referral</strong>.
        </p>
        <div class="flex flex-wrap gap-3 justify-center">
          <a href="share.html" class="px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors">
            🔗 Share a Link (+50 🪙)
          </a>
        </div>
      </div>`;
    return;
  }

  const myUid = user.uid;
  container.innerHTML = `
    <div class="surface max-w-lg mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center text-2xl">💬</div>
        <div>
          <h2 class="text-xl font-black text-white">Private Chat</h2>
          <p class="text-xs text-gray-500">End-to-end private · Auto-deleted after 6 hours</p>
        </div>
      </div>

      <!-- Your Chat ID -->
      <div class="mb-5 p-4 bg-gray-900/60 border border-gray-700 rounded-2xl">
        <div class="text-xs text-gray-500 uppercase font-bold tracking-widest mb-2">Your Chat ID</div>
        <div class="flex items-center gap-2">
          <code id="tabMyChatId" class="flex-1 text-sm font-mono text-blue-300 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/30 select-all truncate">${myUid}</code>
          <button id="tabCopyIdBtn"
                  class="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors whitespace-nowrap shrink-0">
            📋 Copy
          </button>
        </div>
        <p class="text-[11px] text-gray-600 mt-2">Share this ID with someone so they can chat with you.</p>
      </div>

      <!-- Start a chat -->
      <div>
        <label class="block text-xs text-gray-400 mb-2 font-semibold uppercase tracking-widest">Start a Conversation</label>
        <div class="flex gap-2">
          <input id="tabPartnerInput" type="text" placeholder="Enter partner's Chat ID…"
                 class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5
                        text-sm text-white outline-none focus:border-blue-500 transition font-mono" />
          <button id="tabOpenChatBtn"
                  class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors whitespace-nowrap shrink-0">
            Open Chat →
          </button>
        </div>
        <p id="tabChatError" class="text-xs text-red-400 mt-2 hidden"></p>
      </div>
    </div>`;

  // Wire up copy button
  document.getElementById("tabCopyIdBtn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(myUid).then(() => {
      const btn = document.getElementById("tabCopyIdBtn");
      if (btn) {
        btn.textContent = "✓ Copied!";
        setTimeout(() => { btn.textContent = "📋 Copy"; }, 2000);
      }
    });
  });

  // Wire up open chat button
  const openBtn = document.getElementById("tabOpenChatBtn");
  const partnerInput = document.getElementById("tabPartnerInput");
  const errorEl = document.getElementById("tabChatError");

  function doOpenChat() {
    if (!partnerInput) return;
    const partnerId = partnerInput.value.trim();
    if (errorEl) errorEl.classList.add("hidden");

    if (!partnerId) {
      if (errorEl) { errorEl.textContent = "Please enter a Chat ID."; errorEl.classList.remove("hidden"); }
      return;
    }
    if (partnerId === myUid) {
      if (errorEl) { errorEl.textContent = "You can't chat with yourself."; errorEl.classList.remove("hidden"); }
      return;
    }
    if (!/^[a-zA-Z0-9_\-]{20,128}$/.test(partnerId)) {
      if (errorEl) { errorEl.textContent = "That doesn't look like a valid Chat ID."; errorEl.classList.remove("hidden"); }
      return;
    }
    window.location.href = `chat.html?partner=${encodeURIComponent(partnerId)}`;
  }

  openBtn?.addEventListener("click", doOpenChat);
  partnerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doOpenChat(); }
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  let userData = {};
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) userData = snap.data();
  } catch (_) {}

  // Initial render
  renderChatTab(user, userData);

  // Re-render if profile updates (e.g. referral added during session)
  window.addEventListener("userProfileUpdated", (e) => {
    renderChatTab(user, e.detail || userData);
  });
});
