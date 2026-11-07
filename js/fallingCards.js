// Title-screen backdrop: playing cards drifting slowly down the screen the
// way a real card falls -- swaying side to side like a leaf, banking into
// each swing, slowing at the ends of it, and lazily tumbling over so both the
// printed face and the red back show. Plain DOM + CSS 3D transforms, one
// requestAnimationFrame loop, paused whenever the title screen is hidden.

import { cardFaceSVG, cardBackSVG } from "./cardArt.js?v=45";

const FACES = ["NO_DICE", "MUST_BUST", "DOUBLE_TROUBLE", "FILL_1000", "BONUS_300", "BONUS_400", "BONUS_500", "VENGEANCE"];
const CARD_W = 74;
const CARD_H = 104;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class FallingCard {
  constructor(layer) {
    this.el = document.createElement("div");
    this.el.className = "fall-card";
    this.el.style.width = `${CARD_W}px`;
    this.el.style.height = `${CARD_H}px`;
    this.el.innerHTML = `<div class="side front"></div><div class="side back">${cardBackSVG()}</div>`;
    this.front = this.el.firstChild;
    layer.appendChild(this.el);
  }

  // New card above the top edge (or anywhere on screen, for the first batch).
  reset(w, h, anywhere) {
    this.front.innerHTML = cardFaceSVG({ id: pick(FACES) });
    this.z = Math.random(); // 0 = far away, 1 = close
    this.scale = 0.5 + 0.65 * this.z;
    this.fall = 18 + 30 * this.z; // px/s -- slow, and the far ones slower still
    this.x0 = rand(-0.05, 1.05) * w;
    this.sway = rand(25, 80) * this.scale; // side-to-side reach
    this.swing = rand(0.45, 0.9); // rad/s through the sway
    this.phase = rand(0, Math.PI * 2);
    this.bank = rand(14, 30); // degrees it tilts into each swing
    this.tilt = rand(-25, 25);
    // Tumble: mostly end-over-end around one axis, with a gentle wobble on
    // the other, so it keeps flashing face, edge, back.
    this.spinX = rand(14, 45) * (Math.random() < 0.5 ? -1 : 1);
    this.spinY = rand(8, 30) * (Math.random() < 0.5 ? -1 : 1);
    if (Math.random() < 0.5) [this.spinX, this.spinY] = [this.spinY, this.spinX];
    this.rx = rand(0, 360);
    this.ry = rand(0, 360);
    const reach = CARD_H * this.scale;
    this.y = anywhere ? rand(-reach, h) : -reach - rand(0, h * 0.3);
    this.el.style.zIndex = String(Math.round(this.z * 100));
    const shade = `brightness(${(0.62 + 0.38 * this.z).toFixed(2)})`;
    for (const side of this.el.children) side.style.filter = shade;
  }

  step(dt, w, h) {
    this.phase += this.swing * dt;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    // Glides fastest through the middle of a swing, hangs at the ends.
    this.y += this.fall * (0.55 + 0.7 * Math.abs(c)) * dt;
    this.rx += this.spinX * dt;
    this.ry += this.spinY * dt;
    const x = this.x0 + this.sway * s;
    const rz = this.tilt + this.bank * c;
    this.el.style.transform =
      `translate3d(${x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0) ` +
      `rotateZ(${rz.toFixed(1)}deg) rotateX(${this.rx.toFixed(1)}deg) rotateY(${this.ry.toFixed(1)}deg) ` +
      `scale(${this.scale.toFixed(3)})`;
    if (this.y > h + CARD_H) this.reset(w, h, false);
  }
}

export function startFallingCards(screen) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "falling-cards";
  layer.setAttribute("aria-hidden", "true");
  screen.prepend(layer);

  const cards = [];
  const size = () => [window.innerWidth, window.innerHeight];
  const fit = () => {
    // About one card per 50,000 px² of screen: ~20 on a laptop, ~6 on a phone.
    const [w, h] = size();
    const want = Math.max(6, Math.min(22, Math.round((w * h) / 50000)));
    while (cards.length < want) {
      const c = new FallingCard(layer);
      c.reset(w, h, true);
      cards.push(c);
    }
    while (cards.length > want) cards.pop().el.remove();
  };
  fit();
  window.addEventListener("resize", fit);

  let raf = 0;
  let last = 0;
  const frame = (t) => {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    const [w, h] = size();
    for (const c of cards) c.step(dt, w, h);
    raf = requestAnimationFrame(frame);
  };
  const sync = () => {
    const on = !screen.classList.contains("hidden") && !document.hidden;
    if (on && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", sync);
  sync();
}
