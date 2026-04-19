/**
 * lgBackground.js — Phase 3: Liquid Gold Glass WebGL shader background
 *
 * Provides startLgBackground() / stopLgBackground(). Called by auth.js after
 * login (if profile mode = liquidGoldGlass) and by account.js when the user
 * toggles the UI mode.
 *
 * Architecture (§3.A):
 *   - Raw WebGL1 full-screen quad; no Three.js dependency.
 *   - Pauses #bgCanvas / #threeCanvas (via window._bgPaused) while active.
 *   - Falls back gracefully to the CSS gradient defined for
 *     body[data-ui-mode="liquidGoldGlass"] when WebGL is unavailable.
 *
 * Quality tiers (§3.D — fallback ladder):
 *   2 = high   — domain-warp FBM + shimmer sparkle
 *   1 = medium — simple 2-octave FBM, shimmer off
 *   0 = low    — time frozen (static gradient-in-WebGL), shimmer off
 * Auto-selected from average FPS over the first 2 seconds.
 */

// ── Constants ────────────────────────────────────────────────────────────────
const _CANVAS_ID      = "lgShaderCanvas";
const _DPR_CAP        = 0.75;      // §3.D: cap DPR to 0.75× for laptop safety
const _FPS_MONITOR_MS = 2000;      // §3.D: auto-detect window
const _FPS_MED_THRESH = 40;        // below → medium
const _FPS_LOW_THRESH = 25;        // below → low (freeze)
const _FLOW_SPEED     = 0.28;      // uniform: base fluid speed

// ── Module state ──────────────────────────────────────────────────────────────
let _gl           = null;
let _canvas       = null;
let _prog         = null;
let _rafId        = null;
let _running      = false;
let _startTime    = 0;
let _lastTs       = 0;
let _qualityTier  = 2;
let _fpsCheckDone  = false;
let _fpsCheckStart = 0;
let _fpsSamples   = [];
let _frozenTime   = 0;     // elapsed-time value frozen at quality=0

// Input state
let _mouseX = 0, _mouseY = 0;
let _scrollY = 0;
let _pageVisible = document.visibilityState === "visible";

// Uniform locations (cached after program link)
let _uTime, _uResolution, _uFlowSpeed, _uGoldIntensity;
let _uContrast, _uShimmerStrength, _uMouse, _uQuality;

// ── Event handlers (stable refs for cleanup) ─────────────────────────────────
const _onMouseMove = (e) => {
    _mouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
    _mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
};
const _onScroll = () => { _scrollY = window.scrollY; };
const _onVis    = () => { _pageVisible = document.visibilityState === "visible"; };
const _onResize = () => _resize();

