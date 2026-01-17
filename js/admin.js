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

// Your Unique Admin ID
const ADMIN_UID = "bnGhRvqW1YhvGek1JTLuAed6Ib63";

// Costs/bonuses (must match frontend logic)
const SUGGESTION_COST = 20;
const LINK_BONUS = 150;

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
    // --- STEP 1: Find Top 10 Active Users ---
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

        // Update Credits
        batchPromises.push(
          updateDoc(userRef, {
            credits: increment(reward),
            totalEarned: increment(reward),
          })
        );

        // Send Inbox Notification
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

    // --- STEP 2: Global Reset ---
    resetBtn.innerHTML = `🧹 Resetting Leaderboard...`;
    const allUsersSnap = await getDocs(collection(db, "users"));
    const resetPromises = allUsersSnap.docs.map((userDoc) => {
      return updateDoc(doc(db, "users", userDoc.id), { weekMinutes: 0 });
    });

    await Promise.all(resetPromises);

    // Optional: store next reset info
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
          <button class="del-user-btn bg-red-900/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/40 px-3 py-1 rounded text-[10px] font-bold uppercase transition" 
                  data-id="${userDoc.id}">
            Delete
          </button>
        </td>
      `;
      userListEl.appendChild(row);
    });

    // Attach Message listeners
    document.querySelectorAll(".msg-user-btn").forEach((btn) => {
      btn.onclick = () => manualNotify(btn.dataset.id, btn.dataset.name);
    });

    // Attach delete listeners
    document.querySelectorAll(".del-user-btn").forEach((btn) => {
      btn.onclick = () => deleteUserAccount(btn.dataset.id);
    });
  } catch (err) {
    console.error("Load Error:", err);
  }
}

/**
 * Load and render suggestions
 */
async function loadSuggestions() {
  if (!suggestionListEl) return;

  suggestionListEl.innerHTML =
    '<tr><td colspan="5" class="p-6 text-center text-slate-400 text-sm">Loading suggestions...</td></tr>';

  try {
    const q = query(
      collection(db, "suggestions"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const snap = await getDocs(q);
    suggestionListEl.innerHTML = "";

    if (snap.empty) {
      suggestionListEl.innerHTML =
        '<tr><td colspan="5" class="p-6 text-center text-slate-500 text-sm italic">No suggestions yet.</td></tr>';
      return;
    }

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const row = document.createElement("tr");
      const status = s.status || "pending";

      row.className =
        "border-b border-slate-800 hover:bg-slate-800/40 transition";

      const typeLabel =
        s.type === "bug"
          ? '<span class="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">Bug</span>'
          : '<span class="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">Feature</span>';

      const statusColor =
        status === "approved"
          ? "text-emerald-400"
          : status === "denied"
          ? "text-red-400"
          : "text-yellow-400";

      row.innerHTML = `
        <td class="p-3 align-top">
          <div class="font-bold text-white text-sm line-clamp-2">${s.title || "(no title)"}</div>
          <div class="text-xs text-slate-400 mt-1 max-w-xl">${(s.text || "").slice(0, 180)}${(s.text || "").length > 180 ? "..." : ""}</div>
        </td>
        <td class="p-3 align-top">
          ${typeLabel}
        </td>
        <td class="p-3 align-top text-xs text-slate-300">
          <div>${s.email || "No email"}</div>
          <div class="text-[10px] text-slate-500">${s.userId}</div>
        </td>
        <td class="p-3 align-top text-xs ${statusColor} font-bold uppercase">
          ${status}
        </td>
        <td class="p-3 align-top text-right text-[10px] space-y-1">
          ${
            status === "pending"
              ? `
            <button
              class="bg-emerald-700/60 hover:bg-emerald-600 text-emerald-100 px-3 py-1 rounded-full font-bold uppercase mr-1"
              data-action="approve"
              data-id="${docSnap.id}"
              data-user="${s.userId}"
            >
              Approve (Refund)
            </button>
            <button
              class="bg-blue-700/60 hover:bg-blue-600 text-blue-100 px-3 py-1 rounded-full font-bold uppercase mr-1"
              data-action="approveBonus"
              data-id="${docSnap.id}"
              data-user="${s.userId}"
            >
              Approve + Bonus
            </button>
            <button
              class="bg-red-800/40 hover:bg-red-700 text-red-200 px-3 py-1 rounded-full font-bold uppercase"
              data-action="deny"
              data-id="${docSnap.id}"
              data-user="${s.userId}"
            >
              Deny
            </button>
          `
              : "<span class='text-slate-500'>Reviewed</span>"
          }
        </td>
      `;

      suggestionListEl.appendChild(row);
    });

    // Attach click handlers
    suggestionListEl.querySelectorAll("button[data-action]").forEach((btn) => {
      const action = btn.getAttribute("data-action");
      const suggestionId = btn.getAttribute("data-id");
      const userId = btn.getAttribute("data-user");

      if (action === "approve") {
        btn.onclick = () => approveSuggestion(suggestionId, userId, false);
      } else if (action === "approveBonus") {
        btn.onclick = () => approveSuggestion(suggestionId, userId, true);
      } else if (action === "deny") {
        btn.onclick = () => denySuggestion(suggestionId, userId);
      }
    });
  } catch (err) {
    console.error("Load suggestions error:", err);
    suggestionListEl.innerHTML =
      '<tr><td colspan="5" class="p-6 text-center text-red-400 text-xs">Failed to load suggestions.</td></tr>';
  }
}

/**
 * Approve suggestion: refund and optional bonus
 */
async function approveSuggestion(suggestionId, userId, withBonus) {
  const confirmText = withBonus
    ? "Approve and refund 20 credits + give bonus tokens?"
    : "Approve and refund 20 credits?";
  if (!confirm(confirmText)) return;

  try {
    const suggestionRef = doc(db, "suggestions", suggestionId);
    const userRef = doc(db, "users", userId);

    const totalCreditChange = withBonus ? SUGGESTION_COST + 40 : SUGGESTION_COST;

    await updateDoc(userRef, {
      credits: increment(totalCreditChange),
      totalEarned: withBonus ? increment(40) : increment(0),
    });

    await updateDoc(suggestionRef, {
      status: "approved",
      refundGiven: true,
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
    });

    await sendNotification(
      userId,
      "Suggestion Approved",
      withBonus
        ? `Thanks for the great suggestion! Your 20-credit deposit was refunded and you received bonus tokens as a reward.`
        : `Thanks for the helpful suggestion! Your 20-credit deposit was refunded.`,
      "suggestion"
    );

    loadSuggestions();
  } catch (err) {
    console.error("Approve suggestion error:", err);
    alert("Failed to approve suggestion.");
  }
}

/**
 * Deny suggestion: no refund
 */
async function denySuggestion(suggestionId, userId) {
  if (!confirm("Deny this suggestion? The user will not receive a refund.")) {
    return;
  }

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
      "Thanks for sending a suggestion. This one was not approved, so the 20-credit deposit was not refunded. Please keep reporting important bugs or high-value ideas!",
      "suggestion"
    );

    loadSuggestions();
  } catch (err) {
    console.error("Deny suggestion error:", err);
    alert("Failed to deny suggestion.");
  }
}

/**
 * Load and render link submissions
 */
async function loadLinkSubmissions() {
  if (!linkSubmissionListEl) return;

  linkSubmissionListEl.innerHTML =
    '<tr><td colspan="4" class="p-6 text-center text-slate-400 text-sm">Loading link submissions...</td></tr>';

  try {
    const q = query(
      collection(db, "linkSubmissions"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const snap = await getDocs(q);
    linkSubmissionListEl.innerHTML = "";

    if (snap.empty) {
      linkSubmissionListEl.innerHTML =
        '<tr><td colspan="4" class="p-6 text-center text-slate-500 text-sm italic">No link submissions yet.</td></tr>';
      return;
    }

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const row = document.createElement("tr");
      const status = s.status || "pending";

      const statusColor =
        status === "approved"
          ? "text-emerald-400"
          : status === "denied"
          ? "text-red-400"
          : "text-yellow-400";

      row.className =
        "border-b border-slate-800 hover:bg-slate-800/40 transition";

      row.innerHTML = `
        <td class="p-3 align-top">
          <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline text-sm break-all">
            ${s.title || s.url || "(no title)"}
          </a>
          <div class="text-xs text-slate-400 mt-1 max-w-xl">${(s.notes || "").slice(0, 180)}${(s.notes || "").length > 180 ? "..." : ""}</div>
        </td>
        <td class="p-3 align-top text-xs text-slate-300">
          <div>${s.email || "No email"}</div>
          <div class="text-[10px] text-slate-500">${s.userId}</div>
        </td>
        <td class="p-3 align-top text-xs ${statusColor} font-bold uppercase">
          ${status}
        </td>
        <td class="p-3 align-top text-right text-[10px] space-y-1">
          ${
            status === "pending"
              ? `
            <button
              class="bg-emerald-700/60 hover:bg-emerald-600 text-emerald-100 px-3 py-1 rounded-full font-bold uppercase mr-1"
              data-link-action="approveLink"
              data-id="${docSnap.id}"
              data-user="${s.userId}"
            >
              Approve (+${LINK_BONUS})
            </button>
            <button
              class="bg-red-800/40 hover:bg-red-700 text-red-200 px-3 py-1 rounded-full font-bold uppercase"
              data-link-action="denyLink"
              data-id="${docSnap.id}"
              data-user="${s.userId}"
            >
              Deny
            </button>
          `
              : "<span class='text-slate-500'>Reviewed</span>"
          }
        </td>
      `;

      linkSubmissionListEl.appendChild(row);
    });

    // Attach handlers
    linkSubmissionListEl
      .querySelectorAll("button[data-link-action]")
      .forEach((btn) => {
        const action = btn.getAttribute("data-link-action");
        const id = btn.getAttribute("data-id");
        const userId = btn.getAttribute("data-user");

        if (action === "approveLink") {
          btn.onclick = () => approveLinkSubmission(id, userId);
        } else if (action === "denyLink") {
          btn.onclick = () => denyLinkSubmission(id, userId);
        }
      });
  } catch (err) {
    console.error("Load link submissions error:", err);
    linkSubmissionListEl.innerHTML =
      '<tr><td colspan="4" class="p-6 text-center text-red-400 text-xs">Failed to load link submissions.</td></tr>';
  }
}

/**
 * Approve link: give bonus
 */
async function approveLinkSubmission(submissionId, userId) {
  if (
    !confirm(
      `Approve this link and give the student ${LINK_BONUS} bonus credits?`
    )
  ) {
    return;
  }

  try {
    const subRef = doc(db, "linkSubmissions", submissionId);
    const userRef = doc(db, "users", userId);

    await updateDoc(userRef, {
      credits: increment(LINK_BONUS),
      totalEarned: increment(LINK_BONUS),
    });

    await updateDoc(subRef, {
      status: "approved",
      rewardGiven: true,
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
    });

    await sendNotification(
      userId,
      "Link Approved",
      `Thanks for sharing a great resource! Your link was approved and you received ${LINK_BONUS} bonus credits.`,
      "link"
    );

    loadLinkSubmissions();
  } catch (err) {
    console.error("Approve link error:", err);
    alert("Failed to approve link.");
  }
}

/**
 * Deny link: no bonus
 */
async function denyLinkSubmission(submissionId, userId) {
  if (!confirm("Deny this link submission? No credits will be given.")) {
    return;
  }

  try {
    const subRef = doc(db, "linkSubmissions", submissionId);

    await updateDoc(subRef, {
      status: "denied",
      reviewedAt: serverTimestamp(),
      reviewerUid: auth.currentUser?.uid || null,
    });

    await sendNotification(
      userId,
      "Link Reviewed",
      "Thanks for sending a link. This one was not approved, but please keep sharing safe and helpful math resources!",
      "link"
    );

    loadLinkSubmissions();
  } catch (err) {
    console.error("Deny link error:", err);
    alert("Failed to deny link.");
  }
}

/**
 * Manual Message Trigger
 */
async function manualNotify(userId, userName) {
  const msg = prompt(`Send an inbox message to ${userName}:`);
  if (!msg) return;

  const success = await sendNotification(userId, "Admin Message", msg, "admin");
  if (success) alert("Message delivered!");
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

initAdmin();
