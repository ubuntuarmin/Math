import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const onboardModal = document.getElementById("onboardModal");
const firstInput = document.getElementById("onboardFirst");
const lastInput = document.getElementById("onboardLast");
const gradeSelect = document.getElementById("onboardGrade");
const saveBtn = document.getElementById("onboardSave");
const errorEl = document.getElementById("onboardError");

let _isSaving = false;

function setSavingState(on) {
  _isSaving = !!on;
  if (saveBtn) {
    saveBtn.disabled = _isSaving;
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

/**
 * Fetch fresh user data and notify rest of app.
 */
async function finalizeOnboarding(uid, firstName) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const freshData = snap.data() || {};

    sessionStorage.removeItem("justSignedUp");

    const updateEvent = new CustomEvent("userProfileUpdated", { detail: freshData });
    window.dispatchEvent(updateEvent);

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
      <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white text-3xl shadow-lg animate-bounce">
        ✓
      </div>
      <div class="text-xl font-bold">Welcome, ${name || "Student"}!</div>
      <p class="text-gray-400 text-sm text-center max-w-sm">
        Your profile is set. Let's take a quick tour of the platform! 🚀
      </p>
    </div>
  `;

  setTimeout(() => {
    hideOnboarding();
    startGuidedTour(uid);
  }, 1500);
}

/**
 * Build a rich tour step using the .mt-step component system.
 * @param {string} icon - Emoji icon
 * @param {string} title - Step title (may contain <span class="mt-hl"> highlights)
 * @param {string} body - Main description paragraph
 * @param {string[]} [chips] - Optional stat chips [{label, type}]
 * @param {string} [tip] - Optional tip card content
 * @param {number} stepNum - 1-based step number
 * @param {number} totalSteps - Total number of steps
 * @returns {string} HTML string
 */
function buildStep(icon, title, body, chips, tip, stepNum, totalSteps) {
  const chipsHtml = chips && chips.length
    ? `<div class="mt-chips">${chips.map(c => `<span class="mt-chip${c.type ? " " + c.type : ""}">${c.label}</span>`).join("")}</div>`
    : "";
  const tipHtml = tip
    ? `<div class="mt-tip"><strong>💡 Tip:</strong> ${tip}</div>`
    : "";
  return `
    <div class="mt-step">
      <div class="mt-step-badge">Step <span>${stepNum}</span> of ${totalSteps}</div>
      <div class="mt-step-icon">${icon}</div>
      <div class="mt-step-title">${title}</div>
      <p class="mt-step-body">${body}</p>
      ${chipsHtml}
      ${tipHtml}
    </div>`;
}

/**
 * Launch the professional Intro.js guided tour for new users.
 * The tour is non-bypassable (no skip, no ESC, no overlay-click-to-close).
 */
function startGuidedTour(uid) {
  if (typeof introJs === "undefined") {
    markTourComplete(uid);
    return;
  }

  const TOTAL = 13;

  const rawSteps = [
    /* 1 — Welcome (no element highlight) */
    {
      intro: buildStep(
        "🎮",
        `Welcome to <span class="mt-hl">Math Katy</span>!`,
        `Your community hub for discovering and sharing the best game &amp; study sites. This quick tour walks you through every feature — it'll only take about 90 seconds. Let's go! 🚀`,
        null,
        `You can revisit this tour anytime from the <strong>Account</strong> tab.`,
        1, TOTAL
      ),
    },

    /* 2 — Navigation tabs */
    {
      element: document.getElementById("tourNavTabs"),
      intro: buildStep(
        "🗺️",
        `Your <span class="mt-hl">Navigation</span> Hub`,
        `These tabs are your main compass. Every section of the platform lives here — switch instantly between <strong>Links</strong>, <strong>Daily</strong>, <strong>Leaderboard</strong>, <strong>News</strong>, and your <strong>Account</strong> without reloading the page.`,
        null,
        `The active tab is always highlighted. Your progress and credits update in real-time across all tabs.`,
        2, TOTAL
      ),
      position: "bottom",
    },

    /* 3 — Links tab */
    {
      element: document.getElementById("tourTabLinks"),
      intro: buildStep(
        "🔗",
        `The <span class="mt-hl">Community Links</span> Feed`,
        `This is where the magic happens. Browse game and study sites submitted by your peers, open any card to view the site <em>inside</em> the platform, and rate links to help others find the best ones. Bad link? Report it — 3 reports removes it automatically! 🧹`,
        [
          { label: "Upvote +10 🪙", type: "green" },
          { label: "Review = visibility boost", type: "" },
        ],
        `Upvoting a link rewards <strong>+10 credits</strong> to you <em>and</em> encourages the sharer. Quality wins!`,
        3, TOTAL
      ),
      position: "bottom",
    },

    /* 4 — Search & filter */
    {
      element: document.getElementById("linksSearch"),
      intro: buildStep(
        "🔍",
        `<span class="mt-hl">Search</span> &amp; Filter`,
        `Use the search bar to instantly filter links by name or tag. The <strong>Sort</strong> dropdown lets you reorder by <em>Newest</em>, <em>Most Upvoted</em>, or <em>Highest Rated</em> — so you always find exactly what you're looking for.`,
        null,
        `Sort by <strong>Highest Rated</strong> to surface the most loved community picks instantly.`,
        4, TOTAL
      ),
      position: "bottom",
    },

    /* 5 — Share button */
    {
      element: document.getElementById("tourShareBtn"),
      intro: buildStep(
        "➕",
        `Share Links &amp; <span class="mt-hl">Earn Credits</span>`,
        `Found something awesome? Hit <strong>+ Share</strong> to contribute it to the community. You'll earn <strong>+50 credits</strong> immediately, and every upvote your link collects adds another <strong>+10 credits</strong> to your balance. You can also upload custom HTML pages!`,
        [
          { label: "Share = +50 🪙", type: "green" },
          { label: "Per upvote = +10 🪙", type: "green" },
          { label: "Quality bonus = +50 🪙/mo", type: "" },
        ],
        `Links with an average rating above 4.7 and 10+ reviews earn a monthly quality bonus!`,
        5, TOTAL
      ),
      position: "bottom",
    },

    /* 6 — Credits & tier pill */
    {
      element: document.getElementById("tourCreditsPill"),
      intro: buildStep(
        "🪙",
        `Credits &amp; <span class="mt-hl">Rank System</span>`,
        `Credits are your platform currency and reputation score. Earn them multiple ways and spend them to unlock more session time. Your rank rises as you accumulate credits, unlocking longer sessions and exclusive perks.`,
        [
          { label: "Basic", type: "" },
          { label: "Silver", type: "" },
          { label: "Gold", type: "purple" },
          { label: "VIP", type: "purple" },
        ],
        `Refer a friend with your personal referral code and earn <strong>+150 credits</strong> — the fastest way to rank up!`,
        6, TOTAL
      ),
      position: "bottom",
    },

    /* 7 — Session timer */
    {
      element: document.getElementById("navSessionTime"),
      intro: buildStep(
        "⏱️",
        `Your <span class="mt-hl">Session Timer</span>`,
        `Every new browser session starts with <strong>30 free minutes</strong> shared across all links you open. When time runs low, click this button to top up for <strong>50 credits</strong>. Higher ranks get more minutes per top-up — VIP gets a whopping 6 hours per purchase! ⚡`,
        [
          { label: "Basic = 45 min/top-up", type: "" },
          { label: "Silver = 60 min", type: "" },
          { label: "Gold = 2 hrs", type: "purple" },
          { label: "VIP = 6 hrs", type: "purple" },
        ],
        `The timer only counts down while you have a link open inside the platform, so browse the feed for free!`,
        7, TOTAL
      ),
      position: "bottom",
    },

    /* 8 — Inbox / notifications bell */
    {
      element: document.getElementById("notifBtn"),
      intro: buildStep(
        "🔔",
        `<span class="mt-hl">Notifications</span> &amp; Inbox`,
        `The bell icon shows your notification count. Receive alerts when someone upvotes your links, when your appeal vote is counted, or when the platform has an important announcement. Click the bell or visit your full <strong>Inbox</strong> to stay in the loop.`,
        null,
        `Red badge = unread messages. Keep it at zero to never miss credit rewards or community updates!`,
        8, TOTAL
      ),
      position: "bottom",
    },

    /* 9 — Daily streak */
    {
      element: document.getElementById("tourTabDaily"),
      intro: buildStep(
        "🔥",
        `Daily <span class="mt-hl">Streak</span> Rewards`,
        `Log in every day and claim your daily reward to build a streak. The longer your streak, the bigger your daily payout. Miss a day and the streak resets to zero — consistency is rewarded! Hit milestone streaks for special bonus credits and badges. 🏆`,
        null,
        `Even a 2-day streak gives a bonus multiplier. Set a daily reminder and never miss a claim!`,
        9, TOTAL
      ),
      position: "bottom",
    },

    /* 10 — Leaderboard */
    {
      element: document.getElementById("tourTabLeaderboard"),
      intro: buildStep(
        "🏆",
        `<span class="mt-hl">Leaderboard</span> &amp; Prizes`,
        `The leaderboard ranks users by time spent on the platform each bi-monthly season. The <strong>top 10</strong> players earn credit prizes when the season resets — and the higher your rank, the bigger the payout. Can you claim the #1 spot? 💰`,
        [
          { label: "Top 10 earn prizes", type: "green" },
          { label: "Season resets bi-monthly", type: "" },
        ],
        `Stack your session time and keep your daily streak active to dominate the leaderboard!`,
        10, TOTAL
      ),
      position: "bottom",
    },

    /* 11 — News */
    {
      element: document.getElementById("tourTabNews"),
      intro: buildStep(
        "📰",
        `News &amp; <span class="mt-hl">Announcements</span>`,
        `Stay in the loop with platform updates, new feature rollouts, and community announcements. The upcoming <strong>Social Chat</strong> feature is almost here — Gold Rank members and users with 2+ referrals get early access. 💬`,
        null,
        `Check News regularly — limited-time credit events and bonus promotions are announced here first!`,
        11, TOTAL
      ),
      position: "bottom",
    },

    /* 12 — Account */
    {
      element: document.getElementById("tourTabAccount"),
      intro: buildStep(
        "👤",
        `Your <span class="mt-hl">Account</span> &amp; Profile`,
        `The Account tab is your personal dashboard. View your credit balance, rank progress, submission history, and your unique <strong>referral code</strong>. Share that code with friends — each person who signs up through it earns you <strong>+150 credits</strong>! You can also customise your avatar, bio, and display name here. 🤝`,
        [
          { label: "Referral = +150 🪙 each", type: "green" },
        ],
        `Your referral code is permanent. Post it on social media or share it in class for passive credit income!`,
        12, TOTAL
      ),
      position: "bottom",
    },

    /* 13 — Finale (no element) */
    {
      intro: `<div class="mt-finale">
        <span class="mt-finale-emoji">🎉</span>
        <div class="mt-finale-title">Tour Complete!</div>
        <p class="mt-finale-body">
          You now know everything there is to know about <strong style="color:#f1f5f9">Math Katy</strong>.
          Start exploring, earn credits, climb the ranks, and share your favourite sites with the community.
          Good luck out there! 🚀
        </p>
        <p class="mt-finale-sub">Hit <em>Let's Go!</em> to dive in.</p>
      </div>`,
    },
  ].filter(s => !s.element || document.body.contains(s.element));

  const tour = introJs().setOptions({
    steps: rawSteps,
    showProgress: true,
    showBullets: false,
    showStepNumbers: false,
    exitOnOverlayClick: false,
    exitOnEsc: false,
    showSkipButton: false,
    nextLabel: "Next &rarr;",
    prevLabel: "&larr; Back",
    doneLabel: "Let&rsquo;s Go! 🚀",
    tooltipClass: "math-tour-tooltip",
    overlayOpacity: 0.72,
    scrollToElement: true,
    scrollPadding: 80,
    disableInteraction: false,
    helperElementPadding: 10,
  });

  tour.oncomplete(() => markTourComplete(uid));
  tour.onexit(() => markTourComplete(uid));

  setTimeout(() => tour.start(), 150);
}

