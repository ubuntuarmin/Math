// Controls the full-screen welcome animation shown to returning users after sign-in
export function showWelcome(name = "Learner") {
  const overlay = document.getElementById("welcomeOverlay");
  const card = document.getElementById("welcomeCard");
  const logo = document.getElementById("welcomeLogo");
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");

  if (!overlay || !card || !logo || !title || !sub) return;

  // Set copy
  title.textContent = `Welcome back, ${name}!`;
  sub.textContent = "Refer the site to friends for a bonus!";

  // Clear previous state if any
  overlay.classList.remove("hide");
  card.classList.remove("enter", "idle", "exit");
  logo.classList.remove("enter", "idle", "exit");

  // Show overlay and kick off enter animations
  overlay.classList.add("show");

  // Force reflow to ensure animations restart when called multiple times
  // eslint-disable-next-line no-unused-expressions
  void card.offsetWidth;

  card.classList.add("enter");
  logo.classList.add("enter");

  // When enter animation ends, switch to idle float
  const onCardEnterEnd = (e) => {
    if (e.target !== card) return;
    card.removeEventListener("animationend", onCardEnterEnd);
    card.classList.remove("enter");
    card.classList.add("idle");
    logo.classList.remove("enter");
    logo.classList.add("idle");
  };

  card.addEventListener("animationend", onCardEnterEnd);

  // Total visible time: ~3.0–3.2s
  //  - ~0.8s enter
  //  - ~1.8–2.0s idle
  // Then trigger exit animations
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

      // Ensure overlay is not capturing pointer events when hidden
      overlay.style.display = "none";

      // Small async to allow future re-show
      setTimeout(() => {
        overlay.style.display = "";
      }, 10);
    };

    card.addEventListener("animationend", onCardExitEnd);
  }, visibleDuration);
}
