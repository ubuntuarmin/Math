import { db, auth } from "./firebase.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  increment,
  addDoc,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");
const suggestionListEl = document.getElementById("suggestionList");
const linkSubmissionListEl = document.getElementById("linkSubmissionList");

// Extend-limit modal elements
const extendLimitModal = document.getElementById("extendLimitModal");
const extendMinutesInput = document.getElementById("extendMinutesInput");
const extendBonusInput = document.getElementById("extendBonusInput");
const extendLimitError = document.getElementById("extendLimitError");
const extendLimitCancel = document.getElementById("extendLimitCancel");
const extendLimitConfirm = document.getElementById("extendLimitConfirm");

// Your Unique Admin ID
const ADMIN_UID = "bnGhRvqW1YhvGek1JTLuAed6Ib63";

// Costs/bonuses (must match frontend logic)
const SUGGESTION_COST = 20;
const LINK_BONUS = 150;

// Field name for per-day extra limit minutes (temp override for today only).
const EXTRA_LIMIT_FIELD = "extraLimitMinutesToday";

// State for which user is currently being edited in the modal
let extendTargetUserId = null;
let extendTargetUserName = "";

/**
 * Send Inbox Message Logic
 */
async function sendNotification(targetUid, title, message, type = "admin") {
  try {
    const messagesRef = collection(db, "messages");
    await addDoc(messagesRef, {
      to: targetUid,
      fromName: "Admin",
      text: message,
      title: title,
      type: type,
      timestamp: serverTimestamp(),
      read: false,
    });
    return true;
  } catch (error) {
    console.error("Error sending notification:", error);
    return false;
  }
}

/**
 * Open / Close Extend Limit Modal
 */
function openExtendLimitModal(userId, userName) {
  if (!extendLimitModal) return;
  extendTargetUserId = userId;
  extendTargetUserName = userName || "this student";
  if (extendMinutesInput) extendMinutesInput.value = "";
  if (extendBonusInput) extendBonusInput.value = "";
  if (extendLimitError) extendLimitError.textContent = "";
  extendLimitModal.classList.remove("hidden");
}

function closeExtendLimitModal() {
  extendTargetUserId = null;
  extendTargetUserName = "";
  if (extendLimitModal) extendLimitModal.classList.add("hidden");
}

/**
 * Apply Extend Daily Limit + Bonus Credits
 * TEMP override: extends today's limit only (auth.js clears it on new day).
 */
async function applyExtendDailyLimit() {
  if (!extendTargetUserId) return;

  const minutesRaw = extendMinutesInput?.value.trim() || "";
  const bonusRaw = extendBonusInput?.value.trim() || "";

  const extraMinutes = Number(minutesRaw);
  const bonusCredits = bonusRaw === "" ? 0 : Number(bonusRaw);

  if (!Number.isFinite(extraMinutes) || extraMinutes <= 0) {
    if (extendLimitError)
      extendLimitError.textContent = "Enter a positive number of minutes.";
    return;
  }
  if (!Number.isFinite(bonusCredits) || bonusCredits < 0) {
    if (extendLimitError)
      extendLimitError.textContent = "Bonus credits must be 0 or more.";
    return;
  }

  try {
    if (extendLimitError) extendLimitError.textContent = "";

    const userRef = doc(db, "users", extendTargetUserId);

    const updateData = {
      [EXTRA_LIMIT_FIELD]: increment(extraMinutes),
    };

    if (bonusCredits > 0) {
      updateData.credits = increment(bonusCredits);
      updateData.totalEarned = increment(bonusCredits);
    }

    await updateDoc(userRef, updateData);

    const msgParts = [
      `Your daily limit was extended by ${extraMinutes} minutes for today.`,
    ];
    if (bonusCredits > 0) {
      msgParts.push(`You also received ${bonusCredits} bonus credits.`);
    }

    await sendNotification(
      extendTargetUserId,
      "Daily Limit Extended",
      msgParts.join(" "),
      "limit"
    );

    closeExtendLimitModal();
    loadAllUsers();
  } catch (err) {
    console.error("Extend daily limit error:", err);
    if (extendLimitError)
      extendLimitError.textContent = "Failed to apply. Please try again.";
  }
}

/**
 * Authorization & Initial Load
 */
