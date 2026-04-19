# UI Upgrade Plan — “Liquid Gold Glass” (Opt-In New UI)

## 1. Executive Summary

The current update feels inconsistent because it mixes premium effects with unstable fundamentals. The redesign will keep **Classic UI as default** and introduce a fully opt-in **New UI mode** that feels materially different: layered glass panels over a shader-driven molten-gold background, deep contrast, and slow luxury motion tuned for small laptops.

Why the current UI failed:
- Login can appear invisible because the login card starts at `opacity:0` inline and relies on GSAP/mutation timing to become visible (`/home/runner/work/Math/Math/index.html`).
- Navbar layering is fragile: many unrelated z-index values and transform-heavy cards create stacking conflicts (`/home/runner/work/Math/Math/style.css`, `/home/runner/work/Math/Math/js/links.js`).
- Visual direction is fragmented (multiple color systems, repeated overrides, many `!important` blocks), so the UI feels busy instead of premium.

What makes this upgrade significant:
- A unified visual system (tokens, layer rules, motion rules) replacing ad-hoc styling.
- A dedicated visual engine (WebGL shader background + glass DOM layers) with strict performance budgets.
- Distinct interaction grammar (3D tilt, magnetic actions, glow diffusion, parallax, micro-feedback) designed as one system, not isolated effects.

---

## 2. Creative Vision System

### 2.1 Color System (Liquid Gold Glass Palette)

Define semantic tokens (used only in New UI scope):
- `--lg-bg-0: #050307` (deep black-violet base)
- `--lg-bg-1: #120b08` (deep brown-black)
- `--lg-bg-2: #1e140f` (mid brown)
- `--lg-gold-0: #7a4d1c` (dark molten gold)
- `--lg-gold-1: #b8772f` (amber-gold core)
- `--lg-gold-2: #e7b86e` (highlight gold)
- `--lg-gold-3: #f6dfb0` (specular edge)
- `--lg-accent-violet: #6e56cf` (cool premium contrast)
- `--lg-text-primary: #f8f4ec`
- `--lg-text-secondary: #bfb4a2`
- `--lg-border-glass: rgba(255, 232, 198, 0.22)`
- `--lg-shadow-deep: rgba(0, 0, 0, 0.56)`

Usage ratios:
- 70% dark base (black/brown)
- 20% gold gradients
- 10% highlight/specular/accent

### 2.2 Glassmorphism Rules

- Blur tiers:
  - Tier A (cards): `14px–18px`
  - Tier B (modals/nav): `20px–28px`
  - Tier C (hero overlays): `30px+` only for large containers
- Transparency:
  - Panel fill alpha range: `0.38–0.72` (never fully opaque in New UI)
  - Border alpha: `0.16–0.30`
- Layer stacking logic:
  - Every glass container has: base tint + inner highlight + edge border + soft drop shadow
  - No isolated random glow without source lighting logic

### 2.3 Lighting & Shadow Philosophy

- Light source model: top-left key light + low-intensity bottom bounce.
- Shadows are soft and wide (luxury), not sharp (gaming UI).
- Gold reflections must appear strongest on edges, weakest at center.

### 2.4 Depth Hierarchy

- Background (L0): shader fluid field
- Atmospheric layer (L1): subtle vignette/noise veil
- Structural UI (L2): cards, panels, sections
- Navigation + controls (L3): sticky/fixed shell, highest non-modal layer
- Modal/dialog (L4): exclusive interaction layer

### 2.5 Motion Philosophy (Liquid Gravity)

- Motion style: slow, viscous, gravity-led.
- Durations:
  - Ambient loops: `8s–24s`
  - Hover transitions: `180–320ms`
  - Page mode transitions: `420–700ms`
- Easing family: cubic-bezier curves with soft settle (`0.16,1,0.3,1`) and slow sine for ambient loops.
- Animation placement:
  - Animated: background fluid, specular sweeps, hover depth, page transition continuity.
  - Static: dense text areas, long forms, critical data rows.
- Overuse prevention:
  - Max 1 ambient loop per major region.
  - Disable shimmer on dense repeated lists after first viewport screen.

---

## 3. Advanced Visual Engine (Three.js + Shaders)

### A. Liquid Background System

Architecture:
- Add a dedicated New UI WebGL canvas container under app chrome.
- Keep existing content DOM separate; WebGL is purely atmospheric.
- Render full-screen quad with fragment shader (not heavy mesh scenes).

Shader design:
- Blend 4–5 color stops (black/brown/gold/highlight violet accent).
- Use layered simplex/perlin noise fields:
  - Low frequency for mass movement.
  - Mid frequency for channel flow.
  - Very low amplitude high frequency for micro shimmer.
- Direction bias downward + slight lateral drift to mimic gravity ooze.

