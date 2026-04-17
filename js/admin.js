/**
 * ADMIN HUB MODULE
 *
 * Handles all Admin-tier functionality:
 *   - Rendering the Admin Hub tab for all users
 *   - Admin check-in / check-out toggle
 *   - User → Admin messaging (one message per user per admin per 24 h)
 *   - Admin response (one reply per message; locks the thread for 24 h)
 *   - "Mark Productive" (awards the user 15 credits)
 *   - 48-hour escalation: forwards unanswered messages to the next available admin
 *   - Admin missed-response counter (≥ 3 → downgrade flag, handled in auth.js)
 */

import { auth, db } from "./firebase.js";
import { runDuplicateLinkCleanupPass } from "./linkDuplicateCleanup.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    increment,
    serverTimestamp,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MS_24H = 24 * 60 * 60 * 1000;
const MS_48H = 48 * 60 * 60 * 1000;
const PRODUCTIVE_CREDIT_REWARD = 15;

// ─── Module state ─────────────────────────────────────────────────────────────
let _currentUserData = null;
let _duplicateCleanupStarted = false;

// ─── Escape helper ────────────────────────────────────────────────────────────
function esc(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ─── Time formatting ──────────────────────────────────────────────────────────
function timeAgo(ts) {
    if (!ts) return "—";
    const ms = typeof ts.toMillis === "function" ? ts.toMillis() : Number(ts);
    const diff = Date.now() - ms;
    if (diff < 60000)   return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: renderAdminHub(userData)
// Called from auth.js syncAllUI and userProfileUpdated.
// ═══════════════════════════════════════════════════════════════════════════════
export async function renderAdminHub(userData) {
    _currentUserData = userData;
    const container = document.getElementById("adminHubContent");
    if (!container) return;

    // Hide the eligibility banner when user is already an admin
    const banner = document.getElementById("adminEligibilityBanner");
    if (banner) banner.classList.toggle("hidden", !!userData.isAdmin);

    // Run 48-h escalation check for all logged-in users (lightweight, idempotent)
    await checkEscalations();

    if (userData.isAdmin && !_duplicateCleanupStarted) {
        _duplicateCleanupStarted = true;
        runDuplicateLinkCleanupPass({
            isAdmin: true,
            adminUid: auth.currentUser?.uid || "",
        }).catch(err => {
            console.warn("[Admin] Duplicate cleanup pass failed:", err);
        });
    }

    container.innerHTML = `
        <div class="flex justify-center py-8">
          <div class="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>`;

    try {
        await Promise.all([
            renderAdminPanel(userData, container),
            loadAdminDirectory(userData, container),
        ]);
    } catch (err) {
        console.error("[Admin] renderAdminHub error:", err);
        container.innerHTML = `<p class="text-red-400 text-sm text-center py-8">Failed to load Admin Hub. Please refresh.</p>`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL (only visible to admins)
// ═══════════════════════════════════════════════════════════════════════════════
async function renderAdminPanel(userData, container) {
    if (!userData.isAdmin) return;

    const uid           = auth.currentUser?.uid;
    const isCheckedIn   = userData.adminCheckedIn || false;
    const missed        = userData.adminMissedResponses || 0;

    // Fetch pending messages addressed to this admin
    let pendingMessages = [];
    try {
        const snap = await getDocs(
            query(
                collection(db, "adminMessages"),
                where("toUid", "==", uid),
                where("status", "==", "pending"),
                orderBy("timestamp", "asc")
            )
        );
        snap.forEach(d => pendingMessages.push({ id: d.id, ...d.data() }));
    } catch (err) {
        console.warn("[Admin] Could not load pending messages:", err);
    }

    // Inject admin panel before the directory
    const panelId = "adminOwnPanel";
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = document.createElement("div");
        panel.id = panelId;
        container.prepend(panel);
    }

    const checkinColor = isCheckedIn ? "emerald" : "gray";
    const checkinLabel = isCheckedIn ? "✅ Checked In (Available)" : "⬜ Checked Out";

    panel.innerHTML = `
      <div class="surface rounded-3xl p-6 mb-6 border border-purple-500/30 bg-purple-500/5">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          <div>
            <span class="badge bg-purple-500/15 text-purple-300 border-purple-500/30">🛡️ Your Admin Panel</span>
            <h3 class="text-lg font-black text-white mt-2">Manage Your Status</h3>
            <p class="text-xs text-gray-400 mt-1">
              Missed responses: <strong class="${missed >= 2 ? "text-red-400" : "text-gray-300"}">${missed}/3</strong>
              (3 misses = automatic demotion)
            </p>
          </div>
          <button id="adminCheckinBtn"
            aria-label="Toggle admin availability status"
            class="shrink-0 px-5 py-2.5 rounded-2xl font-bold text-sm transition-all duration-200
                   border border-${checkinColor}-500/40 bg-${checkinColor}-500/15
                   text-${checkinColor}-300 hover:bg-${checkinColor}-500/30">
            ${checkinLabel}
          </button>
        </div>

        ${pendingMessages.length === 0
            ? `<p class="text-gray-500 text-sm">No pending messages — you're all caught up! 🎉</p>`
            : `<h4 class="text-sm font-bold text-white mb-3">Pending Messages (${pendingMessages.length})</h4>
               <div class="space-y-3" id="adminPendingList">
                 ${pendingMessages.map(m => buildMessageCard(m, true)).join("")}
               </div>`
        }
      </div>`;

    document.getElementById("adminCheckinBtn")?.addEventListener("click", () =>
        toggleCheckin(uid, isCheckedIn)
    );

    // Wire response + productive buttons
    wireAdminMessageButtons(panel);
}

function buildMessageCard(m, isAdminView) {
    const ts       = timeAgo(m.timestamp);
    const fromName = esc(m.fromName || "Anonymous");
    const msg      = esc(m.message || "");
    const response = esc(m.response || "");
    const msgId    = m.id;
    const status   = m.status;

    let actionHtml = "";
    if (isAdminView && status === "pending") {
        actionHtml = `
          <div class="mt-3 flex flex-col gap-2">
            <textarea data-reply-for="${msgId}"
              class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm
                     text-white placeholder-gray-500 resize-none"
              rows="2" maxlength="1000" placeholder="Type your reply…"></textarea>
            <div class="flex gap-2">
              <button data-respond="${msgId}"
                class="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition">
                📨 Send Reply
              </button>
              <button data-productive="${msgId}" data-from="${m.fromUid}"
                class="flex-1 px-4 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-white font-bold text-xs transition"
                ${m.markedProductive ? "disabled" : ""}>
                🏆 Mark Productive (+15 🪙)
              </button>
            </div>
          </div>`;
    } else if (status === "responded" || status === "locked") {
        actionHtml = `
          <div class="mt-2 pt-2 border-t border-gray-700/60">
            <p class="text-xs text-emerald-400 font-bold mb-1">Admin replied:</p>
            <p class="text-xs text-gray-300">${response}</p>
            ${m.markedProductive
                ? `<p class="text-xs text-yellow-400 mt-1">🏆 Marked productive — user received +${PRODUCTIVE_CREDIT_REWARD} credits</p>`
                : ""}
          </div>`;
        if (isAdminView && !m.markedProductive) {
            actionHtml += `
              <button data-productive="${msgId}" data-from="${m.fromUid}"
                class="mt-2 w-full px-4 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-500
                       text-white font-bold text-xs transition">
                🏆 Mark Productive (+15 🪙)
              </button>`;
        }
    } else if (status === "forwarded") {
        actionHtml = `<p class="text-xs text-orange-400 mt-2">⏩ Forwarded to another admin</p>`;
    }

    return `
      <div class="bg-gray-900/70 rounded-2xl p-4 border border-gray-700/50">
        <div class="flex items-start justify-between gap-2 mb-1">
          <span class="text-xs font-bold text-purple-300">${fromName}</span>
          <span class="text-[10px] text-gray-500">${ts}</span>
        </div>
        <p class="text-sm text-gray-200">${msg}</p>
        ${actionHtml}
      </div>`;
}

function wireAdminMessageButtons(root) {
    // Send reply
    root.querySelectorAll("[data-respond]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const msgId   = btn.dataset.respond;
            const textarea = root.querySelector(`[data-reply-for="${msgId}"]`);
            const text    = textarea?.value.trim() || "";
            if (!text) return;
            btn.disabled = true;
            btn.textContent = "Sending…";
            try {
                await respondToMessage(msgId, text);
                // Re-render panel
                await renderAdminHub(_currentUserData);
            } catch (err) {
                console.error("[Admin] Reply error:", err);
                btn.disabled = false;
                btn.textContent = "📨 Send Reply";
            }
        });
    });

    // Mark productive
    root.querySelectorAll("[data-productive]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const msgId   = btn.dataset.productive;
            const fromUid = btn.dataset.from;
            btn.disabled = true;
            btn.textContent = "Awarding…";
            try {
                await markProductive(msgId, fromUid);
                await renderAdminHub(_currentUserData);
            } catch (err) {
                console.error("[Admin] Productive error:", err);
                btn.disabled = false;
                btn.textContent = "🏆 Mark Productive (+15 🪙)";
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN DIRECTORY + USER MESSAGING
// ═══════════════════════════════════════════════════════════════════════════════
async function loadAdminDirectory(userData, container) {
    const uid = auth.currentUser?.uid;

    // Fetch all checked-in admins
    let admins = [];
    try {
        const snap = await getDocs(
            query(
                collection(db, "users"),
                where("isAdmin", "==", true),
                where("adminCheckedIn", "==", true)
            )
        );
        snap.forEach(d => {
            if (d.id !== uid) admins.push({ id: d.id, ...d.data() });
        });
    } catch (err) {
        console.warn("[Admin] Could not load admin directory:", err);
    }

    // Fetch this user's own sent messages so we can show them & enforce 24h limit
    let myMessages = [];
    if (uid) {
        try {
            const snap = await getDocs(
                query(
                    collection(db, "adminMessages"),
                    where("fromUid", "==", uid),
                    orderBy("timestamp", "desc"),
                    limit(50)
                )
            );
            snap.forEach(d => myMessages.push({ id: d.id, ...d.data() }));
        } catch (err) {
            console.warn("[Admin] Could not load sent messages:", err);
        }
    }

    // Inject (or update) directory section
    const dirId = "adminDirectorySection";
    let dirEl = document.getElementById(dirId);
    if (!dirEl) {
        dirEl = document.createElement("div");
        dirEl.id = dirId;
        container.appendChild(dirEl);
    }

    // Build a Map of adminUid → most-recent-message-within-24h for O(1) lookups
    // in buildAdminCard, avoiding O(n*m) iteration per card.
    const now = Date.now();
    const recentMessageByAdmin = new Map();
    for (const m of myMessages) {
        const ts = typeof m.timestamp?.toMillis === "function" ? m.timestamp.toMillis() : Number(m.timestamp || 0);
        if ((now - ts) < MS_24H && !recentMessageByAdmin.has(m.toUid)) {
            recentMessageByAdmin.set(m.toUid, m);
        }
    }

    const adminCards = admins.length === 0
        ? `<p class="text-gray-500 text-sm text-center py-6">No admins are currently available. Check back later.</p>`
        : admins.map(a => buildAdminCard(a, recentMessageByAdmin, now)).join("");

    dirEl.innerHTML = `
      <div class="surface rounded-3xl p-6 mb-6">
        <span class="badge">Community Support</span>
        <h3 class="text-lg font-black text-white mt-2 mb-1">Available Admins</h3>
        <p class="text-xs text-gray-400 mb-5">
          Send one question to an Admin per 24 hours. Admins reply once and the thread is locked for that cycle.
        </p>
        <div class="space-y-4" id="adminCardsList">
          ${adminCards}
        </div>
      </div>

      ${myMessages.length > 0 ? buildSentMessagesSection(myMessages) : ""}`;

    // Wire send-message forms
    dirEl.querySelectorAll("[data-send-msg]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const toUid   = btn.dataset.sendMsg;
            const textarea = dirEl.querySelector(`[data-msg-input="${toUid}"]`);
            const text    = textarea?.value.trim() || "";
            if (!text) return;
            btn.disabled = true;
            btn.textContent = "Sending…";
            try {
                await sendAdminMessage(uid, toUid, text, userData, admins);
                textarea.value = "";
                // Re-render
                await renderAdminHub(_currentUserData);
            } catch (err) {
                console.error("[Admin] Send error:", err);
                alert(err.message || "Failed to send message. Try again.");
                btn.disabled = false;
                btn.textContent = "Send Message";
            }
        });
    });
}

// recentByAdmin: Map<adminUid, message> — built once before the loop for O(1) lookups.
// now: current timestamp in ms.
function buildAdminCard(admin, recentByAdmin, now) {
    const adminUid  = admin.id;
    const adminName = esc(admin.firstName || "Admin");

    // O(1) lookup using the pre-built Map
    const recent = recentByAdmin.get(adminUid);
    const canSend = !recent;

    let statusText = "";
    if (!canSend && recent) {
        const recentTs = typeof recent.timestamp?.toMillis === "function"
            ? recent.timestamp.toMillis()
            : Number(recent.timestamp || 0);
        const hoursLeft = recentTs
            ? Math.ceil((MS_24H - (now - recentTs)) / 3600000)
            : 24;
        statusText = `<p class="text-xs text-yellow-400 mt-2">You already contacted this admin. You can message again in ~${hoursLeft}h.</p>`;
    }

    const inputHtml = canSend ? `
      <textarea data-msg-input="${adminUid}"
        class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm
               text-white placeholder-gray-500 resize-none mt-3"
        rows="2" maxlength="500"
        placeholder="Ask your question…"></textarea>
      <button data-send-msg="${adminUid}"
        class="mt-2 w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500
               text-white font-bold text-sm transition">
        Send Message
      </button>` : "";

    return `
      <div class="bg-gray-900/60 rounded-2xl p-4 border border-gray-700/50">
        <div class="flex items-center gap-3 mb-1">
          <div class="w-9 h-9 rounded-xl bg-purple-500/30 border border-purple-500/40
                      flex items-center justify-center text-lg font-black text-purple-200">
            ${adminName[0]}
          </div>
          <div>
            <span class="text-sm font-bold text-white">${adminName}</span>
            <span class="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              🟢 Available
            </span>
          </div>
        </div>
        ${statusText}
        ${inputHtml}
      </div>`;
}

function buildSentMessagesSection(messages) {
    const cards = messages.slice(0, 10).map(m => buildMessageCard(m, false)).join("");
    return `
      <div class="surface rounded-3xl p-6">
        <span class="badge">Your Conversations</span>
        <h3 class="text-lg font-black text-white mt-2 mb-4">Messages You Sent</h3>
        <div class="space-y-3">${cards}</div>
      </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toggle admin check-in status.
 */
async function toggleCheckin(uid, currentlyCheckedIn) {
    if (!uid) return;
    try {
        await updateDoc(doc(db, "users", uid), {
            adminCheckedIn: !currentlyCheckedIn,
        });
        _currentUserData = { ..._currentUserData, adminCheckedIn: !currentlyCheckedIn };
        await renderAdminHub(_currentUserData);
    } catch (err) {
        console.error("[Admin] Check-in toggle error:", err);
        alert("Could not update your status. Try again.");
    }
}

/**
 * User sends a message to a specific admin.
 * Enforces one-message-per-admin-per-24h at the client level.
 */
async function sendAdminMessage(fromUid, toUid, text, fromUserData, adminList) {
    if (!fromUid || !toUid || !text) throw new Error("Invalid message parameters.");

    // Double-check 24h limit
    const recentSnap = await getDocs(
        query(
            collection(db, "adminMessages"),
            where("fromUid", "==", fromUid),
            where("toUid",   "==", toUid),
            where("timestamp", ">",
                Timestamp.fromMillis(Date.now() - MS_24H)
            )
        )
    );
    if (!recentSnap.empty) {
        throw new Error("You can only send one message to this admin per 24-hour period.");
    }

    const toAdmin = adminList.find(a => a.id === toUid);
    await addDoc(collection(db, "adminMessages"), {
        fromUid:        fromUid,
        fromName:       `${fromUserData.firstName || ""} ${fromUserData.lastName || ""}`.trim() || "Anonymous",
        toUid:          toUid,
        toName:         `${toAdmin?.firstName || "Admin"}`,
        message:        text,
        timestamp:      serverTimestamp(),
        status:         "pending",
        response:       null,
        respondedAt:    null,
        markedProductive: false,
        creditAwarded:  false,
        forwardedAt:    null,
        forwardedTo:    null,
        originalTo:     null,
        missedBy:       [],
    });
}

/**
 * Admin responds to a message.
 * Sets status to "locked" and records respondedAt.
 */
async function respondToMessage(msgId, responseText) {
    if (!msgId || !responseText) return;
    await updateDoc(doc(db, "adminMessages", msgId), {
        response:    responseText,
        respondedAt: serverTimestamp(),
        status:      "locked",
    });
}

/**
 * Admin marks a message thread as productive.
 * Awards PRODUCTIVE_CREDIT_REWARD credits to the message sender.
 */
async function markProductive(msgId, fromUid) {
    if (!msgId || !fromUid) return;

    const msgRef  = doc(db, "adminMessages", msgId);
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) return;

    const data = msgSnap.data();
    if (data.creditAwarded) return; // idempotent guard

    // Award credits to the user who sent the message
    await updateDoc(doc(db, "users", fromUid), {
        credits:     increment(PRODUCTIVE_CREDIT_REWARD),
        totalEarned: increment(PRODUCTIVE_CREDIT_REWARD),
    });

    // Send in-app notification to the user
    try {
        await addDoc(collection(db, "messages"), {
            to:        fromUid,
            fromName:  "Admin System",
            title:     "Your question was marked productive! 🏆",
            text:      `An Admin marked your inquiry as productive. You earned +${PRODUCTIVE_CREDIT_REWARD} credits!`,
            type:      "system",
            timestamp: serverTimestamp(),
            read:      false,
        });
    } catch (_) {}

    await updateDoc(msgRef, {
        markedProductive: true,
        creditAwarded:    true,
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 48-HOUR ESCALATION CHECKER
// Runs once per page load (for the logged-in user).
// Finds messages that are still "pending" after 48 h and forwards them to the
// next available (checked-in) admin.
// ═══════════════════════════════════════════════════════════════════════════════
async function checkEscalations() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
        const cutoff = Timestamp.fromMillis(Date.now() - MS_48H);

        // Only look at messages addressed to the current user (if admin) to limit reads
        const snap = await getDocs(
            query(
                collection(db, "adminMessages"),
                where("toUid",     "==", uid),
                where("status",    "==", "pending"),
                where("timestamp", "<",  cutoff)
            )
        );

        if (snap.empty) return;

        // Find next available admin (checked-in, not the current one)
        const adminSnap = await getDocs(
            query(
                collection(db, "users"),
                where("isAdmin",       "==", true),
                where("adminCheckedIn","==", true)
            )
        );
        const otherAdmins = [];
        adminSnap.forEach(d => { if (d.id !== uid) otherAdmins.push(d.id); });

        if (otherAdmins.length === 0) return; // no one to forward to

        // Forward each stale message and increment missed count on original admin
        let adminIdx = 0;
        const batch  = [];
        snap.forEach(msgDoc => {
            const msgData = msgDoc.data();
            const nextAdminUid = otherAdmins[adminIdx % otherAdmins.length];
            adminIdx++;

            // Build the forwarded doc update
            const missed = Array.isArray(msgData.missedBy) ? msgData.missedBy : [];
            if (!missed.includes(uid)) missed.push(uid);

            batch.push(updateDoc(doc(db, "adminMessages", msgDoc.id), {
                toUid:       nextAdminUid,
                status:      "pending",
                forwardedAt: serverTimestamp(),
                forwardedTo: nextAdminUid,
                originalTo:  msgData.originalTo || uid,
                missedBy:    missed,
            }));
        });

        // Increment missed-response count on this admin
        batch.push(
            updateDoc(doc(db, "users", uid), {
                adminMissedResponses: increment(snap.size),
            })
        );

        await Promise.all(batch);
        console.info(`[Admin] Forwarded ${snap.size} stale message(s) and recorded misses.`);
    } catch (err) {
        // Escalation checks are best-effort — don't block the UI
        console.warn("[Admin] Escalation check error:", err);
    }
}
