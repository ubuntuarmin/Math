import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  increment,
  addDoc,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";

const linksGrid    = document.getElementById("linksGrid");
const creditCount  = document.getElementById("creditCount");
const tierLabel    = document.getElementById("tierLabel");
const linksLoading = document.getElementById("linksLoading");
const linksEmpty   = document.getElementById("linksEmpty");

const LINK_CREDITS        = 50;
const UPVOTE_CREDITS      = 10;
const SESSION_COST        = 50;  // credits per time top-up
const MAX_SESSION_USERS   = 6;   // max concurrent users per link
const REPORT_THRESHOLD    = 3;
const APPEAL_VOTE_CREDITS   = 10;
const APPEAL_VOTE_THRESHOLD = 10;
const RATING_REQUIRED_MS  = 10000; // 10 seconds minimum to unlock rating
const IFRAME_LOAD_TIMEOUT_MS = 15000; // 15 seconds before showing embed-blocked error
const FREE_SESSION_MS     = 30 * 60 * 1000; // 30 free minutes per browser session
const GLOBAL_SESSION_KEY  = "global_session"; // localStorage key for cross-link timer
const SESSION_TTL_MS      = 24 * 60 * 60 * 1000; // 24-hour TTL for stored session data
const SLOT_EXPIRY_FALLBACK_MS = 4 * 60 * 60 * 1000; // fallback slot expiry for orphaned sessions
const LOW_TIME_WARNING_MS = 5 * 60 * 1000;  // warn when < 5 minutes remain in session

const LEADERBOARD_RESET_DAYS = [15, 29];

function toMillisSafe(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function getCurrentBimonthlyResetMillis(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (day >= LEADERBOARD_RESET_DAYS[1]) {
    return new Date(year, month, LEADERBOARD_RESET_DAYS[1], 0, 0, 0, 0).getTime();
  }
  if (day >= LEADERBOARD_RESET_DAYS[0]) {
    return new Date(year, month, LEADERBOARD_RESET_DAYS[0], 0, 0, 0, 0).getTime();
  }
  return new Date(year, month - 1, LEADERBOARD_RESET_DAYS[1], 0, 0, 0, 0).getTime();
}

// Helper: compute average rating string ("4.2") or null
function calcAvgRating(ratingSum, ratingCount) {
  if (!ratingCount) return null;
  return (ratingSum / ratingCount).toFixed(1);
}

// Module state
let allDocs        = [];
let activeFilter   = null;   // { type: 'profile'|'hashtag', value, label }
let searchTerm     = "";
let sortMode       = "newest";
let isLoadingLinks = false;  // guard against concurrent loadLinks calls

// Cached current user data (set by updateUI, refreshed via userProfileUpdated event)
let currentUserData = null;

// Session tracking state
let currentLinkId         = null; // linkId of the link currently open (non-owner)
let activeSessionExpiry   = 0;    // ms since epoch when current session window expires
let sessionTimerInterval  = null; // setInterval id for countdown

// Iframe / rating state
let iframeOpenTime       = 0;
let iframeLoaded         = false;
let pendingRating        = null; // { linkId, title, submittedBy }
let selectedStars        = 0;
let ratingTimerOut       = null;
let iframeLoadTimeout    = null; // 15-second embed-detection timeout
let currentBlobUrl       = null; // active Blob URL for HTML submissions
let loadingFrame         = null; // cached reference to loading animation iframe
let loadingAnimCompleted = false; // true once loading.html has sent animationComplete at least once
let setupDone            = false;
let pendingDelete        = null; // { linkId, data, cardEl }
let appealsLoaded        = false;

// ── Optimization caches ───────────────────────────────────────────────────────
// Avoids redundant Firestore reads within a session.

// Set of linkIds the current user has already rated (populated on successful submit
// and on cache-hit in checkAndShowRatingModal).
const ratedLinksCache = new Set();

// Profile data cache: uid → { userData, ratings, expiresAt }
const profileCache = new Map();
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Client-side rate limiting ─────────────────────────────────────────────────
// Uses localStorage sliding-window counters for fast, client-only enforcement.
// The Firestore security rules enforce equivalent limits server-side.

/**
 * Returns how many events in the given localStorage key occurred within
 * the last `windowMs` milliseconds.
 */
function rateLimitCount(storageKey, windowMs) {
  const now = Date.now();
  let history;
  try {
    history = JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch (_) {
    history = [];
  }
  return history.filter(t => now - t < windowMs).length;
}

/**
 * Records a new event timestamp for the given key, pruning entries outside
 * `windowMs` to prevent unbounded localStorage growth.
 */
function rateLimitRecord(storageKey, windowMs) {
  const now = Date.now();
  let history;
  try {
    history = JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch (_) {
    history = [];
  }
  history = history.filter(t => now - t < windowMs);
  history.push(now);
  try {
    localStorage.setItem(storageKey, JSON.stringify(history));
  } catch (_) {}
}

/**
 * Returns true when the action is allowed (under the limit).
 * Limits:
 *   reviews       – 10 per 10 seconds  (matches Firestore rule)
 *   upvotes       – 30 per hour
 *   profileUpvotes– 20 per hour
 *   reports       – 5  per hour
 *   appealVotes   – 3  per hour
 *   sessionBuys   – 10 per hour
 */
function checkRateLimit(storageKey, maxCount, windowMs) {
  return rateLimitCount(storageKey, windowMs) < maxCount;
}

// Loading-animation state — iframe is revealed only once BOTH flags are true
let animationDone     = false; // set when loading.html sends 'animationComplete'
let iframeFrameLoaded = false; // set when the content iframe fires onload

/** Reveal the content iframe and hide the loading overlay */
function revealIframe() {
  const loader      = document.getElementById("iframeLoader");
  const quickLoader = document.getElementById("quickLoader");
  const frame       = document.getElementById("iframeFrame");
  const rateBtn     = document.getElementById("iframeRateBtn");
  if (loader)      loader.classList.add("hidden");
  if (quickLoader) quickLoader.classList.add("hidden");
  // Restore loadingFrame visibility so it is ready for the next first-open
  if (loadingFrame) loadingFrame.style.display = "";
  if (frame)  frame.classList.remove("opacity-0");
  iframeLoaded = true;
  if (pendingRating?.linkId && auth.currentUser) {
    ratingTimerOut = setTimeout(() => {
      if (rateBtn) rateBtn.classList.remove("hidden");
    }, RATING_REQUIRED_MS);
  }
}

// Listen for the end-of-animation signal from loading.html
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (!loadingFrame || event.source !== loadingFrame.contentWindow) return;
  if (event.data === "animationComplete") {
    animationDone = true;
    loadingAnimCompleted = true; // remember that the animation has played at least once
    if (iframeFrameLoaded) revealIframe();
  }
});

// Exported: called by auth.js after sign-in
export function updateUI(userData) {
  currentUserData = userData || null;
  if (creditCount) creditCount.textContent = userData?.credits ?? 0;
  if (tierLabel) {
    const tier = calculateTier(userData?.totalEarned ?? 0);
    tierLabel.textContent = tier.name;
    tierLabel.style.color = tier.color;
  }
  updateNavSessionTimer();
  if (!setupDone) {
    setupDone = true;
    setupSearchSort();
    setupRatingModal();
    setupDeleteModal();
    setupEditLinkModal();
    setupAppealsTab();
    setupShareReminder();
    // Keep currentUserData in sync when other modules update the profile
    window.addEventListener("userProfileUpdated", (e) => {
      if (e.detail) currentUserData = e.detail;
    });
  }
  loadLinks();
}

// ── Share reminder ────────────────────────────────────────────────────────────

const SHARE_BANNER_KEY     = "shareReminderDismissed"; // localStorage key
const SHARE_REMINDER_TOAST_INTERVAL_MS = 8 * 60 * 1000; // show toast every 8 min of browsing

let shareReminderToastTimer = null;

/**
 * Wire up the share reminder banner dismiss button and schedule periodic
 * toast nudges to encourage link sharing for credits.
 */
function setupShareReminder() {
  const banner    = document.getElementById("shareReminderBanner");
  const dismissBtn = document.getElementById("dismissShareBanner");

  // Hide banner permanently if the user already dismissed it this session
  if (banner) {
    const dismissed = sessionStorage.getItem(SHARE_BANNER_KEY);
    if (dismissed) {
      banner.classList.add("sr-hide");
    }
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      sessionStorage.setItem(SHARE_BANNER_KEY, "1");
      if (banner) banner.classList.add("sr-hide");
    });
  }

  // Schedule a periodic toast nudge (only while the user is on the page and browsing)
  scheduleShareReminderToast();
}

function scheduleShareReminderToast() {
  if (shareReminderToastTimer) clearTimeout(shareReminderToastTimer);
  shareReminderToastTimer = setTimeout(() => {
    // Only show the toast if no modal is open and user is signed in
    const iframeOpen = document.getElementById("iframeModal") &&
      !document.getElementById("iframeModal").classList.contains("hidden");
    if (!iframeOpen && auth.currentUser) {
      showToast("🔗 Share a link to earn +50 credits! Help the community grow.");
    }
    scheduleShareReminderToast(); // reschedule
  }, SHARE_REMINDER_TOAST_INTERVAL_MS);
}

