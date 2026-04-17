import { auth, db } from "./firebase.js";
import { doc, updateDoc, getDoc, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { TIER_CONFIG, FREE_SESSION_MINUTES, SESSION_TOPUP_COST } from "./tier.js";

// ══════════════════════════════════════════════════════════
//  PROFILE SETUP FORM
// ══════════════════════════════════════════════════════════

const onboardModal = document.getElementById("onboardModal");
const firstInput   = document.getElementById("onboardFirst");
const lastInput    = document.getElementById("onboardLast");
const gradeSelect  = document.getElementById("onboardGrade");
const saveBtn      = document.getElementById("onboardSave");
const errorEl      = document.getElementById("onboardError");

let _isSaving = false;

function setSavingState(on) {
  _isSaving = !!on;
  if (saveBtn) {
    saveBtn.disabled    = _isSaving;
    saveBtn.textContent = _isSaving ? "Saving\u2026" : "Save & Continue";
  }
}

export function showOnboarding() {
  if (!onboardModal) return;
  onboardModal.classList.remove("hidden");
  onboardModal.setAttribute("aria-hidden", "false");
  if (errorEl) errorEl.textContent = "";
  setTimeout(() => firstInput?.focus(), 50);
  // Start Three.js particle field after the modal has rendered
  requestAnimationFrame(() => _initOnboardScene());
}

export function hideOnboarding() {
  if (!onboardModal) return;
  _destroyOnboardScene();
  onboardModal.classList.add("hidden");
  onboardModal.setAttribute("aria-hidden", "true");
}

// ── Three.js animated particle field behind the onboarding modal ───────
function _initOnboardScene() {
  _destroyOnboardScene();
  if (typeof THREE === "undefined") return;

  const canvas = document.getElementById("onboardThreeCanvas");
  if (!canvas) return;

  const W = window.innerWidth;
  const H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 100);
  camera.position.z = 10;

  // Particle data
  const COUNT    = 70;
  const MAX_DIST = 140;
  const MAX_SEGS = (COUNT * (COUNT - 1)) >> 1;

  const pos = new Float32Array(COUNT * 3);
  const vel = [];
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * W;
    pos[i * 3 + 1] = (Math.random() - 0.5) * H;
    pos[i * 3 + 2] = 0;
    vel.push({ x: (Math.random() - 0.5) * 0.22, y: (Math.random() - 0.5) * 0.22 });
  }

  const ptGeom  = new THREE.BufferGeometry();
  const ptAttr  = new THREE.BufferAttribute(pos, 3);
  ptAttr.setUsage(THREE.DynamicDrawUsage);
  ptGeom.setAttribute("position", ptAttr);
  const ptMat   = new THREE.PointsMaterial({ size: 2.5, color: 0x38bdf8, transparent: true, opacity: 0.85, sizeAttenuation: false });
  scene.add(new THREE.Points(ptGeom, ptMat));

  // Line segments between close particles
  const linePos  = new Float32Array(MAX_SEGS * 6);
  const lineGeom = new THREE.BufferGeometry();
  const lineAttr = new THREE.BufferAttribute(linePos, 3);
  lineAttr.setUsage(THREE.DynamicDrawUsage);
  lineGeom.setAttribute("position", lineAttr);
  const lineMat  = new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.20 });
  const lineMesh = new THREE.LineSegments(lineGeom, lineMat);
  scene.add(lineMesh);

  const state = { raf: null };

  function _tick() {
    state.raf = requestAnimationFrame(_tick);
    const hw = W / 2, hh = H / 2;
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     += vel[i].x;
      pos[i * 3 + 1] += vel[i].y;
      if (pos[i * 3]     >  hw) pos[i * 3]     = -hw;
      if (pos[i * 3]     < -hw) pos[i * 3]     =  hw;
      if (pos[i * 3 + 1] >  hh) pos[i * 3 + 1] = -hh;
      if (pos[i * 3 + 1] < -hh) pos[i * 3 + 1] =  hh;
    }
    ptAttr.needsUpdate = true;

    let li = 0;
    const maxD2 = MAX_DIST * MAX_DIST;
    for (let i = 0; i < COUNT; i++) {
      for (let j = i + 1; j < COUNT; j++) {
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        if (dx * dx + dy * dy < maxD2) {
          linePos[li++] = pos[i * 3];     linePos[li++] = pos[i * 3 + 1]; linePos[li++] = 0;
          linePos[li++] = pos[j * 3];     linePos[li++] = pos[j * 3 + 1]; linePos[li++] = 0;
        }
      }
    }
    lineGeom.setDrawRange(0, li / 3);
    lineAttr.needsUpdate = true;

    renderer.render(scene, camera);
  }
  _tick();

  function _onResize() {
    const nW = window.innerWidth, nH = window.innerHeight;
    renderer.setSize(nW, nH, false);
    camera.left = -nW / 2; camera.right = nW / 2;
    camera.top = nH / 2;   camera.bottom = -nH / 2;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", _onResize);

  _onboardThree = {
    burst() {
      try {
        const originalPointColor = ptMat.color.clone();
        const originalLineColor = lineMat.color.clone();
        const originalPointOpacity = ptMat.opacity;
        const originalLineOpacity = lineMat.opacity;

        ptMat.color.set(0x22d3ee);
        lineMat.color.set(0x60a5fa);
        ptMat.opacity = Math.min(1, originalPointOpacity + 0.1);
        lineMat.opacity = Math.min(0.5, originalLineOpacity + 0.1);

        if (typeof gsap !== "undefined") {
          gsap.fromTo(ptMat, { size: 4.2 }, { size: 2.5, duration: 0.8, ease: "power2.out" });
          gsap.to(ptMat.color, { r: originalPointColor.r, g: originalPointColor.g, b: originalPointColor.b, duration: 0.9 });
          gsap.to(lineMat.color, { r: originalLineColor.r, g: originalLineColor.g, b: originalLineColor.b, duration: 0.9 });
          gsap.to(ptMat, { opacity: originalPointOpacity, duration: 0.9 });
          gsap.to(lineMat, { opacity: originalLineOpacity, duration: 0.9 });
        } else {
          setTimeout(() => {
            ptMat.color.copy(originalPointColor);
            lineMat.color.copy(originalLineColor);
            ptMat.opacity = originalPointOpacity;
            lineMat.opacity = originalLineOpacity;
          }, 900);
        }
      } catch (err) {
        console.warn("[Onboarding] Particle burst failed:", err);
      }
    },
    destroy() {
      cancelAnimationFrame(state.raf);
      window.removeEventListener("resize", _onResize);
      ptGeom.dispose();  ptMat.dispose();
      lineGeom.dispose(); lineMat.dispose();
      renderer.dispose();
      _onboardThree = null;
    },
  };
}

