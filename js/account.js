import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier, getNextTierInfo } from "./tier.js"; 
import { handleDeleteAccount } from "./deleteAccount.js";
import { startTourForExistingUser } from "./onboarding.js";
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const { useState, useCallback } = React;
const h = React.createElement;

const accountInfo  = document.getElementById("accountInfo");
const referralArea = document.getElementById("referralArea");
const tutorialArea = document.getElementById("tutorialArea");

// Lazy React roots – created once on first render
let accountRoot  = null;
let referralRoot = null;
let tutorialRoot = null;

// Form Elements (static HTML – wired imperatively as before)
const editForm = document.getElementById("editProfileForm");
const showEditBtn = document.getElementById("showEditBtn");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const deleteBtn = document.getElementById("deleteAccountBtn");

const editFirst = document.getElementById("editFirst");
const editLast = document.getElementById("editLast");
const editGrade = document.getElementById("editGrade");
const editBio = document.getElementById("editBio");
const editAvatarColor = document.getElementById("editAvatarColor");

// Avatar gradient presets
const AVATAR_PRESETS = [
  { label: "Ocean", value: "ocean",     gradient: "linear-gradient(135deg,#38bdf8,#3b82f6)" },
  { label: "Sunset", value: "sunset",   gradient: "linear-gradient(135deg,#f97316,#ec4899)" },
  { label: "Forest", value: "forest",   gradient: "linear-gradient(135deg,#22c55e,#16a34a)" },
  { label: "Cosmic", value: "cosmic",   gradient: "linear-gradient(135deg,#a855f7,#6366f1)" },
  { label: "Fire",   value: "fire",     gradient: "linear-gradient(135deg,#ef4444,#f97316)" },
  { label: "Gold",   value: "gold",     gradient: "linear-gradient(135deg,#fbbf24,#f59e0b)" },
];

function getAvatarGradient(colorKey) {
  return AVATAR_PRESETS.find(p => p.value === colorKey)?.gradient
    || AVATAR_PRESETS[0].gradient;
}

