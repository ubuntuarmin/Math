import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  increment,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier } from "./tier.js";

const linksGrid    = document.getElementById("linksGrid");
const creditCount  = document.getElementById("creditCount");
const tierLabel    = document.getElementById("tierLabel");
const linksLoading = document.getElementById("linksLoading");
const linksEmpty   = document.getElementById("linksEmpty");

const LINK_CREDITS      = 50;
const REPORT_THRESHOLD  = 3;

// ─── Exported: called by auth.js after sign-in ───────────────────────────────
export function updateUI(userData) {
  if (creditCount) creditCount.textContent = userData?.credits ?? 0;
  if (tierLabel) {
    const tier = calculateTier(userData?.totalEarned ?? 0);
    tierLabel.textContent  = tier.name;
    tierLabel.style.color  = tier.color;
  }
  loadLinks();
}

// ─── Notification helper ─────────────────────────────────────────────────────
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

// ─── Load + render all active community links ─────────────────────────────────
async function loadLinks() {
  if (!linksGrid) return;

  if (linksLoading) linksLoading.classList.remove("hidden");
  if (linksEmpty)   linksEmpty.classList.add("hidden");
  linksGrid.innerHTML = "";

  try {
    const q = query(
      collection(db, "sharedLinks"),
      where("status", "==", "active"),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);

    if (linksLoading) linksLoading.classList.add("hidden");

    if (snap.empty) {
      if (linksEmpty) linksEmpty.classList.remove("hidden");
      return;
    }

    const uid = auth.currentUser?.uid ?? "";
    snap.forEach((docSnap) => renderLinkCard(docSnap.id, docSnap.data(), uid));
  } catch (err) {
    console.error("Links load error:", err);
    if (linksLoading) linksLoading.classList.add("hidden");
    if (linksGrid) {
      linksGrid.innerHTML = `
        <div class="col-span-full text-center text-red-400 py-10 text-sm">
          Failed to load links. Please check your connection and refresh.
        </div>`;
    }
  }
}

