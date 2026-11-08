// Table sounds: recorded samples (Kenney "Casino Audio", CC0 -- converted to
// MP3 by tools/blender/convert_sounds.py) with a synthesized fallback that's
// used until the samples have loaded, or if they can't be.
//
// Dice impacts come from the physics pre-simulation (dice3d.js): every hit is
// replayed as its own short sample, scaled by how hard it was, so what you
// hear tracks exactly what you see. Everything else (cards, chips) is a
// one-shot cue via sfx().

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let sfxVol = 0.9;    // effects volume, 0..1
let musicVol = 0.35; // background music volume, 0..1
try {
  muted = localStorage.getItem("fob.muted") === "1";
  const sv = parseFloat(localStorage.getItem("fob.sfxVol"));
  const mv = parseFloat(localStorage.getItem("fob.musicVol"));
  if (sv >= 0 && sv <= 1) sfxVol = sv;
  if (mv >= 0 && mv <= 1) musicVol = mv;
} catch {}
let musicGain = null;
let musicEl = null;

const BASE = new URL("../assets/sounds/", import.meta.url).href; // works from any page
const V = "?v=59";

// Sample groups; a random member is picked each time (never the same one
// twice in a row) so repeated sounds don't read as a loop.
const GROUPS = {
  floor: ["die-throw-1", "die-throw-4", "die-throw-2"],
  floorHard: ["die-throw-3", "dice-throw-3"],
  wall: ["die-throw-1", "die-throw-4"],
  die: ["dice-throw-1", "dice-throw-2"],
  grab: ["dice-grab-1", "dice-grab-2"],
  cardSlide: ["card-slide-1", "card-slide-2", "card-slide-4", "card-slide-5", "card-slide-6"],
  cardPlace: ["card-place-1", "card-place-2", "card-place-3"],
  cardShove: ["card-shove-1", "card-shove-2", "card-shove-3", "card-shove-4"],
  shuffle: ["card-shuffle"],
  packOpen: ["cards-pack-open-1", "cards-pack-open-2"],
  chipLay: ["chip-lay-1", "chip-lay-2"],
  chipStack: ["chips-stack-1", "chips-stack-2", "chips-stack-4", "chips-stack-5", "chips-stack-6"],
  chipsHandle: ["chips-handle-1", "chips-handle-5", "chips-handle-6"],
  // Card stingers (Pixabay, free license; converted by tools/blender/convert_stingers.py).
  stingerNoDice: ["stinger-no-dice"],
  stingerMustBust: ["stinger-must-bust"],
  stingerVengeance: ["stinger-vengeance"],
};

const buffers = new Map();     // name -> AudioBuffer
const raw = new Map();         // name -> Promise<ArrayBuffer>
const lastPick = new Map();
let voices = 0;
const MAX_VOICES = 12;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : sfxVol;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 5;
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // Music bypasses the compressor (it would pump against the dice).
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(ctx.destination);
  decodeAll();
  return ctx;
}

// Download the sample files right away (no audio context needed for that);
// they're decoded as soon as the first tap creates the context.
export function preloadSounds() {
  for (const name of new Set(Object.values(GROUPS).flat())) {
    if (raw.has(name)) continue;
    raw.set(name, fetch(BASE + name + ".mp3" + V).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  }
  if (ctx) decodeAll();
}

function decodeAll() {
  for (const [name, p] of raw) {
    if (buffers.has(name)) continue;
    buffers.set(name, null); // decoding in flight
    p.then((ab) => {
      if (!ab) { buffers.delete(name); return; }
      // Callback form: older Safari doesn't return a promise here.
      ctx.decodeAudioData(ab.slice(0), (buf) => buffers.set(name, buf), () => buffers.delete(name));
    });
  }
}

// Browsers only allow audio after a user gesture; call this from one.
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume().then(syncMusic, () => {});
  syncMusic();
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("fob.muted", m ? "1" : "0"); } catch {}
  applyLevels();
}
export function getVolumes() { return { music: musicVol, sfx: sfxVol }; }
export function setMusicVolume(v) {
  musicVol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem("fob.musicVol", String(musicVol)); } catch {}
  applyLevels();
}
export function setSfxVolume(v) {
  sfxVol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem("fob.sfxVol", String(sfxVol)); } catch {}
  applyLevels();
}

function applyLevels() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : sfxVol, ctx.currentTime, 0.03);
  syncMusic();
}

// ---- background music ------------------------------------------------------
// One long loop, streamed (not decoded into memory) through an <audio>
// element routed into Web Audio -- so its volume works on iPhones too, where
// an <audio> element's own volume is read-only. Paused while muted, at zero
// volume, or while the tab is in the background.

function musicLevel() {
  // Squared, so the middle of the slider sounds like "half as loud".
  return muted ? 0 : musicVol * musicVol;
}