function _destroyOnboardScene() {
  if (_onboardThree) _onboardThree.destroy();
}

async function finalizeOnboarding(uid, firstName) {
  try {
    const snap      = await getDoc(doc(db, "users", uid));
    const freshData = snap.data() || {};
    sessionStorage.removeItem("justSignedUp");
    window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: freshData }));
    showSuccessAndClose(firstName, uid);
  } catch (e) {
    console.error("Finalize error:", e);
    hideOnboarding();
  }
}

function showSuccessAndClose(name, uid) {
  const panel = onboardModal?.querySelector(".panel");
  if (!panel) return;

  // Safely escape the user-supplied name to prevent XSS
  const safeName = document.createTextNode(name || "Student").textContent;

  panel.innerHTML = `
    <div class="flex flex-col items-center gap-4 py-6">
      <div id="onboardSuccessCheck"
           class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center
                  text-white text-3xl shadow-lg" style="opacity:0;transform:scale(0.4)">\u2713</div>
      <div class="text-xl font-bold" style="opacity:0;transform:translateY(10px)" id="onboardSuccessTitle">
        Welcome, <span id="onboardSuccessName"></span>!
      </div>
      <p class="text-gray-400 text-sm text-center max-w-sm" style="opacity:0" id="onboardSuccessBody">
        Your profile is set. Let's take a quick <strong>interactive tour</strong>! \uD83D\uDE80
      </p>
    </div>`;

  // Set name text node to avoid XSS
  const nameEl = document.getElementById("onboardSuccessName");
  if (nameEl) nameEl.textContent = safeName;

  if (typeof gsap !== "undefined") {
    gsap.to("#onboardSuccessCheck", { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" });
    gsap.to("#onboardSuccessTitle", { opacity: 1, y: 0, duration: 0.4, delay: 0.25, ease: "power3.out" });
    gsap.to("#onboardSuccessBody",  { opacity: 1, duration: 0.4, delay: 0.45, ease: "power2.out" });
  }

  setTimeout(() => {
    hideOnboarding();
    _showToast("✨ Tips will appear as you explore new features.");
  }, 1600);
}

async function handleSave() {
  if (_isSaving) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const first = (firstInput?.value || "").trim();
  const last  = (lastInput?.value  || "").trim();
  const grade = gradeSelect?.value  || "";

  if (errorEl) errorEl.textContent = "";

  if (!first || first.length < 2) {
    if (errorEl) errorEl.textContent = "Please enter your first name (at least 2 characters).";
    firstInput?.focus(); return;
  }
  if (first.length > 20) {
    if (errorEl) errorEl.textContent = "First name is too long (max 20 characters).";
    firstInput?.focus(); return;
  }
  if (!grade) {
    if (errorEl) errorEl.textContent = "Please select your grade.";
    gradeSelect?.focus(); return;
  }

  setSavingState(true);
  try {
    await updateDoc(doc(db, "users", uid), {
      firstName: first, lastName: last, grade, onboardingComplete: true,
    });
    await finalizeOnboarding(uid, first);
  } catch (err) {
    console.error("Onboarding save error:", err);
    if (errorEl) errorEl.textContent = "Failed to save. Please try again.";
    setSavingState(false);
  }
}

saveBtn?.addEventListener("click", (e) => { e.preventDefault(); handleSave(); });
[firstInput, lastInput].forEach(el => {
  el?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } });
});

// ══════════════════════════════════════════════════════════
//  ONBOARD.JS TOUR  (Onboard-compatible guided onboarding)
// ══════════════════════════════════════════════════════════

let _tourUid          = null;
let _tourAwardCredits = false;
let _tourContext      = null;
let _activeFeatureIds = [];
let _onboardTour      = null;
let _tourLibLoadPromise = null;
let _onboardThree     = null;  // Three.js particle scene state
let _jitListenersBound = false;
const _visitedFeaturesByUid = new Map();
const _featureToursInFlight = new Set();

const TOUR_LIB_SOURCE_TIMEOUT_MS = 4500;
const TOUR_LIB_LOAD_MAX_MS = 12000;
const NATIVE_TOUR_CLS = "mt-native-tour-target";
const FALLBACK_CARD_HEIGHT = 280;
const FALLBACK_CARD_MIN_HEIGHT = 260;
const FALLBACK_CARD_MAX_HEIGHT = 680;
const LOCAL_TOUR_LIB_SRC = new URL("./vendor/onboard.umd.min.js", import.meta.url).href;

