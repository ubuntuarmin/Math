export function tier(totalEarned) {
    if (totalEarned >= 5000) return "Diamond";
    if (totalEarned >= 2000) return "Platinum";
    if (totalEarned >= 1000) return "Gold";
    if (totalEarned >= 500) return "Silver";
    return "Basic";
}

export function showPage(page) {
    const sections = ["dashboard", "tokens", "account", "leaderboard", "referral"];
    sections.forEach(p => {
        const el = document.getElementById(p + "Page");
        if (el) el.classList.add("hidden");
    });
    const target = document.getElementById(page + "Page");
    if (target) target.classList.remove("hidden");

    if (page === 'referral' && window.renderReferral) {
        window.renderReferral();
    }
}
