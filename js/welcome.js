// Very animated full-screen welcome shown after sign-in
let welcomePlaying = false;

// Controls the full-screen welcome animation shown to returning users after sign-in
export function showWelcome(name = "Learner") {
  const overlay = document.getElementById("welcomeOverlay");
  const card = document.getElementById("welcomeCard");
  const logo = document.getElementById("welcomeLogo");
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");

  if (!overlay || !card || !logo || !title || !sub) return;

  // Prevent double-play / flicker if called twice quickly
  if (welcomePlaying) return;
  welcomePlaying = true;

  // Set copy
  title.textContent = `Welcome back, ${name}!`;
  sub.textContent = "Refer the site to friends for a bonus!";

  // Reset previous state
  overlay.classList.remove("hide");
  card.classList.remove("enter", "idle", "exit");
  logo.classList.remove("enter", "idle", "exit");

  // Show overlay and kick off enter animations
  overlay.classList.add("show");

  // Force reflow so CSS animations restart even if classes were used before
  // eslint-disable-next-line no-unused-expressions
  void card.offsetWidth;

  card.classList.add("enter");
  logo.classList.add("enter");

  // Enter → idle
  const onCardEnterEnd = (e) => {
    if (e.target !== card) return;
    card.removeEventListener("animationend", onCardEnterEnd);
    card.classList.remove("enter");
    card.classList.add("idle");
    logo.classList.remove("enter");
    logo.classList.add("idle");
  };
  card.addEventListener("animationend", onCardEnterEnd);

  // Visible for ~2.8s total (including enter)
  const visibleDuration = 2800;

  setTimeout(() => {
    // Start exit animations
    card.classList.remove("idle");
    logo.classList.remove("idle");
    card.classList.add("exit");
    logo.classList.add("exit");
    overlay.classList.add("hide");

    const onCardExitEnd = (e) => {
      if (e.target !== card) return;
      card.removeEventListener("animationend", onCardExitEnd);

      // Fully hide and reset
      overlay.classList.remove("show", "hide");
      card.classList.remove("enter", "idle", "exit");
      logo.classList.remove("enter", "idle", "exit");
      welcomePlaying = false;
    };

    card.addEventListener("animationend", onCardExitEnd);
  }, visibleDuration);
}
