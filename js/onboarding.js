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
 * Launch the mandatory Intro.js guided tour for new users.
 * The tour is non-bypassable (no skip button, no ESC, no overlay-click-to-close).
 */
function startGuidedTour(uid) {
  if (typeof introJs === "undefined") {
    markTourComplete(uid);
    return;
  }

  const steps = [
    {
      element: document.querySelector(".navbar-brand"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.4rem;font-weight:800;margin-bottom:8px">🎮 Welcome to <strong>Math Katy</strong>!</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Your all-in-one hub for discovering and sharing the best game &amp; study sites.
          Let's take a quick tour — it'll only take a minute! 🚀
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourNavTabs"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">🗺️ Navigation Tabs</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          These tabs are your main compass. Switch between <strong>Links</strong>,
          <strong>Daily</strong>, <strong>Leaderboard</strong>, <strong>News</strong>,
          and your <strong>Account</strong> — all without leaving the page.
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourTabLinks"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">🔗 Community Links</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Browse, search, and rate links submitted by your peers. Click any card to open
          the site <strong>inside</strong> the platform. Report broken ones to keep the
          library clean! 🧹
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourShareBtn"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">➕ Share &amp; Earn!</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Found something awesome? Hit <strong>+ Share</strong> and pocket
          <strong>+50 credits</strong> instantly. The more quality links you contribute,
          the more the community loves you. 🤩
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourCreditsPill"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">🪙 Credits &amp; Rank</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Credits are your platform currency. Earn them by sharing links, receiving upvotes,
          referring friends (<strong>+150 each!</strong>), and daily streaks.
          Accumulate enough to climb <strong>Basic → Silver → Gold → VIP</strong>! 🏅
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("navSessionTime"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">⏱️ Session Timer</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          You get <strong>30 free minutes</strong> per session to explore links.
          Running low? Spend <strong>50 credits</strong> to top up. Higher ranks unlock
          more time per purchase — Gold gets 2 hrs, VIP gets 6 hrs! ⚡
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourTabDaily"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">🔥 Daily Streak</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Claim your daily reward every day to build a streak. Miss a day and it resets —
          stay consistent for bonus credits and milestone badges! 🏆
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourTabLeaderboard"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">🏆 Leaderboard</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          See who's logging the most time bi-monthly. The <strong>top 10</strong> earn
          credit prizes when the season resets — higher rank means bigger reward! 💰
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourTabNews"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">📰 News &amp; Announcements</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Stay in the loop! Check News for upcoming features and platform announcements —
          including the upcoming <strong>Social Chat</strong> feature (Gold Rank or 2 referrals gets early access). 💬
        </p>
      </div>`,
      position: "bottom",
    },
    {
      element: document.getElementById("tourTabAccount"),
      intro: `<div style="max-width:280px">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">👤 Your Account</div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5">
          Manage your profile, track stats, view your referral code, and monitor rank progress —
          all from the Account tab. Share your code to earn <strong>+150 credits</strong> per friend! 🤝
        </p>
      </div>`,
      position: "bottom",
    },
    {
      intro: `<div style="max-width:300px;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">🎉</div>
        <div style="font-size:1.25rem;font-weight:800;margin-bottom:8px;color:#38bdf8">
          Tour Complete!
        </div>
        <p style="font-size:0.85rem;color:#9ca3af;line-height:1.5;margin-bottom:12px">
          You now know your way around Math Katy. Start exploring, earn credits, climb the ranks,
          and share your favourite sites with the community. Good luck! 🚀
        </p>
        <p style="font-size:0.75rem;color:#4b5563">
          Hit "Let's Go!" to dive in.
        </p>
      </div>`,
    },
  ].filter(s => !s.element || document.body.contains(s.element));

  const tour = introJs().setOptions({
    steps,
    showProgress: true,
    showBullets: false,
    exitOnOverlayClick: false,
    exitOnEsc: false,
    showSkipButton: false,
    nextLabel: "Next →",
    prevLabel: "← Back",
    doneLabel: "Let's Go! 🚀",
    tooltipClass: "math-tour-tooltip",
    overlayOpacity: 0.65,
    scrollToElement: true,
    disableInteraction: false,
  });

  tour.oncomplete(() => markTourComplete(uid));
  tour.onexit(() => markTourComplete(uid));

  setTimeout(() => tour.start(), 100);
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