// ── Vertex shader ─────────────────────────────────────────────────────────────
// Full-screen triangle-strip quad; vUv = [0,1]² UV
const _VERT = `
  attribute vec2 aPos;
  varying   vec2 vUv;
  void main() {
    vUv         = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
// Domain-warped value noise → 5-stop Liquid Gold Glass palette.
// Max 2 FBM octaves per pass (§3.C: laptop-GPU safe).
const _FRAG = `
  precision mediump float;

  varying vec2  vUv;
  uniform float uTime;
  uniform vec2  uResolution;
  uniform float uFlowSpeed;
  uniform float uGoldIntensity;
  uniform float uContrast;
  uniform float uShimmerStrength;
  uniform vec2  uMouse;
  uniform int   uQuality;

  /* ── Value noise (hash-based) ──────────────────────────────── */
  float hash21(vec2 p) {
    p  = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i),                   hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  /* 2-octave FBM — §3.C: capped for mid-tier GPU safety */
  float fbm2(vec2 p) {
    return 0.5000 * vnoise(p)
         + 0.2500 * vnoise(p * 2.03 + vec2(1.7, 9.2));
  }

  /* Domain-warp FBM — high quality only (§3.C) */
  float warpFbm(vec2 p) {
    vec2 q = vec2(fbm2(p),               fbm2(p + vec2(5.2, 1.3)));
    vec2 r = vec2(fbm2(p + 1.2 * q),     fbm2(p + 1.2 * q + vec2(8.3, 2.8)));
    return fbm2(p + 1.6 * r);
  }

  /* ── 5-stop Liquid Gold Glass palette (§2.1) ───────────────── */
  vec3 goldPalette(float t) {
    vec3 c0 = vec3(0.020, 0.012, 0.027); /* #050307 — deep black-violet */
    vec3 c1 = vec3(0.071, 0.043, 0.031); /* #120b08 — dark brown        */
    vec3 c2 = vec3(0.478, 0.302, 0.110); /* #7a4d1c — molten gold dark  */
    vec3 c3 = vec3(0.722, 0.467, 0.184); /* #b8772f — amber gold        */
    vec3 c4 = vec3(0.906, 0.722, 0.431); /* #e7b86e — highlight gold    */
    vec3 vl = vec3(0.431, 0.337, 0.812); /* #6e56cf — violet accent     */

    float s = clamp(t, 0.0, 1.0);
    vec3  col;
    if      (s < 0.25) col = mix(c0, c1, s           / 0.25);
    else if (s < 0.45) col = mix(c1, c2, (s - 0.25)  / 0.20);
    else if (s < 0.70) col = mix(c2, c3, (s - 0.45)  / 0.25);
    else               col = mix(c3, c4, (s - 0.70)  / 0.30);

    /* Violet tint bleeds into the darkest shadows (§2.3 key-light model) */
    col += vl * 0.06 * pow(max(1.0 - s, 0.0), 2.5);
    return col;
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2  p      = vec2(vUv.x * aspect, vUv.y);
    float t      = uTime * uFlowSpeed;

    /* §2.5 Liquid Gravity: downward + slight lateral drift */
    p.y -= t * 0.040;
    p.x += t * 0.015;

    /* §3.A: very subtle mouse influence (capped) */
    p   += uMouse * 0.040;

    /* Noise field — quality-gated (§3.D) */
    float n;
    if (uQuality >= 2) {
      n = warpFbm(p * 1.8);
    } else {
      n = fbm2(p * 1.8);
    }

    /* Contrast pump */
    n = pow(max(n, 0.0), 1.0 / max(uContrast, 0.01));

    /* Gold intensity — controls how saturated the gold band is */
    float g = mix(n * 0.55, n, uGoldIntensity);

    vec3 col = goldPalette(g);

    /* §3.C Shimmer — noise-threshold sparkle, disabled at medium/low */
    if (uQuality >= 1 && uShimmerStrength > 0.001) {
      float sh      = vnoise(p * 16.0 + vec2(t * 0.50, t * 0.38));
      float sparkle = step(0.86, sh) * uShimmerStrength;
      col += vec3(0.95, 0.88, 0.72) * sparkle * 0.22;
    }

    /* Radial vignette (§2.3 top-left key + low bounce) */
    vec2  vig = vUv - 0.5;
    float v   = 1.0 - dot(vig, vig) * 1.80;
    col *= max(v, 0.0);

    /* §2.5: top-lit — brightest at top, gravity-heavy at bottom */
    col *= 0.84 + (1.0 - vUv.y) * 0.22;

    gl_FragColor = vec4(col, 0.94);
  }
