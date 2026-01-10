// Controls the welcome animation overlay
export function showWelcome(name = "Learner"){
  const overlay = document.getElementById("welcomeOverlay");
  const card = document.getElementById("welcomeCard");
  const logo = document.getElementById("welcomeLogo");
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");

  if(!overlay || !card || !logo) return;
  title.textContent = `Welcome, ${name}!`;
  sub.textContent = "Great to see you — let's learn some math!";
  overlay.classList.add("show");
  // trigger animations
  card.classList.add("animate");
  logo.classList.add("animate");

  // hide after 2.2s
  setTimeout(()=>{
    card.classList.remove("animate");
    logo.classList.remove("animate");
    overlay.classList.remove("show");
  }, 2200);
}
