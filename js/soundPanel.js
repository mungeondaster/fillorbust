// The speaker button + its popover: Music and Effects volume sliders and a
// mute switch. One shared popover; any number of buttons can open it (the
// title screen has one, the in-game status bar another).

import { isMuted, setMuted, getVolumes, setMusicVolume, setSfxVolume, unlockAudio } from "./sound.js?v=59";

let panel = null;
let openFor = null;
const buttons = new Set();

function icon() {
  const { music, sfx } = getVolumes();
  if (isMuted() || (music === 0 && sfx === 0)) return "🔇";
  return Math.max(music, sfx) < 0.4 ? "🔈" : "🔊";
}

function syncAll() {
  for (const b of buttons) {
    b.textContent = icon();
    b.title = "Sound & music";
  }
  if (!panel) return;
  const { music, sfx } = getVolumes();
  panel.querySelector("#volMusic").value = Math.round(music * 100);
  panel.querySelector("#volSfx").value = Math.round(sfx * 100);
  panel.querySelector("#volMute").checked = isMuted();
  panel.classList.toggle("muted", isMuted());
}

function build() {
  panel = document.createElement("div");
  panel.className = "sound-panel hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Sound settings");
  panel.innerHTML = `
    <label class="vol-row"><span>Music</span>
      <input type="range" id="volMusic" min="0" max="100" step="1" aria-label="Music volume"></label>
    <label class="vol-row"><span>Effects</span>
      <input type="range" id="volSfx" min="0" max="100" step="1" aria-label="Sound effects volume"></label>
    <label class="vol-mute"><input type="checkbox" id="volMute"> Mute everything</label>`;
  document.body.appendChild(panel);

  const unmuteAnd = (fn) => (e) => {
    unlockAudio();
    if (isMuted()) setMuted(false); // moving a slider means "I want sound"
    fn(e.target.value / 100);
    syncAll();
  };
  panel.querySelector("#volMusic").addEventListener("input", unmuteAnd(setMusicVolume));
  panel.querySelector("#volSfx").addEventListener("input", unmuteAnd(setSfxVolume));
  panel.querySelector("#volMute").addEventListener("change", (e) => {
    unlockAudio();
    setMuted(e.target.checked);
    syncAll();
  });

  // Close on any tap outside, or Escape.
  document.addEventListener("pointerdown", (e) => {
    if (openFor && !panel.contains(e.target) && !buttons.has(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("resize", () => openFor && place(openFor));
}

function place(btn) {
  const r = btn.getBoundingClientRect();
  const w = panel.offsetWidth;
  panel.style.top = `${r.bottom + 8}px`;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
}

function close() {
  if (!panel) return;
  panel.classList.add("hidden");
  openFor?.setAttribute("aria-expanded", "false");
  openFor = null;
}

export function attachSoundButton(btn) {
  if (!panel) build();
  buttons.add(btn);
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", () => {
    if (openFor === btn) return close();
    openFor = btn;
    syncAll();
    panel.classList.remove("hidden");
    place(btn);
    btn.setAttribute("aria-expanded", "true");
  });
  syncAll();
}