// Notification helper
// Also updates the sender's message rate-limit window on the user doc so the
// Firestore rule `messageRateLimitOk()` has accurate state to check.
async function sendNotification(toUid, title, text, type = "system") {
  const senderUid = auth.currentUser?.uid;
  try {
    await addDoc(collection(db, "messages"), {
      to: toUid,
      fromName: "System",
      title,
      text,
      type,
      timestamp: serverTimestamp(),
      read: false,
    });
    // Keep the message rate-limit window fields up to date on the user doc so
    // the server-side Firestore rule can enforce the 50-messages/hour limit.
    if (senderUid) {
      const now        = Date.now();
      const userData   = currentUserData || {};
      const winStart   = userData.messageWindowStart || 0;
      const isNewWin   = (now - winStart) > 3600000;
      const msgUpdate  = isNewWin
        ? { messageWindowStart: now, messageWindowCount: 1 }
        : { messageWindowCount: increment(1) };
      try {
        await updateDoc(doc(db, "users", senderUid), msgUpdate);
        if (currentUserData) {
          if (isNewWin) {
            currentUserData.messageWindowStart = now;
            currentUserData.messageWindowCount = 1;
          } else {
            currentUserData.messageWindowCount = (currentUserData.messageWindowCount || 0) + 1;
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn("Failed to send notification:", err);
  }
}

// Load all active links
async function loadLinks() {
  if (!linksGrid) return;
  // Do nothing if the user is not yet authenticated (avoids permission-denied errors)
  if (!auth.currentUser) return;
  // Guard against concurrent loads (e.g. rapid refresh clicks or profile-update triggers)
  if (isLoadingLinks) return;
  isLoadingLinks = true;

  if (linksLoading) linksLoading.classList.remove("hidden");
  if (linksEmpty)   linksEmpty.classList.add("hidden");
  linksGrid.innerHTML = "";

  try {
    // Query the most recent 100 links without a composite index requirement.
    // Active-status filtering is applied client-side so a single-field index suffices.
    const q    = query(
      collection(db, "sharedLinks"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const snap = await getDocs(q);

    if (linksLoading) linksLoading.classList.add("hidden");

    allDocs = [];
    snap.forEach(s => {
      const data = s.data();
      if (data.status === "active") allDocs.push({ id: s.id, data });
    });

    filterAndRenderLinks();
  } catch (err) {
    console.error("Links load error:", err);
    if (linksLoading) linksLoading.classList.add("hidden");
    if (linksGrid) {
      linksGrid.innerHTML =
        '<div class="col-span-full text-center text-red-400 py-10 text-sm">' +
        'Failed to load links. Please check your connection and ' +
        '<button class="retry-load-links underline hover:text-red-300 transition-colors">try again</button>.' +
        '</div>';
      // innerHTML replaces the old node each time, so there is exactly one listener per failure.
      linksGrid.querySelector(".retry-load-links")?.addEventListener("click", () => loadLinks());
    }
  } finally {
    isLoadingLinks = false;
  }
}

// Filter + sort + render
function filterAndRenderLinks() {
  if (!linksGrid) return;
  linksGrid.innerHTML = "";

  const uid  = auth.currentUser?.uid ?? "";
  const term = searchTerm.toLowerCase();

  let docs = allDocs.filter(({ data }) => {
    if (activeFilter) {
      if (activeFilter.type === "profile" && data.submittedBy !== activeFilter.value) return false;
      if (activeFilter.type === "hashtag") {
        const tags = (data.hashtags || []).map(t => t.toLowerCase());
        if (!tags.includes(activeFilter.value.toLowerCase())) return false;
      }
    }
    if (term) {
      const haystack = [
        data.title || "",
        data.description || "",
        data.submittedByName || "",
        ...(data.hashtags || []),
      ].join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  if (sortMode === "upvotes") {
    docs.sort((a, b) => (b.data.upvoteCount || 0) - (a.data.upvoteCount || 0));
  } else if (sortMode === "rating") {
    docs.sort((a, b) => {
      const aAvg = parseFloat(calcAvgRating(a.data.ratingSum, a.data.ratingCount) ?? "0");
      const bAvg = parseFloat(calcAvgRating(b.data.ratingSum, b.data.ratingCount) ?? "0");
      return bAvg - aAvg;
    });
  } else {
    docs.sort((a, b) => {
      const aMs = a.data.createdAt?.toMillis?.() ?? 0;
      const bMs = b.data.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });
  }

  if (docs.length === 0) {
    if (linksEmpty) linksEmpty.classList.remove("hidden");
    updateFilterBar();
    return;
  }

  if (linksEmpty) linksEmpty.classList.add("hidden");
  docs.forEach(({ id, data }) => renderLinkCard(id, data, uid));
  updateFilterBar();
}

// Update active filter indicator bar
function updateFilterBar() {
  const bar    = document.getElementById("activeFilterBar");
  const textEl = document.getElementById("activeFilterText");
  if (!bar || !textEl) return;

  if (activeFilter) {
    textEl.textContent =
      activeFilter.type === "profile"
        ? "\u{1F4CC} Showing links by " + activeFilter.label
        : "\u{1F3F7}\uFE0F Filtering by " + activeFilter.label;
    bar.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
  }
}

// Set an active filter (profile or hashtag)
function setLinkFilter(type, value, label) {
  activeFilter = { type, value, label };

  document.querySelectorAll(".tab-btn").forEach(btn => {
    const active = btn.dataset.tab === "links";
    btn.classList.toggle("active", active);
    btn.style.color        = active ? "#38bdf8" : "";
    btn.style.borderBottom = active ? "2px solid #38bdf8" : "";
  });
  document.querySelectorAll(".tab-content").forEach(el => {
    el.classList.toggle("active", el.id === "tab-links");
  });

  filterAndRenderLinks();
}

// Setup search + sort controls
function setupSearchSort() {
  const searchInput = document.getElementById("linksSearch");
  const sortSelect  = document.getElementById("linksSort");
  const clearBtn    = document.getElementById("clearFilterBtn");

  // Debounce search input so Firestore filtering doesn't fire on every keystroke
  let searchDebounce = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = searchInput.value.trim();
      filterAndRenderLinks();
    }, 150);
  });

  sortSelect?.addEventListener("change", () => {
    sortMode = sortSelect.value;
    filterAndRenderLinks();
  });

  clearBtn?.addEventListener("click", () => {
    activeFilter = null;
    if (searchInput) { searchInput.value = ""; searchTerm = ""; }
    filterAndRenderLinks();
  });
}

// Render a single link card
function renderLinkCard(id, data, currentUid) {
  if (!linksGrid) return;

  const hasReported = Array.isArray(data.reports) &&
    data.reports.some(r => r.uid === currentUid);
  const reportCount = data.reportCount || 0;

  const hasUpvoted = Array.isArray(data.upvotes) &&
    data.upvotes.some(u => u === currentUid || u?.uid === currentUid);
  const upvoteCount  = data.upvoteCount || 0;

  const safeName    = escapeHtml(data.submittedByName || "Anonymous");
  const safeTitle   = escapeHtml(data.title || "Untitled");
  const safeDesc    = data.description ? escapeHtml(data.description) : "";
  const submittedBy = data.submittedBy || "";
  const isHtml      = data.type === "html";

  const hashtags     = Array.isArray(data.hashtags) ? data.hashtags : [];
  const hashtagsHtml = hashtags.length
    ? '<div class="flex flex-wrap gap-1 mt-1.5">' +
      hashtags.map(t =>
        '<button class="hashtag-btn text-[10px] px-2 py-0.5 rounded-full ' +
        'bg-blue-500/10 text-blue-300 border border-blue-500/20 ' +
        'hover:bg-blue-500/30 transition-colors" ' +
        'data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>'
      ).join("") + '</div>'
    : "";

  const typeBadge = isHtml
    ? '<span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ' +
      'bg-purple-500/20 text-purple-300 border border-purple-500/30 ml-1">HTML</span>'
    : "";

  const avgRating  = calcAvgRating(data.ratingSum, data.ratingCount);
  const ratingHtml = avgRating !== null
    ? '<span class="text-[10px] text-yellow-400 flex items-center gap-0.5">' +
      '\u2B50 ' + avgRating +
      ' <span class="text-gray-600">(' + data.ratingCount + ')</span></span>'
    : "";

  const reportSection = hasReported
    ? '<span class="text-[10px] text-gray-500 italic">You reported this</span>'
    : '<div class="relative report-wrapper">' +
      '<button class="report-btn text-[10px] text-gray-500 hover:text-orange-400 ' +
      'transition-colors px-2 py-1 rounded border border-gray-700 ' +
      'hover:border-orange-500/60 leading-none" data-id="' + id + '">Report \u25BE</button>' +
      '<div class="report-dropdown hidden absolute right-0 bottom-full mb-1 z-20 ' +
      'bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl min-w-[150px]">' +
      '<button class="report-type w-full text-left px-4 py-2.5 text-xs text-gray-200 ' +
      'hover:bg-red-900/40 hover:text-red-300 transition-colors flex items-center gap-2" ' +
      'data-id="' + id + '" data-type="fake"><span>\uD83D\uDEAB</span> Fake / Spam</button>' +
      '<button class="report-type w-full text-left px-4 py-2.5 text-xs text-gray-200 ' +
      'hover:bg-orange-900/40 hover:text-orange-300 transition-colors flex items-center gap-2" ' +
      'data-id="' + id + '" data-type="blocked"><span>\u26D4</span> Blocked / Broken</button>' +
      '</div></div>';

  const isOwner = submittedBy === currentUid;

  // Owners see edit + delete buttons instead of the report section; they also can't upvote their own
  const actionSection = isOwner
    ? '<button class="edit-link-btn text-[10px] text-blue-400 hover:text-blue-300 ' +
      'transition-colors px-2 py-1 rounded border border-gray-700 ' +
      'hover:border-blue-500/60 leading-none flex items-center gap-1" ' +
      'data-id="' + id + '">\u270F\uFE0F Edit</button>' +
      '<button class="delete-link-btn text-[10px] text-red-500 hover:text-red-400 ' +
      'transition-colors px-2 py-1 rounded border border-gray-700 ' +
      'hover:border-red-500/60 leading-none flex items-center gap-1" ' +
      'data-id="' + id + '">\uD83D\uDDD1\uFE0F Delete</button>'
    : reportSection;

  const upvoteSection = isOwner
    ? (upvoteCount > 0
        ? '<span class="text-[10px] text-blue-400 font-bold flex items-center gap-1">' +
          '\uD83D\uDC4D ' + upvoteCount + '</span>'
        : '')
    : (hasUpvoted
        ? '<span class="text-[10px] text-blue-400 font-bold flex items-center gap-1">' +
          '\uD83D\uDC4D ' + upvoteCount + '</span>'
        : '<button class="upvote-btn text-[10px] text-gray-500 hover:text-blue-400 ' +
          'transition-colors px-2 py-1 rounded border border-gray-700 ' +
          'hover:border-blue-500/60 leading-none flex items-center gap-1" ' +
          'data-id="' + id + '" data-submitter="' + submittedBy + '">' +
          '\uD83D\uDC4D ' + (upvoteCount > 0 ? upvoteCount : "Upvote") +
          ' <span class="text-emerald-400">(+' + UPVOTE_CREDITS + '\u2728)</span></button>');

  const card = document.createElement("div");
  card.dataset.linkId = id;
  card.className =
    "link-card relative flex flex-col gap-3 p-5 rounded-2xl " +
    "bg-gray-900/80 border border-gray-700/60 " +
    "hover:border-blue-500/60 transition-all duration-200 " +
    "hover:-translate-y-1 shadow-lg";

  card.innerHTML =
    '<div class="flex items-start justify-between gap-2">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-1 flex-wrap">' +
          '<span class="text-white font-bold text-base truncate">' + safeTitle + '</span>' +
          typeBadge +
        '</div>' +
        hashtagsHtml +
      '</div>' +
      '<button class="open-link-btn shrink-0 px-3 py-1.5 ' +
      (isHtml ? 'bg-purple-600/80 hover:bg-purple-500' : 'bg-blue-600/80 hover:bg-blue-500') +
      ' text-white text-xs font-bold rounded-full transition-colors flex items-center gap-1" ' +
      'data-id="' + id + '">' + (isHtml ? '▶ Play' : 'Open \u2197') + '</button>' +
    '</div>' +
    (safeDesc ? '<p class="text-gray-400 text-xs leading-relaxed line-clamp-2">' + safeDesc + '</p>' : '') +
    '<div class="flex items-center justify-between mt-auto pt-2 border-t border-gray-800">' +
      '<div class="card-footer-left flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">' +
        '<span>Shared by</span>' +
        '<button class="view-profile-btn text-gray-400 hover:text-blue-300 transition-colors ' +
        'underline-offset-2 hover:underline" ' +
        'data-uid="' + submittedBy + '" data-name="' + safeName + '">' + safeName + '</button>' +
        (reportCount > 0
          ? ' \u00B7 <span class="text-orange-400">\u26A0 ' + reportCount +
            ' report' + (reportCount !== 1 ? "s" : "") + '</span>'
          : "") +
        (ratingHtml ? ' \u00B7 ' + ratingHtml : "") +
      '</div>' +
      '<div class="flex items-center gap-2">' + upvoteSection + actionSection + '</div>' +
    '</div>';

  card.querySelector(".open-link-btn").addEventListener("click", () => {
    openIframeModal(data.url, safeTitle, id, submittedBy, data.htmlContent || null);
  });

  card.querySelector(".view-profile-btn").addEventListener("click", () => {
    openProfileModal(submittedBy, safeName);
  });

  card.querySelectorAll(".hashtag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      setLinkFilter("hashtag", btn.dataset.tag, btn.dataset.tag);
    });
  });

  const upvoteBtn = card.querySelector(".upvote-btn");
  if (upvoteBtn) {
    upvoteBtn.addEventListener("click", async () => {
      if (!auth.currentUser) { alert("You must be signed in to upvote."); return; }
      await handleUpvote(id, data, upvoteBtn, card);
    });
  }

  const reportBtn = card.querySelector(".report-btn");
  const dropdown  = card.querySelector(".report-dropdown");
  if (reportBtn && dropdown) {
    reportBtn.addEventListener("click", e => {
      e.stopPropagation();
      document.querySelectorAll(".report-dropdown").forEach(d => {
        if (d !== dropdown) d.classList.add("hidden");
      });
      dropdown.classList.toggle("hidden");
    });
  }

  card.querySelectorAll(".report-type").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const linkId = btn.dataset.id;
      const type   = btn.dataset.type;
      if (!linkId || !type) return;
      if (!auth.currentUser) { alert("You must be signed in to report links."); return; }
      await handleReport(linkId, type, card);
    });
  });

  const deleteBtn = card.querySelector(".delete-link-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (!auth.currentUser) { alert("You must be signed in."); return; }
      openDeleteConfirmModal(id, data, card);
    });
  }

  const editBtn = card.querySelector(".edit-link-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      if (!auth.currentUser) { alert("You must be signed in."); return; }
      openEditLinkModal(id, data, card);
    });
  }

  linksGrid.appendChild(card);
}

// ── Session helpers ───────────────────────────────────────────────────────────

/** Return the count of currently active (unexpired) sessions for a link */
function getActiveSessionCount(sessions) {
  const now = Date.now();
  return (sessions || []).filter(s => s.expiresAt > now).length;
}

/**
 * Get the global cross-link session from localStorage.
 * Returns { remainingMs } or null if never started / expired.
 * Uses a 24-hour TTL so purchased time survives tab refreshes and re-opens.
 */
