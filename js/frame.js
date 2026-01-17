import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/**
 * Launches the app/link in a fullscreen overlay with timer and voting logic.
 * Now includes a modern full-screen loading animation (~2 seconds).
 */
export function launchFrame(content, linkId, currentUsage, maxSeconds) {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 bg-black z-50 flex flex-col";

  // --- SMART DETECTION ---
  let finalSrc = content;
  let isApp = false;

  if (content.trim().startsWith("<")) {
    isApp = true;
    const blob = new Blob([content], { type: "text/html" });
    finalSrc = URL.createObjectURL(blob);
  }

  // Build overlay HTML with header, iframe, and loading layer
  overlay.innerHTML = `
    <div class="bg-gray-900 p-2 border-b border-gray-700 flex flex-col gap-1">
      <div class="flex justify-between items-center px-2">
        <span class="text-[10px] text-blue-400 font-mono" id="usageStatus">
          ${isApp ? "🚀 Launching App..." : "🌐 Loading Link..."}
        </span>
        <div id="promptArea" class="hidden text-sm font-bold text-yellow-400 flex items-center gap-2">
          Working? 
          <button id="vYes" class="bg-green-600 px-3 py-0.5 rounded text-white hover:bg-green-500 transition">Yes</button>
          <button id="vNo" class="bg-red-600 px-3 py-0.5 rounded text-white hover:bg-red-500 transition">No</button>
        </div>
        <button id="closeIframe" class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs text-white font-bold transition">
          Close X
        </button>
      </div>
      <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
        <div id="usageBar" class="bg-blue-500 h-full transition-all duration-300" style="width: 0%"></div>
      </div>
    </div>
    <div class="relative flex-1">
      <iframe id="activeFrame" src="${finalSrc}" class="flex-1 w-full h-full border-none bg-white shadow-2xl"></iframe>

      <!-- FULLSCREEN LOADING LAYER -->
      <div
        id="frameLoader"
        class="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950/95 pointer-events-auto"
      >
        <div class="flex flex-col items-center gap-5 px-6 text-center">
          <div class="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center shadow-xl border border-slate-700/70">
            <div class="token-spin text-3xl">🪙</div>
          </div>

          <div>
            <div class="text-sm font-semibold text-slate-300 tracking-[0.18em] uppercase mb-1">
              Loading
            </div>
            <div class="text-xl font-bold text-white">
              Getting your math ready…
            </div>
            <p class="text-xs text-slate-400 mt-1">
              Hang tight! This takes about <span class="font-semibold text-emerald-400">2 seconds</span>.
            </p>
          </div>

          <div class="w-64 max-w-full">
            <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/80">
              <div
                id="frameLoaderBar"
                class="h-full bg-gradient-to-r from-blue-400 via-emerald-400 to-fuchsia-400"
                style="width: 0%"
              ></div>
            </div>
            <div class="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>Preparing</span>
              <span id="frameLoaderHint">Connecting…</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const usageBar = document.getElementById("usageBar");
  const usageStatus = document.getElementById("usageStatus");
  const iframe = document.getElementById("activeFrame");
  const loader = document.getElementById("frameLoader");
  const loaderBar = document.getElementById("frameLoaderBar");
  const loaderHint = document.getElementById("frameLoaderHint");

  const startTime = Date.now();

  // ---- LOADER ANIMATION (about 2 seconds) ----
  let iframeLoaded = false;
  let loaderMinTimePassed = false;

  // Fake progress bar animation
  let loaderProgress = 0;
  const loaderInterval = setInterval(() => {
    if (!loaderBar) return;
    // Ease to 90% over ~2 seconds
    loaderProgress = Math.min(loaderProgress + 7, 90);
    loaderBar.style.width = `${loaderProgress}%`;

    if (loaderProgress < 30 && loaderHint) {
      loaderHint.textContent = "Connecting…";
    } else if (loaderProgress < 70 && loaderHint) {
      loaderHint.textContent = "Loading content…";
    } else if (loaderHint) {
      loaderHint.textContent = "Almost ready…";
    }
  }, 120);

  // Minimum loader time ~2 seconds
  setTimeout(() => {
    loaderMinTimePassed = true;
    maybeHideLoader();
  }, 2000);

  // Hide loader when both iframe is loaded AND min time passed
  function maybeHideLoader() {
    if (!loader) return;
    if (!iframeLoaded || !loaderMinTimePassed) return;

    clearInterval(loaderInterval);
    // Smooth finish to 100%
    if (loaderBar) {
      loaderBar.style.transition = "width 300ms ease-out";
      loaderBar.style.width = "100%";
    }

    // Fade out loader
    loader.style.transition = "opacity 300ms ease-out";
    loader.style.opacity = "0";
    setTimeout(() => {
      loader.remove();
    }, 320);
  }

  iframe.onload = () => {
    iframeLoaded = true;
    maybeHideLoader();

    // Existing behavior: show vote prompt after 5 seconds
    setTimeout(() => {
      const prompt = document.getElementById("promptArea");
      if (prompt) prompt.classList.remove("hidden");
    }, 5000);
  };

  // ---- TIMER / USAGE LOGIC ----
  const autoKickInterval = setInterval(() => {
    const sessionSeconds = Math.floor((Date.now() - startTime) / 1000);
    const totalUsed = currentUsage + sessionSeconds;
    const progressPct = (totalUsed / maxSeconds) * 100;

    if (usageBar) {
      usageBar.style.width = `${Math.min(progressPct, 100)}%`;
    }
    if (usageStatus) {
      usageStatus.textContent = `Usage: ${Math.floor(
        totalUsed / 60
      )}m / ${maxSeconds / 60}m (${Math.floor(progressPct)}%)`;
    }

    if (totalUsed >= maxSeconds) {
      alert("🚨 DAILY TIME EXPIRED!");
      saveTimeAndClose(sessionSeconds);
    }
  }, 1000);

  // Save and Exit Logic
  const saveTimeAndClose = async (sessionSeconds) => {
    clearInterval(autoKickInterval);
    clearInterval(loaderInterval);
    if (isApp) URL.revokeObjectURL(finalSrc);

    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, {
        dailyLinkUsage: increment(sessionSeconds),
        totalMinutes: increment(Math.floor(sessionSeconds / 60)),
      });
    } catch (e) {
      console.error("Save error:", e);
    }

    overlay.remove();
    location.reload();
  };

  // Voting Logic
  const castVote = async (type) => {
    const promptArea = document.getElementById("promptArea");
    try {
      const voteRef = doc(db, "linkVotes", linkId);
      await setDoc(
        voteRef,
        { [type]: increment(1) },
        { merge: true }
      );

      if (promptArea) {
        promptArea.innerHTML =
          "<span class='text-green-400 animate-pulse'>Vote Recorded!</span>";
        setTimeout(() => promptArea.classList.add("hidden"), 2000);
      }
    } catch (e) {
      console.error("Vote failed:", e);
      if (promptArea) {
        promptArea.innerHTML = "<span class='text-red-400'>Error!</span>";
      }
    }
  };

  // Event Listeners
  document.getElementById("closeIframe").onclick = () =>
    saveTimeAndClose(Math.floor((Date.now() - startTime) / 1000));

  document.getElementById("vYes").onclick = () => castVote("yes");
  document.getElementById("vNo").onclick = () => castVote("no");
}