// ── AccountInfoPanel ──────────────────────────────────────────────────────────
function AccountInfoPanel({
  data, tier, displayName, displayColor,
  progressPct, avatarGradient, joinDate, bio, nextTierMessage,
}) {
  const [chatIdCopied, setChatIdCopied] = useState(false);
  const uid = auth.currentUser?.uid || "";

  const handleCopyId = useCallback(() => {
    if (!uid) return;
    navigator.clipboard.writeText(uid).then(() => {
      setChatIdCopied(true);
      setTimeout(() => setChatIdCopied(false), 2000);
    });
  }, [uid]);

  return h(React.Fragment, null,
    // Cover + avatar
    h("div", { className: "relative mb-8" },
      h("div", {
        className: "h-24 rounded-2xl mb-0",
        style: { background: avatarGradient, opacity: 0.3 },
      }),
      h("div", {
        className: "h-24 rounded-2xl absolute inset-0",
        style: { background: avatarGradient, opacity: 0.15 },
      }),
      h("div", { className: "absolute -bottom-8 left-6" },
        h("div", {
          className: "w-20 h-20 rounded-2xl border-4 border-gray-950 flex items-center justify-center text-4xl font-black text-white shadow-2xl",
          style: { background: avatarGradient },
        }, (data.firstName || "?")[0].toUpperCase())
      )
    ),

    // Name + tier row
    h("div", { className: "mt-10 mb-4 flex flex-wrap items-start justify-between gap-3" },
      h("div", null,
        h("div", { className: "text-2xl font-black text-white leading-tight" },
          `${data.firstName || "Student"} ${data.lastName || ""}`
        ),
        h("div", { className: "flex items-center gap-2 mt-1 flex-wrap" },
          h("span", {
            className: "text-xs px-2 py-0.5 rounded-full font-bold border",
            style: { color: displayColor, borderColor: `${displayColor}44` },
          }, displayName),
          h("span", { className: "text-xs text-gray-500" }, `Grade ${data.grade || "—"}`),
          h("span", { className: "text-xs text-gray-600" }, `· Joined ${joinDate}`)
        )
      ),
      h("div", {
        className: "flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm font-bold",
      }, `🪙 ${data.credits || 0}`)
    ),

    // Bio
    bio
      ? h("p", { className: "text-gray-400 text-sm leading-relaxed mb-5 max-w-lg" }, bio)
      : h("p", { className: "text-gray-600 text-sm italic mb-5" },
          "No bio yet — add one to tell the community about yourself!"
        ),

    // Stats grid
    h("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" },
      h("div", { className: "bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-emerald-500/40 transition-colors" },
        h("div", { className: "text-lg font-black text-emerald-400" }, data.totalEarned || 0),
        h("div", { className: "text-[10px] text-gray-500 uppercase font-bold mt-0.5" }, "Lifetime 🪙")
      ),
      h("div", { className: "bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-blue-500/40 transition-colors" },
        h("div", { className: "text-lg font-black text-blue-400" }, `${data.totalMinutes || 0}m`),
        h("div", { className: "text-[10px] text-gray-500 uppercase font-bold mt-0.5" }, "Playtime")
      ),
      h("div", { className: "bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-orange-500/40 transition-colors" },
        h("div", { className: "text-lg font-black text-orange-400" }, data.streak || 0),
        h("div", { className: "text-[10px] text-gray-500 uppercase font-bold mt-0.5" }, "🔥 Streak")
      ),
      h("div", { className: "bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-purple-500/40 transition-colors" },
        h("div", { className: "text-lg font-black text-purple-400" }, (data.referrals || []).length),
        h("div", { className: "text-[10px] text-gray-500 uppercase font-bold mt-0.5" }, "👥 Referrals")
      )
    ),

    // Tier progress
    h("div", { className: "bg-gray-900/80 p-5 rounded-2xl border border-gray-700 shadow-xl mb-2" },
      h("div", { className: "flex justify-between items-end mb-3" },
        h("div", null,
          h("div", { className: "text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1" }, "Current Rank"),
          h("div", { className: "text-xl font-black", style: { color: displayColor } }, displayName)
        ),
        h("div", { className: "text-right" },
          h("div", { className: "text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1" }, "Session Limit"),
          h("div", { className: "text-lg text-white font-bold" }, `${tier.limitMinutes}m`)
        )
      ),
      h("div", { className: "w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-gray-700 shadow-inner" },
        h("div", {
          className: "h-full transition-all duration-1000 ease-out",
          style: {
            width: `${progressPct}%`,
            backgroundColor: displayColor,
            boxShadow: `0 0 15px ${displayColor}88`,
          },
        })
      ),
      h("div", { className: "mt-3 text-center" },
        h("span", { className: "text-xs text-blue-400 italic font-medium" }, nextTierMessage)
      )
    ),

    // Chat ID with useState-driven copy button label
    h("div", { className: "mt-4 p-4 bg-gray-900/60 border border-gray-700 rounded-2xl" },
      h("div", { className: "text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2" }, "💬 Your Chat ID"),
      h("div", { className: "flex items-center gap-2" },
        h("code", {
          id: "accountChatId",
          className: "flex-1 text-xs font-mono text-blue-300 bg-blue-500/10 px-3 py-1.5 rounded-lg border border-blue-500/30 select-all truncate",
        }, uid),
        h("button", {
          id: "accountCopyIdBtn",
          className: "text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors shrink-0 whitespace-nowrap",
          onClick: handleCopyId,
        }, chatIdCopied ? "✓ Copied!" : "📋 Copy")
      ),
      h("p", { className: "text-[11px] text-gray-600 mt-1.5" },
        "Share this ID with friends so they can start a private chat with you."
      )
    )
  );
}