const _tourScriptSources = [
  LOCAL_TOUR_LIB_SRC,
  "https://cdn.jsdelivr.net/npm/onboardjs@latest/dist/onboard.umd.min.js",
  "https://unpkg.com/onboardjs@latest/dist/onboard.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/onboardjs/latest/onboard.umd.min.js",
];

// Helper: programmatically switch the app to a named tab
function _switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

// Helper: animated progress bar HTML
function _progressBar(current, total) {
  const pct = Math.round((current / total) * 100);
  return `<div class="onboard-progress-wrap"><div class="onboard-progress" style="width:${pct}%"></div></div>`;
}

// Helper: chip badges
function _chips(list) {
  if (!list?.length) return "";
  return `<div class="mt-chips">${list.map(c =>
    `<span class="mt-chip${c.type ? " " + c.type : ""}">${c.label}</span>`
  ).join("")}</div>`;
}

// Helper: tip box
function _tip(text) {
  return text ? `<div class="mt-tip"><strong>\uD83D\uDCA1 Tip:</strong> ${text}</div>` : "";
}

// Helper: instruction pill
function _instr(text) {
  return text ? `<div class="mt-instr">${text}</div>` : "";
}

// Helper: step icon circle
function _icon(emoji) {
  return `<div class="mt-step-icon">${emoji}</div>`;
}

// Helper: step-dot progress navigation
function _buildDotNav(currentIndex, total) {
  let html = '<div class="mt-ntc-dots" aria-hidden="true">';
  for (let i = 0; i < total; i++) {
    const cls = i < currentIndex ? "past" : (i === currentIndex ? "active" : "");
    html += `<span class="mt-ntc-dot${cls ? " " + cls : ""}"></span>`;
  }
  html += "</div>";
  return html;
}

function _tierTopupChips() {
  return [
    { label: `Basic = ${TIER_CONFIG.BASIC.limitMinutes}m/top-up`, type: "" },
    { label: `Silver = ${TIER_CONFIG.SILVER.limitMinutes}m/top-up`, type: "" },
    { label: `Gold = ${TIER_CONFIG.GOLD.limitMinutes}m/top-up`, type: "purple" },
    { label: `VIP = ${TIER_CONFIG.VIP.limitMinutes}m/top-up ⭐`, type: "purple" },
  ];
}

// Build the body section of a step (icon + progress + body + chips + tip + instruction)
function _stepContent({ icon, body, chips, tip, instr, step, total }) {
  return [
    _icon(icon),
    _progressBar(step, total),
    `<p style="color:#94a3b8;font-size:.845rem;line-height:1.65;margin-top:.5rem">${body}</p>`,
    _chips(chips),
    _tip(tip),
    _instr(instr),
  ].filter(Boolean).join("");
}

// GSAP entrance animation on tooltip element
function _animateIn(el) {
  if (typeof gsap === "undefined" || !el) return;
  gsap.fromTo(el,
    { opacity: 0, y: 14, scale: 0.96 },
    { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.7)", clearProps: "all" }
  );
}

// GSAP dramatic ring-pulse on a target element to draw attention
function _pulseTarget(selector) {
  if (typeof gsap === "undefined" || !selector) return;
  const el = document.querySelector(selector);
  if (!el) return;
  gsap.timeline({ repeat: 1, yoyo: true })
    .to(el, { scale: 1.06, duration: 0.22, ease: "power1.inOut" })
    .to(el, { scale: 1,    duration: 0.22, ease: "power1.inOut" });
}

// Register GSAP animation hooks on the tour instance
// (only fires for OnboardJS-style tooltips; native fallback animates itself in _renderCurrent)
function _addGsapHooks(tour) {
  tour.on("show", () => {
    requestAnimationFrame(() => {
      const tooltip = document.querySelector(".onboard-tooltip");
      if (tooltip) _animateIn(tooltip);
    });
  });
}

// Toast notification for credit awards
function _showToast(msg) {
  const t = document.createElement("div");
  t.className = "mt-tour-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("mt-tour-toast-show"));
  setTimeout(() => {
    t.classList.remove("mt-tour-toast-show");
    setTimeout(() => t.remove(), 420);
  }, 4500);
}

class NativeOnboardTour {
  constructor(options = {}) {
    this.options = options;
    this.steps = [];
    this.handlers = { show: [], complete: [], cancel: [] };
    this.index = -1;
    this._direction = 1;  // +1 = forward, -1 = back (drives slide animation)
    this.host = null;
    this.card = null;
    this.currentTarget = null;
    this.cleanupAdvance = null;
    this.boundEsc = (e) => {
      if (e.key === "Escape" && this.options.exitOnEsc) this.cancel();
    };
    this.boundReposition = () => this._repositionCurrent();
  }

  addStep(step) {
    this.steps.push(step);
    return this;
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    return this;
  }

  start() {
    if (!this.steps.length) return;
    this._mount();
    this._direction = 1;
    this.index = 0;
    this._renderCurrent();
  }

  next() {
    if (this.index >= this.steps.length - 1) return this.complete();
    this._direction = 1;
    this.index += 1;
    this._renderCurrent();
  }

  back() {
    if (this.index <= 0) return;
    this._direction = -1;
    this.index -= 1;
    this._renderCurrent();
  }

  complete() {
    this._teardown();
    this._emit("complete");
  }

  cancel() {
    this._teardown();
    this._emit("cancel");
  }