Core uniforms:
- `uTime`, `uResolution`
- `uFlowSpeed`, `uFlowDirection`
- `uGoldIntensity`, `uContrast`, `uShimmerStrength`
- `uMouseInfluence` (very subtle, capped)

Laptop performance:
- Base internal render scale: 0.75 device pixel ratio cap.
- Dynamic quality steps: high/medium/low profile chosen on first 2 seconds by frame timing.
- Suspend background render when tab hidden or modal/video/iframe heavy usage is active.

### B. Glass Panel Rendering

- DOM panels remain native HTML/CSS for accessibility and form stability.
- WebGL sits beneath; glass illusion comes from:
  - backdrop blur
  - alpha-tinted panel gradients
  - inner specular pseudo-element
  - optional sampled “light streak” mask synced with shader phase
- Keep panel and canvas separated to avoid expensive readbacks.

### C. Shader Behavior

- Flow function: domain-warped simplex noise with 2 octaves max (small-laptop safe).
- Highlights:
  - Fresnel-like edge brightening using normal approximation from noise gradient.
  - Soft anisotropic streaks moving slower than base flow.
- Shimmer:
  - Noise-threshold sparkle with low alpha and long period.
  - Disabled in reduced-motion mode.

### D. Performance Strategy

Targets:
- 60 FPS on mid-tier laptop GPUs.
- Acceptable fallback floor: 30 FPS stable.

Fallback ladder:
1. Reduce render scale.
2. Reduce noise octaves / disable shimmer.
3. Freeze fluid animation and keep static gradient.
4. Final fallback to CSS gradient background if WebGL unsupported.

Loading strategy:
- Lazy-load Three.js + shader bundle only after user opts into New UI.
- Defer until idle/interaction-safe.
- Cache mode in local storage/backend preference.

---

## 4. Technical Fixes (Critical)

### A. Broken Login Screen

Root-cause analysis:
- Login card is initially forced to hidden visual state (`opacity:0`, transformed inline).
- Visibility depends on JS animation sequence and GSAP readiness, creating failure paths where modal exists but content remains invisible.
- Multiple animated layers increase risk of timing race and perceived blank state.

Fix strategy:
1. Make login visible by default in CSS (non-animated baseline).
2. Apply entry animation as progressive enhancement only when animation engine is confirmed ready.
3. Add deterministic login state class (`.is-auth-logged-out`) on `<body>` to drive shell visibility.
4. Add robust error/empty-state fallback if enhancement scripts fail.

Login redesign:
- Centered glass card with fixed min/max dimensions for small laptops.
- Background: molten-gold shader (or static premium fallback).
- Inputs:
  - Focus ring with gold halo + subtle reflection sweep
  - Clear hover/focus/disabled/error states with consistent token colors
- Entry transition:
  - Card fade+rise (`420ms`)
  - Child stagger (`40ms` each)
  - Reduced-motion path: instant reveal

### B. Navbar Scroll / Z-Index Bug

Why overlap occurs:
- Header uses moderate z-index while transformed 3D elements and mixed high z-index components create competing stacking contexts.
- No enforced global z-index scale; arbitrary values across CSS and utility classes conflict.
- Main content lacks explicit stacking isolation boundaries.

Structural fixes:
1. Introduce global z-index tokens (actual implemented values):
   - `--z-bg: -2` (fixed background canvases)
   - `--z-orb: -1` (decorative background orbs)
   - `--z-content: 10` (regular page content)
   - `--z-nav: 100` (sticky header)
   - `--z-nav-dropdown: 150` (nav dropdowns, within header stacking context)
   - `--z-modal: 400` (dialogs / login modal)
   - `--z-toast: 500` (toast notifications)
   - `--z-tour: 10100` (onboarding tour tooltips — must match vendor onboard.css which uses 10000/10001)
2. Navbar strategy:
   - Use `position: sticky; top: 0; z-index: var(--z-nav);`
   - Keep nav inside isolated app shell.
3. Scroll container rules:
   - Body handles vertical scroll.
   - Avoid nested scroll on primary content regions unless intentional.
4. Overflow handling:
   - Add `isolation: isolate` on `#appContainer` to contain 3D card transforms.
   - Ensure dropdowns use `var(--z-nav-dropdown)` only.

---

## 5. Interactive System Design

### A. 3D Mouse Tracking Tilt Cards

Behavior logic:
- Compute cursor delta from card center.
- Map to rotateX/rotateY with capped angles.
- Add mild translateZ to exaggerate depth.
- Move reflection hotspot (`--mx`, `--my`) with cursor.

Trigger:
- Desktop pointer fine mode only.
- Disabled on touch and reduced-motion.

Motion:
- Enter follow: fast (`50–90ms` response loop)
- Leave settle: spring-like (`220–320ms`)

### B. Additional Interactions (Required)

#### 1) Hover-Driven Glow Diffusion
- Trigger: pointer enter on premium buttons/cards.
- Logic: radial glow expands from cursor, fades to edge.
- Timing: in `180ms`, out `240ms`, eased.