function getGlobalSession() {
  try {
    const raw = localStorage.getItem(GLOBAL_SESSION_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    // Invalidate stale entries older than 24 hours
    if (sess.ttlExpiry && Date.now() >= sess.ttlExpiry) {
      localStorage.removeItem(GLOBAL_SESSION_KEY);
      return null;
    }
    // If there is an active session with a future expiry timestamp, derive
    // remainingMs from it so the timer survives page refreshes mid-session.
    if (sess.activeExpiresAt && sess.activeExpiresAt > Date.now()) {
      sess.remainingMs = sess.activeExpiresAt - Date.now();
    }
    return sess;
  } catch (_) { return null; }
}

/**
 * Save the global session state to localStorage.
 * Preserves an existing TTL expiry or starts a fresh 24-hour window.
 * @param {{ remainingMs: number }} session
 */
function saveGlobalSession(session) {
  try {
    const existing   = getGlobalSession();
    const ttlExpiry  = existing?.ttlExpiry || (Date.now() + SESSION_TTL_MS);
    localStorage.setItem(GLOBAL_SESSION_KEY, JSON.stringify({ ...session, ttlExpiry }));
  } catch (_) {}
}

/**
 * Update the navbar session time display.
 * Shows live countdown when a session is active, otherwise shows saved remaining time.
 */
function updateNavSessionTimer() {
  const navTimeEl = document.getElementById("navSessionTimeLeft");
  const navBtn    = document.getElementById("navSessionTime");
  if (!navTimeEl) return;

  let remainingMs;
  if (activeSessionExpiry > 0) {
    remainingMs = Math.max(0, activeSessionExpiry - Date.now());
  } else {
    const gs = getGlobalSession();
    remainingMs = gs ? gs.remainingMs : FREE_SESSION_MS;
  }

  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  navTimeEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  if (navBtn) {
    if (remainingMs < LOW_TIME_WARNING_MS) {
      navBtn.classList.add("session-time-low");
    } else {
      navBtn.classList.remove("session-time-low");
    }
  }
}

/**
 * Start the live session countdown in the iframe header.
 * Closes the modal automatically when time runs out.
 */
function startSessionTimer(expiresAt) {
  clearSessionTimer();
  activeSessionExpiry = expiresAt;
  const timerEl = document.getElementById("sessionTimer");
  const timeLeftEl = document.getElementById("sessionTimeLeft");
  if (timerEl) timerEl.classList.remove("hidden");

  const tick = () => {
    const remaining = Math.max(0, activeSessionExpiry - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    if (timeLeftEl) {
      timeLeftEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    updateNavSessionTimer();
    if (remaining <= 0) {
      clearSessionTimer();
      showToast("⏰ Session time expired — you have been removed.");
      closeIframeModal();
    }
  };
  tick();
  sessionTimerInterval = setInterval(tick, 1000);
}

/** Stop the session countdown */
function clearSessionTimer() {
  if (sessionTimerInterval) { clearInterval(sessionTimerInterval); sessionTimerInterval = null; }
  const timerEl = document.getElementById("sessionTimer");
  if (timerEl) timerEl.classList.add("hidden");
  updateNavSessionTimer();
}

/**
 * Attempt to remove the current user's session entry from the link's activeSessions array.
 * Best-effort (fire-and-forget) — called on modal close.
 */
async function removeSessionFromLink(linkId) {
  const uid = auth.currentUser?.uid;
  if (!uid || !linkId) return;
  try {
    // Build the exact object that was stored so arrayRemove can match it
    // We need to find the exact entry — fetch the doc and filter client-side
    const linkRef = doc(db, "sharedLinks", linkId);
    const snap = await getDoc(linkRef);
    if (!snap.exists()) return;
    const sessions = snap.data().activeSessions || [];
    const filtered = sessions.filter(s => s.uid !== uid);
    await updateDoc(linkRef, { activeSessions: filtered });
  } catch (err) {
    console.warn("Session cleanup failed (non-critical):", err);
  }
}

/**
 * Show the session purchase modal. Resolves to true if user confirmed, false if cancelled.
 */
function showSessionPurchaseModal(title, sessionCount, tierName, sessionMinutes, userCredits) {
  return new Promise(resolve => {
    const modal       = document.getElementById("sessionBuyModal");
    const linkTitleEl = document.getElementById("sessionLinkTitle");
    const slotsEl     = document.getElementById("sessionSlotsUsed");
    const tierEl      = document.getElementById("sessionTierInfo");
    const creditsEl   = document.getElementById("sessionCreditsBalance");
    const confirmBtn  = document.getElementById("sessionConfirmBtn");
    const cancelBtn   = document.getElementById("sessionCancelBtn");
    if (!modal) { resolve(false); return; }

    if (linkTitleEl) linkTitleEl.textContent = title || "your session";
    if (slotsEl)     slotsEl.textContent     = `${sessionCount}/${MAX_SESSION_USERS}`;
    if (tierEl)      tierEl.textContent      = `${tierName} — +${sessionMinutes} min added`;
    if (creditsEl)   creditsEl.textContent   = userCredits;

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const cleanup = () => {
      modal.classList.add("hidden");
      document.body.style.overflow = "";
      confirmBtn?.removeEventListener("click", onConfirm);
      cancelBtn?.removeEventListener("click",  onCancel);
    };

    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel  = () => { cleanup(); resolve(false); };

    confirmBtn?.addEventListener("click", onConfirm, { once: true });
    cancelBtn?.addEventListener("click",  onCancel,  { once: true });
  });
}

// Open link in iframe modal — supports both URL and HTML-code submissions
async function openIframeModal(url, title, linkId, submittedBy, htmlContent) {
  const uid     = auth.currentUser?.uid;
  const isOwner = uid && submittedBy === uid;

  // Owners always open freely with no timer
  if (isOwner || !linkId) {
    _doOpenIframe(url, title, linkId, submittedBy, htmlContent, 0);
    return;
  }

  // ── Non-owner flow: global session with 30 free minutes ──────────────────
  const userData = currentUserData || {};
  const tier     = calculateTier(userData.totalEarned || 0);

  // Get or create global session (30 free minutes for new sessions)
  let gs = getGlobalSession();
  if (!gs) {
    gs = { remainingMs: FREE_SESSION_MS };
    saveGlobalSession(gs);
  }

  // If time is exhausted, prompt user to buy more time (50 credits → tier minutes)
  if (gs.remainingMs <= 0) {
    const userCredits = userData.credits || 0;

    if (userCredits < SESSION_COST) {
      showToast(`❌ Not enough credits — you need ${SESSION_COST} 🪙 to add more session time.`);
      return;
    }

    // Rate limit: max 10 time purchases per hour
    if (!checkRateLimit("sessionBuyHistory", 10, 3600000)) {
      showToast("⏳ You've reached the session purchase limit (10/hour). Please try again later.");
      return;
    }

    const cachedLink   = allDocs.find(d => d.id === linkId);
    const sessionCount = getActiveSessionCount(cachedLink?.data?.activeSessions);

    const confirmed = await showSessionPurchaseModal(
      title, sessionCount, tier.name, tier.limitMinutes, userCredits
    );
    if (!confirmed) return;

    // Atomically deduct credits; time is tracked client-side in localStorage
    try {
      const userRef = doc(db, "users", uid);
      await runTransaction(db, async (txn) => {
        const userSnap = await txn.get(userRef);
        if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");
        if ((userSnap.data().credits || 0) < SESSION_COST) throw new Error("INSUFFICIENT_CREDITS");
        txn.update(userRef, { credits: increment(-SESSION_COST) });
      });

      // Add rank-based minutes to the global session
      gs.remainingMs = tier.limitMinutes * 60 * 1000;
      saveGlobalSession(gs);

      if (currentUserData) currentUserData.credits = (currentUserData.credits || 0) - SESSION_COST;
      const creditEl = document.getElementById("creditCount");
      if (creditEl) creditEl.textContent = currentUserData?.credits ?? 0;

      rateLimitRecord("sessionBuyHistory", 3600000);
      updateNavSessionTimer();
    } catch (err) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        showToast(`❌ Not enough credits.`);
      } else {
        console.error("Session time purchase error:", err);
        showToast("❌ Failed to add session time. Please try again.");
      }
      return;
    }
  }

  // Compute the effective session expiry from remaining time
  const expiresAt = Date.now() + gs.remainingMs;

  // Persist the active session expiry so the countdown survives page refreshes.
  // When the modal closes, saveGlobalSession({ remainingMs }) replaces this entry
  // without activeExpiresAt, clearing the active-session marker.
  saveGlobalSession({ remainingMs: gs.remainingMs, activeExpiresAt: expiresAt });

  // Track this user in the link's activeSessions (enforces the 6-user capacity limit).
  // Uses a transaction so concurrent opens can't exceed the cap.
  try {
    const linkRef = doc(db, "sharedLinks", linkId);
    let freshSessions = [];

    await runTransaction(db, async (txn) => {
      const linkSnap = await txn.get(linkRef);
      if (!linkSnap.exists()) throw new Error("LINK_NOT_FOUND");

      freshSessions = (linkSnap.data().activeSessions || [])
        .filter(s => s.expiresAt > Date.now());

      // If user already has a slot (e.g. re-opened same link), skip adding again
      const alreadyIn = freshSessions.some(s => s.uid === uid);
      if (!alreadyIn) {
        if (freshSessions.length >= MAX_SESSION_USERS) throw new Error("SESSION_FULL");
        // Use a generous slot expiry as a fallback for orphaned sessions (browser crash etc.)
        const slotExpiry = Date.now() + Math.max(gs.remainingMs, SLOT_EXPIRY_FALLBACK_MS);
        txn.update(linkRef, { activeSessions: [...freshSessions, { uid, expiresAt: slotExpiry }] });
      }
    });

    // Update local cache
    const cl = allDocs.find(d => d.id === linkId);
    if (cl && !freshSessions.some(s => s.uid === uid)) {
      const slotExpiry = Date.now() + Math.max(gs.remainingMs, SLOT_EXPIRY_FALLBACK_MS);
      cl.data.activeSessions = [...freshSessions, { uid, expiresAt: slotExpiry }];
    }
  } catch (err) {
    if (err.message === "SESSION_FULL") {
      showToast(`❌ This link is full (${MAX_SESSION_USERS}/${MAX_SESSION_USERS} slots used). Try again later.`);
      return;
    } else if (err.message === "LINK_NOT_FOUND") {
      showToast("❌ Link not found.");
      return;
    } else {
      // Non-critical: slot tracking failed, open anyway
      console.warn("Session slot tracking failed (non-critical):", err);
    }
  }

  currentLinkId = linkId;
  _doOpenIframe(url, title, linkId, submittedBy, htmlContent, expiresAt);
}

/** Internal: actually open the iframe modal with optional session expiry tracking */
function _doOpenIframe(url, title, linkId, submittedBy, htmlContent, sessionExpiresAt) {
  const modal   = document.getElementById("iframeModal");
  const frame   = document.getElementById("iframeFrame");
  const loader     = document.getElementById("iframeLoader");
  const quickLoader = document.getElementById("quickLoader");
  const titleEl    = document.getElementById("iframeTitle");
  const rateBtn    = document.getElementById("iframeRateBtn");
  const errEl      = document.getElementById("iframeError");
  if (!modal || !frame || !loader) return;

  if (titleEl) titleEl.textContent = title || "Loading\u2026";
  frame.src = "";
  loader.classList.remove("hidden");
  // Re-use the loading animation if it has already completed (avoids a costly
  // Babylon.js reload). After the first run, show a random spot-file ad page
  // so Babylon.js does not consume GPU/CPU on every subsequent open.
  if (!loadingFrame) { loadingFrame = document.getElementById("loadingFrame"); }
  if (loadingAnimCompleted) {
    // Animation already played — skip Babylon.js, show spot-file ad loader instead.
    animationDone = true;
    if (loadingFrame) loadingFrame.style.display = "none";
    if (quickLoader) {
      // Pick a fresh random spot file on each open
      const _qf = document.getElementById("quickLoaderFrame");
      if (_qf) {
        const _n = Math.floor(Math.random() * 20) + 1;
        _qf.src = "spot_" + (_n < 10 ? "0" + _n : "" + _n) + ".html";
      }
      quickLoader.classList.remove("hidden");
    }
  } else {
    // First open: (re)load the animation so Babylon.js initialises.
    if (loadingFrame) { loadingFrame.style.display = ""; loadingFrame.src = "loading.html"; }
    if (quickLoader)  quickLoader.classList.add("hidden");
    animationDone = false;
  }
  frame.classList.add("opacity-0");
  if (rateBtn) rateBtn.classList.add("hidden");
  if (errEl)   errEl.classList.add("hidden");

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Pause the background canvas animation so the embedded game gets more CPU/GPU
  window._bgPaused = true;

  // Start session countdown if this is a purchased session
  if (sessionExpiresAt > Date.now()) {
    startSessionTimer(sessionExpiresAt);
  } else {
    clearSessionTimer();
  }

  iframeOpenTime    = Date.now();
  iframeLoaded      = false;
  // Keep animationDone = true if loadingAnimCompleted (set above); only reset when waiting
  // for a fresh animation.
  if (!loadingAnimCompleted) { animationDone = false; }
  iframeFrameLoaded = false;
  pendingRating  = { linkId: linkId || null, title, submittedBy: submittedBy || null };

  if (ratingTimerOut) { clearTimeout(ratingTimerOut); ratingTimerOut = null; }
  if (iframeLoadTimeout) { clearTimeout(iframeLoadTimeout); iframeLoadTimeout = null; }

  // 15-second timeout: if load event hasn't fired, assume site blocks embedding
  // (only for URL submissions; HTML blobs always load)
  if (!htmlContent) {
    iframeLoadTimeout = setTimeout(() => {
      if (!iframeFrameLoaded) {
        loader.classList.add("hidden");
        showIframeError(url, title);
      }
    }, IFRAME_LOAD_TIMEOUT_MS);
  }

  frame.onload = () => {
    if (iframeLoadTimeout) { clearTimeout(iframeLoadTimeout); iframeLoadTimeout = null; }

    if (!htmlContent) {
      // Detect sites that refuse embedding via X-Frame-Options:
      // - SecurityError (cross-origin) means site loaded successfully
      // - href === "about:blank" or empty means site likely blocked embedding
      let blockedByXFrame = false;
      try {
        const href = frame.contentWindow?.location?.href ?? "";
        if (!href || href === "about:blank") {
          blockedByXFrame = true;
        }
      } catch (_e) {
        // SecurityError = cross-origin = loaded successfully
        blockedByXFrame = false;
      }

      if (blockedByXFrame) {
        loader.classList.add("hidden");
        showIframeError(url, title);
        return;
      }
    }

    iframeFrameLoaded = true;
    // Only reveal once the loading animation has also finished
    if (animationDone) revealIframe();
  };

  if (htmlContent) {
    // HTML-code submission: create a blob URL so the content renders in the frame.
    // Store the URL so closeIframeModal can revoke it immediately.
    const blob    = new Blob([htmlContent], { type: "text/html" });
    currentBlobUrl = URL.createObjectURL(blob);
    frame.src      = currentBlobUrl;
  } else {
    frame.src = url;
  }

  if (rateBtn && !rateBtn.dataset.bound) {
    rateBtn.dataset.bound = "1";
    rateBtn.addEventListener("click", () => {
      if (pendingRating?.linkId) {
        checkAndShowRatingModal(
          pendingRating.linkId,
          pendingRating.title,
          pendingRating.submittedBy
        );
      }
    });
  }
}

/** Show an inline error inside the iframe modal when embedding is blocked */
function showIframeError(url, title) {
  const errEl      = document.getElementById("iframeError");
  const frame      = document.getElementById("iframeFrame");
  const loader     = document.getElementById("iframeLoader");
  const quickLoader = document.getElementById("quickLoader");
  // Reset animation state so a late 'animationComplete' message does not
  // accidentally reveal a frame that failed to load
  animationDone     = false;
  iframeFrameLoaded = false;
  if (frame)       frame.classList.add("opacity-0");
  if (loader)      loader.classList.add("hidden");
  if (quickLoader) quickLoader.classList.add("hidden");
  // Restore loadingFrame for next open
  if (loadingFrame) loadingFrame.style.display = "";
  if (!errEl) return;
  errEl.innerHTML =
    '<div class="flex flex-col items-center gap-3 text-center">' +
      '<div class="text-5xl">🚫</div>' +
      '<div class="text-white font-bold text-base">' + escapeHtml(title || "This Site") + ' can\'t be embedded</div>' +
      '<p class="text-gray-400 text-sm max-w-xs leading-relaxed">' +
        'This site has blocked embedding in iframes (X-Frame-Options). ' +
        'You can still open it directly in a new tab.' +
      '</p>' +
      (url
        ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" ' +
          'class="mt-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors">' +
          '🔗 Open in New Tab</a>'
        : "") +
    '</div>';
  errEl.classList.remove("hidden");
}

// Close iframe modal
function closeIframeModal() {
  const modal   = document.getElementById("iframeModal");
  const frame   = document.getElementById("iframeFrame");
  const rateBtn = document.getElementById("iframeRateBtn");
  const errEl   = document.getElementById("iframeError");
  if (!modal || modal.classList.contains("hidden")) return;

  if (ratingTimerOut)     { clearTimeout(ratingTimerOut);     ratingTimerOut     = null; }
  if (iframeLoadTimeout)  { clearTimeout(iframeLoadTimeout);  iframeLoadTimeout  = null; }
  if (currentBlobUrl)     { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  if (rateBtn) rateBtn.classList.add("hidden");
  if (errEl)   errEl.classList.add("hidden");
  if (frame) frame.src = "";
  // Keep the loading animation iframe alive so Babylon.js stays warm for the
  // next open — avoids re-downloading and re-initialising the 3-D engine.
  if (!loadingFrame) { loadingFrame = document.getElementById("loadingFrame"); }
  // animationDone is intentionally left in its current state; loadingAnimCompleted
  // tracks whether the animation has run at least once so _doOpenIframe can skip
  // the animation on subsequent opens.
  iframeFrameLoaded = false;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
  // Resume background canvas animation
  window._bgPaused = false;

  // Pause the global session: save remaining time before stopping the timer
  if (activeSessionExpiry > 0) {
    const remaining = Math.max(0, activeSessionExpiry - Date.now());
    saveGlobalSession({ remainingMs: remaining });
    activeSessionExpiry = 0;
  }

  // Clean up session timer and Firestore session slot
  clearSessionTimer();
  if (currentLinkId) {
    const lId = currentLinkId;
    currentLinkId = null;
    removeSessionFromLink(lId); // best-effort cleanup
  }

  const timeSpent = Date.now() - iframeOpenTime;
  const pr = pendingRating;
  pendingRating = null;
  if (timeSpent >= RATING_REQUIRED_MS && iframeLoaded && pr?.linkId && auth.currentUser) {
    checkAndShowRatingModal(pr.linkId, pr.title, pr.submittedBy);
  }

  // Track time spent and update leaderboard/profile minute counters.
  // Only record whole minutes; cap at 500 to respect Firestore security rules.
  // Guard: iframeOpenTime must have been set (non-zero) to avoid a bogus delta.
  const uid = auth.currentUser?.uid;
  const minutesSpent = iframeOpenTime > 0 ? Math.floor(timeSpent / 60000) : 0;
  iframeOpenTime = 0; // reset so a second accidental close cannot double-count
  if (uid && minutesSpent > 0) {
    const cappedMinutes = Math.min(minutesSpent, 500);
    const userRef = doc(db, "users", uid);
    runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        throw new Error("User profile not found while updating session minutes.");
      }

      const data = snap.data() || {};
      const currentResetMs = getCurrentBimonthlyResetMillis();
      let resetMarker = toMillisSafe(data.weekMinutesResetAtMs);

      if (resetMarker <= 0) {
        const lastVisitMs = toMillisSafe(data.lastVisitTimestamp);
        const shouldResetLegacyCarryOver =
          lastVisitMs > 0 && lastVisitMs < currentResetMs;
        resetMarker = shouldResetLegacyCarryOver
          ? currentResetMs - 1
          : currentResetMs;
      }

      const didReset = resetMarker < currentResetMs;
      tx.update(userRef, {
        weekMinutes: didReset ? cappedMinutes : increment(cappedMinutes),
        totalMinutes: increment(cappedMinutes),
        weekMinutesResetAtMs: currentResetMs,
      });

      return { didReset, currentResetMs };
    }).then(({ didReset = false, currentResetMs = 0 } = {}) => {
      if (currentUserData) {
        currentUserData.weekMinutes = didReset
          ? cappedMinutes
          : (currentUserData.weekMinutes || 0) + cappedMinutes;
        currentUserData.totalMinutes = (currentUserData.totalMinutes || 0) + cappedMinutes;
        if (currentResetMs > 0) currentUserData.weekMinutesResetAtMs = currentResetMs;
      }
    }).catch(err => console.warn(`Failed to update session minutes (uid=${uid}, minutes=${cappedMinutes}):`, err));
    // Keep local cache in sync so the UI reflects the change immediately
    // Notify the leaderboard to refresh so the new minutes are reflected
    document.dispatchEvent(new CustomEvent("weekMinutesUpdated"));
  }
}

