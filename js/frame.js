import { db, auth } from "./firebase.js";
import { doc, updateDoc, increment, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/**
 * Injects a small script into the iframe (for same-origin content) to
 * neutralize browser notifications and some noisy APIs, without breaking sites.
 */
function injectNotificationBlocker(iframe) {
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win.document;
    if (!win || !doc) return;

    const script = doc.createElement("script");
    script.textContent = `
      (function () {
        try {
          // Block Notification API (pretend denied)
          if (typeof Notification !== "undefined") {
            try {
              Notification.requestPermission = function () {
                return Promise.resolve("denied");
              };
            } catch (_) {}

            try {
              const OriginalNotification = Notification;
              window.Notification = function () {
                console.warn("Notification blocked by Katy Math frame sandbox.");
                // no-op constructor
              };
              window.Notification.prototype = OriginalNotification.prototype;
              Object.defineProperty(window.Notification, "permission", {
                get: function () {
                  return "denied";
                }
              });
            } catch (_) {}
          }

          // Optional: soften alert/confirm/prompt to avoid annoying popups
          const softBlock = function (name) {
            if (!window[name]) return;
            const original = window[name];
            window[name] = function () {
              console.warn(name + " blocked in Katy Math frame sandbox.");
              // we can still log or silently ignore
              return name === "confirm" ? false : undefined;
            };
            window[name].__original = original;
          };
          softBlock("alert");
          softBlock("confirm");
          softBlock("prompt");

          // Optional: block service worker registration attempts
          if (navigator && navigator.serviceWorker && navigator.serviceWorker.register) {
            const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
            navigator.serviceWorker.register = function () {
              console.warn("Service worker registration blocked in Katy Math frame sandbox.");
              // Pretend it failed with a clean error to avoid site crashes.
              return Promise.reject(new Error("Service worker not allowed in this context."));
            };
            navigator.serviceWorker.register.__original = origRegister;
          }
        } catch (e) {
          console.warn("Frame sandbox injection error:", e);
        }
      })();
    `;
    doc.documentElement.appendChild(script);
  } catch (e) {
    // Cross-origin iframes will throw; just ignore
    console.warn("Unable to inject notification blocker (likely cross-origin).", e);
  }
}

/**
 * Launches the app/link in a fullscreen overlay with timer and voting logic.
 * Includes:
 * - Modern full-screen loader (~2s)
 * - Notification blocking sandbox for iframe (best-effort)
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

      <!-- FULLSCREEN LOADING LAYER (unchanged auto behavior) -->
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

      <!-- SPECIAL LOGIN HELP POPUP FOR LINK 1 -->
      ${
        linkId === "link1"
          ? `
      <div
        id="loginHelpPopup"
        class="fixed top-4 right-4 z-[60] bg-slate-900/95 border border-amber-400/70 rounded-xl shadow-2xl max-w-xs p-3 text-left text-xs text-slate-100"
      >
        <div class="flex items-start gap-2">
          <div class="text-lg leading-none">💡</div>
          <div class="flex-1">
            <div class="font-semibold text-amber-300 text-[11px] tracking-[0.16em] uppercase mb-1">
              Steps to Log In
            </div>
            <ol class="list-decimal list-inside space-y-0.5 text-[11px]">
              <li>Click on <strong>Login</strong>.</li>
              <li>Use this username: <code class="font-mono text-[10px] bg-slate-800 px-1 py-px rounded">u4)29ccb8</code></li>
              <li>Use this password: <code class="font-mono text-[10px] bg-slate-800 px-1 py-px rounded">3aa7%9a52+64</code></li>
            </ol>
            <button
              id="loginHelpImIn"
              class="mt-2 w-full text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-emerald-50 py-1 transition"
              type="button"
            >
              I'M IN
            </button>
          </div>
        </div>
      </div>
      `
          : ""
      }
    </div>
  `;
  document.body.appendChild(overlay);

  const usageBar = document.getElementById("usageBar");
  const usageStatus = document.getElementById("usageStatus");
  const iframe = document.getElementById("activeFrame");
  const loader = document.getElementById("frameLoader");
  const loaderBar = document.getElementById("frameLoaderBar");
  const loaderHint = document.getElementById("frameLoaderHint");
  const loginHelpPopup = document.getElementById("loginHelpPopup");
  const loginHelpImInBtn = document.getElementById("loginHelpImIn");

  const startTime = Date.now();

  // --- NEW: Popup only hides when user clicks I'M IN ---
  if (loginHelpImInBtn && loginHelpPopup) {
    loginHelpImInBtn.onclick = () => {
      loginHelpPopup.style.transition = "opacity 200ms ease-out, transform 200ms ease-out";
      loginHelpPopup.style.opacity = "0";
      loginHelpPopup.style.transform = "translateY(-4px)";
      setTimeout(() => {
        if (loginHelpPopup.parentNode) loginHelpPopup.remove();
      }, 220);
    };
  }

  // ---- LOADER ANIMATION (original behavior) ----
  let iframeLoaded = false;
  let loaderMinTimePassed = false;

  let loaderProgress = 0;
  const loaderInterval = setInterval(() => {
    if (!loaderBar) return;
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

  setTimeout(() => {
    loaderMinTimePassed = true;
    maybeHideLoader();
  }, 2000);

  function maybeHideLoader() {
    if (!loader) return;
    if (!iframeLoaded || !loaderMinTimePassed) return;

    clearInterval(loaderInterval);
    if (loaderBar) {
      loaderBar.style.transition = "width 300ms ease-out";
      loaderBar.style.width = "100%";
    }

    loader.style.transition = "opacity 300ms ease-out";
    loader.style.opacity = "0";
    setTimeout(() => {
      loader.remove();
    }, 320);
    // IMPORTANT: we do NOT touch loginHelpPopup here anymore,
    // so it stays until the user clicks "I'M IN".
  }

  iframe.onload = () => {
    iframeLoaded = true;

    injectNotificationBlocker(iframe);

    maybeHideLoader();

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

  const castVote = async (type) => {
    const promptArea = document.getElementById("promptArea");
    try {
      const voteRef = doc(db, "linkVotes", linkId);
      await setDoc(voteRef, { [type]: increment(1) }, { merge: true });

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

  document.getElementById("closeIframe").onclick = () =>
    saveTimeAndClose(Math.floor((Date.now() - startTime) / 1000));

  document.getElementById("vYes").onclick = () => castVote("yes");
  document.getElementById("vNo").onclick = () => castVote("no");
}
