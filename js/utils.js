export function tier(totalEarned){
  if(totalEarned>=1000) return "VIP";
  if(totalEarned>=800) return "Gold";
  if(totalEarned>=400) return "Silver";
  return "Basic";
}

export function showPage(page){
  ["dashboard","tokens","account","leaderboard"].forEach(p=>{
    const el = document.getElementById(p+"Page");
    if(el) el.classList.add("hidden");
  });
  const target = document.getElementById(page+"Page");
  if(target) target.classList.remove("hidden");
}
