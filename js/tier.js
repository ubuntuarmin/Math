/**
 * TIER SETTINGS
 * Defines the lifetime credit requirements and daily time limits.
 */
export const TIER_CONFIG = {
    BASIC: {
        name: "Basic",
        minCredits: 0,
        limitMinutes: 45,
        color: "#94a3b8", // slate-400
        bg: "bg-slate-500/10",
        border: "border-slate-500/20"
    },
    SILVER: {
        name: "Silver",
        minCredits: 150,
        limitMinutes: 60,
        color: "#cbd5e1", // slate-300
        bg: "bg-indigo-500/10",
        border: "border-indigo-500/20"
    },
    GOLD: {
        name: "Gold",
        minCredits: 300,
        limitMinutes: 120,
        color: "#fbbf24", // amber-400
        bg: "bg-amber-500/10",
        border: "border-amber-500/20"
    },
    VIP: {
        name: "VIP",
        minCredits: 600,
        limitMinutes: 360, // 6 Hours
        color: "#e879f9", // fuchsia-400
        bg: "bg-fuchsia-500/10",
        border: "border-fuchsia-500/20"
    }
};

/**
 * Logic to determine user's tier based on TOTAL lifetime earnings
 */
export function calculateTier(totalEarned = 0) {
    if (totalEarned >= TIER_CONFIG.VIP.minCredits) return TIER_CONFIG.VIP;
    if (totalEarned >= TIER_CONFIG.GOLD.minCredits) return TIER_CONFIG.GOLD;
    if (totalEarned >= TIER_CONFIG.SILVER.minCredits) return TIER_CONFIG.SILVER;
    return TIER_CONFIG.BASIC;
}

/**
 * Logic to see how close they are to the next level
 */
export function getNextTierInfo(totalEarned = 0) {
    const current = calculateTier(totalEarned);
    
    let next = null;
    if (current.name === "Basic") next = TIER_CONFIG.SILVER;
    else if (current.name === "Silver") next = TIER_CONFIG.GOLD;
    else if (current.name === "Gold") next = TIER_CONFIG.VIP;

    if (!next) return { message: "Max Tier Reached!", remaining: 0 };

    const remaining = next.minCredits - totalEarned;
    return {
        nextName: next.name,
        remaining: remaining,
        nextLimit: next.limitMinutes,
        message: `${remaining} more credits to unlock ${next.name} (${next.limitMinutes}m limit)`
    };
}