`;

// ── WebGL helpers ─────────────────────────────────────────────────────────────
function _makeShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("[lgBG] Shader compile:", gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function _makeProgram(gl) {
    const vs = _makeShader(gl, gl.VERTEX_SHADER,   _VERT);
    const fs = _makeShader(gl, gl.FRAGMENT_SHADER, _FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("[lgBG] Program link:", gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
}

function _resize() {
    if (!_canvas || !_gl) return;
    const dpr = Math.min(devicePixelRatio || 1, _DPR_CAP);
    const w   = Math.floor(window.innerWidth  * dpr);
    const h   = Math.floor(window.innerHeight * dpr);
    if (_canvas.width !== w || _canvas.height !== h) {
        _canvas.width  = w;
        _canvas.height = h;
        _gl.viewport(0, 0, w, h);
    }
}

// ── Render loop ───────────────────────────────────────────────────────────────
function _frame(ts) {
    if (!_running) return;
    _rafId = requestAnimationFrame(_frame);

    // §3.D: suspend when tab hidden or classic backgrounds have control
    if (!_pageVisible || window._bgPaused === "classic") return;

    const elapsed = (ts - _startTime) / 1000; // seconds
    const delta   = ts - _lastTs;
    _lastTs = ts;

    // §3.D: FPS quality auto-detection (first _FPS_MONITOR_MS ms)
    if (!_fpsCheckDone) {
        if (!_fpsCheckStart) _fpsCheckStart = ts;
        if (delta > 0 && delta < 500) _fpsSamples.push(1000 / delta);
        if (ts - _fpsCheckStart >= _FPS_MONITOR_MS && _fpsSamples.length >= 5) {
            const avg = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;
            if      (avg < _FPS_LOW_THRESH) { _qualityTier = 0; _frozenTime = elapsed; }
            else if (avg < _FPS_MED_THRESH) { _qualityTier = 1; }
            // else keep 2 (high)
            _gl.uniform1i(_uQuality,          _qualityTier);
            _gl.uniform1f(_uShimmerStrength,  _qualityTier >= 2 ? 0.85 : 0.0);
            _fpsCheckDone = true;
            _fpsSamples   = []; // free
        }
    }

    // §3.D: freeze time at quality=0 (static gradient via WebGL)
    const uTime = (_qualityTier === 0) ? _frozenTime : elapsed;

    _resize();

    const gl = _gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(_uTime, uTime);
    gl.uniform2f(_uResolution, _canvas.width, _canvas.height);
    gl.uniform2f(_uMouse, _mouseX, _mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialises and starts the Liquid Gold Glass WebGL background.
 * Creates a dedicated <canvas id="lgShaderCanvas"> in the DOM and
 * suspends the classic bgCanvas/threeCanvas while active.
 *
 * No-op if reduced-motion is preferred (CSS gradient is the baseline).
 * Falls back silently to CSS gradient if WebGL is unavailable.
 */
export function startLgBackground() {
    if (_running) return;

    // §3.C Shimmer: disabled in reduced-motion mode
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Create shader canvas
    _canvas = document.createElement("canvas");
    _canvas.id = _CANVAS_ID;
    _canvas.setAttribute("aria-hidden", "true");
    Object.assign(_canvas.style, {
        position:      "fixed",
        inset:         "0",
        width:         "100%",
        height:        "100%",
        zIndex:        "var(--z-bg, -2)",
        pointerEvents: "none",
        display:       "block",
    });
    document.body.insertBefore(_canvas, document.body.firstChild);

    // Obtain WebGL1 context (§3.A: raw WebGL, no Three.js)
    _gl = _canvas.getContext("webgl", {
        alpha:              true,
        antialias:          false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
    });

    if (!_gl) {
        // §3.D Final fallback: CSS gradient already covers this via
        // body[data-ui-mode="liquidGoldGlass"] background rules.
        console.warn("[lgBG] WebGL unavailable — CSS gradient fallback active.");
        _canvas.remove();
        _canvas = null;
        return;
    }

    _prog = _makeProgram(_gl);
    if (!_prog) {
        _canvas.remove();
        _canvas = null;
        _gl     = null;
        return;
    }

    _gl.useProgram(_prog);

    // Full-screen quad as triangle strip: (-1,-1), (1,-1), (-1,1), (1,1)
    const vbuf = _gl.createBuffer();
    _gl.bindBuffer(_gl.ARRAY_BUFFER, vbuf);
    _gl.bufferData(_gl.ARRAY_BUFFER,
        new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
        _gl.STATIC_DRAW);
    const aPosLoc = _gl.getAttribLocation(_prog, "aPos");
    _gl.enableVertexAttribArray(aPosLoc);
    _gl.vertexAttribPointer(aPosLoc, 2, _gl.FLOAT, false, 0, 0);

    // Alpha blending (canvas alpha:true)
    _gl.enable(_gl.BLEND);
    _gl.blendFunc(_gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA);

    // Cache uniform locations
    _uTime            = _gl.getUniformLocation(_prog, "uTime");
    _uResolution      = _gl.getUniformLocation(_prog, "uResolution");
    _uFlowSpeed       = _gl.getUniformLocation(_prog, "uFlowSpeed");
    _uGoldIntensity   = _gl.getUniformLocation(_prog, "uGoldIntensity");
    _uContrast        = _gl.getUniformLocation(_prog, "uContrast");
    _uShimmerStrength = _gl.getUniformLocation(_prog, "uShimmerStrength");
    _uMouse           = _gl.getUniformLocation(_prog, "uMouse");
    _uQuality         = _gl.getUniformLocation(_prog, "uQuality");

    // §7: Start at medium quality (tier 1) on small laptop screens (viewport height < 780).
    // The FPS monitor can only lower quality further, never raise it, so this sets a safe ceiling.
    _qualityTier = (window.innerHeight < 780) ? 1 : 2;

    // Static uniforms (set once)
    _gl.uniform1f(_uFlowSpeed,      _FLOW_SPEED);
    _gl.uniform1f(_uGoldIntensity,  0.82);
    _gl.uniform1f(_uContrast,       0.72);
    // Shimmer: disabled when reduced-motion is preferred (§3.C) or quality is below high (§7)
    _gl.uniform1f(_uShimmerStrength, (reducedMotion || _qualityTier < 2) ? 0.0 : 0.85);
    _gl.uniform1i(_uQuality,        _qualityTier);

    _resize();

    // §3.D: pause classic backgrounds while LGG shader is active.
    // Using a sentinel string so stopLgBackground can distinguish our pause
    // from a game-iframe pause (_bgPaused truthy either way).
    document.getElementById("bgCanvas")?.style.setProperty("display", "none");
    document.getElementById("threeCanvas")?.style.setProperty("display", "none");
    window._bgPaused = "lgShader";

    // Event listeners
    window.addEventListener("mousemove",          _onMouseMove, { passive: true });
    window.addEventListener("scroll",             _onScroll,    { passive: true });
    document.addEventListener("visibilitychange", _onVis);
    window.addEventListener("resize",             _onResize,    { passive: true });

    // Reset FPS monitoring state (quality tier already set above)
    _running       = true;
    _startTime     = performance.now();
    _lastTs        = _startTime;
    _fpsCheckDone  = false;
    _fpsCheckStart = 0;
    _fpsSamples    = [];

    _rafId = requestAnimationFrame(_frame);
}

/**
 * Stops the LGG shader, removes its canvas, and restores the classic
 * bgCanvas/threeCanvas backgrounds.
 */
export function stopLgBackground() {
    if (!_running) return;
    _running = false;

    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }

    _canvas?.remove();
    _canvas = null;
    _gl     = null;
    _prog   = null;

    // Restore classic backgrounds (only if we were the ones who paused them)
    if (window._bgPaused === "lgShader") {
        document.getElementById("bgCanvas")?.style.removeProperty("display");
        document.getElementById("threeCanvas")?.style.removeProperty("display");
        window._bgPaused = false;
    }

    // Remove event listeners
    window.removeEventListener("mousemove",          _onMouseMove);
    window.removeEventListener("scroll",             _onScroll);
    document.removeEventListener("visibilitychange", _onVis);
    window.removeEventListener("resize",             _onResize);
}