function syncMusic() {
  if (!ctx || ctx.state !== "running") return;
  const level = musicLevel();
  const want = level > 0 && !document.hidden;
  if (want && !musicEl) {
    musicEl = new Audio(BASE + "music-loop.mp3" + V);
    musicEl.loop = true;
    musicEl.preload = "auto";
    ctx.createMediaElementSource(musicEl).connect(musicGain);
  }
  if (!musicEl) return;
  musicGain.gain.setTargetAtTime(level, ctx.currentTime, 0.08);
  if (want && musicEl.paused) musicEl.play().catch(() => {});
  else if (!want && !musicEl.paused) musicEl.pause();
}

document.addEventListener("visibilitychange", syncMusic);

export function audioNow() {
  return ctx ? ctx.currentTime : 0;
}

// Optional gate (set by Game): while a device is fast-forwarding through
// moves it missed, everything is silent.
let gate = null;
export function setSoundGate(fn) {
  gate = fn;
}

function ready() {
  return ctx && !muted && ctx.state === "running" && (!gate || gate());
}

function pick(group) {
  const names = GROUPS[group].filter((n) => buffers.get(n));
  if (!names.length) return null;
  let name = names[Math.floor(Math.random() * names.length)];
  if (names.length > 1 && name === lastPick.get(group)) {
    name = names[(names.indexOf(name) + 1) % names.length];
  }
  lastPick.set(group, name);
  return buffers.get(name);
}

// Play one sample from a group. Returns false if nothing was available.
function playSample(group, { vol = 1, rate = 1, when, lowpass } = {}) {
  if (voices >= MAX_VOICES) return true; // drop it rather than pile up
  const buf = pick(group);
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  let node = src;
  if (lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    node = node.connect(f);
  }
  node.connect(g).connect(master);
  voices++;
  src.onended = () => { voices--; };
  src.start(when ?? ctx.currentTime);
  return true;
}

// One-shot cues for cards, chips, holding dice, etc.
export function sfx(group, opts = {}) {
  if (!ready()) return;
  const jitter = opts.rate ?? 0.95 + Math.random() * 0.1;
  playSample(group, { vol: opts.vol ?? 0.8, rate: jitter, when: opts.when });
}

// Banking: a short cascade of chips being stacked -- more chips for a
// bigger bank -- finished by a handful being straightened up.
export function playBank(amount) {
  if (!ready() || amount <= 0) return;
  const n = Math.max(2, Math.min(9, Math.round(amount / 300)));
  const t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    playSample("chipStack", { vol: 0.55 + 0.35 * (i / n), rate: 0.95 + i * 0.015, when: t0 + i * (0.075 + Math.random() * 0.02) });
  }
  playSample("chipsHandle", { vol: 0.5, when: t0 + n * 0.085 + 0.05 });
}

// A busted turn: the dice get swept off, with a low "thunk" under it.
export function playBust() {
  if (!ready()) return;
  playSample("cardShove", { vol: 0.7, rate: 0.8 });
  tone(ctx.currentTime, 110, 0.35, 0.35, "sine");
}

// ---- synthesized fallback ----------------------------------------------

function noise(t, dur, filterType, freq, q, gain, decay) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.4, dur);
}

function tone(t, freq, gain, decay, type = "sine") {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + decay + 0.02);
}

function synthImpact(kind, s, t) {
  const vol = 0.15 + 0.85 * s;
  const jitter = 0.9 + Math.random() * 0.2;
  if (kind === "die") {
    noise(t, 0.04, "bandpass", 3800 * jitter, 2.5, 0.55 * vol, 0.035);
    tone(t, 2600 * jitter, 0.18 * vol, 0.05);
  } else if (kind === "wall") {
    noise(t, 0.08, "bandpass", 1100 * jitter, 6, 0.9 * vol, 0.07);
    tone(t, 420 * jitter, 0.22 * vol, 0.06, "triangle");
  } else {
    noise(t, 0.06, "lowpass", 900 * jitter, 0.8, 0.7 * vol, 0.05);
    tone(t, 150 * jitter, 0.3 * vol, 0.07);
  }
}

// ---- dice impacts --------------------------------------------------------

const DEFAULT_PROFILE = { floor: 1, wall: 1, die: 1, feltCutoff: 0 };

// kind: 'floor' | 'wall' | 'die'; v: impact speed (game units/s).
// profile (per scene): volume per kind, and feltCutoff -- a low-pass on
// floor hits so dice landing on felt sound softer than on bare wood.
export function playImpact(kind, v, when, profile = DEFAULT_PROFILE) {
  if (!ready()) return;
  const t = when ?? ctx.currentTime;
  const s = Math.min(1, Math.max(0, (v - 1) / 14)); // 0..1 strength
  if (s <= 0.02) return;
  const p = { ...DEFAULT_PROFILE, ...profile };
  const vol = (0.12 + 0.88 * Math.pow(s, 1.15)) * (p[kind] ?? 1);
  const rate = (kind === "wall" ? 0.86 : 0.94) + Math.random() * 0.12;
  const group = kind === "floor" ? (s > 0.65 ? "floorHard" : "floor") : kind;
  const ok = playSample(group, {
    vol,
    rate,
    when: t,
    lowpass: kind === "floor" && p.feltCutoff ? p.feltCutoff * (0.7 + 0.6 * s) : 0,
  });
  if (!ok) synthImpact(kind, s, t);
}