// Check if already rated, then show rating modal
async function checkAndShowRatingModal(linkId, title, submittedBy) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Don't prompt the link owner to rate their own link
  if (submittedBy && uid === submittedBy) return;

  // Fast path: check in-memory cache before hitting Firestore
  if (ratedLinksCache.has(linkId)) return;

  try {
    const q    = query(
      collection(db, "linkRatings"),
      where("linkId", "==", linkId),
      where("ratedBy", "==", uid)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      ratedLinksCache.add(linkId); // cache so we never re-query this session
      return;
    }
    showRatingModal(linkId, title, submittedBy);
  } catch (err) {
    console.warn("Rating check error:", err);
  }
}

// Show rating modal
function showRatingModal(linkId, title, submittedBy) {
  const modal   = document.getElementById("rateModal");
  const titleEl = document.getElementById("rateLinkTitle");
  if (!modal) return;

  if (titleEl) titleEl.textContent = title || "";
  selectedStars = 0;
  pendingRating = { linkId, title, submittedBy };

  document.querySelectorAll(".star-btn").forEach(btn => { btn.style.color = ""; });
  const label = document.getElementById("rateStarLabel");
  if (label) label.textContent = "Click a star to rate";
  const commentEl = document.getElementById("rateComment");
  if (commentEl) commentEl.value = "";
  const submitBtn = document.getElementById("rateSubmitBtn");
  if (submitBtn) submitBtn.disabled = true;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// Close rating modal
function closeRatingModal() {
  const modal = document.getElementById("rateModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
  pendingRating = null;
  selectedStars = 0;
}

// Setup rating modal event listeners (called once)
function setupRatingModal() {
  const modal = document.getElementById("rateModal");
  if (!modal) return;

  const STAR_LABELS = ["", "Poor \uD83D\uDE15", "Fair \uD83D\uDE10", "Good \uD83D\uDC4D", "Great \uD83D\uDE04", "Excellent \uD83E\uDD29"];

  document.querySelectorAll(".star-btn").forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      const n = parseInt(btn.dataset.star, 10);
      document.querySelectorAll(".star-btn").forEach((s, i) => {
        s.style.color = i < n ? "#facc15" : "";
      });
    });
    btn.addEventListener("mouseleave", () => {
      document.querySelectorAll(".star-btn").forEach((s, i) => {
        s.style.color = i < selectedStars ? "#facc15" : "";
      });
    });
    btn.addEventListener("click", () => {
      selectedStars = parseInt(btn.dataset.star, 10);
      document.querySelectorAll(".star-btn").forEach((s, i) => {
        s.style.color = i < selectedStars ? "#facc15" : "";
      });
      const label = document.getElementById("rateStarLabel");
      if (label) label.textContent = STAR_LABELS[selectedStars] || "";
      const submitBtn = document.getElementById("rateSubmitBtn");
      if (submitBtn) submitBtn.disabled = false;
    });
  });

  document.getElementById("rateSubmitBtn")?.addEventListener("click", submitRating);
  document.getElementById("rateSkipBtn")?.addEventListener("click",  closeRatingModal);
}