async function initAdmin() {
  auth.onAuthStateChanged((user) => {
    if (!user || user.uid !== ADMIN_UID) {
      console.warn("Unauthorized access. Redirecting...");
      window.location.href = "index.html";
    } else {
      loadAllUsers();
      loadSuggestions();
      loadLinkSubmissions();
    }
  });
}

function getRewardAmount(rank) {
  if (rank > 10) return 0;
  return 110 - rank * 10;
}

/**
 * Reset leaderboard + rewards
 */
if (resetBtn) {
  resetBtn.onclick = async () => {
    const confirmAction = confirm(
      "🚨 CRITICAL ACTION 🚨\n\n" +
        "This will:\n" +
        "1. Give bonus credits to the Top 10\n" +
        "2. Send an Inbox message to winners\n" +
        "3. Clear all 'This Week' minutes.\n\n" +
        "Do you want to proceed?"
    );

    if (!confirmAction) return;

    resetBtn.disabled = true;
    const originalText = resetBtn.innerHTML;
    resetBtn.innerHTML = `⏳ Processing Rewards...`;

    try {
      const topQuery = query(
        collection(db, "users"),
        orderBy("weekMinutes", "desc"),
        limit(10)
      );
      const topSnap = await getDocs(topQuery);

      const batchPromises = [];
      let rank = 1;

      for (const userDoc of topSnap.docs) {
        const userData = userDoc.data();
        if ((userData.weekMinutes || 0) > 0) {
          const reward = getRewardAmount(rank);
          const userRef = doc(db, "users", userDoc.id);

          batchPromises.push(
            updateDoc(userRef, {
              credits: increment(reward),
              totalEarned: increment(reward),
            })
          );

          batchPromises.push(
            sendNotification(
              userDoc.id,
              "🏆 Leaderboard Reward!",
              `Congratulations! You finished Rank #${rank} this week and earned ${reward} credits.`,
              "credit"
            )
          );

          rank++;
        }
      }

      await Promise.all(batchPromises);

      resetBtn.innerHTML = `🧹 Resetting Leaderboard...`;
      const allUsersSnap = await getDocs(collection(db, "users"));
      const resetPromises = allUsersSnap.docs.map((userDoc) => {
        return updateDoc(doc(db, "users", userDoc.id), { weekMinutes: 0 });
      });

      await Promise.all(resetPromises);

      const settingsRef = doc(db, "settings", "leaderboard");
      const now = new Date();
      const nextSunday = new Date();
      nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
      nextSunday.setHours(0, 0, 0, 0);

      await setDoc(
        settingsRef,
        {
          nextReset: nextSunday,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      alert(`Success! Distributed rewards and reset minutes.`);
    } catch (error) {
      console.error("Critical Reset Error:", error);
      alert("An error occurred.");
    } finally {
      resetBtn.disabled = false;
      resetBtn.innerHTML = originalText;
      loadAllUsers();
      loadSuggestions();
      loadLinkSubmissions();
    }
  };
}

/**
 * UI: Fetch and Render User List
 */
async function loadAllUsers() {
  if (!userListEl) return;

  userListEl.innerHTML =
    '<tr><td colspan="6" class="p-10 text-center text-white">Loading Students...</td></tr>';

  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    userListEl.innerHTML = "";

    querySnapshot.forEach((userDoc) => {
      const u = userDoc.data();
      const row = document.createElement("tr");
      row.className =
        "border-b border-slate-800 hover:bg-slate-800/50 transition user-row";

      row.innerHTML = `
        <td class="p-4 font-bold user-name text-white">
          ${u.firstName || "???"} ${u.lastName || ""}
        </td>
        <td class="p-4 text-slate-400 text-xs font-mono">${u.email || "No Email"}</td>
        <td class="p-4 text-slate-400 font-medium">${u.grade || "N/A"}</td>
        <td class="p-4 text-emerald-400 font-mono font-bold">${u.credits || 0}</td>
        <td class="p-4 font-mono text-blue-400 font-bold">${u.weekMinutes || 0}m</td>
        <td class="p-4 text-right flex gap-2 justify-end">
          <button class="msg-user-btn bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                  data-id="${userDoc.id}" data-name="${u.firstName}">
            Message
          </button>
          <button class="extend-limit-btn bg-emerald-700/30 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition"
                  data-id="${userDoc.id}" data-name="${u.firstName || "Student"} ${u.lastName || ""}">
            Extend Limit
          </button>
          <button class="del-user-btn bg-red-900/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                  data-id="${userDoc.id}">
            Delete
          </button>
        </td>
      `;
      userListEl.appendChild(row);
    });

    document.querySelectorAll(".msg-user-btn").forEach((btn) => {
      btn.onclick = () => manualNotify(btn.dataset.id, btn.dataset.name);
    });

    document.querySelectorAll(".extend-limit-btn").forEach((btn) => {
      btn.onclick = () =>
        openExtendLimitModal(btn.dataset.id, btn.dataset.name);
    });

    document.querySelectorAll(".del-user-btn").forEach((btn) => {
      btn.onclick = () => deleteUserAccount(btn.dataset.id);
    });
  } catch (err) {
    console.error("Load Error:", err);
  }
}

/**
 * SUGGESTIONS: Load and render
 */
async function loadSuggestions() {
  if (!suggestionListEl) return;

  suggestionListEl.innerHTML = `
    <tr>
      <td colspan="5" class="p-6 text-center text-slate-400 text-sm">
        Loading suggestions...
      </td>
    </tr>
  `;

  try {
    const qSuggestions = query(
      collection(db, "suggestions"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const snap = await getDocs(qSuggestions);

    if (snap.empty) {
      suggestionListEl.innerHTML = `
        <tr>
          <td colspan="5" class="p-6 text-center text-slate-500 text-sm italic">
            No suggestions yet.
          </td>
        </tr>
      `;
      return;
    }

    suggestionListEl.innerHTML = "";

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const row = document.createElement("tr");
      row.className =
        "border-b border-slate-800 hover:bg-slate-800/50 transition";

      const statusBadge =
        s.status === "approved"
          ? '<span class="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] font-bold uppercase">Approved</span>'
          : s.status === "denied"
          ? '<span class="px-2 py-1 rounded-full bg-red-500/10 text-red-300 text-[10px] font-bold uppercase">Denied</span>'
          : '<span class="px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-300 text-[10px] font-bold uppercase">Pending</span>';

      row.innerHTML = `
        <td class="p-3 align-top max-w-xs">
          <div class="font-semibold text-white text-xs mb-1">${s.title || "(No title)"}</div>
          <div class="text-xs text-slate-300 whitespace-pre-wrap">${s.text || ""}</div>
        </td>
        <td class="p-3 align-top text-xs text-slate-400">
          ${s.type || "feature"}
        </td>
        <td class="p-3 align-top text-xs text-slate-400">
          ${s.email || s.userId || "Unknown"}
        </td>
        <td class="p-3 align-top text-xs">
          ${statusBadge}
        </td>
        <td class="p-3 align-top text-right text-xs space-x-2">
          ${
            s.status === "pending"
              ? `
            <button
              class="px-3 py-1 rounded-full bg-emerald-600/80 hover:bg-emerald-500 text-white font-bold uppercase tracking-wide text-[10px]"
              data-sid="${docSnap.id}"
              data-uid="${s.userId}"
              data-email="${s.email || ""}"
              data-title="${(s.title || "").replace(/"/g, "&quot;")}"
            >
              Approve & Refund
            </button>
            <button
              class="px-3 py-1 rounded-full bg-red-600/80 hover:bg-red-500 text-white font-bold uppercase tracking-wide text-[10px]"
              data-sid-deny="${docSnap.id}"
              data-uid-deny="${s.userId}"
              data-title-deny="${(s.title || "").replace(/"/g, "&quot;")}"
            >
              Deny
            </button>
          `
              : "-"
          }
        </td>
      `;

      suggestionListEl.appendChild(row);
    });

    // Wire approve / deny buttons
    suggestionListEl
      .querySelectorAll("[data-sid]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          approveSuggestion(
            btn.getAttribute("data-sid"),
            btn.getAttribute("data-uid"),
            btn.getAttribute("data-email"),
            btn.getAttribute("data-title")
          )
        )
      );

    suggestionListEl
      .querySelectorAll("[data-sid-deny]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          denySuggestion(
            btn.getAttribute("data-sid-deny"),
            btn.getAttribute("data-uid-deny"),
            btn.getAttribute("data-title-deny")
          )
        )
      );
  } catch (err) {
    console.error("Load suggestions error:", err);
    suggestionListEl.innerHTML = `
      <tr>
        <td colspan="5" class="p-6 text-center text-red-400 text-sm">
          Failed to load suggestions.
        </td>
      </tr>
    `;
  }
}

