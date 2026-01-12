import { auth, db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const referralContent = document.getElementById("referralContent");

/**
 * 1. URL TRACKER & CLEANER
 * Runs immediately when the script loads to capture ?ref=CODE
 */
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');

if (incomingRef && incomingRef !== "NOCODE") {
    // Store for the login/signup process
    localStorage.setItem("pendingReferral", incomingRef);
    
    // Clean the URL bar immediately so it looks professional
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    
    console.log("Referral system: Code captured and URL cleaned.");
}

/**
 * 2. HELPER: Generate Code
 */
function generateRandomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * 3. MAIN RENDER FUNCTION
 */
export async function renderReferral() {
    if (!auth.currentUser) {
        if (referralContent) {
            referralContent.innerHTML = `
                <div class="p-6 text-center bg-slate-800/50 rounded-2xl border border-slate-700">
                    <p class="text-sm text-slate-400">Please sign in to view your referral rewards.</p>
                </div>`;
        }
        return;
    }

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let snap = await getDoc(userRef);

        if (!snap.exists()) return;

        let data = snap.data();

        // Ensure user has a code; if not, create one automatically
        if (!data.referralCode || data.referralCode === "NOCODE") {
            const newCode = generateRandomCode();
            await updateDoc(userRef, { referralCode: newCode });
            data.referralCode = newCode; 
        }

        const code = data.referralCode;
        const referrals = data.referrals || [];
        const friendCount = referrals.length;
        const totalCreditsEarned = friendCount * 50; 
        
        // Construct link (stripping any existing params)
        const referralLink = `${window.location.origin}${window.location.pathname}?ref=${code}`;

        referralContent.innerHTML = `
            <div class="space-y-6 animate-in fade-in duration-500">
                
                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                    <div class="text-xs text-indigo-400 mb-2 uppercase tracking-widest font-bold">Your Unique Invite Link</div>
                    <p class="text-xs text-slate-500 mb-4 font-medium">Invite a friend. When they join, you both get 50 credits!</p>
                    <div class="flex items-center gap-2 bg-slate-900 p-3 rounded-xl border border-slate-700">
                        <input readonly value="${referralLink}" id="refUrlInput" class="bg-transparent border-none text-sm w-full outline-none text-slate-300 font-mono" />
                        <button id="copyReferralBtn" class="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 shadow-lg whitespace-nowrap">Copy</button>
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

                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col items-center">
                     <div class="text-xs text-slate-400 mb-1 uppercase tracking-widest font-bold">Your Personal Code</div>
                     <div class="text-3xl font-mono font-black text-white mb-4 tracking-wider">${code}</div>
                     <button id="shareReferralBtn" class="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg">
                        <span>🚀</span> Send to Friend
                     </button>
                </div>

                <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                    <div class="text-xs text-slate-400 uppercase tracking-widest font-bold mb-4 border-b border-slate-700 pb-2">Recent Referrals</div>
                    <div id="refList" class="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        ${referrals.length > 0 ? referrals.map(refEmail => `
                            <div class="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/50">
                                <span class="text-sm text-slate-200 font-medium">${refEmail}</span>
                                <span class="text-xs font-black text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">+50 🪙</span>
                            </div>
                        `).join("") : '<div class="text-center py-4 text-slate-500 text-sm italic">No friends have joined yet.</div>'}
                    </div>
                </div>
            </div>
        `;

        // Action Logic
        const copyBtn = document.getElementById("copyReferralBtn");
        const shareBtn = document.getElementById("shareReferralBtn");

        const handleCopy = async () => {
            try {
                await navigator.clipboard.writeText(referralLink);
                copyBtn.textContent = "Copied!";
                copyBtn.classList.replace("bg-indigo-600", "bg-emerald-600");
                setTimeout(() => {
                    copyBtn.textContent = "Copy";
                    copyBtn.classList.replace("bg-emerald-600", "bg-indigo-600");
                }, 2000);
            } catch (err) {
                console.error("Clipboard error", err);
            }
        };

        copyBtn?.addEventListener("click", handleCopy);
        
        shareBtn?.addEventListener("click", () => {
            if (navigator.share) {
                navigator.share({
                    title: "Join Katy Math!",
                    text: "Use my link to get 50 bonus credits and start learning math today!",
                    url: referralLink
                }).catch(() => {});
            } else {
                handleCopy(); // Fallback to copy if native share isn't supported
            }
        });

    } catch (err) {
        console.error("Referral Page Error:", err);
    }
}

// Make globally accessible if needed for onclicks
window.renderReferral = renderReferral;