// Submit a rating
async function submitRating() {
  const uid = auth.currentUser?.uid;
  if (!uid || !pendingRating || selectedStars === 0) return;

  const { linkId, title, submittedBy } = pendingRating;
  const comment   = (document.getElementById("rateComment")?.value || "").trim();
  const submitBtn = document.getElementById("rateSubmitBtn");

  // Rate limit: max 10 reviews per 10 seconds (matches Firestore rule)
  if (!checkRateLimit("reviewHistory", 10, 10000)) {
    showToast("⏳ You're reviewing too fast — please wait a moment.");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const batch = writeBatch(db);

    const ratingRef = doc(collection(db, "linkRatings"));
    batch.set(ratingRef, {
      linkId,
      ratedBy:     uid,
      submittedBy: submittedBy || "",
      score:       selectedStars,
      comment,
      linkTitle:   title,
      timestamp:   serverTimestamp(),
    });

    batch.update(doc(db, "sharedLinks", linkId), {
      ratingSum:   increment(selectedStars),
      ratingCount: increment(1),
    });

    // Update server-side review rate-limit window on the user document.
    // The Firestore rule reads these fields BEFORE the batch commits.
    const userData     = currentUserData || {};
    const now          = Date.now();
    const reviewWindow = userData.reviewWindowStart || 0;
    const isNewWindow  = (now - reviewWindow) > 10000; // 10-second window
    const reviewUpdate = isNewWindow
      ? { reviewWindowStart: now, reviewWindowCount: 1 }
      : { reviewWindowCount: increment(1) };
    batch.update(doc(db, "users", uid), reviewUpdate);

    await batch.commit();

    // Record locally so client-side rate limit is immediately accurate
    rateLimitRecord("reviewHistory", 10000);
    // Cache this link as rated so we skip future Firestore checks in this session
    ratedLinksCache.add(linkId);
    // Update local userData copy so next review uses correct window values
    if (currentUserData) {
      if (isNewWindow) {
        currentUserData.reviewWindowStart = now;
        currentUserData.reviewWindowCount = 1;
      } else {
        currentUserData.reviewWindowCount = (currentUserData.reviewWindowCount || 0) + 1;
      }
    }

    if (submittedBy && submittedBy !== uid) {
      const stars = "\u2605".repeat(selectedStars) + "\u2606".repeat(5 - selectedStars);
      await sendNotification(
        submittedBy,
        "Your link received a rating!",
        'Someone rated "' + title + '" ' + stars + (comment ? ' \u2014 "' + comment + '"' : "."),
        "rating"
      );
    }

    const entry = allDocs.find(d => d.id === linkId);
    if (entry) {
      entry.data.ratingSum   = (entry.data.ratingSum   || 0) + selectedStars;
      entry.data.ratingCount = (entry.data.ratingCount || 0) + 1;
      updateCardRatingDisplay(linkId, entry.data.ratingSum, entry.data.ratingCount);
    }

    closeRatingModal();
    showToast("Rating submitted! \u2B50");
  } catch (err) {
    console.error("Rating submit error:", err);
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Update a rendered card's rating display
function updateCardRatingDisplay(linkId, ratingSum, ratingCount) {
  if (!linksGrid || !ratingCount) return;
  const card = linksGrid.querySelector('.link-card[data-link-id="' + linkId + '"]');
  if (!card) return;

  const avg = calcAvgRating(ratingSum, ratingCount);
  const footerLeft = card.querySelector(".card-footer-left");
  if (!footerLeft) return;

  footerLeft.querySelectorAll(".card-rating-display").forEach(el => el.remove());

  const sep = document.createTextNode(" \u00B7 ");
  const ratingSpan = document.createElement("span");
  ratingSpan.className = "card-rating-display text-[10px] text-yellow-400 flex items-center gap-0.5";
  ratingSpan.innerHTML = "\u2B50 " + avg + ' <span class="text-gray-600">(' + ratingCount + ")</span>";
  footerLeft.appendChild(sep);
  footerLeft.appendChild(ratingSpan);
}

// Simple toast notification
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className =
    "fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-full " +
    "bg-gray-800 border border-gray-700 text-white text-sm font-medium shadow-2xl " +
    "toast-enter pointer-events-none";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity    = "0";
    toast.style.transition = "opacity 0.4s ease";
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// ── Delete link ───────────────────────────────────────────────────────────────

// Setup delete confirm modal event listeners (called once)
function setupDeleteModal() {
  document.getElementById("deleteConfirmCancelBtn")?.addEventListener("click", closeDeleteConfirmModal);
  document.getElementById("deleteConfirmBtn")?.addEventListener("click", handleDeleteLink);
}

// ── Edit link ─────────────────────────────────────────────────────────────────

const MS_PER_HOUR    = 3600000;                        // milliseconds in one hour
const EDIT_COOLDOWN_MS = 24 * MS_PER_HOUR;             // 24-hour edit cooldown

let pendingEdit = null; // { linkId, data, cardEl }

function parseHashtagsEdit(input) {
  if (!input) return [];
  return input
    .split(/[\s,]+/)
    .map(t => {
      t = t.trim().toLowerCase().replace(/[^a-z0-9_#]/g, "");
      if (t && !t.startsWith("#")) t = "#" + t;
      return t;
    })
    .filter(t => t.length > 1)
    .slice(0, 5);
}

// Setup edit link modal event listeners (called once)
function setupEditLinkModal() {
  document.getElementById("editLinkCancelBtn")?.addEventListener("click", closeEditLinkModal);
  document.getElementById("editLinkSaveBtn")?.addEventListener("click", handleEditLinkSave);
}

function openEditLinkModal(linkId, data, cardEl) {
  // Check 24-hour cooldown
  const lastEdited = data.lastEditedAt?.toMillis ? data.lastEditedAt.toMillis() : 0;
  if (lastEdited > 0) {
    const msSinceLast = Date.now() - lastEdited;
    if (msSinceLast < EDIT_COOLDOWN_MS) {
      const hoursLeft = Math.ceil((EDIT_COOLDOWN_MS - msSinceLast) / MS_PER_HOUR);
      showToast(`✏️ You can edit again in ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}.`);
      return;
    }
  }

  pendingEdit = { linkId, data, cardEl };

  const modal = document.getElementById("editLinkModal");
  const titleInput = document.getElementById("editLinkTitle");
  const urlInput   = document.getElementById("editLinkUrl");
  const descInput  = document.getElementById("editLinkDesc");
  const tagsInput  = document.getElementById("editLinkTags");
  const urlWrap    = document.getElementById("editLinkUrlWrap");
  const errEl      = document.getElementById("editLinkError");
  if (!modal) return;

  if (titleInput) titleInput.value = data.title || "";
  if (urlInput)   urlInput.value   = data.url   || "";
  if (descInput)  descInput.value  = data.description || "";
  if (tagsInput)  tagsInput.value  = (data.hashtags || []).join(" ");
  // Hide URL field for HTML submissions
  if (urlWrap) urlWrap.classList.toggle("hidden", data.type === "html");
  if (errEl)   errEl.classList.add("hidden");

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeEditLinkModal() {
  const modal = document.getElementById("editLinkModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
  pendingEdit = null;
}

async function handleEditLinkSave() {
  if (!pendingEdit) return;
  const { linkId, data, cardEl } = pendingEdit;
  const uid = auth.currentUser?.uid;
  if (!uid || data.submittedBy !== uid) return;

  const titleInput = document.getElementById("editLinkTitle");
  const urlInput   = document.getElementById("editLinkUrl");
  const descInput  = document.getElementById("editLinkDesc");
  const tagsInput  = document.getElementById("editLinkTags");
  const saveBtn    = document.getElementById("editLinkSaveBtn");
  const errEl      = document.getElementById("editLinkError");

  const title = (titleInput?.value || "").trim();
  const desc  = (descInput?.value  || "").trim();
  const tags  = parseHashtagsEdit(tagsInput?.value || "");

  if (!title || title.length < 3) {
    if (errEl) { errEl.textContent = "Title must be at least 3 characters."; errEl.classList.remove("hidden"); }
    return;
  }
  if (!desc || desc.length < 10) {
    if (errEl) { errEl.textContent = "Description must be at least 10 characters."; errEl.classList.remove("hidden"); }
    return;
  }

  let url = data.url || "";
  if (data.type !== "html") {
    url = (urlInput?.value || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      if (errEl) { errEl.textContent = "Please enter a valid URL starting with https://"; errEl.classList.remove("hidden"); }
      return;
    }
  }

  // Re-check 24-hour cooldown server-side by re-reading the doc
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    const linkRef = doc(db, "sharedLinks", linkId);
    const freshSnap = await getDoc(linkRef);
    if (!freshSnap.exists()) {
      if (errEl) { errEl.textContent = "Link not found."; errEl.classList.remove("hidden"); }
      return;
    }
    const freshData = freshSnap.data();
    const lastEdited = freshData.lastEditedAt?.toMillis ? freshData.lastEditedAt.toMillis() : 0;
    if (lastEdited > 0 && (Date.now() - lastEdited) < EDIT_COOLDOWN_MS) {
      const hoursLeft = Math.ceil((EDIT_COOLDOWN_MS - (Date.now() - lastEdited)) / MS_PER_HOUR);
      if (errEl) { errEl.textContent = `You can edit again in ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}.`; errEl.classList.remove("hidden"); }
      return;
    }

    const updates = {
      title,
      description: desc,
      hashtags:    tags,
      lastEditedAt: serverTimestamp(),
    };
    if (data.type !== "html") updates.url = url;

    await updateDoc(linkRef, updates);

    // Update local cache
    const entry = allDocs.find(d => d.id === linkId);
    if (entry) {
      entry.data.title       = title;
      entry.data.description = desc;
      entry.data.hashtags    = tags;
      if (data.type !== "html") entry.data.url = url;
      entry.data.lastEditedAt = { toMillis: () => Date.now() };
    }

    // Update the card title and description inline
    if (cardEl) {
      const titleSpan = cardEl.querySelector(".text-white.font-bold.text-base.truncate");
      if (titleSpan) titleSpan.textContent = title;
      const descP = cardEl.querySelector(".text-gray-400.text-xs.leading-relaxed");
      if (descP) descP.textContent = desc;
      // Replace the open-link-btn to update its click handler with the new URL/title
      const oldOpenBtn = cardEl.querySelector(".open-link-btn");
      if (oldOpenBtn) {
        const newOpenBtn = oldOpenBtn.cloneNode(true);
        newOpenBtn.addEventListener("click", () => {
          openIframeModal(url, escapeHtml(title), linkId, uid, data.type === "html" ? (entry?.data?.htmlContent || null) : null);
        });
        oldOpenBtn.replaceWith(newOpenBtn);
      }
    }

    closeEditLinkModal();
    showToast("✏️ Link updated!");
  } catch (err) {
    console.error("Edit link error:", err);
    if (errEl) { errEl.textContent = "Failed to save changes. Please try again."; errEl.classList.remove("hidden"); }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Changes"; }
  }
}

// Open delete confirm modal
function openDeleteConfirmModal(linkId, data, cardEl) {
  pendingDelete = { linkId, data, cardEl };
  const modal = document.getElementById("deleteConfirmModal");
  const msgEl = document.getElementById("deleteConfirmMsg");
  if (!modal) return;
  if (msgEl) {
    msgEl.textContent = (data.rewardGiven && !data.creditsReversed)
      ? "You will lose " + LINK_CREDITS + " credits."
      : "No credits will be deducted (already reversed).";
  }
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// Close delete confirm modal
function closeDeleteConfirmModal() {
  const modal = document.getElementById("deleteConfirmModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
  pendingDelete = null;
}

// Execute the link deletion after user confirms
async function handleDeleteLink() {
  if (!pendingDelete) return;
  const { linkId, data, cardEl } = pendingDelete;
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const confirmBtn = document.getElementById("deleteConfirmBtn");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Deleting\u2026"; }

  try {
    const batch   = writeBatch(db);
    const linkRef = doc(db, "sharedLinks", linkId);
    batch.delete(linkRef);

    // Deduct credits only if they were awarded and not already reversed
    if (data.rewardGiven && !data.creditsReversed) {
      batch.update(doc(db, "users", uid), {
        credits: increment(-LINK_CREDITS),
      });
    }

    await batch.commit();

    await sendNotification(
      uid,
      "Link Deleted",
      'You deleted your link "' + (data.title || "Untitled") + '".' +
        ((data.rewardGiven && !data.creditsReversed)
          ? " \u2212" + LINK_CREDITS + " credits deducted."
          : ""),
      "link"
    );

    // Animate card out
    cardEl.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    cardEl.style.opacity    = "0";
    cardEl.style.transform  = "scale(0.95)";
    setTimeout(() => {
      cardEl.remove();
      if (linksGrid && linksGrid.querySelectorAll(".link-card").length === 0) {
        if (linksEmpty) linksEmpty.classList.remove("hidden");
      }
    }, 300);

    allDocs = allDocs.filter(d => d.id !== linkId);
    closeDeleteConfirmModal();
    showToast("\uD83D\uDDD1\uFE0F Link deleted.");
  } catch (err) {
    console.error("Delete error:", err);
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "\uD83D\uDDD1\uFE0F Delete"; }
    alert("Failed to delete. Please try again.");
  }
}

// ── Appeals ───────────────────────────────────────────────────────────────────

// Wire up the appeals tab so data loads on first visit
function setupAppealsTab() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    if (btn.dataset.tab === "appeals") {
      btn.addEventListener("click", () => {
        if (!appealsLoaded) {
          appealsLoaded = true;
          loadAppeals();
        }
      });
    }
  });
  document.addEventListener("refreshAppeals", () => {
    appealsLoaded = false;
    loadAppeals();
  });
}

// Load appeals data
async function loadAppeals() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const appealsGrid      = document.getElementById("appealsGrid");
  const appealsLoading   = document.getElementById("appealsLoading");
  const appealsEmptyEl   = document.getElementById("appealsEmpty");
  const myRemovedSection = document.getElementById("myRemovedSection");
  const myRemovedLinks   = document.getElementById("myRemovedLinks");
  if (!appealsGrid) return;

  if (appealsLoading)   appealsLoading.classList.remove("hidden");
  if (appealsEmptyEl)   appealsEmptyEl.classList.add("hidden");
  appealsGrid.innerHTML = "";
  if (myRemovedLinks)   myRemovedLinks.innerHTML = "";
  if (myRemovedSection) myRemovedSection.classList.add("hidden");

  try {
    // Community appeals: links currently under vote (cap at 25 to limit reads)
    const appealsQ    = query(
      collection(db, "sharedLinks"),
      where("status", "==", "appealing"),
      limit(25)
    );
    const appealsSnap = await getDocs(appealsQ);

    // Owner's own links: query by submitter, filter removed client-side (cap at 50)
    const myLinksQ    = query(
      collection(db, "sharedLinks"),
      where("submittedBy", "==", uid),
      limit(50)
    );
    const myLinksSnap = await getDocs(myLinksQ);

    if (appealsLoading) appealsLoading.classList.add("hidden");

    // Populate "My Removed Links" section
    const myRemoved = [];
    myLinksSnap.forEach(s => {
      const d = s.data();
      if (d.status === "removed" && !d.appealClosed) {
        myRemoved.push({ id: s.id, data: d });
      }
    });

    if (myRemoved.length > 0 && myRemovedSection && myRemovedLinks) {
      myRemovedSection.classList.remove("hidden");
      myRemoved.forEach(({ id, data }) => renderRemovedCard(id, data, myRemovedLinks));
    }

    // Populate community voting section (exclude own appeals)
    const votableAppeals = [];
    appealsSnap.forEach(s => {
      if (s.data().submittedBy !== uid) {
        votableAppeals.push({ id: s.id, data: s.data() });
      }
    });

    if (votableAppeals.length === 0) {
      if (appealsEmptyEl) appealsEmptyEl.classList.remove("hidden");
    } else {
      votableAppeals.forEach(({ id, data }) => renderAppealCard(id, data, uid, appealsGrid));
    }
  } catch (err) {
    console.error("Appeals load error:", err);
    if (appealsLoading) appealsLoading.classList.add("hidden");
    if (appealsGrid) {
      appealsGrid.innerHTML =
        '<p class="text-red-400 text-sm text-center py-6">Failed to load appeals. Please refresh.</p>';
    }
  }
}

// Render an owner's removed link card (with Appeal button)
function renderRemovedCard(id, data, container) {
  const safeTitle = escapeHtml(data.title || "Untitled");
  const safeDesc  = data.description ? escapeHtml(data.description) : "";

  const card = document.createElement("div");
  card.className =
    "flex flex-col gap-2 p-4 rounded-2xl bg-gray-900/80 border border-red-700/40";
  card.innerHTML =
    '<div class="flex items-start justify-between gap-2">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="text-white font-bold text-sm truncate">' + safeTitle + '</div>' +
        (safeDesc ? '<p class="text-gray-500 text-xs mt-0.5 line-clamp-2">' + safeDesc + '</p>' : '') +
        '<div class="text-[10px] text-orange-400 mt-1">\u26A0 Removed \u00B7 ' +
          (data.reportCount || 0) + ' report' + ((data.reportCount || 0) !== 1 ? 's' : '') + '</div>' +
      '</div>' +
      '<button class="appeal-btn shrink-0 px-3 py-1.5 rounded-full bg-blue-600/80 hover:bg-blue-500 ' +
        'text-white text-xs font-bold transition-colors whitespace-nowrap" data-id="' + id + '">' +
        '\u2696\uFE0F Appeal' +
      '</button>' +
    '</div>';

  card.querySelector(".appeal-btn").addEventListener("click", async () => {
    const btn = card.querySelector(".appeal-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Submitting\u2026"; }
    await handleAppeal(id, data, card);
  });

  container.appendChild(card);
}

// Render a community appeal card (with vote buttons)
function renderAppealCard(id, data, uid, container) {
  const safeTitle = escapeHtml(data.title || "Untitled");
  const safeDesc  = data.description ? escapeHtml(data.description) : "";
  const safeName  = escapeHtml(data.submittedByName || "Anonymous");

  const totalVotes  = data.appealVoteCount || 0;
  const reinstateCt = data.reinstateCount  || 0;
  const removeCt    = totalVotes - reinstateCt;
  const alreadyVoted = Array.isArray(data.appealVotes) &&
    data.appealVotes.some(v => v.uid === uid);
  const progressPct = Math.min(Math.round((totalVotes / APPEAL_VOTE_THRESHOLD) * 100), 100);

  const card = document.createElement("div");
  card.dataset.appealId = id;
  card.className =
    "flex flex-col gap-3 p-4 rounded-2xl bg-gray-900/80 border border-yellow-700/40";
  card.innerHTML =
    '<div class="flex-1 min-w-0">' +
      '<div class="text-white font-bold text-sm truncate">' + safeTitle + '</div>' +
      (safeDesc ? '<p class="text-gray-500 text-xs mt-0.5 line-clamp-2">' + safeDesc + '</p>' : '') +
      '<div class="text-[10px] text-gray-500 mt-1">Submitted by ' + safeName +
        ' \u00B7 \u26A0 ' + (data.reportCount || 0) + ' reports</div>' +
    '</div>' +
    '<div class="flex items-center gap-2">' +
      '<div class="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">' +
        '<div class="bg-blue-500 h-full rounded-full transition-all" ' +
          'style="width:' + progressPct + '%"></div>' +
      '</div>' +
      '<span class="text-[10px] text-gray-500 shrink-0">' +
        totalVotes + '/' + APPEAL_VOTE_THRESHOLD + ' votes</span>' +
    '</div>' +
    '<div class="flex items-center gap-3 text-[10px] text-gray-500">' +
      '<span class="text-green-400">\u2705 Reinstate: ' + reinstateCt + '</span>' +
      '<span class="text-red-400">\u274C Keep Removed: ' + removeCt + '</span>' +
      '<span class="ml-auto text-emerald-400 font-bold">(+' + APPEAL_VOTE_CREDITS + ' \u2728 per vote)</span>' +
    '</div>' +
    (alreadyVoted
      ? '<div class="text-center text-xs text-gray-500 italic py-1">You already voted on this appeal.</div>'
      : '<div class="flex gap-2">' +
          '<button class="appeal-vote-btn flex-1 py-2 rounded-xl bg-green-700/60 hover:bg-green-600 ' +
            'text-white text-xs font-bold transition-colors" ' +
            'data-id="' + id + '" data-vote="reinstate">\u2705 Reinstate</button>' +
          '<button class="appeal-vote-btn flex-1 py-2 rounded-xl bg-red-800/60 hover:bg-red-700 ' +
            'text-white text-xs font-bold transition-colors" ' +
            'data-id="' + id + '" data-vote="remove">\u274C Keep Removed</button>' +
        '</div>');

  card.querySelectorAll(".appeal-vote-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      card.querySelectorAll(".appeal-vote-btn").forEach(b => { b.disabled = true; });
      await handleAppealVote(id, btn.dataset.vote, data, card);
    });
  });

  container.appendChild(card);
}

