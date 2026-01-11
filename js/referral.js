import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const referralContent = document.getElementById("referralContent");

/**
 * Renders the referral dashboard for the logged-in user.
 */
export async function renderReferral() {
    if (!auth.currentUser) {
        if (referralContent) referralContent.innerHTML = `<div class="text-sm text-gray-400">Please sign in to view your referral rewards.</div>`;
        return;
    }

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
            referralContent.innerHTML = `<div class="text-sm text-gray-400">User profile not found.</div>`;
            return;
        }

        const data = snap.data();
        const code = data.referralCode || "NOCODE";
        const referrals = data.referrals || [];
        
        // Construct the full invite URL
        const referralLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

        referralContent.innerHTML = `
            <div class="space-y-6 animate-in fade-in duration-500">
                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                    <div class="text-xs text-indigo-400 mb-2 uppercase tracking-widest font-bold">Your Unique Invite Link</div>
                    <p class="text-xs text-slate-500 mb-4">Share this link. When friends join, you get 50 credits and they get 50!</p>
                    <div class="flex items-center gap-2 bg-slate-900 p-3 rounded-xl border border-slate-700">
                        <input readonly value="${referralLink}" id="refUrlInput" class="bg-transparent border-none text-sm w-full outline-none text-slate-300 font-mono" />
                        <button id="copyReferralBtn" class="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 shadow-lg">Copy</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                        <div class="text-xs text-slate-400 mb-1 uppercase tracking-widest font-bold">Your Code</div>
                        <div class="text-3xl font-mono font-black text-white tracking-tighter">${code}</div>
                    </div>
                    <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col justify-center">
                        <button id="shareReferralBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg">
                            <span>🚀</span> Quick Share
                        </button>
                    </div>
                </div>

                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                    <div class="flex justify-between items-center mb-4">
                        <div class="text-xs text-slate-400 uppercase tracking-widest font-bold">Friends Joined (${referrals.length})</div>
                        <div class="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-full">+50 Credits Each</div>
                    </div>
                    <div id="refList" class="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        </div>
                </div>
            </div>
        `;

        // --- BUTTON LOGIC ---

        const copyBtn = document.getElementById("copyReferralBtn");
        copyBtn?.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(referralLink);
                copyBtn.textContent = "Copied!";
                copyBtn.classList.replace("bg-indigo-600", "bg-green-600");
                setTimeout(() => {
                    copyBtn.textContent = "Copy";
                    copyBtn.classList.replace("bg-green-600", "bg-indigo-600");
                }, 2000);
            } catch (err) {
                // Fallback for non-HTTPS or failed clipboard
                const input = document.getElementById("refUrlInput");
                input.select();
                document.execCommand("copy");
                alert("Link selected! Press Ctrl+C to copy.");
            }
        });

        const shareBtn = document.getElementById("shareReferralBtn");
        shareBtn?.addEventListener("click", () => {
            if (navigator.share) {
                navigator.share({
                    title: "Join me on Katy Math!",
                    text: `Use my link to get 50 bonus credits and start learning:`,
                    url: referralLink
                }).catch(() => {});
            } else {
                // If native share isn't available, trigger copy logic
                copyBtn.click();
            }
        });

        // --- LIST LOGIC ---

        const refList = document.getElementById("refList");
        if (referrals.length > 0) {
            refList.innerHTML = referrals.map(refName => `
                <div class="flex items-center gap-3 p-3 bg-slate-900/50 rounded-xl border border-slate-700/50 hover:border-indigo-500/50 transition-colors">
                    <div class="w-8 h-8 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center text-xs font-bold border border-indigo-500/30">
                        👤
                    </div>
                    <div class="flex-1">
                        <div class="text-sm text-slate-200 font-bold">${refName}</div>
                        <div class="text-[10px] text-emerald-400 font-medium tracking-tight">Referral Bonus Applied ✓</div>
                    </div>
                </div>
            `).join("");
        } else {
            refList.innerHTML = `
                <div class="text-center py-8 bg-slate-900/30 rounded-xl border border-dashed border-slate-700">
                    <div class="text-2xl mb-2">🎁</div>
                    <div class="text-slate-500 text-sm">No friends joined yet.</div>
                    <div class="text-[10px] text-slate-600 uppercase mt-1">Start sharing to earn extra credits!</div>
                </div>
            `;
        }

    } catch (err) {
        console.error("Referral Page Error:", err);
        if (referralContent) referralContent.innerHTML = `<div class="text-sm text-red-400 p-4 bg-red-400/10 rounded-lg">Error loading referral data. Please try again later.</div>`;
    }
}

// Attach to window for global access (if using standard HTML onclicks elsewhere)
window.renderReferral = renderReferral;