async function markTourComplete(uid) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, "users", uid), { tourComplete: true });
  } catch (e) {
    console.warn("Could not mark tour complete:", e);
  }
}

async function handleSave() {
  if (_isSaving) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const first = (firstInput?.value || "").trim();
  const last = (lastInput?.value || "").trim();
  const grade = gradeSelect?.value || "";

  if (errorEl) errorEl.textContent = "";

  if (!first || first.length < 2) {
    if (errorEl) errorEl.textContent = "Please enter your first name (at least 2 characters).";
    firstInput?.focus();
    return;
  }

  if (first.length > 20) {
    if (errorEl) errorEl.textContent = "First name is too long (max 20 characters).";
    firstInput?.focus();
    return;
  }

  if (!grade) {
    if (errorEl) errorEl.textContent = "Please select your grade.";
    gradeSelect?.focus();
    return;
  }

  setSavingState(true);

  try {
    await updateDoc(doc(db, "users", uid), {
      firstName: first,
      lastName: last,
      grade: grade,
      onboardingComplete: true,
    });

    await finalizeOnboarding(uid, first);
  } catch (err) {
    console.error("Onboarding save error:", err);
    if (errorEl) errorEl.textContent = "Failed to save. Please try again.";
    setSavingState(false);
  }
}

saveBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSave();
});

[firstInput, lastInput].forEach((el) => {
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  });
});
