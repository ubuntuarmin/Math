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
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// DOM Elements
const userListEl = document.getElementById("adminUserList");
const resetBtn = document.getElementById("resetLeaderboardBtn");
const searchInput = document.getElementById("adminSearch");
const suggestionListEl = document.getElementById("suggestionList");
const linkSubmissionListEl = document.getElementById("linkSubmissionList");

// Extend-limit modal elements (optional; if you later add modal to admin.html)
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
  if (!extendLimitModal) return; // no modal in HTML yet
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

// ... (keep your existing loadSuggestions, approveSuggestion, denySuggestion,
// loadLinkSubmissions, approveLinkSubmission, denyLinkSubmission, manualNotify
// exactly as in the previous full version – they are unchanged) ...

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

// Modal button wiring (won't run if modal not in HTML)
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