#### 2) Magnetic Buttons
- Trigger: pointer proximity within threshold box.
- Logic: button translates slightly toward cursor; text/icon lag at lower amplitude.
- Timing: live tracking + release settle `200ms`.

#### 3) Smooth Page Transitions
- Trigger: tab/page switch in New UI mode.
- Logic: outgoing panel blur/fade down; incoming panel rise/focus in.
- Timing: `420–550ms`; preserve scroll context when appropriate.

#### 4) Input Micro-Interactions
- Trigger: focus, valid, invalid, submit.
- Logic:
  - Focus: edge glow + top sheen shift
  - Valid: short gold pulse
  - Error: warm-red shake-lite + border alert
- Timing: `120–260ms`.

#### 5) Scroll-Based Depth / Parallax
- Trigger: vertical scroll.
- Logic: background fluid phase offset + foreground section parallax at low ratio.
- Limits: subtle movement only; disable under low-performance profile.

---

## 6. Feature Logic

### A. “New UI” Announcement Banner

Requirements:
- Persistent until dismissed.
- Dismiss state stored per user (fallback local storage for guest/session edge).
- Matches glass-luxury styling with restrained animation.

Behavior:
- Entrance: slide/fade from top (`380–480ms`).
- Dismiss: collapse + fade with height transition.
- Reopen option in account settings (“Show New UI banner again”).

### B. Opt-In UI Toggle (Account Settings)

Core requirement:
- **Classic UI remains default. New UI is opt-in only.**

Mode model:
- `uiMode = "classic" | "liquidGoldGlass"`
- Source of truth priority:
  1. User profile field (if authenticated)
  2. localStorage fallback
  3. default classic

Transition behavior:
- On toggle, apply root mode class/data attribute.
- Crossfade shell tokens + animate key surfaces; avoid full app re-mount.
- Keep both style scopes available but isolated (`[data-ui-mode="..."]`).

Persistence:
- Write preference immediately to local cache.
- Sync to backend in background; retry on failure.

---

## 7. Responsive Strategy (Small Laptop Focus)

Target viewport baseline:
- 1280×720 and 1366×768 first-class support.

Rules:
- Use compact spacing scale in New UI mode (`4/8/12/16/20/24` rhythm).
- Keep navbar single-row where possible; degrade secondary actions to overflow menu.
- Limit glass blur and shadow spread at narrow heights to preserve readability.
- Avoid clutter:
  - One primary CTA per section.
  - Collapse decorative badges on constrained widths.

WebGL + UI layering:
- Keep canvas fixed full-screen behind content.
- Reduce shader quality when viewport height < 780.
- Clamp card max heights to avoid fold overflow.

---

## 8. Implementation Roadmap

### Phase 1: Bug Fixes + Layout Stabilization
- Fix login visibility baseline independent of animation libraries.
- Enforce z-index token scale and stacking isolation.
- Stabilize navbar + dropdown + transformed card coexistence.

### Phase 2: Design System + Base Components
- Introduce Liquid Gold Glass token set.
- Build shared glass primitives (panel, button, input, badge).
- Scope New UI styles under explicit mode selector.

### Phase 3: WebGL Integration
- Add lazy-loaded Three.js shader background module.
- Implement quality tiers and fallback ladder.
- Integrate reduced-motion and visibility pause controls.

### Phase 4: Interaction Layer
- Deploy standardized 3D tilt, glow diffusion, magnetic button, tab/page transitions, micro-interactions.
- Add motion guardrails and performance cutoffs.

### Phase 5: Feature Rollout (Toggle + Banner)
- Release account toggle with persistence model.
- Release dismissible announcement banner tied to preference state.
- Keep Classic UI default until quality thresholds pass.

### Phase 6: Double Check for Issues
- Validate login, auth states, and UI mode switching across reloads.
- Validate navbar layering under heavy scroll and hover transforms.
- Validate FPS targets and fallback activation on low-end laptops.
- Run visual regression and interaction QA before broad enablement.

---

## 9. Risks & Mitigation

### Risk: WebGL/Shader Performance Drops
- Mitigation: dynamic quality tiers, capped DPR, pause on hidden tab, static gradient fallback.

### Risk: Over-Animation Hurts Premium Feel
- Mitigation: motion budget per view, ambient-only loops, reduced-motion compliance, strict transition durations.

### Risk: Layering Regressions Reappear
- Mitigation: centralized z-index tokens, stacking-context audit checklist, isolate transformed elements.

### Risk: Toggle Transition Jank
- Mitigation: root-level mode class switch + token interpolation, avoid full rerender, preload critical assets.

### Risk: Style Drift Between Classic and New UI
- Mitigation: explicit scoped styles, shared component contracts, no unscoped global overrides for New UI tokens.