// Owner submits an appeal for a removed link
async function handleAppeal(linkId, data, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid || data.submittedBy !== uid) return;

  // Rate limit: max 2 appeals per day (86400 seconds)
  if (!checkRateLimit("appealHistory", 2, 86400000)) {
    showToast("⏳ You've reached the appeal limit (2/day). Please try again tomorrow.");
    const btn = cardEl.querySelector(".appeal-btn");
    if (btn) { btn.disabled = false; btn.textContent = "\u2696\uFE0F Appeal"; }
    return;
  }

  try {
    await updateDoc(doc(db, "sharedLinks", linkId), {
      status:          "appealing",
      appealedAt:      serverTimestamp(),
      appealVotes:     [],
      appealVoteCount: 0,
      reinstateCount:  0,
    });

    // Record locally so rate limit counter is immediately accurate
    rateLimitRecord("appealHistory", 86400000);

    await sendNotification(
      uid,
      "Appeal Submitted \u2696\uFE0F",
      'Your appeal for "' + (data.title || "Untitled") + '" has been submitted. ' +
        "The community will vote — " + APPEAL_VOTE_THRESHOLD + " votes needed to reach a decision.",
      "link"
    );

    cardEl.style.transition = "opacity 0.3s ease";
    cardEl.style.opacity    = "0";
    setTimeout(() => {
      cardEl.remove();
      const myRemovedLinks   = document.getElementById("myRemovedLinks");
      const myRemovedSection = document.getElementById("myRemovedSection");
      if (myRemovedLinks && myRemovedLinks.children.length === 0 && myRemovedSection) {
        myRemovedSection.classList.add("hidden");
      }
    }, 300);

    showToast("Appeal submitted! The community will vote. \u2696\uFE0F");
  } catch (err) {
    console.error("Appeal error:", err);
    const btn = cardEl.querySelector(".appeal-btn");
    if (btn) { btn.disabled = false; btn.textContent = "\u2696\uFE0F Appeal"; }
    alert("Failed to submit appeal. Please try again.");
  }
}

// Community member votes on an appeal
async function handleAppealVote(linkId, vote, data, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Prevent double-voting (client-side guard matching the stored array)
  const alreadyVoted = Array.isArray(data.appealVotes) &&
    data.appealVotes.some(v => v.uid === uid);
  if (alreadyVoted) {
    alert("You have already voted on this appeal.");
    cardEl.querySelectorAll(".appeal-vote-btn").forEach(b => { b.disabled = false; });
    return;
  }

  // Rate limit: max 3 appeal votes per hour
  if (!checkRateLimit("appealVoteHistory", 3, 3600000)) {
    showToast("⏳ You've reached the appeal vote limit (3/hour). Please try again later.");
    cardEl.querySelectorAll(".appeal-vote-btn").forEach(b => { b.disabled = false; });
    return;
  }

  try {
    const newVote      = { uid, vote, votedAt: new Date().toISOString() };
    const newTotal     = (data.appealVoteCount || 0) + 1;
    const newReinstate = (data.reinstateCount  || 0) + (vote === "reinstate" ? 1 : 0);
    const newRemove    = newTotal - newReinstate;

    const batch   = writeBatch(db);
    const linkRef = doc(db, "sharedLinks", linkId);

    const linkUpdate = {
      appealVotes:     arrayUnion(newVote),
      appealVoteCount: increment(1),
    };
    if (vote === "reinstate") {
      linkUpdate.reinstateCount = increment(1);
    }

    // If threshold reached, enact the decision
    let decisionMade = false;
    let reinstated   = false;
    if (newTotal >= APPEAL_VOTE_THRESHOLD) {
      decisionMade         = true;
      reinstated           = newReinstate > newRemove;
      linkUpdate.status    = reinstated ? "active" : "removed";
      linkUpdate.appealClosed = true;

      if (reinstated && data.creditsReversed && data.submittedBy) {
        // Restore credits to original submitter
        batch.update(doc(db, "users", data.submittedBy), {
          credits:     increment(LINK_CREDITS),
          totalEarned: increment(LINK_CREDITS),
        });
      }
    }

    batch.update(linkRef, linkUpdate);

    // Award the voter for participating
    batch.update(doc(db, "users", uid), {
      credits:     increment(APPEAL_VOTE_CREDITS),
      totalEarned: increment(APPEAL_VOTE_CREDITS),
    });

    await batch.commit();

    // Record locally so rate limit counter is immediately accurate
    rateLimitRecord("appealVoteHistory", 3600000);

    // Notify the link owner when a decision has been reached
    if (decisionMade && data.submittedBy) {
      await sendNotification(
        data.submittedBy,
        reinstated ? "Appeal Successful! \uD83C\uDF89" : "Appeal Closed",
        reinstated
          ? 'The community voted to reinstate your link "' + (data.title || "Untitled") + '"!' +
              (data.creditsReversed ? " Your " + LINK_CREDITS + " credits have been restored." : "")
          : 'The community voted to keep your link "' + (data.title || "Untitled") + '" removed.',
        "link"
      );
    }

    // Animate card out after voting
    cardEl.style.transition = "opacity 0.3s ease";
    cardEl.style.opacity    = "0";
    setTimeout(() => {
      cardEl.remove();
      const appealsGrid  = document.getElementById("appealsGrid");
      const appealsEmpty = document.getElementById("appealsEmpty");
      if (appealsGrid && appealsGrid.children.length === 0 && appealsEmpty) {
        appealsEmpty.classList.remove("hidden");
      }
    }, 300);

    showToast("Vote cast! +" + APPEAL_VOTE_CREDITS + " credits \u2728");
  } catch (err) {
    console.error("Appeal vote error:", err);
    cardEl.querySelectorAll(".appeal-vote-btn").forEach(b => { b.disabled = false; });
    alert("Failed to cast vote. Please try again.");
  }
}

