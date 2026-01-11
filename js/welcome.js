// Controls the full-screen welcome animation shown to returning users after sign-in
export function showWelcome(name = "Learner"){
  const overlay = document.getElementById("welcomeOverlay");
  const card = document.getElementById("welcomeCard");
  const logo = document.getElementById("welcomeLogo");
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");

  if(!overlay || !card || !logo) return;
  title.textContent = `Welcome back, ${name}!`;
  sub.textContent = "Great to see you — keep up the streak!";
  overlay.classList.add("show");

  // animate
  card.classList.add("animate");
  logo.classList.add("animate");

  // show for 2000ms then fade (fade implemented by removing show after brief delay)
  setTimeout(()=>{
    card.classList.remove("animate");
    logo.classList.remove("animate");
    overlay.classList.remove("show");
  }, 2000);
}