// ── ReferralPanel: copy/share buttons driven by useState ─────────────────────
function ReferralPanel({ code, fullLink, hasNativeShare }) {
  const [copyLabel, setCopyLabel]   = useState("COPY");
  const [copyExtra, setCopyExtra]   = useState("");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullLink);
      setCopyLabel("COPIED!");
      setCopyExtra("bg-green-600 hover:bg-green-600");
      setTimeout(() => {
        setCopyLabel("COPY");
        setCopyExtra("");
      }, 2000);
    } catch (_) {
      const input = document.getElementById("refInput");
      if (input) input.select();
      alert("Press Ctrl+C to copy your link!");
    }
  }, [fullLink]);

  const handleShare = useCallback(async () => {
    try {
      await navigator.share({
        title: "Join me on Math Katy!",
        text: "Hey! Join Math Katy — share and discover game sites and earn credits. Use my invite link to get started with bonus credits!",
        url: fullLink,
      });
    } catch (e) {
      if (e.name !== "AbortError") {
        try { await navigator.clipboard.writeText(fullLink); } catch (_) {}
        alert("Link copied to clipboard!");
      }
    }
  }, [fullLink]);

  if (!code) {
    return h("div", { className: "text-sm text-gray-500 italic" }, "No referral code found.");
  }

  return h("div", { className: "mt-4 p-4 bg-gray-900/50 rounded-xl border border-gray-700" },
    h("div", { className: "flex items-center gap-2 mb-2" },
      h("div", { className: "text-xs text-gray-400 uppercase font-bold tracking-wider" }, "Your Invite Link"),
      h("span", {
        className: "tooltip-icon",
        tabIndex: 0,
        role: "note",
        "aria-label": "Referral help",
      },
        "?",
        h("span", { className: "tooltip-text" },
          "Share this link with friends. When they sign up, you earn 150 🪙 bonus credits and they start with 20 credits!"
        )
      )
    ),
    h("div", { className: "flex items-center gap-2" },
      h("input", {
        readOnly: true,
        id: "refInput",
        value: fullLink,
        className: "bg-gray-950 text-xs p-2 rounded border border-gray-800 w-full text-blue-300 font-mono outline-none",
      }),
      h("button", {
        id: "copyRefBtn",
        className: `text-white text-xs px-3 py-2 rounded font-bold transition whitespace-nowrap ${
          copyExtra || "bg-blue-600 hover:bg-blue-500"
        }`,
        onClick: handleCopy,
      }, copyLabel),
      hasNativeShare && h("button", {
        id: "shareRefBtn",
        className: "bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-2 rounded font-bold transition whitespace-nowrap",
        onClick: handleShare,
      }, "SHARE")
    ),
    h("p", { className: "text-[10px] text-gray-500 mt-2" },
      "New friends start with 20 credits; you earn 150 🪙 per referral!"
    )
  );
}

// ── TutorialCard ──────────────────────────────────────────────────────────────
function TutorialCard({ claimed, onStart }) {
  if (claimed) {
    return h("div", {
      className: "mt-4 p-4 bg-gray-900/40 border border-gray-700/50 rounded-2xl flex items-center gap-3",
    },
      h("div", { className: "text-green-400 text-xl" }, "✅"),
      h("div", null,
        h("div", { className: "text-xs font-bold text-green-400" }, "Tutorial Completed"),
        h("div", { className: "text-[11px] text-gray-500 mt-0.5" },
          "You've already earned your +30 credits reward!"
        )
      )
    );
  }

  return h("div", {
    className: "mt-4 p-4 bg-gradient-to-br from-blue-950/60 to-purple-950/60 border border-blue-500/30 rounded-2xl shadow-lg",
  },
    h("div", { className: "flex items-center gap-3 mb-3" },
      h("div", {
        className: "w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl shrink-0",
      }, "🎓"),
      h("div", null,
        h("div", { className: "text-sm font-bold text-white" }, "Take the Interactive Tutorial"),
        h("div", { className: "text-[11px] text-blue-300 mt-0.5" },
          "Learn all the features and earn ",
          h("strong", null, "+30 credits"),
          "!"
        )
      )
    ),
    h("p", { className: "text-xs text-gray-400 mb-3 leading-relaxed" },
      "The tutorial walks you through every feature of Math Katy — and this time you'll need to click and interact with things to move on. Complete it to earn ",
      h("strong", { className: "text-yellow-300" }, "+30 🪙 credits"),
      "!"
    ),
    h("button", {
      id: "startTutorialBtn",
      className: "w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-bold transition-all shadow active:scale-95",
      onClick: onStart,
    }, "🚀 Start Tutorial (+30 🪙)")
  );
}

/**
 * Updates the visual account page
 */