/**
 * Approve suggestion: refund 20 credits, mark status, notify
 */
async function approveSuggestion(suggestionId, userId, email, title) {
  if (!suggestionId || !userId) return;

  const ok = confirm(
    `Approve this suggestion and refund ${SUGGESTION_COST} credits?`
  );
  if (!ok) return;

  try {
    const suggestionRef = doc(db, "suggestions", suggestionId);
    const userRef = doc(db, "users", userId);

    await updateDoc(userRef, {
      credits: increment(SUGGESTION_COST),
    });

    await updateDoc(suggestionRef, {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
      refundGiven: true,
    });

    await sendNotification(
      userId,
      "Suggestion Approved",
      `Your suggestion "${title || ""}" was approved. Your ${SUGGESTION_COST} credit deposit was refunded and the admin may grant additional rewards separately.`,
      "suggestion"
    );

    alert("Suggestion approved and credits refunded.");
    loadSuggestions();
  } catch (err) {
    console.error("Approve suggestion error:", err);
    alert("Failed to approve suggestion.");
  }
}

/**
 * Deny suggestion: mark status, notify (no refund)
 */
async function denySuggestion(suggestionId, userId, title) {
  if (!suggestionId || !userId) return;

  const ok = confirm(
    "Deny this suggestion? The 20-credit deposit will not be refunded."
  );
  if (!ok) return;

  try {
    const suggestionRef = doc(db, "suggestions", suggestionId);

    await updateDoc(suggestionRef, {
      status: "denied",
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
    });

    await sendNotification(
      userId,
      "Suggestion Reviewed",
      `Your suggestion "${title || ""}" was reviewed but not approved this time. Thank you for your feedback!`,
      "suggestion"
    );

    alert("Suggestion denied.");
    loadSuggestions();
  } catch (err) {
    console.error("Deny suggestion error:", err);
    alert("Failed to deny suggestion.");
  }
}

