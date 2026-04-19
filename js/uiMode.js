/**
 * uiMode.js — UI Mode management
 *
 * Source of truth priority (matches UI_UPGRADE_PLAN.md §6.B):
 *   1. User Firestore profile field `uiMode` (applied by auth.js after login)
 *   2. localStorage cache (applied immediately on page load via inline script)
 *   3. Default: "classic"
 *
 * Valid modes: "classic" | "liquidGoldGlass"
 */

export const VALID_MODES = /** @type {const} */ (["classic", "liquidGoldGlass"]);
const STORAGE_KEY = "mathKatyUiMode";

/**
 * Returns the currently applied mode from body[data-ui-mode].
 * Falls back to the localStorage value, then "classic".
 * @returns {"classic"|"liquidGoldGlass"}
 */
export function getCurrentUiMode() {
  const attr = document.body.dataset.uiMode;
  if (VALID_MODES.includes(attr)) return /** @type {any} */ (attr);
  return getStoredUiMode();
}

/**
 * Returns the mode stored in localStorage, or "classic" if absent/invalid.
 * @returns {"classic"|"liquidGoldGlass"}
 */
export function getStoredUiMode() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID_MODES.includes(stored) ? /** @type {any} */ (stored) : "classic";
}

/**
 * Applies `mode` to the document immediately and writes it to localStorage.
 * Safe to call multiple times; ignores invalid values.
 * @param {"classic"|"liquidGoldGlass"} mode
 */
export function applyUiMode(mode) {
  const safe = VALID_MODES.includes(mode) ? mode : "classic";
  document.body.dataset.uiMode = safe;
  try {
    localStorage.setItem(STORAGE_KEY, safe);
  } catch (_) {
    // Private-browsing or storage quota — not fatal.
  }
}

/**
 * Toggles between "classic" and "liquidGoldGlass" and returns the new mode.
 * Does NOT sync to Firestore — callers that have a uid should do that themselves.
 * @returns {"classic"|"liquidGoldGlass"}
 */
export function toggleUiMode() {
  const next = getCurrentUiMode() === "classic" ? "liquidGoldGlass" : "classic";
  applyUiMode(next);
  return next;
}
