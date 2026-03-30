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
const UPVOTE_CREDITS    = 10;
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

  const hasUpvoted = Array.isArray(data.upvotes) &&
    data.upvotes.some((u) => u === currentUid || u?.uid === currentUid);
  const upvoteCount = data.upvoteCount || 0;

  const safeName  = escapeHtml(data.submittedByName || "Anonymous");
  const safeTitle = escapeHtml(data.title || "Untitled");
  const safeDesc  = data.description ? escapeHtml(data.description) : "";
  const submittedBy = data.submittedBy || "";

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

  // Upvote section
  const upvoteSection = hasUpvoted
    ? `<span class="text-[10px] text-blue-400 font-bold flex items-center gap-1">
         👍 ${upvoteCount}
       </span>`
    : `<button class="upvote-btn text-[10px] text-gray-500 hover:text-blue-400
                      transition-colors px-2 py-1 rounded border border-gray-700
                      hover:border-blue-500/60 leading-none flex items-center gap-1"
              data-id="${id}" data-submitter="${submittedBy}">
         👍 ${upvoteCount > 0 ? upvoteCount : "Upvote"} <span class="text-emerald-400">(+${UPVOTE_CREDITS}✨)</span>
       </button>`;

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
      </div>
      <button class="open-link-btn shrink-0 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500 text-white
               text-xs font-bold rounded-full transition-colors flex items-center gap-1"
              data-id="${id}">
        Open ↗
      </button>
    </div>
    ${safeDesc ? `
    <p class="text-gray-400 text-xs leading-relaxed line-clamp-2">${safeDesc}</p>` : ""}
    <div class="flex items-center justify-between mt-auto pt-2 border-t border-gray-800">
      <div class="flex items-center gap-2 text-[10px] text-gray-500">
        <span>Shared by</span>
        <button class="view-profile-btn text-gray-400 hover:text-blue-300 transition-colors underline-offset-2 hover:underline"
                data-uid="${submittedBy}" data-name="${safeName}">
          ${safeName}
        </button>
        ${reportCount > 0
          ? `· <span class="text-orange-400">⚠ ${reportCount} report${reportCount !== 1 ? "s" : ""}</span>`
          : ""}
      </div>
      <div class="flex items-center gap-2">
        ${upvoteSection}
        ${reportSection}
      </div>
    </div>`;

  // Open-in-iframe button
  card.querySelector(".open-link-btn").addEventListener("click", () => {
    openIframeModal(data.url, safeTitle);
  });

  // View profile button
  card.querySelector(".view-profile-btn").addEventListener("click", () => {
    openProfileModal(submittedBy, safeName);
  });

  // Upvote button
  const upvoteBtn = card.querySelector(".upvote-btn");
  if (upvoteBtn) {
    upvoteBtn.addEventListener("click", async () => {
      if (!auth.currentUser) {
        alert("You must be signed in to upvote.");
        return;
      }
      await handleUpvote(id, data, upvoteBtn, card);
    });
  }

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

// ─── Open link in iframe modal ────────────────────────────────────────────────
function openIframeModal(url, title) {
  const modal   = document.getElementById("iframeModal");
  const frame   = document.getElementById("iframeFrame");
  const loader  = document.getElementById("iframeLoader");
  const titleEl = document.getElementById("iframeTitle");
  if (!modal || !frame || !loader) return;

  if (titleEl) titleEl.textContent = title || "Loading…";
  frame.src = "";
  loader.classList.remove("hidden");
  frame.classList.add("opacity-0");

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Load the URL
  frame.onload = () => {
    loader.classList.add("hidden");
    frame.classList.remove("opacity-0");
  };
  frame.src = url;
}

// ─── Close iframe modal ───────────────────────────────────────────────────────
function closeIframeModal() {
  const modal = document.getElementById("iframeModal");
  const frame = document.getElementById("iframeFrame");
  if (!modal) return;
  if (frame) frame.src = "";
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// ─── Open profile modal ───────────────────────────────────────────────────────
async function openProfileModal(uid, displayName) {
  const modal   = document.getElementById("profileModal");
  const content = document.getElementById("profileModalContent");
  if (!modal || !content) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  content.innerHTML = `<div class="flex justify-center py-10"><div class="loader"></div></div>`;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      content.innerHTML = `<p class="text-gray-400 text-sm text-center py-6">Profile not found.</p>`;
      return;
    }
    const data = snap.data();
    const tier = calculateTier(data.totalEarned || 0);
    const currentUid = auth.currentUser?.uid ?? "";
    const isSelf = currentUid === uid;

    content.innerHTML = `
      <div class="text-center">
        <div class="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center
                    text-3xl font-black text-white"
             style="background: linear-gradient(135deg, #38bdf8, #a855f7)">
          ${escapeHtml((data.firstName || "?")[0].toUpperCase())}
        </div>
        <div class="text-xl font-bold text-white mb-1">
          ${escapeHtml(data.firstName || "Student")} ${escapeHtml(data.lastName || "")}
        </div>
        <div class="text-xs font-bold px-2 py-0.5 rounded inline-block mb-4"
             style="color:${tier.color}; border: 1px solid ${tier.color}44">
          ${tier.name}
        </div>
        <div class="grid grid-cols-2 gap-3 mb-5">
          <div class="bg-gray-800/60 p-3 rounded-xl text-center">
            <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Total Earned</div>
            <div class="text-lg font-bold text-emerald-400">${data.totalEarned || 0} 🪙</div>
          </div>
          <div class="bg-gray-800/60 p-3 rounded-xl text-center">
            <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Grade</div>
            <div class="text-lg font-bold text-white">${escapeHtml(data.grade || "—")}</div>
          </div>
        </div>
        ${!isSelf ? `
        <button id="profileUpvoteBtn"
                class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500
                       text-white font-bold text-sm transition-colors
                       flex items-center justify-center gap-2"
                data-uid="${uid}">
          👍 Upvote <span class="text-blue-200 font-normal">(gives +${UPVOTE_CREDITS} credits)</span>
        </button>` : `
        <div class="text-xs text-gray-500 italic">This is your profile.</div>`}
      </div>`;

    // Profile upvote button (profile-level, separate from link upvotes)
    const profileUpvoteBtn = content.querySelector("#profileUpvoteBtn");
    if (profileUpvoteBtn) {
      profileUpvoteBtn.addEventListener("click", async () => {
        if (!auth.currentUser) {
          alert("You must be signed in to upvote.");
          return;
        }
        await handleProfileUpvote(uid, profileUpvoteBtn);
      });
    }
  } catch (err) {
    console.error("Profile load error:", err);
    content.innerHTML = `<p class="text-red-400 text-sm text-center py-6">Failed to load profile.</p>`;
  }
}

// ─── Close profile modal ──────────────────────────────────────────────────────
function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// ─── Handle upvote on a link card ─────────────────────────────────────────────
async function handleUpvote(linkId, data, btn, cardEl) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Prevent self-upvoting
  if (data.submittedBy === uid) {
    alert("You cannot upvote your own link.");
    return;
  }

  // Prevent double-upvoting
  const alreadyUpvoted = Array.isArray(data.upvotes) &&
    data.upvotes.some((u) => u === uid || u?.uid === uid);
  if (alreadyUpvoted) {
    alert("You have already upvoted this link.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Upvoting…";

  try {
    const linkRef = doc(db, "sharedLinks", linkId);

    // Award credits to the submitter
    if (data.submittedBy) {
      await updateDoc(doc(db, "users", data.submittedBy), {
        credits:      increment(UPVOTE_CREDITS),
        totalEarned:  increment(UPVOTE_CREDITS),
      });
      await sendNotification(
        data.submittedBy,
        "Your link was upvoted!",
        `Someone upvoted your link "${data.title}". You earned +${UPVOTE_CREDITS} credits! 🎉`,
        "upvote"
      );
    }

    await updateDoc(linkRef, {
      upvotes:     arrayUnion(uid),
      upvoteCount: increment(1),
    });

    // Replace button with static count
    const newCount = (data.upvoteCount || 0) + 1;
    btn.replaceWith(
      Object.assign(document.createElement("span"), {
        className:   "text-[10px] text-blue-400 font-bold flex items-center gap-1",
        textContent: `👍 ${newCount}`,
      })
    );
  } catch (err) {
    console.error("Upvote error:", err);
    btn.disabled = false;
    btn.textContent = "👍 Upvote";
    alert("Failed to upvote. Please try again.");
  }
}

// ─── Handle profile-level upvote ─────────────────────────────────────────────
async function handleProfileUpvote(targetUid, btn) {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  if (currentUid === targetUid) {
    alert("You cannot upvote yourself.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Upvoting…";

  try {
    // Check if already upvoted this user (stored in upvotedUsers array on current user doc)
    const myRef = doc(db, "users", currentUid);
    const mySnap = await getDoc(myRef);
    const myData = mySnap.exists() ? mySnap.data() : {};
    const upvotedUsers = myData.upvotedUsers || [];

    if (upvotedUsers.includes(targetUid)) {
      btn.disabled = false;
      btn.innerHTML = `👍 Upvote <span class="text-blue-200 font-normal">(gives +${UPVOTE_CREDITS} credits)</span>`;
      alert("You have already upvoted this user.");
      return;
    }

    // Award credits to the target user
    await updateDoc(doc(db, "users", targetUid), {
      credits:     increment(UPVOTE_CREDITS),
      totalEarned: increment(UPVOTE_CREDITS),
    });

    // Record that we upvoted this user
    await updateDoc(myRef, {
      upvotedUsers: arrayUnion(targetUid),
    });

    await sendNotification(
      targetUid,
      "Someone upvoted your profile!",
      `You received a profile upvote. +${UPVOTE_CREDITS} credits added! 🎉`,
      "upvote"
    );

    btn.innerHTML = `✅ Upvoted (+${UPVOTE_CREDITS} credits sent)`;
    btn.className = btn.className.replace("bg-blue-600 hover:bg-blue-500", "bg-gray-700 cursor-default");
  } catch (err) {
    console.error("Profile upvote error:", err);
    btn.disabled = false;
    btn.innerHTML = `👍 Upvote <span class="text-blue-200 font-normal">(gives +${UPVOTE_CREDITS} credits)</span>`;
    alert("Failed to upvote. Please try again.");
  }
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
      const profileBtn = cardEl.querySelector(".view-profile-btn");
      const submitterUid  = profileBtn?.dataset.uid  || "";
      const submitterName = escapeHtml(profileBtn?.textContent?.trim() || "Anonymous");
      const footerLeft = cardEl.querySelector(".flex.items-center.gap-2.text-\\[10px\\].text-gray-500");
      const footerInfo = footerLeft || cardEl.querySelector(".text-gray-500");
      if (footerInfo) {
        footerInfo.innerHTML =
          `<span>Shared by</span>
           <button class="view-profile-btn text-gray-400 hover:text-blue-300 transition-colors underline-offset-2 hover:underline"
             data-uid="${submitterUid}" data-name="${submitterName}">${submitterName}</button>` +
          ` · <span class="text-orange-400">⚠ ${newCount} report${newCount !== 1 ? "s" : ""}</span>`;
        // Re-attach profile view listener
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

// ─── Close all dropdowns when clicking outside ───────────────────────────────
document.addEventListener("click", () => {
  document.querySelectorAll(".report-dropdown").forEach((d) => d.classList.add("hidden"));
});

// ─── Refresh links when the header "Refresh" button is clicked ───────────────
document.addEventListener("refreshLinks", () => loadLinks());

// ─── Expose modal close functions globally ───────────────────────────────────
window.closeIframeModal  = closeIframeModal;
window.closeProfileModal = closeProfileModal;

// ─── XSS-safe helpers ────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

