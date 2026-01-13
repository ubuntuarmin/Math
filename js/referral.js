import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// ID changed to match your index.html (referralArea)
const referralContent = document.getElementById("referralArea");

/**
 * MAIN RENDER FUNCTION
 * Displays the user's referral stats and sharing options.
 */
export async function renderReferral(userData) {
    // If the element doesn't exist on the current page, exit silently
    if (!referralContent) return;

    // 1. Auth Guard
    if (!auth.currentUser) {
        referralContent.innerHTML = `
            <div class="p-6 text-center bg-gray-800/50 rounded-2xl border border-gray-700">
                <p class="text-sm text-gray-400">Please sign in to view your referral rewards.</p>
            </div>`;
        return;
    }

    try {
        // Use provided userData or fetch fresh if missing
        let data = userData;
        if (!data || !data.referralCode) {
            const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (snap.exists()) data = snap.data();
        }

        // Fallback if the data is still loading or incomplete
        if (!data) return;

        const code = data.referralCode || auth.currentUser.uid.slice(0, 6).toUpperCase();
        const referrals = data.referrals || [];
        const friendCount = referrals.length;
        const totalCreditsEarned = friendCount * 50; 
        
        // Construct the shareable link
        const referralLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

        referralContent.innerHTML = `
            <div class="space-y-6 animate-in fade-in duration-500">
                
                <div class="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 shadow-xl">
                    <div class="text-xs text-blue-400 mb-2 uppercase tracking-widest font-bold">Invite Friends</div>
                    <p class="text-xs text-gray-400 mb-4">Give 20 credits, Get 50 credits!</p>
                    <div class="flex flex-col sm:flex-row items-center gap-2 bg-gray-900 p-3 rounded-xl border border-gray-700">
                        <input readonly value="${referralLink}" id="refUrlInput" 
                               class="bg-transparent border-none text-sm w-full outline-none text-blue-300 font-mono p-1" />
                        <button id="copyReferralBtn" 
                                class="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 shadow-lg whitespace-nowrap">
                            Copy
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-gray-800/80 p-5 rounded-2xl border border-gray-700 text-center">
                        <div class="text-gray-400 text-[10px] uppercase font-bold tracking-widest mb-1">Friends Joined</div>
                        <div class="text-3xl font-black text-white">${friendCount}</div>
                    </div>
                    <div class="bg-gray-800/80 p-5 rounded-2xl border border-gray-700 text-center">
                        <div class="text-emerald-400 text-[10px] uppercase font-bold tracking-widest mb-1">Credits Earned</div>
                        <div class="text-3xl font-black text-emerald-400">+${totalCreditsEarned}</div>
                    </div>
                </div>

                <div class="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 flex flex-col items-center">
                     <div class="text-xs text-gray-400 mb-1 uppercase tracking-widest font-bold">Your Code</div>
                     <div class="text-3xl font-mono font-black text-white mb-4 tracking-wider">${code}</div>
                     <button id="shareReferralBtn" 
                             class="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg">
                        <span>🚀</span> Share with Friends
                     </button>
                </div>

                <div class="bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
                    <div class="text-xs text-gray-400 uppercase tracking-widest font-bold mb-4 border-b border-gray-700 pb-2">Friend History</div>
                    <div id="refList" class="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar text-left">
                        ${referrals.length > 0 ? referrals.map(refEmail => `
                            <div class="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl border border-gray-700/50">
                                <span class="text-sm text-gray-200 font-medium">${refEmail}</span>
                                <span class="text-xs font-black text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">+50 🪙</span>
                            </div>
                        `).join("") : '<div class="text-center py-4 text-gray-500 text-sm italic">No friends have joined yet.</div>'}
                    </div>
                </div>
            </div>
        `;

        // --- Event Listeners ---
        const copyBtn = document.getElementById("copyReferralBtn");
        const shareBtn = document.getElementById("shareReferralBtn");

        const handleCopy = async () => {
            try {
                await navigator.clipboard.writeText(referralLink);
                if (copyBtn) {
                    copyBtn.textContent = "Copied!";
                    copyBtn.classList.replace("bg-blue-600", "bg-emerald-600");
                    setTimeout(() => {
                        copyBtn.textContent = "Copy";
                        copyBtn.classList.replace("bg-emerald-600", "bg-blue-600");
                    }, 2000);
                }
            } catch (err) {
                console.error("Clipboard error", err);
            }
        };

        copyBtn?.addEventListener("click", handleCopy);
        
        shareBtn?.addEventListener("click", () => {
            if (navigator.share) {
                navigator.share({
                    title: "Join Katy Math!",
                    text: `Use my code ${code} to get 20 bonus credits!`,
                    url: referralLink
                }).catch(() => {});
            } else {
                handleCopy(); 
            }
        });

    } catch (err) {
        console.error("Referral Page Error:", err);
    }
}