  _emit(event) {
    (this.handlers[event] || []).forEach((fn) => {
      try {
        fn.call(this);
      } catch (err) {
        console.warn("[Onboarding] Native tour event handler failed:", err);
      }
    });
  }

  _mount() {
    this._teardown();
    this.host = document.createElement("div");
    this.host.className = "mt-native-tour-host";
    this.host.innerHTML = `<div class="mt-native-tour-overlay"></div><section class="mt-native-tour-card" role="dialog" aria-live="polite"></section>`;
    document.body.appendChild(this.host);
    this.card = this.host.querySelector(".mt-native-tour-card");
    this.host.querySelector(".mt-native-tour-overlay")?.addEventListener("click", () => this.cancel());
    document.addEventListener("keydown", this.boundEsc);
    window.addEventListener("resize", this.boundReposition);
    window.addEventListener("scroll", this.boundReposition, { passive: true });
  }

  _teardown() {
    if (this.cleanupAdvance) { this.cleanupAdvance(); this.cleanupAdvance = null; }
    if (this.currentTarget) this.currentTarget.classList.remove(NATIVE_TOUR_CLS);
    this.currentTarget = null;
    document.removeEventListener("keydown", this.boundEsc);
    window.removeEventListener("resize", this.boundReposition);
    window.removeEventListener("scroll", this.boundReposition);
    if (this.host) this.host.remove();
    this.host = null;
    this.card = null;
  }

  _renderCurrent() {
    const step = this.steps[this.index];
    if (!step || !this.card) return;
    if (this.cleanupAdvance) { this.cleanupAdvance(); this.cleanupAdvance = null; }
    if (this.currentTarget) this.currentTarget.classList.remove(NATIVE_TOUR_CLS);

    const title      = step.title || "";
    const text       = step.text  || "";
    const buttons    = step.buttons || [];
    const stepNum    = this.index + 1;
    const totalSteps = this.steps.length;

    this.card.innerHTML = `
      <div class="mt-ntc-top-bar">
        ${_buildDotNav(this.index, totalSteps)}
        <span class="mt-ntc-step-label">${stepNum}&thinsp;/&thinsp;${totalSteps}</span>
      </div>
      <header class="mt-native-tour-header">${title}</header>
      <div class="mt-native-tour-body">${text}</div>
      <footer class="mt-native-tour-footer"></footer>
    `;

    // Direction-aware slide-in animation
    if (typeof gsap !== "undefined") {
      gsap.fromTo(this.card,
        { x: this._direction * 26, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.30, ease: "power2.out", clearProps: "transform" }
      );
    }

    const footer = this.card.querySelector(".mt-native-tour-footer");
    buttons.forEach((btnCfg) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `mt-native-tour-btn ${btnCfg.classes || ""}`.trim();
      btn.textContent = btnCfg.text || "Next";
      btn.addEventListener("click", () => {
        try {
          if (typeof btnCfg.action === "function") btnCfg.action.call(this);
        } catch (err) {
          console.warn("[Onboarding] Native tour button action failed:", err);
        }
      });
      footer?.appendChild(btn);
    });

    const targetSelector = step.attachTo?.element || "";
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    if (target) {
      this.currentTarget = target;
      target.classList.add(NATIVE_TOUR_CLS);
      if (this.options.defaultStepOptions?.scrollTo) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      this._positionNear(target, step.attachTo?.on || "bottom");
    } else {
      this._positionCenter();
    }

    if (step.advanceOn?.selector && step.advanceOn?.event) {
      const advanceEl = document.querySelector(step.advanceOn.selector);
      if (advanceEl) {
        const advance = () => this.next();
        advanceEl.addEventListener(step.advanceOn.event, advance, { once: true });
        this.cleanupAdvance = () => advanceEl.removeEventListener(step.advanceOn.event, advance);
      }
    }

    if (step.when?.show) {
      try {
        step.when.show.call(this);
      } catch (err) {
        console.warn("[Onboarding] Native tour step show hook failed:", err);
      }
    }
    this._emit("show");
  }

  _positionCenter() {
    if (!this.card) return;
    this.card.style.left = "50%";
    this.card.style.top = "50%";
    this.card.style.transform = "translate(-50%, -50%)";
  }

  _repositionCurrent() {
    if (!this.card) return;
    const step = this.steps[this.index];
    if (!step) return;
    const targetSelector = step.attachTo?.element || "";
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    if (target) this._positionNear(target, step.attachTo?.on || "bottom");
    else this._positionCenter();
  }

  _positionNear(target, on) {
    if (!this.card || !target) return;
    const rect = target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(420, Math.max(300, vw - 24));
    const cardH = Number.isFinite(vh)
      ? Math.min(Math.max(FALLBACK_CARD_MIN_HEIGHT, vh * 0.8), FALLBACK_CARD_MAX_HEIGHT)
      : FALLBACK_CARD_HEIGHT;
    const gap = 14;

    let left = rect.left + rect.width / 2 - cardW / 2;
    let top = on === "top" ? rect.top - gap : rect.bottom + gap;
    if (on === "left") { left = rect.left - cardW - gap; top = rect.top; }
    if (on === "right") { left = rect.right + gap; top = rect.top; }

    if (top + cardH + 20 > vh) top = Math.max(20, vh - cardH - 20);
    if (top < 20) top = 20;
    left = Math.max(12, Math.min(vw - cardW - 12, left));

    this.card.style.width = `${cardW}px`;
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
    this.card.style.transform = "none";
  }
}

function _getOnboardLib() {
  if (typeof Onboard !== "undefined" && Onboard?.Tour) return Onboard;
  return null;
}