/**
 * LINK SUBMISSIONS: Load and render
 */
async function loadLinkSubmissions() {
  if (!linkSubmissionListEl) return;

  linkSubmissionListEl.innerHTML = `
    <tr>
      <td colspan="4" class="p-6 text-center text-slate-400 text-sm">
        Loading link submissions...
      </td>
    </tr>
  `;

  try {
    const qLinks = query(
      collection(db, "linkSubmissions"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const snap = await getDocs(qLinks);

    if (snap.empty) {
      linkSubmissionListEl.innerHTML = `
        <tr>
          <td colspan="4" class="p-6 text-center text-slate-500 text-sm italic">
            No link submissions yet.
          </td>
        </tr>
      `;
      return;
    }

    linkSubmissionListEl.innerHTML = "";

    snap.forEach((docSnap) => {
      const l = docSnap.data();
      const row = document.createElement("tr");
      row.className =
        "border-b border-slate-800 hover:bg-slate-800/50 transition";

      const statusBadge =
        l.status === "approved"
          ? '<span class="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] font-bold uppercase">Approved</span>'
          : l.status === "denied"
          ? '<span class="px-2 py-1 rounded-full bg-red-500/10 text-red-300 text-[10px] font-bold uppercase">Denied</span>'
          : '<span class="px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-300 text-[10px] font-bold uppercase">Pending</span>';

      row.innerHTML = `
        <td class="p-3 align-top max-w-xs">
          <a href="${l.url}" target="_blank" class="text-xs text-blue-400 underline break-all">${l.url}</a>
          <div class="text-[11px] text-slate-300 mt-1">${l.title || ""}</div>
          <div class="text-[11px] text-slate-400 mt-1 whitespace-pre-wrap">${l.notes || ""}</div>
        </td>
        <td class="p-3 align-top text-xs text-slate-400">
          ${l.email || l.userId || "Unknown"}
        </td>
        <td class="p-3 align-top text-xs">
          ${statusBadge}
        </td>
        <td class="p-3 align-top text-right text-xs space-x-2">
          ${
            l.status === "pending"
              ? `
            <button
              class="px-3 py-1 rounded-full bg-emerald-600/80 hover:bg-emerald-500 text-white font-bold uppercase tracking-wide text-[10px]"
              data-lid="${docSnap.id}"
              data-uid="${l.userId}"
              data-title="${(l.title || "").replace(/"/g, "&quot;")}"
            >
              Approve & Reward
            </button>
            <button
              class="px-3 py-1 rounded-full bg-red-600/80 hover:bg-red-500 text-white font-bold uppercase tracking-wide text-[10px]"
              data-lid-deny="${docSnap.id}"
              data-uid-deny="${l.userId}"
              data-title-deny="${(l.title || "").replace(/"/g, "&quot;")}"
            >
              Deny
            </button>
          `
              : "-"
          }
        </td>
      `;

      linkSubmissionListEl.appendChild(row);
    });

    // Wire approve / deny buttons
    linkSubmissionListEl
      .querySelectorAll("[data-lid]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          approveLinkSubmission(
            btn.getAttribute("data-lid"),
            btn.getAttribute("data-uid"),
            btn.getAttribute("data-title")
          )
        )
      );

    linkSubmissionListEl
      .querySelectorAll("[data-lid-deny]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          denyLinkSubmission(
            btn.getAttribute("data-lid-deny"),
            btn.getAttribute("data-uid-deny"),
            btn.getAttribute("data-title-deny")
          )
        )
      );
  } catch (err) {
    console.error("Load link submissions error:", err);
    linkSubmissionListEl.innerHTML = `
      <tr>
        <td colspan="4" class="p-6 text-center text-red-400 text-sm">
          Failed to load link submissions.
        </td>
      </tr>
    `;
  }
}

