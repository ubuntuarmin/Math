// Full-screen welcome animation shown to returning users (not shown on reload or immediately after signup)
export function showWelcome(name = "Learner"){
  const overlay = document.getElementById("welcomeOverlay");
  const card = document.getElementById("welcomeCard");
  const logo = document.getElementById("welcomeLogo");
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");
  if(!overlay || !card) return;

  title.textContent = `Welcome back, ${name || "Learner"}!`;
  sub.textContent = "Great to see you — keep up the streak!";
  overlay.classList.add("show");

  // entrance animation
  card.classList.add("animate");
  logo?.classList.add("animate");

  // auto-hide after 2s
  setTimeout(()=>{
    card.classList.remove("animate");
    logo?.classList.remove("animate");
    overlay.classList.remove("show");
  }, 2000);
}