function _loadScript(src, timeoutMs = TOUR_LIB_SOURCE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (_getOnboardLib()) return resolve();

      const cleanup = () => {
        clearTimeout(timer);
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      };
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load ${src}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out loading ${src}`));
      }, timeoutMs);

      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";

    const cleanup = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };

    const timer = setTimeout(() => {
      cleanup();
      script.remove();
      reject(new Error(`Timed out loading ${src}`));
    }, timeoutMs);

    script.onload = () => {
      cleanup();
      resolve();
    };
    script.onerror = () => {
      cleanup();
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };

    document.head.appendChild(script);
  });
}

async function _ensureOnboardLib(maxDurationMs = 8000) {
  let lib = _getOnboardLib();
  if (lib) return lib;

  const deadline = Date.now() + Math.max(0, maxDurationMs);

  for (const src of _tourScriptSources) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      await _loadScript(src, Math.min(TOUR_LIB_SOURCE_TIMEOUT_MS, remaining));
      lib = _getOnboardLib();
      if (lib) return lib;
    } catch (err) {
      console.warn("[Onboarding] Tour library source failed:", src, err);
    }
  }

  return null;
}

function _getTourLibLoadPromise(timeoutMs) {
  if (_tourLibLoadPromise) return _tourLibLoadPromise;

  _tourLibLoadPromise = (async () => {
    try {
      return await _ensureOnboardLib(timeoutMs);
    } finally {
      _tourLibLoadPromise = null;
    }
  })();

  return _tourLibLoadPromise;
}

async function _waitForOnboardLib(timeoutMs = TOUR_LIB_LOAD_MAX_MS) {
  const lib = _getOnboardLib();
  if (lib) return lib;

  const loadPromise = _getTourLibLoadPromise(timeoutMs);
  await loadPromise;
  return _getOnboardLib();
}

// ── JIT micro-tour orchestration ───────────────────────────────────────
function _microQuestBurst() {
  try {
    _onboardThree?.burst?.();
    const shell = document.body;
    if (!shell || typeof gsap === "undefined") return;
    gsap.fromTo(shell, { boxShadow: "inset 0 0 0 rgba(34,211,238,0)" }, {
      boxShadow: "inset 0 0 120px rgba(34,211,238,0.14)",
      duration: 0.28,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
      clearProps: "boxShadow",
    });
  } catch (err) {
    console.warn("[Onboarding] Micro-quest burst failed:", err);
  }
}

const TOUR_FEATURES = Object.freeze({
  WELCOME: "WELCOME_TOUR",
  LINKS: "LINKS_TOUR",
  SEARCH: "SEARCH_TOUR",
  SHARE: "SHARE_TOUR",
  CREDIT: "CREDIT_TOUR",
  SESSION: "SESSION_TOUR",
  STREAK: "STREAK_TOUR",
  LEADERBOARD: "LEADERBOARD_TOUR",
  CHAT: "CHAT_TOUR",
  ACCOUNT: "ACCOUNT_TOUR",
  NEWS: "NEWS_TOUR",
});

const TOUR_CONTEXTS = Object.freeze({
  welcome: [TOUR_FEATURES.WELCOME],
  sharing: [TOUR_FEATURES.SHARE, TOUR_FEATURES.CREDIT, TOUR_FEATURES.SESSION],
  full: [
    TOUR_FEATURES.WELCOME,
    TOUR_FEATURES.LINKS,
    TOUR_FEATURES.SEARCH,
    TOUR_FEATURES.SHARE,
    TOUR_FEATURES.CREDIT,
    TOUR_FEATURES.SESSION,
    TOUR_FEATURES.STREAK,
    TOUR_FEATURES.LEADERBOARD,
    TOUR_FEATURES.CHAT,
    TOUR_FEATURES.ACCOUNT,
    TOUR_FEATURES.NEWS,
  ],
});

const TOUR_EVENT_TRIGGERS = [
  { event: "click", selector: "#tourTabLinks", featureId: TOUR_FEATURES.LINKS },
  { event: "focusin", selector: "#linksSearch", featureId: TOUR_FEATURES.SEARCH },
  { event: "click", selector: "#tourShareBtn, a[href='share.html']", featureId: TOUR_FEATURES.SHARE },
  { event: "click", selector: "#tourCreditsPill", featureId: TOUR_FEATURES.CREDIT },
  { event: "click", selector: "#navSessionTime", featureId: TOUR_FEATURES.SESSION },
  { event: "click", selector: "#tourTabDaily, #dailyTracker .day-card", featureId: TOUR_FEATURES.STREAK },
  { event: "click", selector: "#tourTabLeaderboard", featureId: TOUR_FEATURES.LEADERBOARD },
  { event: "click", selector: "#tourTabChat", featureId: TOUR_FEATURES.CHAT },
  { event: "click", selector: "#tourTabAccount", featureId: TOUR_FEATURES.ACCOUNT },
  { event: "click", selector: "#tourTabNews", featureId: TOUR_FEATURES.NEWS },
];

const TOUR_MANAGER = {
  [TOUR_FEATURES.WELCOME]: [
    {
      id: "jit-welcome",
      icon: "🎮",
      title: "Math Katy reacts to what you explore",
      body: "You’ll now get short, contextual tips only when you use a feature for the first time.",
      chips: [{ label: "No forced 15-step lecture", type: "green" }],
      tip: "Explore naturally — each feature will explain itself once.",
    },
    {
      id: "jit-welcome-interact",
      icon: "🧭",
      title: "Tap around to unlock quick tips",
      body: "Open tabs like Daily, Top, and Chat. The first time you use each area, you’ll get a short guided tip.",
      chips: [{ label: "Hands-on onboarding", type: "green" }],
      attachTo: { element: "#tourNavTabs", on: "bottom" },
      instr: "Try switching tabs while the tour continues.",
      prepare() { _switchTab("links"); },
    },
  ],
  [TOUR_FEATURES.LINKS]: [
    {
      id: "jit-links-tab",
      icon: "🧩",
      title: "Start from the Links tab",
      body: "This is your main discovery area for useful game and study links.",
      attachTo: { element: "#tourTabLinks", on: "bottom" },
      instr: "Tap Links to keep this area active.",
      prepare() { _switchTab("links"); },
      advanceOn: { selector: "#tourTabLinks", event: "click" },
    },
    {
      id: "jit-links",
      icon: "🔗",
      title: "Links Feed",
      body: "This feed is the core hub. Open cards, rate sites after use, and report unsafe links.",
      chips: [
        { label: "Upvote = +10 ��", type: "green" },
        { label: "3 reports = auto-remove", type: "" },
      ],
      attachTo: { element: "#linksGrid", on: "top" },
      prepare() { _switchTab("links"); },
      instr: "Scroll a little and preview a few cards.",
    },
  ],
  [TOUR_FEATURES.SEARCH]: [
    {
      id: "jit-search",
      icon: "🔍",
      title: "Search & Sort",
      body: "Filter instantly by title, tags, or keywords, then sort by newest, votes, or rating.",
      tip: "Use Highest Rated to quickly find trusted picks.",
      attachTo: { element: "#linksSearch", on: "bottom" },
      prepare() { _switchTab("links"); },
      whenShow() { setTimeout(() => document.getElementById("linksSearch")?.focus(), 120); },
      instr: "Click search and type a keyword to continue.",
      advanceOn: { selector: "#linksSearch", event: "input" },
    },
    {
      id: "jit-search-sort",
      icon: "⚙️",
      title: "Sort to surface the best options",
      body: "Switch sorting to find newer links or the most trusted highly-rated resources faster.",
      attachTo: { element: "#linksSort", on: "bottom" },
      prepare() { _switchTab("links"); },
    },
  ],
  [TOUR_FEATURES.SHARE]: [
    {
      id: "jit-share",
      icon: "➕",
      title: "Sharing earns the biggest ongoing rewards",
      body: "Submit useful links to earn +50 credits instantly and +10 for each community upvote.",
      chips: [
        { label: "Share = +50 🪙", type: "green" },
        { label: "Per upvote = +10 🪙", type: "green" },
      ],
      attachTo: { element: "#tourShareBtn", on: "bottom" },
    },
    {
      id: "jit-share-queue",
      icon: "✅",
      title: "Quality shares win long-term",
      body: "The best gains come from links that others revisit, upvote, and save over time.",
      chips: [{ label: "Consistent shares compound credits", type: "green" }],
      attachTo: { element: "#linksGrid", on: "top" },
      prepare() { _switchTab("links"); },
    },
  ],
  [TOUR_FEATURES.CREDIT]: [
    {
      id: "jit-credit",
      icon: "🪙",
      title: "Credits = currency + reputation",
      body: "Credits track both value and status. More earned credits unlock higher tiers and stronger top-ups.",
      chips: [
        { label: "Basic / Silver / Gold / VIP", type: "purple" },
        { label: "Top-up cost stays fixed", type: "" },
      ],
      attachTo: { element: "#tourCreditsPill", on: "bottom" },
    },
    {
      id: "jit-credit-rank",
      icon: "📈",
      title: "Credits also track progression",
      body: "Higher total earned credits improve your visible rank profile and unlock stronger session economy.",
      chips: [{ label: "Earned total matters", type: "purple" }],
      attachTo: { element: "#tierLabel", on: "bottom" },
    },
  ],
  [TOUR_FEATURES.SESSION]: [
    {
      id: "jit-session",
      icon: "⏱️",
      title: "Session timer control",
      body: `You start with ${FREE_SESSION_MINUTES} free minutes. Each refill costs ${SESSION_TOPUP_COST} credits, and tier affects refill size.`,
      chips: _tierTopupChips(),
      attachTo: { element: "#navSessionTime", on: "bottom" },
    },
    {
      id: "jit-session-balance",
      icon: "🔁",
      title: "Watch timer + credits together",
      body: "Smart players refill only when needed and keep a reserve of credits for high-value moments.",
      attachTo: { element: "#tourCreditsPill", on: "bottom" },
    },
  ],
  [TOUR_FEATURES.STREAK]: [
    {
      id: "jit-daily",
      icon: "🔥",
      title: "Daily streak rewards",
      body: "Claim daily to build your streak and increase your reward pace over time.",
      tip: "Missing claims resets streak momentum.",
      attachTo: { element: "#tourTabDaily", on: "bottom" },
      prepare() { _switchTab("daily"); },
    },
    {
      id: "jit-daily-grid",
      icon: "📆",
      title: "How streak milestones pay out",
      body: "Most days grant +10 credits, while milestone days can spike rewards dramatically.",
      chips: [
        { label: "24h claim cadence", type: "" },
        { label: "Milestones = bonus bursts", type: "green" },
      ],
      attachTo: { element: "#dailyTracker", on: "top" },
      prepare() { _switchTab("daily"); },
    },
  ],
  [TOUR_FEATURES.LEADERBOARD]: [
    {
      id: "jit-leaderboard",
      icon: "🏆",
      title: "Leaderboard seasons",
      body: "Leaderboard ranks live performance; top players secure seasonal credit prizes.",
      chips: [{ label: "Top 10 rewarded", type: "green" }],
      attachTo: { element: "#tourTabLeaderboard", on: "bottom" },
    },
    {
      id: "jit-leaderboard-panel",
      icon: "📊",
      title: "Track your climb in real time",
      body: "Check your position often to decide when to push for milestone placements.",
      attachTo: { element: "#leaderboard", on: "top" },
      prepare() { _switchTab("leaderboard"); },
    },
  ],
  [TOUR_FEATURES.CHAT]: [
    {
      id: "jit-chat",
      icon: "💬",
      title: "Community chat",
      body: "Use chat for live help, collaboration, and social coordination with moderated safety.",
      chips: [{ label: "Real-time + moderated", type: "" }],
      attachTo: { element: "#tourTabChat", on: "bottom" },
    },
    {
      id: "jit-chat-compose",
      icon: "✍️",
      title: "Ask quick questions in chat",
      body: "Short, clear questions usually get the fastest responses from the community.",
      attachTo: { element: "#chatTabContent", on: "top" },
      prepare() { _switchTab("chat"); },
      instr: "Place your cursor in chat input to continue.",
      advanceOn: { selector: "#chatTabContent", event: "click" },
    },
  ],
  [TOUR_FEATURES.ACCOUNT]: [
    {
      id: "jit-account",
      icon: "👤",
      title: "Account center",
      body: "Track your profile, rank progress, referrals, and tutorial reward status in one place.",
      chips: [{ label: "Referral = +150 🪙", type: "green" }],
      attachTo: { element: "#tourTabAccount", on: "bottom" },
    },
    {
      id: "jit-account-referral",
      icon: "🎁",
      title: "Use referrals to accelerate growth",
      body: "Invite friends with your referral code to earn bonus credits and grow your standing faster.",
      attachTo: { element: "#referralArea", on: "top" },
      prepare() { _switchTab("account"); },
    },
  ],
  [TOUR_FEATURES.NEWS]: [
    {
      id: "jit-news",
      icon: "📰",
      title: "News & updates",
      body: "Use News for feature rollouts, policy changes, and event announcements so you never miss platform shifts.",
      attachTo: { element: "#tourTabNews", on: "bottom" },
      prepare() {
        const moreBtn = document.getElementById("navMoreBtn");
        if (moreBtn?.getAttribute("aria-expanded") !== "true") moreBtn.click();
      },
    },
    {
      id: "jit-news-feed",
      icon: "📣",
      title: "News keeps your strategy current",
      body: "Use updates to adapt early when rewards, rules, or events change.",
      attachTo: { element: "#tab-news", on: "top" },
      prepare() {
        const moreBtn = document.getElementById("navMoreBtn");
        if (moreBtn?.getAttribute("aria-expanded") !== "true") moreBtn.click();
        _switchTab("news");
      },
    },
  ],
};

function _resolveContextFeatures(context) {
  if (Array.isArray(context)) return context.filter(Boolean);
  if (!context) return [];
  if (TOUR_CONTEXTS[context]) return [...TOUR_CONTEXTS[context]];
  if (TOUR_MANAGER[context]) return [context];
  return [];
}

async function _getVisitedFeatures(uid) {
  if (!uid) return new Set();
  const cached = _visitedFeaturesByUid.get(uid);
  if (cached) return new Set(cached);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const visited = Array.isArray(snap.data()?.visitedFeatures) ? snap.data().visitedFeatures : [];
    const nextSet = new Set(visited);
    _visitedFeaturesByUid.set(uid, nextSet);
    return new Set(nextSet);
  } catch (err) {
    console.warn("[Onboarding] Failed to load visited features:", err);
    return new Set();
  }
}

function _cacheVisitedFeatures(uid, featureIds = []) {
  if (!uid) return;
  const set = _visitedFeaturesByUid.get(uid) || new Set();
  featureIds.forEach((id) => set.add(id));
  _visitedFeaturesByUid.set(uid, set);
}

async function _markFeaturesVisited(uid, featureIds = []) {
  const unique = [...new Set(featureIds.filter(Boolean))];
  if (!uid || !unique.length) return;
  try {
    await updateDoc(doc(db, "users", uid), { visitedFeatures: arrayUnion(...unique) });
    _cacheVisitedFeatures(uid, unique);
  } catch (err) {
    console.warn("[Onboarding] Failed to persist visited features:", err);
  }
}

function _createTourInstance(TourCtor) {
  const tour = new TourCtor({
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      classes: "onboard-math-tour",
      scrollTo: { behavior: "smooth", block: "center" },
      cancelIcon: { enabled: true },
      modalOverlayOpeningPadding: 8,
      modalOverlayOpeningRadius: 10,
      popperOptions: { modifiers: [{ name: "offset", options: { offset: [0, 14] } }] },
    },
  });
  _addGsapHooks(tour);
  return tour;
}

function _buildContextSteps(featureIds) {
  const defs = [];
  for (const featureId of featureIds) {
    const microTour = TOUR_MANAGER[featureId] || [];
    for (const stepDef of microTour) {
      try {
        if (typeof stepDef.prepare === "function") stepDef.prepare();
      } catch (err) {
        console.warn("[Onboarding] Step prepare failed:", err);
      }
      const selector = stepDef.attachTo?.element;
      if (selector && !document.querySelector(selector)) {
        console.warn("[Onboarding] Skipping step; target not found:", selector, stepDef.id || stepDef.featureId);
        continue;
      }
      defs.push({ ...stepDef, featureId });
    }
  }

  const total = defs.length;
  return defs.map((stepDef, idx) => {
    const backBtn = { text: "← Back", action() { this.back(); }, classes: "onboard-button-secondary" };
    const last = idx === total - 1;
    const actionBtn = last
      ? { text: "Done ✓", action() { this.complete(); } }
      : { text: "Next →", action() { this.next(); } };

    return {
      id: `${stepDef.id || stepDef.featureId}-${idx + 1}`,
      _featureId: stepDef.featureId,
      title: stepDef.title || "Tip",
      text: _stepContent({
        icon: stepDef.icon || "✨",
        step: idx + 1,
        total,
        body: stepDef.body || "",
        chips: stepDef.chips || [],
        tip: stepDef.tip || "",
        instr: stepDef.instr || "",
      }),
      attachTo: stepDef.attachTo,
      advanceOn: stepDef.advanceOn,
      buttons: idx === 0 ? [actionBtn] : [backBtn, actionBtn],
      when: {
        show() {
          try {
            if (typeof stepDef.whenShow === "function") stepDef.whenShow();
          } catch (err) {
            console.warn("[Onboarding] Step show hook failed:", err);
          }
          if (stepDef.attachTo?.element) _pulseTarget(stepDef.attachTo.element);
        },
      },
    };
  });
}

async function _startTour(uid, context = "full", options = {}) {
  if (!uid) return false;

  try {
    if (_onboardTour) return false;

    const featureIds = _resolveContextFeatures(context);
    if (!featureIds.length) return false;

    const OnboardLib = await _waitForOnboardLib();
    const TourCtor = OnboardLib?.Tour || NativeOnboardTour;
    if (!OnboardLib?.Tour) _showToast("ℹ️ Using built-in onboarding (external library unavailable).");

    const visited = await _getVisitedFeatures(uid);
    const pendingFeatures = featureIds.filter((featureId) => !visited.has(featureId));
    if (!pendingFeatures.length) return false;

    const steps = _buildContextSteps(pendingFeatures);
    if (!steps.length) return false;

    _tourUid = uid;
    _tourContext = context;
    _tourAwardCredits = !!options.awardCredits;
    _activeFeatureIds = [...new Set(steps.map((step) => step._featureId).filter(Boolean))];

    _onboardTour = _createTourInstance(TourCtor);
    steps.forEach((step) => _onboardTour.addStep(step));
    _onboardTour.on("complete", () => _handleTourEnd(true));
    _onboardTour.on("cancel", () => _handleTourEnd(false));
    _onboardTour.start();
    return true;
  } catch (err) {
    console.warn("[Onboarding] Failed to start context tour:", context, err);
    return false;
  }
}

async function _triggerFeatureTour(featureId) {
  const uid = auth.currentUser?.uid;
  if (!uid || !featureId) return false;
  if (_onboardTour) return false;

  const guardKey = `${uid}:${featureId}`;
  if (_featureToursInFlight.has(guardKey)) return false;
  _featureToursInFlight.add(guardKey);

  try {
    const visited = await _getVisitedFeatures(uid);
    if (visited.has(featureId)) return false;
    return await _startTour(uid, featureId, { awardCredits: false });
  } catch (err) {
    console.warn("[Onboarding] Feature trigger failed:", featureId, err);
    return false;
  } finally {
    _featureToursInFlight.delete(guardKey);
  }
}

function _setupJitOnboarding() {
  if (_jitListenersBound) return;
  _jitListenersBound = true;

  TOUR_EVENT_TRIGGERS.forEach(({ event, selector, featureId }) => {
    document.addEventListener(event, async (e) => {
      try {
        const target = e.target?.closest?.(selector);
        if (!target) return;
        await _triggerFeatureTour(featureId);
      } catch (err) {
        console.warn("[Onboarding] Event-driven tour handler failed:", err);
      }
    }, true);
  });

  window.addEventListener("userProfileUpdated", (e) => {
    const uid = auth.currentUser?.uid;
    const visited = Array.isArray(e.detail?.visitedFeatures) ? e.detail.visitedFeatures : null;
    if (uid && visited) _visitedFeaturesByUid.set(uid, new Set(visited));
  });
}

async function _handleTourEnd(completed) {
  const uid = _tourUid;
  const awardCredits = _tourAwardCredits;
  const context = _tourContext;
  const featureIds = [..._activeFeatureIds];
  _onboardTour = null;
  _tourUid = null;
  _tourContext = null;
  _tourAwardCredits = false;
  _activeFeatureIds = [];

  if (!uid) return;

  try {
    if (completed && featureIds.length) {
      await _markFeaturesVisited(uid, featureIds);
      _microQuestBurst();
    }

    if (completed && awardCredits) {
      await updateDoc(doc(db, "users", uid), {
        credits: increment(30),
        totalEarned: increment(30),
        tutorialCreditClaimed: true,
        tourComplete: true,
      });
      _showToast("🎉 +30 credits earned for completing the tutorial!");
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        window.dispatchEvent(new CustomEvent("userProfileUpdated", { detail: snap.data() }));
      }
      return;
    }

    if (completed && context === "full") {
      await updateDoc(doc(db, "users", uid), { tourComplete: true });
    }
  } catch (e) {
    console.warn("Tour end write failed:", e);
  }
}

/** Public: start guided tutorial for existing users (+30 credits on completion). */
export function startTourForExistingUser(uid) {
  if (!uid) return false;
  _startTour(uid, "full", { awardCredits: true });
  return true;
}

_setupJitOnboarding();
