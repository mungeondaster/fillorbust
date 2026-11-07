// "Tap to Play" intro in front of the title screen.
//
// Browsers only allow sound after the player taps the page, so the game opens
// on the logo + card fan, big and centred over the falling cards, with a
// "Tap to Play" prompt. That tap starts the music (the page-wide unlockAudio
// listener in main.js catches it), and the logo zooms back down into its spot
// on the menu while the rest of the menu fades in around it.
//
// It's the menu's own logo, just moved: while the intro is up a transform
// carries it from its menu position to the middle of the screen; removing
// the transform (with a transition) flies it home.

export function startSplash(screen) {
  const logo = screen.querySelector(".title-logo");
  if (!logo) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const prompt = document.createElement("button");
  prompt.type = "button";
  prompt.className = "tap-to-play";
  prompt.textContent = "Tap to Play";
  const veil = document.createElement("div");
  veil.className = "splash-veil";
  veil.append(prompt);
  screen.append(veil);
  screen.classList.add("splash");

  // Where the logo sits on the menu vs. where the intro wants it.
  const place = () => {
    logo.style.transition = "none";
    logo.style.transform = "none";
    const r = logo.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min((vw * 0.92) / r.width, (vh * 0.56) / r.height, 2.1);
    const dx = vw / 2 - (r.left + r.width / 2);
    const dy = vh * 0.43 - (r.top + r.height / 2);
    logo.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  };
  place();
  window.addEventListener("resize", place);

  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.removeEventListener("resize", place);
    veil.classList.add("leaving");
    logo.style.transition = reduceMotion ? "none" : "transform 0.85s cubic-bezier(0.6, 0, 0.2, 1)";
    void logo.offsetWidth;
    logo.style.transform = "";
    screen.classList.add("splash-out");
    screen.classList.remove("splash");
    setTimeout(() => {
      veil.remove();
      screen.classList.remove("splash-out");
      logo.style.transition = "";
    }, 1300);
  };
  veil.addEventListener("pointerup", go);
  prompt.addEventListener("click", go); // keyboard (Enter / Space)
  prompt.focus({ preventScroll: true });
}
