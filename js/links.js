import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  increment,
  addDoc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";

const linksGrid    = document.getElementById("linksGrid");
const creditCount  = document.getElementById("creditCount");
const tierLabel    = document.getElementById("tierLabel");
const linksLoading = document.getElementById("linksLoading");
const linksEmpty   = document.getElementById("linksEmpty");

const LINK_CREDITS       = 50;
const UPVOTE_CREDITS     = 10;
const REPORT_THRESHOLD   = 3;
const RATING_REQUIRED_MS = 10000; // 10 seconds minimum to unlock rating

// Helper: compute average rating string ("4.2") or null
function calcAvgRating(ratingSum, ratingCount) {
  if (!ratingCount) return null;
  return (ratingSum / ratingCount).toFixed(1);
}

// Module state
let allDocs      = [];
let activeFilter = null;   // { type: 'profile'|'hashtag', value, label }
let searchTerm   = "";
let sortMode     = "newest";

// Iframe / rating state
let iframeOpenTime = 0;
let iframeLoaded   = false;
let pendingRating  = null; // { linkId, title, submittedBy }
let selectedStars  = 0;
let ratingTimerOut = null;
let setupDone      = false;

// Exported: called by auth.js after sign-in
export function updateUI(userData) {
  if (creditCount) creditCount.textContent = userData?.credits ?? 0;
  if (tierLabel) {
    const tier = calculateTier(userData?.totalEarned ?? 0);
    tierLabel.textContent = tier.name;
    tierLabel.style.color = tier.color;
  }
  if (!setupDone) {
    setupDone = true;
    setupSearchSort();
    setupRatingModal();
  }
  loadLinks();
}

// Notification helper
async function sendNotification(toUid, title, text, type = "system") {
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
  } catch (err) {
    console.warn("Failed to send notification:", err);
  }
}

