import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const firstInput   = document.getElementById("onboardFirst");
const lastInput    = document.getElementById("onboardLast");
const gradeSelect  = document.getElementById("onboardGrade");
const saveBtn      = document.getElementById("onboardSave");
const errorEl      = document.getElementById("onboardError");

let _isSaving = false;

function setSavingState(on) {
  _isSaving = !!on;
  if (saveBtn) {
    saveBtn.disabled  = _isSaving;
    saveBtn.textContent = _isSaving ? "Saving…" : "Save & Continue";
  }
}

export function showOnboarding() {
  if (!onboardModal) return;
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
  if (errorEl) errorEl.textContent = "";
  setTimeout(() => firstInput?.focus(), 50);
}

export function hideOnboarding() {
  if (!onboardModal) return;
  onboardModal.classList.add("hidden");
  onboardModal.setAttribute("aria-hidden", "true");
}

async function finalizeOnboarding(uid, firstName) {
  try {
    const snap      = await getDoc(doc(db, "users", uid));
    const freshData = snap.data() || {};
    sessionStorage.removeItem("justSignedUp");
    window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: freshData }));
    showSuccessAndClose(firstName, uid);
  } catch (e) {
    console.error("Finalize error:", e);
    hideOnboarding();
  }
}

function showSuccessAndClose(name, uid) {
  const panel = onboardModal?.querySelector(".panel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="flex flex-col items-center gap-4 py-6">
      <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center
                  text-white text-3xl shadow-lg animate-bounce">✓</div>
      <div class="text-xl font-bold">Welcome, ${name || "Student"}!</div>
      <p class="text-gray-400 text-sm text-center max-w-sm">
        Your profile is set. Let's take a quick <strong>interactive tour</strong>! 🚀
      </p>
    </div>`;

  setTimeout(() => {
    hideOnboarding();
    _startTour(uid, false);   // new users do NOT earn credits
  }, 1500);
}

// ══════════════════════════════════════════════════════════
//  INTERACTIVE TOUR — step definitions
//
//  type "info"   → plain panel with a Next button
//  type "click"  → highlight element, wait for user to click it
//  type "input"  → highlight input, advance when user types something
// ══════════════════════════════════════════════════════════

const TOUR_STEPS = [
  /* 1 – Welcome */
  {
    type: "info",
    icon: "🎮",
    title: `Welcome to <span class="mt-hl">Math Katy</span>!`,
    body: `Your community hub for discovering and sharing game &amp; study sites.
           This quick <strong>interactive tour</strong> has you click &amp; type on
           real elements to move on — so you learn by doing! 🚀`,
    btnLabel: "Start Tour →",
    tip: "Existing users can retake the tutorial from their Account tab to earn 30 credits!",
  },

  /* 2 – Links tab (click to switch) */
  {
    type: "click",
    elementId: "tourTabLinks",
    requiresTab: "links",
    icon: "🔗",
    title: `The <span class="mt-hl">Links</span> Tab`,
    body: `Browse game and study sites shared by your peers, open any card to view it inside
           the platform, and rate links to help the community find the best ones.`,
    instruction: "👆 Click the <strong>Links</strong> tab above to continue",
    chips: [
      { label: "Upvote = +10 🪙", type: "green" },
      { label: "3 reports = auto-remove", type: "" },
    ],
  },

  /* 3 – Search bar (type to search — advances on actual input) */
  {
    type: "input",
    elementId: "linksSearch",
    requiresTab: "links",
    icon: "🔍",
    title: `<span class="mt-hl">Search</span> &amp; Filter`,
    body: `Instantly filter links by name or tag. The Sort dropdown lets you order by
           Newest, Most Upvoted, or Highest Rated so you always find what you need.`,
    instruction: "⌨️ Type anything in the <strong>search bar</strong> to continue",
    tip: "Sort by <strong>Highest Rated</strong> to find the community's top picks!",
  },

  /* 4 – Share button (click — nav prevented) */
  {
    type: "click",
    elementId: "tourShareBtn",
    preventNav: true,
    icon: "➕",
    title: `Share Links &amp; <span class="mt-hl">Earn Credits</span>`,
    body: `Found something awesome? Hit <strong>+ Share</strong> to contribute it.
           You earn <strong>+50 credits</strong> immediately, plus <strong>+10</strong>
           for every upvote your link receives!`,
    instruction: "👆 Click the <strong>Share</strong> button to continue",
    chips: [
      { label: "Share = +50 🪙", type: "green" },
      { label: "Per upvote = +10 🪙", type: "green" },
      { label: "Quality bonus = +50 🪙/mo", type: "" },
    ],
  },

  /* 5 – Credits pill (info) */
  {
    type: "info",
    elementId: "tourCreditsPill",
    icon: "🪙",
    title: `Credits &amp; <span class="mt-hl">Rank System</span>`,
    body: `Credits are your platform currency and reputation. Earn them in multiple ways
           and spend them to unlock more session time. Your rank rises as you accumulate.`,
    btnLabel: "Got it! →",
    chips: [
      { label: "Basic", type: "" },
      { label: "Silver", type: "" },
      { label: "Gold", type: "purple" },
      { label: "VIP", type: "purple" },
    ],
    tip: "Refer a friend and earn <strong>+150 credits</strong> — the fastest way to rank up!",
  },

  /* 6 – Session timer (info) */
  {
    type: "info",
    elementId: "navSessionTime",
    icon: "⏱️",
    title: `Your <span class="mt-hl">Session Timer</span>`,
    body: `Every new browser session starts with <strong>30 free minutes</strong> shared
           across all links you open. When time runs low, top up for <strong>50 credits</strong>.
           Higher ranks get more minutes per top-up — VIP gets 6 hours! ⚡`,
    btnLabel: "Next →",
    chips: [
      { label: "Basic = 45 min/top-up", type: "" },
      { label: "Silver = 60 min", type: "" },
      { label: "Gold = 2 hrs", type: "purple" },
      { label: "VIP = 6 hrs", type: "purple" },
    ],
    tip: "The timer only ticks while a link is open — browse the feed for free!",
  },

  /* 7 – Daily tab (click to switch) */
  {
    type: "click",
    elementId: "tourTabDaily",
    requiresTab: "daily",
    icon: "🔥",
    title: `Daily <span class="mt-hl">Streak</span> Rewards`,
    body: `Log in every day and claim your daily reward to build a streak. The longer
           your streak, the bigger your daily payout. Miss a day and it resets to zero!`,
    instruction: "👆 Click the <strong>Daily</strong> tab to continue",
    tip: "Even a 2-day streak gives a bonus multiplier. Never miss a claim!",
  },

  /* 8 – Leaderboard tab (click to switch) */
  {
    type: "click",
    elementId: "tourTabLeaderboard",
    requiresTab: "leaderboard",
    icon: "🏆",
    title: `<span class="mt-hl">Leaderboard</span> &amp; Prizes`,
    body: `The leaderboard ranks users by platform time each bi-monthly season.
           The <strong>top 10</strong> players earn credit prizes when the season resets!`,
    instruction: "👆 Click the <strong>Leaderboard</strong> tab to continue",
    chips: [
      { label: "Top 10 earn prizes", type: "green" },
      { label: "Season resets bi-monthly", type: "" },
    ],
  },

  /* 9 – Account tab (click to switch) */
  {
    type: "click",
    elementId: "tourTabAccount",
    requiresTab: "account",
    icon: "👤",
    title: `Your <span class="mt-hl">Account</span> &amp; Profile`,
    body: `Your personal dashboard: credit balance, rank progress, and your unique
           <strong>referral code</strong>. Share it with friends and earn
           <strong>+150 credits</strong> for each sign-up! 🤝`,
    instruction: "👆 Click the <strong>Account</strong> tab to continue",
    chips: [
      { label: "Referral = +150 🪙 each", type: "green" },
    ],
  },

  /* 10 – Finale */
  {
    type: "info",
    icon: "🎉",
    title: "Tour Complete!",
    body: `You now know everything about <strong style="color:#f1f5f9">Math Katy</strong>.
           Start exploring, earn credits, climb the ranks, and share your favourite sites
           with the community. Good luck! 🚀`,
    btnLabel: "Let's Go! 🚀",
    isFinale: true,
  },
];

// ── Tour state ──────────────────────────────────────────
let _tourUid          = null;
let _tourAwardCredits = false;
let _tourStep         = 0;
let _activeClickEl    = null;
let _activeClickFn    = null;
let _activeInputEl    = null;
let _activeInputFn    = null;
let _resizeObserver   = null;
let _resizeWindowFn   = null;   // window resize cleanup for tooltip positioning
let _tabGuardFn       = null;   // tab-click guard for self-healing

/** Called after profile setup (new users – no credit award). */
function _startTour(uid, awardCredits) {
  _tourUid          = uid;
  _tourAwardCredits = !!awardCredits;
  _tourStep         = 0;
  _showStep(0);
}

/** Public: start tutorial for existing users (awards +30 credits). */
export function startTourForExistingUser(uid) {
  _startTour(uid, true);
}

// ── Rendering helpers ───────────────────────────────────

function _clearUI() {
  document.getElementById("mtTourBackdrop")?.remove();
  document.getElementById("mtTourTooltip")?.remove();
  document.getElementById("mtTourReroute")?.remove();
  document.querySelectorAll(".mt-tour-hl").forEach(el => el.classList.remove("mt-tour-hl"));
  document.querySelectorAll(".mt-tour-hl-warn").forEach(el => el.classList.remove("mt-tour-hl-warn"));

  if (_activeClickEl && _activeClickFn) {
    _activeClickEl.removeEventListener("click", _activeClickFn, true);
    _activeClickEl = null;
    _activeClickFn = null;
  }
  if (_activeInputEl && _activeInputFn) {
    _activeInputEl.removeEventListener("input", _activeInputFn);
    _activeInputEl = null;
    _activeInputFn = null;
  }
  _removeTabGuard();

  if (_resizeWindowFn) {
    window.removeEventListener("resize", _resizeWindowFn);
    _resizeWindowFn = null;
  }
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
}

function _showStep(idx) {
  _clearUI();

  if (idx >= TOUR_STEPS.length) { _completeTour(); return; }
  _tourStep = idx;

  const step = TOUR_STEPS[idx];
  const el   = step.elementId ? document.getElementById(step.elementId) : null;

  if (step.type === "click") {
    if (!el) { _showStep(idx + 1); return; }  // skip missing elements
    _showClickStep(step, el, idx);
  } else if (step.type === "input") {
    if (!el) { _showStep(idx + 1); return; }
    _showInputStep(step, el, idx);
  } else {
    _showInfoStep(step, el, idx);
  }
}

function _chipsHtml(chips) {
  if (!chips?.length) return "";
  return `<div class="mt-chips">${chips.map(c =>
    `<span class="mt-chip${c.type ? " " + c.type : ""}">${c.label}</span>`).join("")}</div>`;
}

function _tipHtml(tip) {
  return tip ? `<div class="mt-tip"><strong>💡 Tip:</strong> ${tip}</div>` : "";
}

function _buildTooltip(step, idx, isInteractive) {
  const total       = TOUR_STEPS.length;
  const pct         = Math.round(((idx + 1) / total) * 100);
  const backBtn     = idx > 0
    ? `<button id="mtTourBack" class="mt-tour-btn-back">← Back</button>` : "";
  const nextBtn     = !isInteractive
    ? `<button id="mtTourNext" class="mt-tour-btn-next">${step.btnLabel || "Next →"}</button>` : "";
  const instrHtml   = isInteractive && step.instruction
    ? `<div class="mt-tour-instr">${step.instruction}</div>` : "";

  const div = document.createElement("div");
  div.id        = "mtTourTooltip";
  div.className = "mt-tour-tooltip" + (step.isFinale ? " mt-tour-finale" : "");
  div.setAttribute("role", "dialog");
  div.setAttribute("aria-modal", "false");
  div.innerHTML = `
    <div class="mt-tour-prog-wrap"><div class="mt-tour-prog" style="width:${pct}%"></div></div>
    <div class="mt-step-badge">Step <span>${idx + 1}</span> of ${total}</div>
    <div class="mt-step-icon">${step.icon}</div>
    <div class="mt-step-title">${step.title}</div>
    <p class="mt-step-body">${step.body}</p>
    ${_chipsHtml(step.chips)}
    ${_tipHtml(step.tip)}
    ${instrHtml}
    ${(backBtn || nextBtn)
      ? `<div class="mt-tour-btn-row">${backBtn}${nextBtn}</div>`
      : ""}
  `;
  return div;
}

/**
 * Position tooltip near a target, ensuring it never covers the target and
 * never clips outside the viewport. Tries below → above → right → centred as fallbacks.
 */
function _positionTooltip(tooltip, target) {
  const doLayout = () => {
    const r   = target.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const th  = tooltip.offsetHeight || 320;
    const tw  = tooltip.offsetWidth  || 340;

    const GAP = 14;

    // Prefer below the target; flip above if it clips
    let top  = r.bottom + GAP;
    let left = r.left;

    if (top + th > vpH - 8) {
      // Try above
      const topAbove = r.top - th - GAP;
      if (topAbove >= 8) {
        top = topAbove;
      } else {
        // Not enough room above or below — float to right side if room exists
        const leftRight = r.right + GAP;
        if (leftRight + tw <= vpW - 8) {
          top  = Math.max(8, r.top);
          left = leftRight;
        } else {
          // Last resort: centre vertically in viewport away from target
          top = Math.max(8, Math.min(r.top - th - GAP, vpH / 2 - th / 2));
          if (top < 8) top = 8;
        }
      }
    }

    // Horizontal clamping
    if (left + tw > vpW - 8) left = vpW - tw - 8;
    if (left < 8)             left = 8;

    tooltip.style.top       = top  + "px";
    tooltip.style.left      = left + "px";
    tooltip.style.transform = "none";
  };

  requestAnimationFrame(doLayout);

  // Re-layout on resize so tooltips never escape the viewport
  if (_resizeWindowFn) window.removeEventListener("resize", _resizeWindowFn);
  if (_resizeObserver) _resizeObserver.disconnect();

  _resizeWindowFn = doLayout;
  window.addEventListener("resize", _resizeWindowFn, { passive: true });

  _resizeObserver = new ResizeObserver(doLayout);
  _resizeObserver.observe(document.documentElement);
}

function _wireButtons(tooltip, idx) {
  tooltip.querySelector("#mtTourNext")?.addEventListener("click", () => {
    TOUR_STEPS[idx].isFinale ? _completeTour() : _showStep(idx + 1);
  });
  tooltip.querySelector("#mtTourBack")?.addEventListener("click", () => _showStep(idx - 1));
}

/** Smooth-scroll to an element using GSAP if available, then position tooltip. */
function _scrollToAndPosition(el, tooltip) {
  const doPosition = () => _positionTooltip(tooltip, el);

  if (typeof gsap !== "undefined" && typeof ScrollToPlugin !== "undefined") {
    gsap.to(window, {
      duration: 0.55,
      scrollTo: { y: el, offsetY: 120 },
      ease: "power2.inOut",
      onComplete: doPosition,
    });
  } else {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // Give the browser scroll animation time to settle
    setTimeout(doPosition, 350);
  }
}

// ── Self-healing tab guard ─────────────────────────────

/**
 * Install a capture-phase click listener on all tab buttons.
 * If the user clicks a tab that would break the current step's context,
 * intercept, show a reroute pill, then restore state after the user
 * clicks back to the right tab.
 */
function _installTabGuard(requiredTab, targetEl) {
  _removeTabGuard();

  _tabGuardFn = (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    const clickedTab = btn.dataset.tab;
    if (!clickedTab || clickedTab === requiredTab) return;

    // User clicked the wrong tab — intercept and reroute
    e.preventDefault();
    e.stopImmediatePropagation();
    _showReroute(requiredTab, targetEl);
  };

  document.addEventListener("click", _tabGuardFn, true);
}

function _removeTabGuard() {
  if (_tabGuardFn) {
    document.removeEventListener("click", _tabGuardFn, true);
    _tabGuardFn = null;
  }
}

function _showReroute(requiredTab, targetEl) {
  document.getElementById("mtTourReroute")?.remove();

  const tabNames = {
    links: "Links 🔗", daily: "Daily 🔥", leaderboard: "Top 🏆",
    account: "Account 👤",
  };
  const label = tabNames[requiredTab] || requiredTab;

  const pill = document.createElement("div");
  pill.id        = "mtTourReroute";
  pill.className = "mt-tour-reroute";
  pill.innerHTML = `
    <span class="mt-tour-reroute-icon">↩️</span>
    <span>Click the <strong>${label}</strong> tab to get back on track</span>
  `;
  document.body.appendChild(pill);

  // Highlight the correct target tab in red/warning mode
  targetEl.classList.add("mt-tour-hl-warn");

  // One-time click on the correct tab removes the reroute pill
  const heal = (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn?.dataset.tab === requiredTab) {
      pill.remove();
      targetEl.classList.remove("mt-tour-hl-warn");
      targetEl.classList.add("mt-tour-hl");
      document.removeEventListener("click", heal, true);
    }
  };
  document.addEventListener("click", heal, true);

  // Auto-dismiss after 8 s if unused
  setTimeout(() => {
    pill.remove();
    targetEl.classList.remove("mt-tour-hl-warn");
    targetEl.classList.add("mt-tour-hl");
  }, 8000);
}

// ── Step renderers ──────────────────────────────────────

function _showInfoStep(step, el, idx) {
  if (el) {
    el.classList.add("mt-tour-hl");
    _scrollAndAddTooltipInfo(el, step, idx);
  } else {
    // Full-screen dim backdrop for floating centred panels
    const bd  = document.createElement("div");
    bd.id     = "mtTourBackdrop";
    bd.className = "mt-tour-backdrop";
    document.body.appendChild(bd);

    const tooltip = _buildTooltip(step, idx, false);
    document.body.appendChild(tooltip);
    _wireButtons(tooltip, idx);
  }
}

function _scrollAndAddTooltipInfo(el, step, idx) {
  const tooltip = _buildTooltip(step, idx, false);
  document.body.appendChild(tooltip);
  _scrollToAndPosition(el, tooltip);
  _wireButtons(tooltip, idx);
}

function _showClickStep(step, el, idx) {
  el.classList.add("mt-tour-hl");

  const tooltip = _buildTooltip(step, idx, true);
  document.body.appendChild(tooltip);

  // Tooltip is see-through so clicks pass to the spotlight element.
  // Re-enable pointer events only on the Back button row.
  tooltip.style.pointerEvents = "none";
  const btnRow = tooltip.querySelector(".mt-tour-btn-row");
  if (btnRow) btnRow.style.pointerEvents = "auto";

  _scrollToAndPosition(el, tooltip);
  _wireButtons(tooltip, idx);

  // Install tab guard if this step requires a specific tab context
  if (step.requiresTab) _installTabGuard(step.requiresTab, el);

  const fn = (e) => {
    if (step.preventNav) { e.preventDefault(); e.stopPropagation(); }
    el.removeEventListener("click", fn, true);
    _activeClickEl = null;
    _activeClickFn = null;
    _clearUI();
    setTimeout(() => _showStep(idx + 1), 280);
  };
  el.addEventListener("click", fn, true);
  _activeClickEl = el;
  _activeClickFn = fn;
}

function _showInputStep(step, el, idx) {
  el.classList.add("mt-tour-hl");

  const tooltip = _buildTooltip(step, idx, true);
  document.body.appendChild(tooltip);

  // Tooltip is transparent so the user can click/type in the real input.
  tooltip.style.pointerEvents = "none";
  const btnRow = tooltip.querySelector(".mt-tour-btn-row");
  if (btnRow) btnRow.style.pointerEvents = "auto";

  _scrollToAndPosition(el, tooltip);
  _wireButtons(tooltip, idx);

  // Install tab guard if needed
  if (step.requiresTab) _installTabGuard(step.requiresTab, el);

  // Clear any pre-existing value so the user must type something new
  if (el.value) el.value = "";

  const fn = () => {
    if (!el.value.trim()) return;   // must type at least one character
    el.removeEventListener("input", fn);
    _activeInputEl = null;
    _activeInputFn = null;
    _clearUI();
    setTimeout(() => _showStep(idx + 1), 350);
  };
  el.addEventListener("input", fn);
  _activeInputEl = el;
  _activeInputFn = fn;

  // Focus the input so the user can start typing immediately
  setTimeout(() => el.focus(), 120);
}

// ── Tour completion ─────────────────────────────────────

async function _completeTour() {
  _clearUI();

  try {
    if (_tourAwardCredits && _tourUid) {
      await updateDoc(doc(db, "users", _tourUid), {
        credits:               increment(30),
        totalEarned:           increment(30),
        tutorialCreditClaimed: true,
        tourComplete:          true,
      });
      _showToast("🎉 +30 credits earned for completing the tutorial!");
      // Refresh UI across the app
      const snap = await getDoc(doc(db, "users", _tourUid));
      if (snap.exists()) {
        window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: snap.data() }));
      }
    } else if (_tourUid) {
      await updateDoc(doc(db, "users", _tourUid), { tourComplete: true });
    }
  } catch (e) {
    console.warn("Tour complete write failed:", e);
  }
}

function _showToast(msg) {
  const t = document.createElement("div");
  t.className = "mt-tour-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("mt-tour-toast-show"));
  setTimeout(() => {
    t.classList.remove("mt-tour-toast-show");
    setTimeout(() => t.remove(), 420);
  }, 4500);
}

// ══════════════════════════════════════════════════════════
//  PROFILE SETUP FORM
// ══════════════════════════════════════════════════════════

async function handleSave() {
  if (_isSaving) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const first = (firstInput?.value || "").trim();
  const last  = (lastInput?.value  || "").trim();
  const grade = gradeSelect?.value  || "";

  if (errorEl) errorEl.textContent = "";

  if (!first || first.length < 2) {
    if (errorEl) errorEl.textContent = "Please enter your first name (at least 2 characters).";
    firstInput?.focus(); return;
  }
  if (first.length > 20) {
    if (errorEl) errorEl.textContent = "First name is too long (max 20 characters).";
    firstInput?.focus(); return;
  }
  if (!grade) {
    if (errorEl) errorEl.textContent = "Please select your grade.";
    gradeSelect?.focus(); return;
  }

  setSavingState(true);
  try {
    await updateDoc(doc(db, "users", uid), {
      firstName: first, lastName: last, grade, onboardingComplete: true,
    });
    await finalizeOnboarding(uid, first);
  } catch (err) {
    console.error("Onboarding save error:", err);
    if (errorEl) errorEl.textContent = "Failed to save. Please try again.";
    setSavingState(false);
  }
}

saveBtn?.addEventListener("click", (e) => { e.preventDefault(); handleSave(); });
[firstInput, lastInput].forEach(el => {
  el?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } });
});
