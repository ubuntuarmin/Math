import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// ══════════════════════════════════════════════════════════
//  PROFILE SETUP FORM
// ══════════════════════════════════════════════════════════

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
    saveBtn.disabled    = _isSaving;
    saveBtn.textContent = _isSaving ? "Saving\u2026" : "Save & Continue";
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

  // Safely escape the user-supplied name to prevent XSS
  const safeName = document.createTextNode(name || "Student").textContent;

  panel.innerHTML = `
    <div class="flex flex-col items-center gap-4 py-6">
      <div id="onboardSuccessCheck"
           class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center
                  text-white text-3xl shadow-lg" style="opacity:0;transform:scale(0.4)">\u2713</div>
      <div class="text-xl font-bold" style="opacity:0;transform:translateY(10px)" id="onboardSuccessTitle">
        Welcome, <span id="onboardSuccessName"></span>!
      </div>
      <p class="text-gray-400 text-sm text-center max-w-sm" style="opacity:0" id="onboardSuccessBody">
        Your profile is set. Let's take a quick <strong>interactive tour</strong>! \uD83D\uDE80
      </p>
    </div>`;

  // Set name text node to avoid XSS
  const nameEl = document.getElementById("onboardSuccessName");
  if (nameEl) nameEl.textContent = safeName;

  if (typeof gsap !== "undefined") {
    gsap.to("#onboardSuccessCheck", { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" });
    gsap.to("#onboardSuccessTitle", { opacity: 1, y: 0, duration: 0.4, delay: 0.25, ease: "power3.out" });
    gsap.to("#onboardSuccessBody",  { opacity: 1, duration: 0.4, delay: 0.45, ease: "power2.out" });
  }

  setTimeout(() => {
    hideOnboarding();
    _startTour(uid, false);
  }, 1600);
}

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

// ══════════════════════════════════════════════════════════
//  ONBOARD.JS TOUR  (Onboard-compatible guided onboarding)
// ══════════════════════════════════════════════════════════

let _tourUid          = null;
let _tourAwardCredits = false;
let _onboardTour      = null;

// Helper: programmatically switch the app to a named tab
function _switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

// Helper: animated progress bar HTML
function _progressBar(current, total) {
  const pct = Math.round((current / total) * 100);
  return `<div class="mt-shepherd-prog-wrap"><div class="mt-shepherd-prog" style="width:${pct}%"></div></div>`;
}

// Helper: chip badges
function _chips(list) {
  if (!list?.length) return "";
  return `<div class="mt-chips">${list.map(c =>
    `<span class="mt-chip${c.type ? " " + c.type : ""}">${c.label}</span>`
  ).join("")}</div>`;
}

// Helper: tip box
function _tip(text) {
  return text ? `<div class="mt-tip"><strong>\uD83D\uDCA1 Tip:</strong> ${text}</div>` : "";
}

// Helper: instruction pill
function _instr(text) {
  return text ? `<div class="mt-instr">${text}</div>` : "";
}

// Helper: step icon circle
function _icon(emoji) {
  return `<div class="mt-step-icon">${emoji}</div>`;
}

// Build the body section of a step (icon + progress + body + chips + tip + instruction)
function _stepContent({ icon, body, chips, tip, instr, step, total }) {
  return [
    _icon(icon),
    _progressBar(step, total),
    `<p style="color:#94a3b8;font-size:.845rem;line-height:1.65;margin-top:.5rem">${body}</p>`,
    _chips(chips),
    _tip(tip),
    _instr(instr),
  ].filter(Boolean).join("");
}

// GSAP entrance animation on tooltip element
function _animateIn(el) {
  if (typeof gsap === "undefined" || !el) return;
  gsap.fromTo(el,
    { opacity: 0, y: 14, scale: 0.96 },
    { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.7)", clearProps: "all" }
  );
}

// GSAP subtle pulse on a target element to draw attention
function _pulseTarget(selector) {
  if (typeof gsap === "undefined" || !selector) return;
  const el = document.querySelector(selector);
  if (!el) return;
  gsap.timeline({ repeat: 1, yoyo: true })
    .to(el, { scale: 1.05, duration: 0.25, ease: "power1.inOut" })
    .to(el, { scale: 1,    duration: 0.25, ease: "power1.inOut" });
}

// Register GSAP animation hooks on the tour instance
function _addGsapHooks(tour) {
  tour.on("show", () => {
    requestAnimationFrame(() => {
      const tooltip = document.querySelector(".shepherd-element");
      _animateIn(tooltip);
    });
  });
}

// Toast notification for credit awards
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

function _getOnboardLib() {
  if (typeof Onboard !== "undefined" && Onboard?.Tour) return Onboard;
  if (typeof Shepherd !== "undefined" && Shepherd?.Tour) return Shepherd;
  return null;
}

async function _waitForOnboardLib(timeoutMs = 5000, pollMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const lib = _getOnboardLib();
    if (lib) return lib;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

// ── Build and start the Onboard.js-compatible tour ──────────────────
async function _startTour(uid, awardCredits) {
  _tourUid          = uid;
  _tourAwardCredits = !!awardCredits;

  const OnboardLib = await _waitForOnboardLib();
  if (!OnboardLib) {
    console.warn("[Onboarding] Onboard/Shepherd library not loaded — tour skipped.");
    _showToast("⚠️ Tutorial could not start. Please try again.");
    return;
  }

  if (_onboardTour) {
    try { _onboardTour.complete(); } catch (_) {}
  }

  const TOTAL = 14;

  _onboardTour = new OnboardLib.Tour({
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      classes: "shepherd-math-tour",
      scrollTo: { behavior: "smooth", block: "center" },
      cancelIcon: { enabled: true },
      modalOverlayOpeningPadding: 8,
      modalOverlayOpeningRadius: 10,
      popperOptions: {
        modifiers: [{ name: "offset", options: { offset: [0, 14] } }],
      },
    },
  });

  _addGsapHooks(_onboardTour);

  /* ── Shared button factories ── */
  const backBtn  = { text: "\u2190 Back", action() { this.back(); }, classes: "shepherd-button-secondary" };
  const nextBtn  = (label = "Next \u2192") => ({ text: label, action() { this.next(); } });

  /* ══════════════════════════════════════════════════════
     STEP 1 — Welcome splash (centred, no attachment)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "welcome",
    title: `\uD83C\uDFAE Welcome to <span class="mt-hl">Math Katy</span>!`,
    text: _stepContent({
      icon: "\uD83C\uDFAE", step: 1, total: TOTAL,
      body: `Your <strong style="color:#f1f5f9">community hub</strong> for discovering and sharing
             the best game &amp; study sites. This interactive tour walks you through every
             feature — interact with real UI elements and learn by doing! \uD83D\uDE80`,
      tip: "Returning users can retake this tour from the \uD83D\uDC64 Account tab to earn +30 credits!",
    }),
    buttons: [ nextBtn("Start Tour \u2192") ],
  });

  /* ══════════════════════════════════════════════════════
     STEP 2 — Navigation bar overview
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "navbar",
    title: `Your <span class="mt-hl">Navigation Bar</span>`,
    text: _stepContent({
      icon: "\uD83E\uDDED", step: 2, total: TOTAL,
      body: `The nav bar at the top gives instant access to every part of Math Katy. Five
             primary tabs are always visible and the
             <strong style="color:#f1f5f9">More \u25BE</strong> dropdown hides less-used
             pages so the bar stays compact even on smaller screens.`,
      chips: [
        { label: "Links \uD83D\uDD17", type: "" },
        { label: "Daily \uD83D\uDD25", type: "green" },
        { label: "Top \uD83C\uDFC6", type: "" },
        { label: "Chat \uD83D\uDCAC", type: "" },
        { label: "Account \uD83D\uDC64", type: "" },
        { label: "More \u25BE", type: "purple" },
      ],
    }),
    attachTo: { element: "#tourNavTabs", on: "bottom" },
    buttons: [ backBtn, nextBtn() ],
    when: { show() { _pulseTarget("#tourNavTabs"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 3 — Links tab (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "links-tab",
    title: `The <span class="mt-hl">Links</span> Tab`,
    text: _stepContent({
      icon: "\uD83D\uDD17", step: 3, total: TOTAL,
      body: `Browse game and study sites shared by your classmates. Each card shows the
             site name, sharer, and community rating. Click a card to open the site
             <strong style="color:#f1f5f9">right inside Math Katy</strong> — no new tab needed!`,
      chips: [
        { label: "Upvote = +10 \uD83E\uDE99", type: "green" },
        { label: "3 reports = auto-remove", type: "" },
        { label: "Rate 1\u20135 \u2B50 after viewing", type: "" },
      ],
      instr: "\uD83D\uDC46 Click the <strong>\uD83D\uDD17 Links</strong> tab to continue",
    }),
    attachTo: { element: "#tourTabLinks", on: "bottom" },
    advanceOn: { selector: "#tourTabLinks", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _switchTab("links"); _pulseTarget("#tourTabLinks"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 4 — Search & filter (input-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "search",
    title: `<span class="mt-hl">Search</span> &amp; Filter`,
    text: _stepContent({
      icon: "\uD83D\uDD0D", step: 4, total: TOTAL,
      body: `Instantly filter links by typing a name, tag, or keyword. The
             <strong style="color:#f1f5f9">Sort dropdown</strong> lets you order by
             Newest, Most Upvoted, or Highest Rated so you always surface the best content.`,
      tip: "Sort by <strong>Highest Rated</strong> to discover the community\u2019s top picks!",
      instr: "\u2328\uFE0F Type anything in the <strong>search bar</strong> to continue",
    }),
    attachTo: { element: "#linksSearch", on: "bottom" },
    advanceOn: { selector: "#linksSearch", event: "input" },
    buttons: [ backBtn ],
    when: {
      show() {
        _switchTab("links");
        const el = document.getElementById("linksSearch");
        if (el) el.value = "";
        setTimeout(() => document.getElementById("linksSearch")?.focus(), 180);
      },
    },
  });

  /* ══════════════════════════════════════════════════════
     STEP 5 — Opening links & session context
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "open-link",
    title: `Opening Links &amp; <span class="mt-hl">Session Time</span>`,
    text: _stepContent({
      icon: "\u25B6\uFE0F", step: 5, total: TOTAL,
      body: `Click any link card\u2019s <strong style="color:#f1f5f9">\u25B6 Open</strong>
             button to load the site in Math Katy\u2019s built-in viewer. Your session timer
             only counts down while the viewer is actually open \u2014 browsing the feed is
             always free!`,
      chips: [
        { label: "Built-in viewer", type: "" },
        { label: "Timer runs only when open", type: "green" },
        { label: "Rate after viewing", type: "" },
      ],
      tip: "Open and close links as many times as you like \u2014 the timer pauses instantly when you close the viewer.",
    }),
    attachTo: { element: "#linksGrid", on: "top" },
    buttons: [ backBtn, nextBtn() ],
    when: { show() { _switchTab("links"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 6 — Share button (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "share",
    title: `Share Links &amp; <span class="mt-hl">Earn Credits</span>`,
    text: _stepContent({
      icon: "\u2795", step: 6, total: TOTAL,
      body: `Found a great site? Hit <strong style="color:#f1f5f9">+ Share</strong> to
             submit it. You earn <strong style="color:#34d399">+50 credits instantly</strong>,
             plus <strong style="color:#34d399">+10 more</strong> for every upvote your
             link receives from the community!`,
      chips: [
        { label: "Share = +50 \uD83E\uDE99", type: "green" },
        { label: "Per upvote = +10 \uD83E\uDE99", type: "green" },
        { label: "Quality bonus = +50 \uD83E\uDE99/mo", type: "purple" },
      ],
      instr: "\uD83D\uDC46 Click the <strong>+ Share</strong> button to continue",
    }),
    attachTo: { element: "#tourShareBtn", on: "bottom" },
    advanceOn: { selector: "#tourShareBtn", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _pulseTarget("#tourShareBtn"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 7 — Credits & rank system
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "credits",
    title: `Credits &amp; <span class="mt-hl">Rank System</span>`,
    text: _stepContent({
      icon: "\uD83E\uDE99", step: 7, total: TOTAL,
      body: `Your credits are your <strong style="color:#f1f5f9">platform currency and
             reputation score</strong>. Accumulate them to unlock higher tiers with better
             perks \u2014 each tier increases your session top-up bonus and shows your status
             to the community.`,
      chips: [
        { label: "Basic", type: "" },
        { label: "Silver", type: "" },
        { label: "Gold", type: "purple" },
        { label: "VIP \u2B50", type: "purple" },
      ],
      tip: "Refer a friend and earn <strong>+150 credits</strong> \u2014 the fastest single way to rank up!",
    }),
    attachTo: { element: "#tourCreditsPill", on: "bottom" },
    buttons: [ backBtn, nextBtn() ],
    when: { show() { _pulseTarget("#tourCreditsPill"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 8 — Session timer
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "session-timer",
    title: `Your <span class="mt-hl">Session Timer</span>`,
    text: _stepContent({
      icon: "\u23F1\uFE0F", step: 8, total: TOTAL,
      body: `Every new browser session gives you <strong style="color:#f1f5f9">30 free
             minutes</strong> across all links. When time is low, click this button to
             top up for <strong style="color:#fde047">50 credits</strong>. Higher rank =
             more minutes per refill \u2014 VIP gets a massive
             <strong style="color:#a855f7">6 hours</strong>!`,
      chips: [
        { label: "Basic = 45 min/top-up", type: "" },
        { label: "Silver = 60 min", type: "" },
        { label: "Gold = 2 hrs", type: "purple" },
        { label: "VIP = 6 hrs \u2B50", type: "purple" },
      ],
    }),
    attachTo: { element: "#navSessionTime", on: "bottom" },
    buttons: [ backBtn, nextBtn() ],
    when: { show() { _pulseTarget("#navSessionTime"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 9 — Daily streak (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "daily",
    title: `Daily <span class="mt-hl">Streak</span> Rewards`,
    text: _stepContent({
      icon: "\uD83D\uDD25", step: 9, total: TOTAL,
      body: `Visit Math Katy every day and claim your daily reward to build a streak.
             Each consecutive day increases your payout multiplier \u2014 miss a day and
             it resets to zero! Even a 2-day streak gives a meaningful bonus.`,
      tip: "Claim as soon as you log in each day \u2014 it only takes one click!",
      instr: "\uD83D\uDC46 Click the <strong>\uD83D\uDD25 Daily</strong> tab to continue",
    }),
    attachTo: { element: "#tourTabDaily", on: "bottom" },
    advanceOn: { selector: "#tourTabDaily", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _pulseTarget("#tourTabDaily"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 10 — Daily streak mechanics (real interaction)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "daily-mechanics",
    title: `How <span class="mt-hl">Streaks</span> &amp; Bonuses Work`,
    text: _stepContent({
      icon: "📆", step: 10, total: TOTAL,
      body: `Your streak increases by 1 each time you claim the next day in order.
             Most days give <strong style="color:#34d399">+10 credits</strong>, while
             <strong style="color:#fde047">Day 15 gives +100 credits</strong>. Claims are
             spaced by 24 hours, and if you disappear too long your streak can reset,
             so consistency is how you stack big rewards.`,
      chips: [
        { label: "24h between claims", type: "" },
        { label: "Day 15 = +100 🪙", type: "green" },
        { label: "Most days = +10 🪙", type: "" },
      ],
      instr: "👉 Click any day card in the streak grid to continue",
    }),
    attachTo: { element: "#dailyTracker", on: "top" },
    advanceOn: { selector: "#dailyTracker .day-card", event: "click" },
    buttons: [ backBtn ],
    when: {
      show() {
        _switchTab("daily");
        _pulseTarget("#dailyTracker");
      },
    },
  });

  /* ══════════════════════════════════════════════════════
     STEP 11 — Leaderboard (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "leaderboard",
    title: `<span class="mt-hl">Leaderboard</span> &amp; Prizes`,
    text: _stepContent({
      icon: "\uD83C\uDFC6", step: 11, total: TOTAL,
      body: `The leaderboard ranks every player by total platform time each bi-monthly season.
             The <strong style="color:#f1f5f9">top 10</strong> earn credit prizes when the
             season resets \u2014 the higher you climb, the bigger your reward. Rankings
             update in real time!`,
      chips: [
        { label: "Top 10 earn credit prizes", type: "green" },
        { label: "Bi-monthly seasons", type: "" },
        { label: "Real-time rankings", type: "" },
      ],
      instr: "\uD83D\uDC46 Click the <strong>\uD83C\uDFC6 Top</strong> tab to continue",
    }),
    attachTo: { element: "#tourTabLeaderboard", on: "bottom" },
    advanceOn: { selector: "#tourTabLeaderboard", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _pulseTarget("#tourTabLeaderboard"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 12 — Chat tab (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "chat",
    title: `Community <span class="mt-hl">Chat</span>`,
    text: _stepContent({
      icon: "\uD83D\uDCAC", step: 12, total: TOTAL,
      body: `The Chat tab is your real-time community space. Share tips, react to
             messages with emojis, and stay connected with the Math Katy community.
             All messages are moderated \u2014 keep it friendly!`,
      chips: [
        { label: "Real-time messaging", type: "" },
        { label: "Emoji reactions", type: "green" },
        { label: "Moderated community", type: "" },
      ],
      instr: "\uD83D\uDC46 Click the <strong>\uD83D\uDCAC Chat</strong> tab to continue",
    }),
    attachTo: { element: "#tourTabChat", on: "bottom" },
    advanceOn: { selector: "#tourTabChat", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _pulseTarget("#tourTabChat"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 13 — Account & referrals (click-to-advance)
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "account",
    title: `Your <span class="mt-hl">Account</span> &amp; Referrals`,
    text: _stepContent({
      icon: "\uD83D\uDC64", step: 13, total: TOTAL,
      body: `Your Account tab shows your full profile: credit balance, tier progress,
             shared links, and your unique <strong style="color:#f1f5f9">referral code</strong>.
             Share your code with friends \u2014 earn
             <strong style="color:#34d399">+150 credits</strong> for every sign-up!
             Customise your avatar colour and bio here too.`,
      chips: [
        { label: "Referral = +150 \uD83E\uDE99 each", type: "green" },
        { label: "Avatar & bio", type: "" },
        { label: "Tier progress bar", type: "purple" },
      ],
      instr: "\uD83D\uDC46 Click the <strong>\uD83D\uDC64 Account</strong> tab to continue",
    }),
    attachTo: { element: "#tourTabAccount", on: "bottom" },
    advanceOn: { selector: "#tourTabAccount", event: "click" },
    buttons: [ backBtn ],
    when: { show() { _pulseTarget("#tourTabAccount"); } },
  });

  /* ══════════════════════════════════════════════════════
     STEP 14 — Finale
  ══════════════════════════════════════════════════════ */
  _onboardTour.addStep({
    id: "finale",
    title: "Tour Complete!",
    text: `<div class="mt-finale-text">
      <span class="mt-finale-emoji" style="opacity:0;transform:scale(0.4)">\uD83C\uDF89</span>
      <div class="mt-finale-title">You're all set!</div>
      <p class="mt-finale-body">
        You now know everything about <strong style="color:#f1f5f9">Math Katy</strong>.
        Explore links, earn credits, climb the leaderboard, and invite friends with your
        referral code. Good luck! \uD83D\uDE80
      </p>
      ${_progressBar(TOTAL, TOTAL)}
    </div>`,
    buttons: [
      backBtn,
      { text: "Let's Go! \uD83D\uDE80", action() { this.complete(); } },
    ],
    when: {
      show() {
        if (typeof gsap !== "undefined") {
          requestAnimationFrame(() => {
            const emoji = document.querySelector(".mt-finale-emoji");
            if (emoji) {
              gsap.to(emoji, {
                opacity: 1, scale: 1, duration: 0.65,
                ease: "back.out(2.5)", delay: 0.15,
              });
            }
          });
        }
      },
    },
  });

  /* ── Tour lifecycle handlers ── */
  _onboardTour.on("complete", _handleTourEnd);
  _onboardTour.on("cancel",   _handleTourEnd);

  _onboardTour.start();
}

async function _handleTourEnd() {
  try {
    if (_tourAwardCredits && _tourUid) {
      await updateDoc(doc(db, "users", _tourUid), {
        credits:               increment(30),
        totalEarned:           increment(30),
        tutorialCreditClaimed: true,
        tourComplete:          true,
      });
      _showToast("\uD83C\uDF89 +30 credits earned for completing the tutorial!");
      const snap = await getDoc(doc(db, "users", _tourUid));
      if (snap.exists()) {
        window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: snap.data() }));
      }
    } else if (_tourUid) {
      await updateDoc(doc(db, "users", _tourUid), { tourComplete: true });
    }
  } catch (e) {
    console.warn("Tour end write failed:", e);
  }
}

/** Public: start guided tour for existing users — awards +30 credits on completion. */
export function startTourForExistingUser(uid) {
  if (!uid) return false;
  _startTour(uid, true);
  return true;
}
