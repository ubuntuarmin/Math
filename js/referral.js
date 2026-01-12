import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const referralContent = document.getElementById("referralContent");

/**
 * Helper: Generates a random 6-character referral code
 */
function generateRandomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Tracker: Captures the 'ref' parameter from the URL and saves it to localStorage.
 * Put this at the top so it runs immediately when the script loads.
 */
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');
if (incomingRef && incomingRef !== "NOCODE") {
    localStorage.setItem("pendingReferral", incomingRef);
}

export async function renderReferral() {
    if (!auth.currentUser) {
        if (referralContent) referralContent.innerHTML = `<div class="text-sm text-gray-400">Please sign in to view your referral rewards.</div>`;
        return;
    }

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let snap = await getDoc(userRef);

        if (!snap.exists()) {
            if (referralContent) referralContent.innerHTML = `<div class="text-sm text-gray-400">User profile not found.</div>`;
            return;
        }

        let data = snap.data();

        // --- BUG FIX: GENERATE CODE IF MISSING OR "NOCODE" ---
        if (!data.referralCode || data.referralCode === "NOCODE") {
            const newCode = generateRandomCode();
            await updateDoc(userRef, { referralCode: newCode });
            // Re-fetch data to ensure UI is accurate
            const freshSnap = await getDoc(userRef);
            data = freshSnap.data();
        }

        const code = data.referralCode;
        const referrals = data.referrals || [];
        const friendCount = referrals.length;
        const totalCreditsEarned = friendCount * 50; 
        
        // Construct the full invite URL (strips existing params to avoid nesting)
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

                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-slate-800/80 p-5 rounded-2xl border border-slate-700 text-center">
                        <div class="text-slate-400 text-[10px] uppercase font-bold tracking-widest mb-1">Friends Joined</div>
                        <div class="text-3xl font-black text-white">${friendCount}</div>
                    </div>
                    <div class="bg-slate-800/80 p-5 rounded-2xl border border-slate-700 text-center">
                        <div class="text-emerald-400 text-[10px] uppercase font-bold tracking-widest mb-1">Credits Earned</div>
                        <div class="text-3xl font-black text-emerald-400">+${totalCreditsEarned}</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                        <div class="text-xs text-slate-400 mb-1 uppercase tracking-widest font-bold">Your Code</div>
                        <div class="text-3xl font-mono font-black text-white tracking-tighter">${code}</div>
                    </div>
                    <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col justify-center">
                        <button id="shareReferralBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg">
                            <span>🚀</span> Quick Share Link
                        </button>
                    </div>
                </div>

                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                    <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
                        <div class="text-xs text-slate-400 uppercase tracking-widest font-bold">Activity Feed</div>
                        <div class="text-[10px] text-slate-500">History</div>
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
                const input = document.getElementById("refUrlInput");
                input.select();
                document.execCommand("copy");
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
                copyBtn.click();
            }
        });

        // --- LIST LOGIC ---
        const refList = document.getElementById("refList");
        if (referrals.length > 0) {
            refList.innerHTML = referrals.map(refName => `
                <div class="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/50 hover:border-indigo-500/50 transition-colors">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center text-xs font-bold border border-indigo-500/30">
                            👤
                        </div>
                        <div class="text-sm text-slate-200 font-bold">${refName}</div>
                    </div>
                    <div class="text-xs font-black text-emerald-400">+50 🪙</div>
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
        if (referralContent) referralContent.innerHTML = `<div class="text-sm text-red-400 p-4 bg-red-400/10 rounded-lg">Error loading referral data.</div>`;
    }
}

window.renderReferral = renderReferral;
