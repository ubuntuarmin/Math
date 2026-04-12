/**
 * TIER SETTINGS
 * Defines the lifetime credit requirements and per-purchase time bonuses.
 * All users get 30 free minutes per browser session (FREE_SESSION_MINUTES).
 * Buying more time costs 50 credits and adds limitMinutes to the session.
 */
export const FREE_SESSION_MINUTES = 30; // free minutes for everyone, regardless of rank

/**
 * ADMIN PROMOTION REQUIREMENTS
 * Admin is a separate rank above VIP, verified on each login.
 */
export const ADMIN_REQUIREMENTS = {
    minReferrals:   15,      // successful referrals needed
    minPlayMinutes: 1000,    // totalMinutes (play time) needed
    minCredits:     600,     // current credit balance needed
    vipDaysRequired: 5,      // must have been VIP for at least this many days
};

export const ADMIN_DEMOTION_CRITERIA = {
    maxMissedResponses: 3,   // downgrade after this many missed 48 h responses
    maxOfflineDays:     7,   // downgrade if not logged in for this many days
};

/**
 * Check whether a user meets all Admin promotion criteria.
 * @param {Object} userData  - Firestore user document data
 * @returns {boolean}
 */
export function isAdminEligible(userData) {
    if (!userData) return false;
    const referralCount = (userData.referrals || []).length;
    const playMinutes   = userData.totalMinutes || 0;
    const credits       = userData.credits || 0;

    if (referralCount < ADMIN_REQUIREMENTS.minReferrals)   return false;
    if (playMinutes   < ADMIN_REQUIREMENTS.minPlayMinutes) return false;
    if (credits       < ADMIN_REQUIREMENTS.minCredits)     return false;

    // Must already be VIP for at least ADMIN_REQUIREMENTS.vipDaysRequired days.
    // vipPromotedAt is set (once) the first time the user reaches VIP tier.
    const vipPromotedAt = userData.vipPromotedAt;
    if (!vipPromotedAt) return false;
    const vipMs = typeof vipPromotedAt.toMillis === "function"
        ? vipPromotedAt.toMillis()
        : Number(vipPromotedAt);
    const daysSinceVip = (Date.now() - vipMs) / (1000 * 60 * 60 * 24);
    if (daysSinceVip < ADMIN_REQUIREMENTS.vipDaysRequired) return false;

    return true;
}

export const TIER_CONFIG = {
    BASIC: {
        name: "Basic",
        minCredits: 0,
        limitMinutes: 45,     // minutes added per 50-credit time purchase
        color: "#94a3b8", // slate-400
        bg: "bg-slate-500/10",
        border: "border-slate-500/20"
    },
    SILVER: {
        name: "Silver",
        minCredits: 150,
        limitMinutes: 60,     // minutes added per 50-credit time purchase
        color: "#cbd5e1", // slate-300
        bg: "bg-indigo-500/10",
        border: "border-indigo-500/20"
    },
    GOLD: {
        name: "Gold",
        minCredits: 300,
        limitMinutes: 120,    // minutes added per 50-credit time purchase
        color: "#fbbf24", // amber-400
        bg: "bg-amber-500/10",
        border: "border-amber-500/20"
    },
    VIP: {
        name: "VIP",
        minCredits: 600,
        limitMinutes: 360,    // minutes added per 50-credit time purchase (6 hours)
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
        message: `${remaining} more credits to unlock ${next.name} (+${next.limitMinutes}m per time purchase)`
    };
}