// Load all active links
async function loadLinks() {
  if (!linksGrid) return;

  if (linksLoading) linksLoading.classList.remove("hidden");
  if (linksEmpty)   linksEmpty.classList.add("hidden");
  linksGrid.innerHTML = "";

  try {
    const q    = query(collection(db, "sharedLinks"), where("status", "==", "active"));
    const snap = await getDocs(q);

    if (linksLoading) linksLoading.classList.add("hidden");

    allDocs = [];
    snap.forEach(s => allDocs.push({ id: s.id, data: s.data() }));

    filterAndRenderLinks();
  } catch (err) {
    console.error("Links load error:", err);
    if (linksLoading) linksLoading.classList.add("hidden");
    if (linksGrid) {
      linksGrid.innerHTML =
        '<div class="col-span-full text-center text-red-400 py-10 text-sm">' +
        'Failed to load links. Please check your connection and refresh.</div>';
    }
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

  searchInput?.addEventListener("input", () => {
    searchTerm = searchInput.value.trim();
    filterAndRenderLinks();
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

  const upvoteSection = hasUpvoted
    ? '<span class="text-[10px] text-blue-400 font-bold flex items-center gap-1">' +
      '\uD83D\uDC4D ' + upvoteCount + '</span>'
    : '<button class="upvote-btn text-[10px] text-gray-500 hover:text-blue-400 ' +
      'transition-colors px-2 py-1 rounded border border-gray-700 ' +
      'hover:border-blue-500/60 leading-none flex items-center gap-1" ' +
      'data-id="' + id + '" data-submitter="' + submittedBy + '">' +
      '\uD83D\uDC4D ' + (upvoteCount > 0 ? upvoteCount : "Upvote") +
      ' <span class="text-emerald-400">(+' + UPVOTE_CREDITS + '\u2728)</span></button>';

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
        '<div class="text-white font-bold text-base truncate">' + safeTitle + '</div>' +
        hashtagsHtml +
      '</div>' +
      '<button class="open-link-btn shrink-0 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500 ' +
      'text-white text-xs font-bold rounded-full transition-colors flex items-center gap-1" ' +
      'data-id="' + id + '">Open \u2197</button>' +
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
      '<div class="flex items-center gap-2">' + upvoteSection + reportSection + '</div>' +
    '</div>';

  card.querySelector(".open-link-btn").addEventListener("click", () => {
    openIframeModal(data.url, safeTitle, id, submittedBy);
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

  linksGrid.appendChild(card);
}

// Open link in iframe modal
function openIframeModal(url, title, linkId, submittedBy) {
  const modal   = document.getElementById("iframeModal");
  const frame   = document.getElementById("iframeFrame");
  const loader  = document.getElementById("iframeLoader");
  const titleEl = document.getElementById("iframeTitle");
  const rateBtn = document.getElementById("iframeRateBtn");
  if (!modal || !frame || !loader) return;

  if (titleEl) titleEl.textContent = title || "Loading\u2026";
  frame.src = "";
  loader.classList.remove("hidden");
  frame.classList.add("opacity-0");
  if (rateBtn) rateBtn.classList.add("hidden");

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  iframeOpenTime = Date.now();
  iframeLoaded   = false;
  pendingRating  = { linkId: linkId || null, title, submittedBy: submittedBy || null };

  if (ratingTimerOut) { clearTimeout(ratingTimerOut); ratingTimerOut = null; }

  frame.onload = () => {
    loader.classList.add("hidden");
    frame.classList.remove("opacity-0");
    iframeLoaded = true;

    if (pendingRating?.linkId && auth.currentUser) {
      ratingTimerOut = setTimeout(() => {
        if (rateBtn) rateBtn.classList.remove("hidden");
      }, RATING_REQUIRED_MS);
    }
  };

  frame.src = url;

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

// Close iframe modal
function closeIframeModal() {
  const modal   = document.getElementById("iframeModal");
  const frame   = document.getElementById("iframeFrame");
  const rateBtn = document.getElementById("iframeRateBtn");
  if (!modal) return;

  if (ratingTimerOut) { clearTimeout(ratingTimerOut); ratingTimerOut = null; }
  if (rateBtn) rateBtn.classList.add("hidden");
  if (frame) frame.src = "";
  modal.classList.add("hidden");
  document.body.style.overflow = "";

  const timeSpent = Date.now() - iframeOpenTime;
  const pr = pendingRating;
  pendingRating = null;
  if (timeSpent >= RATING_REQUIRED_MS && iframeLoaded && pr?.linkId && auth.currentUser) {
    checkAndShowRatingModal(pr.linkId, pr.title, pr.submittedBy);
  }
}

// Check if already rated, then show rating modal
async function checkAndShowRatingModal(linkId, title, submittedBy) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    const q    = query(
      collection(db, "linkRatings"),
      where("linkId", "==", linkId),
      where("ratedBy", "==", uid)
    );
    const snap = await getDocs(q);
    if (!snap.empty) return;
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

    await batch.commit();

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

// Open profile modal
async function openProfileModal(uid, displayName) {
  const modal   = document.getElementById("profileModal");
  const content = document.getElementById("profileModalContent");
  if (!modal || !content) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  content.innerHTML = '<div class="flex justify-center py-10"><div class="loader"></div></div>';

  try {
    const [userSnap, ratingsSnap] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDocs(query(collection(db, "linkRatings"), where("submittedBy", "==", uid))),
    ]);

    if (!userSnap.exists()) {
      content.innerHTML = '<p class="text-gray-400 text-sm text-center py-6">Profile not found.</p>';
      return;
    }

    const data       = userSnap.data();
    const tier       = calculateTier(data.totalEarned || 0);
    const currentUid = auth.currentUser?.uid ?? "";
    const isSelf     = currentUid === uid;

    const ratings = [];
    ratingsSnap.forEach(s => ratings.push(s.data()));
    const avgRating = ratings.length
      ? (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1)
      : null;

    const userLinks     = allDocs.filter(d => d.data.submittedBy === uid);
    const recentReviews = ratings
      .filter(r => r.comment)
      .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0))
      .slice(0, 3);

    let linksHtml = "";
    if (userLinks.length > 0) {
      const shown = userLinks.slice(0, 5);
      linksHtml =
        '<div class="mb-4">' +
        '<div class="text-[10px] text-gray-500 uppercase font-bold mb-2 tracking-wider">' +
        'Their Links (' + userLinks.length + ')</div>' +
        '<div class="space-y-2">' +
        shown.map(({ id: lid, data: ld }) =>
          '<div class="flex items-center gap-2 p-2.5 bg-gray-800/60 rounded-xl">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="text-xs text-white font-semibold truncate">' + escapeHtml(ld.title || "Untitled") + '</div>' +
              '<div class="text-[10px] text-gray-500 mt-0.5">' +
                '\uD83D\uDC4D ' + (ld.upvoteCount || 0) +
                (calcAvgRating(ld.ratingSum, ld.ratingCount) !== null ? ' \u00B7 \u2B50 ' + calcAvgRating(ld.ratingSum, ld.ratingCount) : "") +
              '</div>' +
            '</div>' +
            '<button class="profile-open-link shrink-0 text-[10px] px-2.5 py-1 rounded-full ' +
            'bg-blue-600/70 hover:bg-blue-500 text-white font-bold transition-colors" ' +
            'data-url="' + escapeHtml(ld.url) + '" data-title="' + escapeHtml(ld.title || "") + '" ' +
            'data-id="' + lid + '" data-submitter="' + uid + '">Open</button>' +
          '</div>'
        ).join("") +
        (userLinks.length > 5
          ? '<button id="profileShowAllLinks" ' +
            'class="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors" ' +
            'data-uid="' + uid + '" data-name="' + escapeHtml(data.firstName || "Student") + '">' +
            '+ ' + (userLinks.length - 5) + ' more links \u2192</button>'
          : "") +
        '</div></div>';
    }

    let reviewsHtml = "";
    if (recentReviews.length > 0) {
      reviewsHtml =
        '<div>' +
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
      ? '<button id="profileUpvoteBtn" ' +
        'class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 ' +
        'text-white font-bold text-sm transition-colors ' +
        'flex items-center justify-center gap-2 mb-2" data-uid="' + uid + '">' +
        '\uD83D\uDC4D Upvote Profile ' +
        '<span class="text-blue-200 font-normal">(+' + UPVOTE_CREDITS + ' credits)</span></button>' +
        '<button id="profileFilterBtn" ' +
        'class="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 ' +
        'text-gray-300 font-bold text-sm transition-colors border border-gray-700 mb-4" ' +
        'data-uid="' + uid + '" data-name="' + escapeHtml(data.firstName || "Student") + '">' +
        '\uD83D\uDD0D Show only their links</button>'
      : '<div class="text-xs text-gray-500 italic text-center mb-4">This is your profile.</div>';

    content.innerHTML =
      '<div>' +
        '<div class="text-center mb-5">' +
          '<div class="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center ' +
          'text-3xl font-black text-white" ' +
          'style="background: linear-gradient(135deg, #38bdf8, #a855f7)">' +
            escapeHtml((data.firstName || "?")[0].toUpperCase()) +
          '</div>' +
          '<div class="text-xl font-bold text-white mb-1">' +
            escapeHtml(data.firstName || "Student") + ' ' + escapeHtml(data.lastName || "") +
          '</div>' +
          '<div class="text-xs font-bold px-2 py-0.5 rounded inline-block" ' +
          'style="color:' + tier.color + '; border: 1px solid ' + tier.color + '44">' +
            tier.name +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-2 gap-2 mb-4">' +
          '<div class="bg-gray-800/60 p-3 rounded-xl text-center">' +
            '<div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Total Earned</div>' +
            '<div class="text-base font-bold text-emerald-400">' + (data.totalEarned || 0) + ' \uD83E\uDE99</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-3 rounded-xl text-center">' +
            '<div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Grade</div>' +
            '<div class="text-base font-bold text-white">' + escapeHtml(data.grade || "\u2014") + '</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-3 rounded-xl text-center">' +
            '<div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Links Shared</div>' +
            '<div class="text-base font-bold text-blue-400">' + userLinks.length + '</div>' +
          '</div>' +
          '<div class="bg-gray-800/60 p-3 rounded-xl text-center">' +
            '<div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Avg Rating</div>' +
            '<div class="text-base font-bold text-yellow-400">' +
              (avgRating !== null ? '\u2B50 ' + avgRating : '\u2014') +
            '</div>' +
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
        closeProfileModal();
        openIframeModal(btn.dataset.url, btn.dataset.title, btn.dataset.id, btn.dataset.submitter);
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

  btn.disabled    = true;
  btn.textContent = "Upvoting\u2026";

  try {
    const linkRef = doc(db, "sharedLinks", linkId);

    if (data.submittedBy) {
      await updateDoc(doc(db, "users", data.submittedBy), {
        credits:     increment(UPVOTE_CREDITS),
        totalEarned: increment(UPVOTE_CREDITS),
      });
      await sendNotification(
        data.submittedBy,
        "Your link was upvoted!",
        'Someone upvoted your link "' + data.title + '". You earned +' + UPVOTE_CREDITS + ' credits! \uD83C\uDF89',
        "upvote"
      );
    }

    await updateDoc(linkRef, {
      upvotes:     arrayUnion(uid),
      upvoteCount: increment(1),
    });

    const newCount = (data.upvoteCount || 0) + 1;
    btn.replaceWith(
      Object.assign(document.createElement("span"), {
        className:   "text-[10px] text-blue-400 font-bold flex items-center gap-1",
        textContent: "\uD83D\uDC4D " + newCount,
      })
    );
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

  try {
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
          'awarded have been reversed.'
        : 'Your shared link "' + data.title + '" was removed after ' + newCount + ' users ' +
          'reported it as blocked or broken. Your credits have been kept.';

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

      alert("Thanks for the report. This link has been removed from the community.");
    } else {
      await updateDoc(linkRef, {
        reportCount: newCount,
        reports:     arrayUnion(newReport),
      });

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

// Expose modal close functions globally
window.closeIframeModal  = closeIframeModal;
window.closeProfileModal = closeProfileModal;
window.closeRatingModal  = closeRatingModal;

// XSS-safe helper
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}
