const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
]);

export function normalizeUrlForDedup(rawUrl) {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) return "";

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_) {
    return "";
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  let pathname = parsed.pathname || "/";
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  parsed.pathname = pathname || "/";

  const kept = [];
  parsed.searchParams.forEach((value, key) => {
    const k = key.toLowerCase();
    const isTrackingParam = TRACKING_PARAM_PREFIXES.some(prefix => k.startsWith(prefix)) || TRACKING_PARAM_KEYS.has(k);
    if (!isTrackingParam) kept.push([key, value]);
  });

  kept.sort(([ka, va], [kb, vb]) => {
    if (ka === kb) return va.localeCompare(vb);
    return ka.localeCompare(kb);
  });

  parsed.search = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  return parsed.toString();
}

function fallbackHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function buildCanonicalUrlKey(canonicalUrl) {
  const value = String(canonicalUrl || "");
  if (!value) return "";
  if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) return `u_${fallbackHash(value)}`;

  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return `u_${hex}`;
}
