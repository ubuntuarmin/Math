import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { calculateTier, getNextTierInfo } from "./tier.js"; 
import { handleDeleteAccount } from "./deleteAccount.js";

const accountInfo = document.getElementById("accountInfo");
const referralArea = document.getElementById("referralArea");

// Form Elements
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
    const nextTier = getNextTierInfo(totalEarned);

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
    const bio = data.bio ? escapeHtml(data.bio) : "";
    const joinDate = data.createdAt?.toMillis
        ? new Date(data.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : "—";

    if (accountInfo) {
        accountInfo.innerHTML = `
            <!-- Social-media-style profile header -->
            <div class="relative mb-8">
              <!-- Cover banner -->
            <div class="h-24 rounded-2xl mb-0" style="background: ${avatarGradient}; opacity: 0.3;"></div>
              <div class="h-24 rounded-2xl absolute inset-0" style="background: ${avatarGradient}; opacity: 0.15;"></div>
              <!-- Avatar -->
              <div class="absolute -bottom-8 left-6">
                <div class="w-20 h-20 rounded-2xl border-4 border-gray-950 flex items-center justify-center text-4xl font-black text-white shadow-2xl"
                     style="background: ${avatarGradient}">
                  ${(data.firstName || "?")[0].toUpperCase()}
                </div>
              </div>
            </div>

            <!-- Name + tier row -->
            <div class="mt-10 mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-2xl font-black text-white leading-tight">
                  ${escapeHtml(data.firstName || "Student")} ${escapeHtml(data.lastName || "")}
                </div>
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span class="text-xs px-2 py-0.5 rounded-full font-bold border"
                        style="color:${tier.color}; border-color:${tier.color}44">
                    ${tier.name}
                  </span>
                  <span class="text-xs text-gray-500">Grade ${data.grade || "—"}</span>
                  <span class="text-xs text-gray-600">· Joined ${joinDate}</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                          bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm font-bold">
                🪙 ${data.credits || 0}
              </div>
            </div>

            <!-- Bio -->
            ${bio
              ? `<p class="text-gray-400 text-sm leading-relaxed mb-5 max-w-lg">${bio}</p>`
              : `<p class="text-gray-600 text-sm italic mb-5">No bio yet — add one to tell the community about yourself!</p>`
            }

            <!-- Stats row -->
            <div class="grid grid-cols-3 gap-3 mb-6">
              <div class="bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-emerald-500/40 transition-colors">
                <div class="text-lg font-black text-emerald-400">${totalEarned}</div>
                <div class="text-[10px] text-gray-500 uppercase font-bold mt-0.5">Lifetime 🪙</div>
              </div>
              <div class="bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-blue-500/40 transition-colors">
                <div class="text-lg font-black text-blue-400">${data.totalMinutes || 0}m</div>
                <div class="text-[10px] text-gray-500 uppercase font-bold mt-0.5">Playtime</div>
              </div>
              <div class="bg-gray-900/60 border border-gray-700/60 rounded-xl p-3 text-center hover:border-orange-500/40 transition-colors">
                <div class="text-lg font-black text-orange-400">${data.streak || 0}</div>
                <div class="text-[10px] text-gray-500 uppercase font-bold mt-0.5">🔥 Streak</div>
              </div>
            </div>

            <!-- Tier progress -->
            <div class="bg-gray-900/80 p-5 rounded-2xl border border-gray-700 shadow-xl mb-2">
              <div class="flex justify-between items-end mb-3">
                <div>
                  <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Current Rank</div>
                  <div class="text-xl font-black" style="color: ${tier.color}">${tier.name}</div>
                </div>
                <div class="text-right">
                  <div class="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Session Limit</div>
                  <div class="text-lg text-white font-bold">${tier.limitMinutes}m</div>
                </div>
              </div>
              <div class="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-gray-700 shadow-inner">
                <div class="h-full transition-all duration-1000 ease-out" 
                     style="width: ${progressPct}%; background-color: ${tier.color}; box-shadow: 0 0 15px ${tier.color}88;">
                </div>
              </div>
              <div class="mt-3 text-center">
                <span class="text-xs text-blue-400 italic font-medium">${nextTier.message}</span>
              </div>
            </div>
        `;
    }

    // Sync Edit Inputs
    if (editFirst) editFirst.value = data.firstName || "";
    if (editLast) editLast.value = data.lastName || "";
    if (editGrade) editGrade.value = data.grade || "";
    if (editBio) editBio.value = data.bio || "";
    if (editAvatarColor) editAvatarColor.value = data.avatarColor || "ocean";

    renderReferralUI(data.referralCode);
}

/** Minimal HTML escape */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Creates the referral link box with improved stability
 */
function renderReferralUI(code) {
    if (!referralArea) return;
    if (!code) {
        referralArea.innerHTML = `<div class="text-sm text-gray-500 italic">No referral code found.</div>`;
        return;
    }

    const fullLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

    referralArea.innerHTML = `
        <div class="mt-4 p-4 bg-gray-900/50 rounded-xl border border-gray-700">
            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">Your Invite Link</div>
            <div class="flex items-center gap-2">
                <input readonly id="refInput" value="${fullLink}" class="bg-gray-950 text-xs p-2 rounded border border-gray-800 w-full text-blue-300 font-mono outline-none">
                <button id="copyRefBtn" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded font-bold transition">COPY</button>
            </div>
            <p class="text-[10px] text-gray-500 mt-2">New friends start with 20 credits; you earn 150!</p>
        </div>
    `;

    const copyRefBtn = document.getElementById("copyRefBtn");
    if (copyRefBtn) {
        copyRefBtn.onclick = async function() {
            try {
                await navigator.clipboard.writeText(fullLink);
                this.textContent = "COPIED!";
                this.classList.replace("bg-blue-600", "bg-green-600");
                setTimeout(() => {
                    this.textContent = "COPY";
                    this.classList.replace("bg-green-600", "bg-blue-600");
                }, 2000);
            } catch (e) {
                const input = document.getElementById("refInput");
                if (input) input.select();
                alert("Press Ctrl+C to copy your link!");
            }
        };
    }
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