export async function updateAccount(userData) {
    let data = userData || {};

    if (!data.firstName && auth.currentUser) {
        try {
            const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (snap.exists()) data = snap.data();
        } catch (err) {
            console.error("Account Refresh Error:", err);
        }
    }

    const totalEarned = data.totalEarned || 0;
    const tier = calculateTier(totalEarned);
    const nextTier = getNextTierInfo(totalEarned, data);

    const ADMIN_COLOR = "#c084fc"; // purple-400 — matches header badge
    const isAdmin = !!data.isAdmin;
    const displayName  = isAdmin ? "Admin"      : tier.name;
    const displayColor = isAdmin ? ADMIN_COLOR  : tier.color;

    let progressPct = 0;
    if (nextTier.remaining > 0) {
        const currentTierMin = tier.minCredits || 0; 
        const nextTierMin = totalEarned + nextTier.remaining;
        const range = nextTierMin - currentTierMin;
        const progressInRange = totalEarned - currentTierMin;
        progressPct = Math.max(0, Math.min((progressInRange / range) * 100, 100));
    } else {
        progressPct = 100;
    }

    const avatarGradient = getAvatarGradient(data.avatarColor);
    const joinDate = data.createdAt?.toMillis
        ? new Date(data.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : "—";

    if (accountInfo) {
        if (!accountRoot) accountRoot = createRoot(accountInfo);
        accountRoot.render(h(AccountInfoPanel, {
            data,
            tier,
            displayName,
            displayColor,
            progressPct,
            avatarGradient,
            joinDate,
            bio: data.bio || "",
            nextTierMessage: nextTier.message,
        }));
    }

    // Sync Edit Inputs (static HTML form – unchanged)
    if (editFirst) editFirst.value = data.firstName || "";
    if (editLast) editLast.value = data.lastName || "";
    if (editGrade) editGrade.value = data.grade || "";
    if (editBio) editBio.value = data.bio || "";
    if (editAvatarColor) editAvatarColor.value = data.avatarColor || "ocean";

    renderReferralUI(data.referralCode);
    renderTutorialCard(data);
}

/**
 * Creates the referral link box – now a React root
 */
function renderReferralUI(code) {
    if (!referralArea) return;
    if (!referralRoot) referralRoot = createRoot(referralArea);
    const fullLink = code
        ? `${window.location.origin}${window.location.pathname}?ref=${code}`
        : "";
    const hasNativeShare = !!code && window.isSecureContext && typeof navigator.share === "function";
    referralRoot.render(h(ReferralPanel, { code, fullLink, hasNativeShare }));
}

/**
 * Renders the "Take Tutorial & Earn 30 Credits" card – now a React root
 */
function renderTutorialCard(data) {
    if (!tutorialArea) return;
    if (!tutorialRoot) tutorialRoot = createRoot(tutorialArea);
    const uid = auth.currentUser?.uid;
    const onStart = () => {
        if (!uid) { alert("Please wait a moment and try again."); return; }
        const started = startTourForExistingUser(uid);
        if (!started) { alert("Tutorial is still loading. Please try again in a moment."); }
    };
    tutorialRoot.render(h(TutorialCard, { claimed: !!data.tutorialCreditClaimed, onStart }));
}

// --- Interaction Logic ---

if (showEditBtn) {
    showEditBtn.onclick = () => {
        editForm?.classList.remove("hidden");
        showEditBtn.classList.add("hidden");
    };
}

if (cancelEditBtn) {
    cancelEditBtn.onclick = () => {
        editForm?.classList.add("hidden");
        showEditBtn?.classList.remove("hidden");
    };
}

if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        if (!auth.currentUser) return;
        
        const fName = editFirst.value.trim();
        if (fName.length < 2 || fName.length > 20) {
            return alert("First name must be between 2 and 20 characters.");
        }

        const bio = editBio ? editBio.value.trim() : "";
        if (bio.length > 200) {
            return alert("Bio must be 200 characters or fewer.");
        }

        const userRef = doc(db, "users", auth.currentUser.uid);

        try {
            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = "Saving...";

            // Read the current doc to compute the profile-update rate-limit window.
            const currentSnap = await getDoc(userRef);
            const currentData = currentSnap.exists() ? currentSnap.data() : {};

            const now         = Date.now();
            const winStart    = currentData.profileUpdateWindowStart || 0;
            const isNewWindow = (now - winStart) > 3600000;
            const profileUpdateFields = isNewWindow
              ? { profileUpdateWindowStart: now, profileUpdateCount: 1 }
              : { profileUpdateCount: increment(1) };

            const updatedData = {
                firstName: fName,
                lastName: editLast.value.trim(),
                grade: editGrade.value,
                bio: bio,
                avatarColor: editAvatarColor?.value || "ocean",
                ...profileUpdateFields,
            };

            await updateDoc(userRef, updatedData);
            
            editForm.classList.add("hidden");
            showEditBtn.classList.remove("hidden");
            
            const snap = await getDoc(userRef);
            updateAccount(snap.data());
            
            window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: snap.data() }));

        } catch (err) {
            console.error(err);
            alert("Error saving profile.");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = "Save Changes";
        }
    };
}

if (deleteBtn) {
    deleteBtn.onclick = () => handleDeleteAccount();
}