// Open profile modal
export async function openProfileModal(uid, displayName) {
  const modal   = document.getElementById("profileModal");
  const content = document.getElementById("profileModalContent");
  if (!modal || !content) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  content.innerHTML = '<div class="flex justify-center py-10"><div class="loader"></div></div>';

  try {
    // Check in-memory profile cache to avoid redundant Firestore reads
    const now    = Date.now();
    const cached = profileCache.get(uid);
    let data, ratings;

    if (cached && cached.expiresAt > now) {
      data    = cached.userData;
      ratings = cached.ratings;
    } else {
      const [userSnap, ratingsSnap] = await Promise.all([
        getDoc(doc(db, "users", uid)),
        getDocs(query(collection(db, "linkRatings"), where("submittedBy", "==", uid))),
      ]);

      if (!userSnap.exists()) {
        content.innerHTML = '<p class="text-gray-400 text-sm text-center py-6">Profile not found.</p>';
        return;
      }

      data    = userSnap.data();
      ratings = [];
      ratingsSnap.forEach(s => ratings.push(s.data()));

      // Cache the profile data for PROFILE_CACHE_TTL ms
      profileCache.set(uid, { userData: data, ratings, expiresAt: now + PROFILE_CACHE_TTL });
    }

    const tier       = calculateTier(data.totalEarned || 0);
    const currentUid = auth.currentUser?.uid ?? "";
    const isSelf     = currentUid === uid;

    const avgRating = ratings.length
      ? (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1)
      : null;

    const userLinks     = allDocs.filter(d => d.data.submittedBy === uid);
    const recentReviews = ratings
      .filter(r => r.comment)
      .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0))
      .slice(0, 3);

    // Avatar gradient
    const AVATAR_PRESETS = {
      ocean:  "linear-gradient(135deg,#38bdf8,#3b82f6)",
      sunset: "linear-gradient(135deg,#f97316,#ec4899)",
      forest: "linear-gradient(135deg,#22c55e,#16a34a)",
      cosmic: "linear-gradient(135deg,#a855f7,#6366f1)",
      fire:   "linear-gradient(135deg,#ef4444,#f97316)",
      gold:   "linear-gradient(135deg,#fbbf24,#f59e0b)",
    };
    const avatarGradient = AVATAR_PRESETS[data.avatarColor] || AVATAR_PRESETS.ocean;

    const joinDate = data.createdAt?.toMillis
      ? new Date(data.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "";

    let linksHtml = "";
    if (userLinks.length > 0) {
      const shown = userLinks.slice(0, 4);
      linksHtml =
        '<div class="mb-4">' +
        '<div class="text-[10px] text-gray-500 uppercase font-bold mb-2 tracking-wider">' +
        'Submissions (' + userLinks.length + ')</div>' +
        '<div class="space-y-2">' +
        shown.map(({ id: lid, data: ld }) => {
          const isHtmlType = ld.type === "html";
          return '<div class="flex items-center gap-2 p-2.5 bg-gray-800/60 rounded-xl">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-1">' +
                '<span class="text-xs text-white font-semibold truncate">' + escapeHtml(ld.title || "Untitled") + '</span>' +
                (isHtmlType ? '<span class="text-[9px] px-1 rounded font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">HTML</span>' : '') +
              '</div>' +
              '<div class="text-[10px] text-gray-500 mt-0.5">' +
                '\uD83D\uDC4D ' + (ld.upvoteCount || 0) +
                (calcAvgRating(ld.ratingSum, ld.ratingCount) !== null ? ' \u00B7 \u2B50 ' + calcAvgRating(ld.ratingSum, ld.ratingCount) : "") +
              '</div>' +
            '</div>' +
            '<button class="profile-open-link shrink-0 text-[10px] px-2.5 py-1 rounded-full ' +
            (isHtmlType ? 'bg-purple-600/70 hover:bg-purple-500' : 'bg-blue-600/70 hover:bg-blue-500') +
            ' text-white font-bold transition-colors" ' +
            'data-url="' + escapeHtml(ld.url || "") + '" data-title="' + escapeHtml(ld.title || "") + '" ' +
            'data-html="' + (isHtmlType ? "1" : "0") + '" ' +
            'data-id="' + lid + '" data-submitter="' + uid + '">' +
            (isHtmlType ? '▶ Play' : 'Open') + '</button>' +
          '</div>';
        }).join("") +
        (userLinks.length > 4
          ? '<button id="profileShowAllLinks" ' +
            'class="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors" ' +
            'data-uid="' + uid + '" data-name="' + escapeHtml(data.firstName || "Student") + '">' +
            '+ ' + (userLinks.length - 4) + ' more \u2192</button>'
          : "") +
        '</div></div>';
    }

    let reviewsHtml = "";
    if (recentReviews.length > 0) {
      reviewsHtml =
        '<div class="mb-4">' +
        '<div class="text-[10px] text-gray-500 uppercase font-bold mb-2 tracking-wider">Recent Reviews</div>' +
        '<div class="space-y-2">' +
        recentReviews.map(r =>
          '<div class="p-2.5 bg-gray-800/60 rounded-xl">' +
            '<div class="flex items-center gap-1.5 mb-0.5">' +
              '<span class="text-yellow-400 text-xs">' +
              "\u2605".repeat(r.score) + "\u2606".repeat(5 - r.score) + '</span>' +
              '<span class="text-[10px] text-gray-500 truncate">for "' + escapeHtml(r.linkTitle || "") + '"</span>' +
            '</div>' +
            '<p class="text-xs text-gray-300 italic leading-relaxed">"' + escapeHtml(r.comment) + '"</p>' +
          '</div>'
        ).join("") +
        '</div></div>';
    }

    const actionsHtml = !isSelf
      ? '<div class="flex flex-col gap-2 mb-4">' +
        '<button id="profileUpvoteBtn" ' +
        'class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 ' +
        'text-white font-bold text-sm transition-colors ' +
        'flex items-center justify-center gap-2" data-uid="' + uid + '">' +
        '\uD83D\uDC4D Upvote Profile ' +
        '<span class="text-blue-200 font-normal text-xs">(+' + UPVOTE_CREDITS + ' credits)</span></button>' +
        '<button id="profileFilterBtn" ' +
        'class="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 ' +
        'text-gray-300 font-bold text-sm transition-colors border border-gray-700" ' +
        'data-uid="' + uid + '" data-name="' + escapeHtml(data.firstName || "Student") + '">' +
        '\uD83D\uDD0D Show only their submissions</button>' +
        '</div>'
      : '<div class="text-xs text-gray-500 italic text-center mb-4">This is your profile.</div>';

    const bio = data.bio ? escapeHtml(data.bio) : "";

    content.innerHTML =
      '<div>' +
        // Cover + avatar
        '<div class="relative mb-10">' +
          '<div class="h-16 rounded-xl" style="background:' + avatarGradient + '; opacity:0.3;"></div>' +
          '<div class="absolute -bottom-8 left-4">' +
            '<div class="w-16 h-16 rounded-2xl border-4 border-gray-900 flex items-center justify-center ' +
            'text-2xl font-black text-white shadow-xl" ' +
            'style="background:' + avatarGradient + '">' +
              escapeHtml((data.firstName || "?")[0].toUpperCase()) +
            '</div>' +
          '</div>' +
        '</div>' +
        // Name + tier + meta
        '<div class="mb-3">' +
          '<div class="text-lg font-black text-white leading-tight">' +
            escapeHtml(data.firstName || "Student") + ' ' + escapeHtml(data.lastName || "") +
          '</div>' +
          '<div class="flex items-center gap-2 flex-wrap mt-1">' +
            '<span class="text-xs font-bold px-2 py-0.5 rounded-full border" ' +
            'style="color:' + tier.color + '; border-color:' + tier.color + '44">' +
              tier.name +
            '</span>' +
            (data.grade ? '<span class="text-[10px] text-gray-500">Grade ' + escapeHtml(data.grade) + '</span>' : '') +
            (joinDate ? '<span class="text-[10px] text-gray-600">· Joined ' + joinDate + '</span>' : '') +
          '</div>' +
          // Bio
          (bio
            ? '<p class="text-gray-400 text-xs leading-relaxed mt-2">' + bio + '</p>'
            : '') +
        '</div>' +
        // Stats grid
        '<div class="grid grid-cols-4 gap-2 mb-4">' +
          '<div class="bg-gray-800/60 p-2.5 rounded-xl text-center">' +
            '<div class="text-sm font-black text-emerald-400">' + (data.totalEarned || 0) + '</div>' +
            '<div class="text-[9px] text-gray-500 uppercase font-bold mt-0.5">Earned 🪙</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-2.5 rounded-xl text-center">' +
            '<div class="text-sm font-black text-blue-400">' + userLinks.length + '</div>' +
            '<div class="text-[9px] text-gray-500 uppercase font-bold mt-0.5">Posts</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-2.5 rounded-xl text-center">' +
            '<div class="text-sm font-black text-yellow-400">' +
              (avgRating !== null ? '\u2B50' + avgRating : '\u2014') +
            '</div>' +
            '<div class="text-[9px] text-gray-500 uppercase font-bold mt-0.5">Rating</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-2.5 rounded-xl text-center">' +
            '<div class="text-sm font-black text-orange-400">' + (data.streak || 0) + '</div>' +
            '<div class="text-[9px] text-gray-500 uppercase font-bold mt-0.5">🔥 Streak</div>' +
          '</div>' +
        '</div>' +
        actionsHtml +
        linksHtml +
        reviewsHtml +
      '</div>';

    content.querySelector("#profileUpvoteBtn")?.addEventListener("click", async () => {
      if (!auth.currentUser) { alert("You must be signed in to upvote."); return; }
      await handleProfileUpvote(uid, content.querySelector("#profileUpvoteBtn"));
    });

    content.querySelector("#profileFilterBtn")?.addEventListener("click", () => {
      const btn = content.querySelector("#profileFilterBtn");
      closeProfileModal();
      setLinkFilter("profile", btn.dataset.uid, btn.dataset.name);
    });

    content.querySelector("#profileShowAllLinks")?.addEventListener("click", () => {
      const btn = content.querySelector("#profileShowAllLinks");
      closeProfileModal();
      setLinkFilter("profile", btn.dataset.uid, btn.dataset.name);
    });

    content.querySelectorAll(".profile-open-link").forEach(btn => {
      btn.addEventListener("click", () => {
        const isHtml = btn.dataset.html === "1";
        // Fetch full doc for htmlContent if needed
        const linkDoc = allDocs.find(d => d.id === btn.dataset.id);
        closeProfileModal();
        openIframeModal(
          btn.dataset.url,
          btn.dataset.title,
          btn.dataset.id,
          btn.dataset.submitter,
          isHtml ? (linkDoc?.data?.htmlContent || null) : null
        );
      });
    });

  } catch (err) {
    console.error("Profile load error:", err);
    content.innerHTML = '<p class="text-red-400 text-sm text-center py-6">Failed to load profile.</p>';
  }
}