// ─── Render a single link card ────────────────────────────────────────────────
function renderLinkCard(id, data, currentUid) {
  if (!linksGrid) return;

  const hasReported = Array.isArray(data.reports) &&
    data.reports.some((r) => r.uid === currentUid);
  const reportCount = data.reportCount || 0;

  // Strip protocol for display
  const displayUrl = (data.url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const safeUrl  = escapeAttr(data.url);
  const safeName = escapeHtml(data.submittedByName || "Anonymous");
  const safeTitle = escapeHtml(data.title || "Untitled");
  const safeDisplayUrl = escapeHtml(displayUrl);
  const safeDesc = data.description ? escapeHtml(data.description) : "";

  const reportSection = hasReported
    ? `<span class="text-[10px] text-gray-500 italic">You reported this</span>`
    : `<div class="relative report-wrapper">
        <button
          class="report-btn text-[10px] text-gray-500 hover:text-orange-400
                 transition-colors px-2 py-1 rounded border border-gray-700
                 hover:border-orange-500/60 leading-none"
          data-id="${id}">
          Report ▾
        </button>
        <div class="report-dropdown hidden absolute right-0 bottom-full mb-1 z-20
                    bg-gray-800 border border-gray-700 rounded-xl overflow-hidden
                    shadow-xl min-w-[150px]">
          <button
            class="report-type w-full text-left px-4 py-2.5 text-xs text-gray-200
                   hover:bg-red-900/40 hover:text-red-300 transition-colors
                   flex items-center gap-2"
            data-id="${id}" data-type="fake">
            <span>🚫</span> Fake / Spam
          </button>
          <button
            class="report-type w-full text-left px-4 py-2.5 text-xs text-gray-200
                   hover:bg-orange-900/40 hover:text-orange-300 transition-colors
                   flex items-center gap-2"
            data-id="${id}" data-type="blocked">
            <span>⛔</span> Blocked / Broken
          </button>
        </div>
      </div>`;

  const card = document.createElement("div");
  card.dataset.linkId = id;
  card.className =
    "link-card relative flex flex-col gap-3 p-5 rounded-2xl " +
    "bg-gray-900/80 border border-gray-700/60 " +
    "hover:border-blue-500/60 transition-all duration-200 " +
    "hover:-translate-y-1 shadow-lg";

  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <div class="text-white font-bold text-base truncate">${safeTitle}</div>
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
           class="text-blue-400 text-xs hover:text-blue-300 truncate block mt-0.5 transition-colors">
          🔗 ${safeDisplayUrl}
        </a>
      </div>
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
         class="shrink-0 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500 text-white
                text-xs font-bold rounded-full transition-colors flex items-center gap-1">
        Open ↗
      </a>
    </div>
    ${safeDesc ? `
    <p class="text-gray-400 text-xs leading-relaxed line-clamp-2">${safeDesc}</p>` : ""}
    <div class="flex items-center justify-between mt-auto pt-2 border-t border-gray-800">
      <div class="text-[10px] text-gray-500">
        Shared by <span class="text-gray-400">${safeName}</span>
        ${reportCount > 0
          ? `· <span class="text-orange-400">⚠ ${reportCount} report${reportCount !== 1 ? "s" : ""}</span>`
          : ""}
      </div>
      ${reportSection}
    </div>`;

  // Toggle report dropdown
  const reportBtn  = card.querySelector(".report-btn");
  const dropdown   = card.querySelector(".report-dropdown");
  if (reportBtn && dropdown) {
    reportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".report-dropdown").forEach((d) => {
        if (d !== dropdown) d.classList.add("hidden");
      });
      dropdown.classList.toggle("hidden");
    });
  }

  // Handle report type click
  card.querySelectorAll(".report-type").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const linkId = btn.dataset.id;
      const type   = btn.dataset.type;
      if (!linkId || !type) return;
      if (!auth.currentUser) {
        alert("You must be signed in to report links.");
        return;
      }
      await handleReport(linkId, type, card);
    });
  });

  linksGrid.appendChild(card);
}

// ─── Handle a report submission ───────────────────────────────────────────────
async function handleReport(linkId, type, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const linkRef = doc(db, "sharedLinks", linkId);
    const snap    = await getDoc(linkRef);
    if (!snap.exists()) return;

    const data = snap.data();

    // Prevent double-reporting
    const alreadyReported = Array.isArray(data.reports) &&
      data.reports.some((r) => r.uid === uid);
    if (alreadyReported) {
      alert("You have already reported this link.");
      return;
    }

    // Prevent self-reporting
    if (data.submittedBy === uid) {
      alert("You cannot report your own link.");
      return;
    }

    const newReport = { uid, type, reportedAt: new Date().toISOString() };
    const newCount  = (data.reportCount || 0) + 1;

    if (newCount >= REPORT_THRESHOLD) {
      // ── Auto-remove ──────────────────────────────────────────────────────
      const allReports  = [...(data.reports || []), newReport];
      const fakeCount   = allReports.filter((r) => r.type === "fake").length;
      const majorityFake = fakeCount >= Math.ceil(allReports.length / 2);

      await updateDoc(linkRef, {
        status:          "removed",
        reportCount:     newCount,
        reports:         arrayUnion(newReport),
        removedAt:       serverTimestamp(),
        creditsReversed: majorityFake,
      });

      // Notify the submitter
      const msg = majorityFake
        ? `Your shared link "${data.title}" was removed after ${newCount} users ` +
          `reported it as fake or spam. The ${LINK_CREDITS} credits originally ` +
          `awarded have been reversed.`
        : `Your shared link "${data.title}" was removed after ${newCount} users ` +
          `reported it as blocked or broken. Your credits have been kept.`;

      await sendNotification(data.submittedBy, "Your Link Was Removed", msg, "link");

      // Reverse credits if the link was fake and a reward was given
      if (majorityFake && data.rewardGiven) {
        try {
          await updateDoc(doc(db, "users", data.submittedBy), {
            credits: increment(-LINK_CREDITS),
          });
        } catch (e) {
          console.warn("Could not reverse credits:", e);
        }
      }

      // Animate card out
      cardEl.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      cardEl.style.opacity    = "0";
      cardEl.style.transform  = "scale(0.95)";
      setTimeout(() => {
        cardEl.remove();
        // Show empty state if no more cards
        if (linksGrid && linksGrid.querySelectorAll(".link-card").length === 0) {
          if (linksEmpty) linksEmpty.classList.remove("hidden");
        }
      }, 300);

      alert("Thanks for the report. This link has been removed from the community.");
    } else {
      // ── Increment count only ─────────────────────────────────────────────
      await updateDoc(linkRef, {
        reportCount: newCount,
        reports:     arrayUnion(newReport),
      });

      // Swap out the report dropdown for a "Reported" label
      const wrapper = cardEl.querySelector(".report-wrapper");
      if (wrapper) {
        const span = document.createElement("span");
        span.className  = "text-[10px] text-gray-500 italic";
        span.textContent = "You reported this";
        wrapper.replaceWith(span);
      }

      // Update the report count display
      const footerInfo = cardEl.querySelector(".text-gray-500");
      if (footerInfo) {
        const submitter = escapeHtml(
          footerInfo.querySelector(".text-gray-400")?.textContent || "Anonymous"
        );
        footerInfo.innerHTML =
          `Shared by <span class="text-gray-400">${submitter}</span>` +
          ` · <span class="text-orange-400">⚠ ${newCount} report${newCount !== 1 ? "s" : ""}</span>`;
      }

      alert("Thanks for the report! If two more users report this link it will be removed.");
    }
  } catch (err) {
    console.error("Report error:", err);
    alert("Failed to submit report. Please try again.");
  }
}

// ─── Close all dropdowns when clicking outside ───────────────────────────────
document.addEventListener("click", () => {
  document.querySelectorAll(".report-dropdown").forEach((d) => d.classList.add("hidden"));
});

// ─── Refresh links when the header "Refresh" button is clicked ───────────────
document.addEventListener("refreshLinks", () => loadLinks());

// ─── XSS-safe helpers ────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(url) {
  if (!/^https?:\/\//i.test(String(url))) return "#";
  return escapeHtml(url);
}