/**
 * Approve link submission: reward credits, mark status, notify
 */
async function approveLinkSubmission(submissionId, userId, title) {
  if (!submissionId || !userId) return;

  const ok = confirm(
    `Approve this link and give ${LINK_BONUS} credits to the student?`
  );
  if (!ok) return;

  try {
    const submissionRef = doc(db, "linkSubmissions", submissionId);
    const userRef = doc(db, "users", userId);

    await updateDoc(userRef, {
      credits: increment(LINK_BONUS),
      totalEarned: increment(LINK_BONUS),
    });

    await updateDoc(submissionRef, {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
      rewardGiven: true,
    });

    await sendNotification(
      userId,
      "Link Approved",
      `Your link "${title || ""}" was approved and added. You earned ${LINK_BONUS} credits!`,
      "link"
    );

    alert("Link approved and credits awarded.");
    loadLinkSubmissions();
  } catch (err) {
    console.error("Approve link error:", err);
    alert("Failed to approve link.");
  }
}

/**
 * Deny link submission: mark status, notify
 */
async function denyLinkSubmission(submissionId, userId, title) {
  if (!submissionId || !userId) return;

  const ok = confirm("Deny this link submission? No credits will be given.");
  if (!ok) return;

  try {
    const submissionRef = doc(db, "linkSubmissions", submissionId);

    await updateDoc(submissionRef, {
      status: "denied",
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
    });

    await sendNotification(
      userId,
      "Link Reviewed",
      `Your link "${title || ""}" was reviewed but not approved this time. Thank you for submitting!`,
      "link"
    );

    alert("Link denied.");
    loadLinkSubmissions();
  } catch (err) {
    console.error("Deny link error:", err);
    alert("Failed to deny link.");
  }
}

/**
 * Manual message to a user
 */
async function manualNotify(userId, firstName) {
  const msg = prompt(
    `Send an inbox message to ${firstName || "this student"}:`
  );
  if (!msg) return;

  try {
    await sendNotification(userId, "Message from your teacher", msg, "admin");
    alert("Message sent.");
  } catch (err) {
    alert("Failed to send message.");
  }
}

if (searchInput) {
  searchInput.oninput = (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll(".user-row").forEach((row) => {
      const name = row.querySelector(".user-name").textContent.toLowerCase();
      const email = row.cells[1].textContent.toLowerCase();
      row.style.display =
        name.includes(term) || email.includes(term) ? "" : "none";
    });
  };
}

async function deleteUserAccount(userId) {
  if (confirm("🚨 WARNING: Delete permanently?")) {
    try {
      await deleteDoc(doc(db, "users", userId));
      loadAllUsers();
    } catch (err) {
      alert("Delete failed.");
    }
  }
}

// Modal button wiring
if (extendLimitCancel) {
  extendLimitCancel.addEventListener("click", closeExtendLimitModal);
}
if (extendLimitConfirm) {
  extendLimitConfirm.addEventListener("click", applyExtendDailyLimit);
}
if (extendLimitModal) {
  extendLimitModal.addEventListener("click", (e) => {
    if (e.target === extendLimitModal) closeExtendLimitModal();
  });
}

initAdmin();