// Close profile modal
function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// Handle upvote on a link card
async function handleUpvote(linkId, data, btn, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  if (data.submittedBy === uid) {
    alert("You cannot upvote your own link.");
    return;
  }

  const alreadyUpvoted = Array.isArray(data.upvotes) &&
    data.upvotes.some(u => u === uid || u?.uid === uid);
  if (alreadyUpvoted) {
    alert("You have already upvoted this link.");
    return;
  }

  // Rate limit: max 30 upvotes per hour
  if (!checkRateLimit("upvoteHistory", 30, 3600000)) {
    showToast("⏳ You've reached the upvote limit (30/hour). Please try again later.");
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Upvoting\u2026";

  try {
    const linkRef = doc(db, "sharedLinks", linkId);
    const batch   = writeBatch(db);

    // Batch credits update + link upvote into a single round-trip
    if (data.submittedBy) {
      batch.update(doc(db, "users", data.submittedBy), {
        credits:     increment(UPVOTE_CREDITS),
        totalEarned: increment(UPVOTE_CREDITS),
      });
    }
    batch.update(linkRef, {
      upvotes:     arrayUnion(uid),
      upvoteCount: increment(1),
    });
    await batch.commit();

    // Record locally so the rate limit counter is immediately accurate
    rateLimitRecord("upvoteHistory", 3600000);

    if (data.submittedBy) {
      await sendNotification(
        data.submittedBy,
        "Your link was upvoted!",
        'Someone upvoted your link "' + data.title + '". You earned +' + UPVOTE_CREDITS + ' credits! \uD83C\uDF89',
        "upvote"
      );
    }

    const newCount = (data.upvoteCount || 0) + 1;
    btn.replaceWith(
      Object.assign(document.createElement("span"), {
        className:   "text-[10px] text-blue-400 font-bold flex items-center gap-1",
        textContent: "\uD83D\uDC4D " + newCount,
      })
    );

    // Keep allDocs in sync so re-renders (sort/filter) show correct state
    const entryIdx = allDocs.findIndex(d => d.id === linkId);
    if (entryIdx !== -1) {
      const entry = allDocs[entryIdx];
      allDocs[entryIdx] = {
        ...entry,
        data: {
          ...entry.data,
          upvotes:     [...(entry.data.upvotes || []), uid],
          upvoteCount: newCount,
        },
      };
    }
  } catch (err) {
    console.error("Upvote error:", err);
    btn.disabled    = false;
    btn.textContent = "\uD83D\uDC4D Upvote";
    alert("Failed to upvote. Please try again.");
  }
}

// Handle profile-level upvote
async function handleProfileUpvote(targetUid, btn) {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  if (currentUid === targetUid) {
    alert("You cannot upvote yourself.");
    return;
  }

  // Rate limit: max 20 profile upvotes per hour
  if (!checkRateLimit("profileUpvoteHistory", 20, 3600000)) {
    showToast("⏳ You've reached the profile upvote limit (20/hour). Please try again later.");
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Upvoting\u2026";

  try {
    const myRef  = doc(db, "users", currentUid);
    const mySnap = await getDoc(myRef);
    const myData = mySnap.exists() ? mySnap.data() : {};
    const upvotedUsers = myData.upvotedUsers || [];

    if (upvotedUsers.includes(targetUid)) {
      btn.disabled  = false;
      btn.innerHTML = "\uD83D\uDC4D Upvote Profile <span class=\"text-blue-200 font-normal\">(+" + UPVOTE_CREDITS + " credits)</span>";
      alert("You have already upvoted this user.");
      return;
    }

    await updateDoc(doc(db, "users", targetUid), {
      credits:     increment(UPVOTE_CREDITS),
      totalEarned: increment(UPVOTE_CREDITS),
    });

    await updateDoc(myRef, {
      upvotedUsers: arrayUnion(targetUid),
    });

    // Record locally so the rate limit counter is immediately accurate
    rateLimitRecord("profileUpvoteHistory", 3600000);

    await sendNotification(
      targetUid,
      "Someone upvoted your profile!",
      "You received a profile upvote. +" + UPVOTE_CREDITS + " credits added! \uD83C\uDF89",
      "upvote"
    );

    btn.innerHTML = "\u2705 Upvoted (+" + UPVOTE_CREDITS + " credits sent)";
    btn.className = btn.className.replace("bg-blue-600 hover:bg-blue-500", "bg-gray-700 cursor-default");
  } catch (err) {
    console.error("Profile upvote error:", err);
    btn.disabled  = false;
    btn.innerHTML = "\uD83D\uDC4D Upvote Profile <span class=\"text-blue-200 font-normal\">(+" + UPVOTE_CREDITS + " credits)</span>";
    alert("Failed to upvote. Please try again.");
  }
}

// Handle a report submission
async function handleReport(linkId, type, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Rate limit: max 5 reports per hour
  if (!checkRateLimit("reportHistory", 5, 3600000)) {
    showToast("⏳ You've reached the report limit (5/hour). Please try again later.");
    return;
  }

  // Use locally cached data for quick guard checks to avoid an unnecessary read
  const localDoc = allDocs.find(d => d.id === linkId);
  if (localDoc) {
    const localData = localDoc.data;
    if (localData.submittedBy === uid) {
      alert("You cannot report your own link.");
      return;
    }
    if (Array.isArray(localData.reports) && localData.reports.some(r => r.uid === uid)) {
      alert("You have already reported this link.");
      return;
    }
  }

  try {
    // Fetch fresh data to ensure accurate report count / state for the actual operation
    const linkRef = doc(db, "sharedLinks", linkId);
    const snap    = await getDoc(linkRef);
    if (!snap.exists()) return;

    const data = snap.data();

    const alreadyReported = Array.isArray(data.reports) &&
      data.reports.some(r => r.uid === uid);
    if (alreadyReported) {
      alert("You have already reported this link.");
      return;
    }

    if (data.submittedBy === uid) {
      alert("You cannot report your own link.");
      return;
    }

    const newReport = { uid, type, reportedAt: new Date().toISOString() };
    const newCount  = (data.reportCount || 0) + 1;

    if (newCount >= REPORT_THRESHOLD) {
      const allReports   = [...(data.reports || []), newReport];
      const fakeCount    = allReports.filter(r => r.type === "fake").length;
      const majorityFake = fakeCount >= Math.ceil(allReports.length / 2);

      await updateDoc(linkRef, {
        status:          "removed",
        reportCount:     newCount,
        reports:         arrayUnion(newReport),
        removedAt:       serverTimestamp(),
        creditsReversed: majorityFake,
      });

      const msg = majorityFake
        ? 'Your shared link "' + data.title + '" was removed after ' + newCount + ' users ' +
          'reported it as fake or spam. The ' + LINK_CREDITS + ' credits originally ' +
          'awarded have been reversed. You can appeal this in the \u2696\uFE0F Appeals tab.'
        : 'Your shared link "' + data.title + '" was removed after ' + newCount + ' users ' +
          'reported it as blocked or broken. Your credits have been kept. ' +
          'You can appeal this in the \u2696\uFE0F Appeals tab.';

      await sendNotification(data.submittedBy, "Your Link Was Removed", msg, "link");

      if (majorityFake && data.rewardGiven) {
        try {
          await updateDoc(doc(db, "users", data.submittedBy), {
            credits: increment(-LINK_CREDITS),
          });
        } catch (e) {
          console.warn("Could not reverse credits:", e);
        }
      }

      cardEl.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      cardEl.style.opacity    = "0";
      cardEl.style.transform  = "scale(0.95)";
      setTimeout(() => {
        cardEl.remove();
        if (linksGrid && linksGrid.querySelectorAll(".link-card").length === 0) {
          if (linksEmpty) linksEmpty.classList.remove("hidden");
        }
      }, 300);

      allDocs = allDocs.filter(d => d.id !== linkId);

      // Record report locally so rate limit counter is immediately accurate
      rateLimitRecord("reportHistory", 3600000);

      alert("Thanks for the report. This link has been removed from the community.");
    } else {
      await updateDoc(linkRef, {
        reportCount: newCount,
        reports:     arrayUnion(newReport),
      });

      // Record report locally so rate limit counter is immediately accurate
      rateLimitRecord("reportHistory", 3600000);

      const wrapper = cardEl.querySelector(".report-wrapper");
      if (wrapper) {
        const span = document.createElement("span");
        span.className   = "text-[10px] text-gray-500 italic";
        span.textContent = "You reported this";
        wrapper.replaceWith(span);
      }

      const profileBtn    = cardEl.querySelector(".view-profile-btn");
      const submitterUid  = profileBtn?.dataset.uid  || "";
      const submitterName = escapeHtml(profileBtn?.textContent?.trim() || "Anonymous");
      const footerInfo    = cardEl.querySelector(".card-footer-left");
      if (footerInfo) {
        footerInfo.innerHTML =
          '<span>Shared by</span>' +
          '<button class="view-profile-btn text-gray-400 hover:text-blue-300 transition-colors ' +
          'underline-offset-2 hover:underline" ' +
          'data-uid="' + submitterUid + '" data-name="' + submitterName + '">' +
          submitterName + '</button>' +
          ' \u00B7 <span class="text-orange-400">\u26A0 ' + newCount +
          ' report' + (newCount !== 1 ? "s" : "") + '</span>';
        const newBtn = footerInfo.querySelector(".view-profile-btn");
        if (newBtn) {
          newBtn.addEventListener("click", () => openProfileModal(submitterUid, submitterName));
        }
      }

      alert("Thanks for the report! If two more users report this link it will be removed.");

      // Keep allDocs in sync so re-renders (sort/filter) preserve the reported state
      const reportEntryIdx = allDocs.findIndex(d => d.id === linkId);
      if (reportEntryIdx !== -1) {
        const entry = allDocs[reportEntryIdx];
        allDocs[reportEntryIdx] = {
          ...entry,
          data: {
            ...entry.data,
            reports:     [...(entry.data.reports || []), newReport],
            reportCount: newCount,
          },
        };
      }
    }
  } catch (err) {
    console.error("Report error:", err);
    alert("Failed to submit report. Please try again.");
  }
}

// Close all dropdowns when clicking outside
document.addEventListener("click", () => {
  document.querySelectorAll(".report-dropdown").forEach(d => d.classList.add("hidden"));
});

// Refresh links when the "Refresh" button is clicked
document.addEventListener("refreshLinks", () => loadLinks());

/**
 * Buy more session time while already viewing a link (called from the "+" button
 * next to the session timer). Deducts 50 credits and adds rank-based minutes.
 */
async function handleExtendSession() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const userData    = currentUserData || {};
  const tier        = calculateTier(userData.totalEarned || 0);
  const userCredits = userData.credits || 0;

  if (userCredits < SESSION_COST) {
    showToast(`❌ Not enough credits — you need ${SESSION_COST} 🪙 to add more time.`);
    return;
  }

  if (!checkRateLimit("sessionBuyHistory", 10, 3600000)) {
    showToast("⏳ You've reached the session purchase limit (10/hour). Please try again later.");
    return;
  }

  const cachedLink   = allDocs.find(d => d.id === currentLinkId);
  const sessionCount = getActiveSessionCount(cachedLink?.data?.activeSessions);

  const confirmed = await showSessionPurchaseModal(
    null, sessionCount, tier.name, tier.limitMinutes, userCredits
  );
  if (!confirmed) return;

  try {
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (txn) => {
      const userSnap = await txn.get(userRef);
      if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");
      if ((userSnap.data().credits || 0) < SESSION_COST) throw new Error("INSUFFICIENT_CREDITS");
      txn.update(userRef, { credits: increment(-SESSION_COST) });
    });

    // Extend the running timer
    const addMs = tier.limitMinutes * 60 * 1000;
    activeSessionExpiry += addMs;

    // Persist the updated remaining time and active expiry timestamp
    saveGlobalSession({ remainingMs: Math.max(0, activeSessionExpiry - Date.now()), activeExpiresAt: activeSessionExpiry });

    if (currentUserData) currentUserData.credits = (currentUserData.credits || 0) - SESSION_COST;
    const creditEl = document.getElementById("creditCount");
    if (creditEl) creditEl.textContent = currentUserData?.credits ?? 0;

    rateLimitRecord("sessionBuyHistory", 3600000);
    updateNavSessionTimer();
    showToast(`✅ Added ${tier.limitMinutes} minutes to your session!`);
  } catch (err) {
    if (err.message === "INSUFFICIENT_CREDITS") {
      showToast(`❌ Not enough credits.`);
    } else {
      console.error("Session extend error:", err);
      showToast("❌ Failed to add time. Please try again.");
    }
  }
}

// Expose modal close functions globally
window.closeIframeModal        = closeIframeModal;
window.closeProfileModal       = closeProfileModal;
window.closeRatingModal        = closeRatingModal;
window.closeDeleteConfirmModal = closeDeleteConfirmModal;
window.closeEditLinkModal      = closeEditLinkModal;
window.closeSessionBuyModal    = () => {
  const modal = document.getElementById("sessionBuyModal");
  if (modal) { modal.classList.add("hidden"); document.body.style.overflow = ""; }
};
window.handleExtendSession = handleExtendSession;

/**
 * Navbar session time button click handler.
 * When a session is active, extends it. Otherwise allows purchasing additional time.
 */
window.handleNavSessionTimerClick = async function handleNavSessionTimerClick() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // If actively in a session, just extend it
  if (currentLinkId) {
    handleExtendSession();
    return;
  }

  // No active session — allow pre-purchasing time
  const userData    = currentUserData || {};
  const tier        = calculateTier(userData.totalEarned || 0);
  const userCredits = userData.credits || 0;

  if (userCredits < SESSION_COST) {
    showToast(`❌ Not enough credits — you need ${SESSION_COST} 🪙 to buy session time.`);
    return;
  }

  if (!checkRateLimit("sessionBuyHistory", 10, 3600000)) {
    showToast("⏳ You've reached the session purchase limit (10/hour). Please try again later.");
    return;
  }

  const confirmed = await showSessionPurchaseModal(
    null, 0, tier.name, tier.limitMinutes, userCredits
  );
  if (!confirmed) return;

  try {
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (txn) => {
      const userSnap = await txn.get(userRef);
      if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");
      if ((userSnap.data().credits || 0) < SESSION_COST) throw new Error("INSUFFICIENT_CREDITS");
      txn.update(userRef, { credits: increment(-SESSION_COST) });
    });

    const gs = getGlobalSession() || { remainingMs: 0 };
    gs.remainingMs += tier.limitMinutes * 60 * 1000;
    saveGlobalSession(gs);

    if (currentUserData) currentUserData.credits = (currentUserData.credits || 0) - SESSION_COST;
    const creditEl = document.getElementById("creditCount");
    if (creditEl) creditEl.textContent = currentUserData?.credits ?? 0;

    rateLimitRecord("sessionBuyHistory", 3600000);
    updateNavSessionTimer();
    showToast(`✅ +${tier.limitMinutes} minutes added to your session time!`);
  } catch (err) {
    if (err.message === "INSUFFICIENT_CREDITS") {
      showToast(`❌ Not enough credits.`);
    } else {
      console.error("Nav session purchase error:", err);
      showToast("❌ Failed to add session time. Please try again.");
    }
  }
};

// XSS-safe helper
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}
