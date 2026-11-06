// Synthesized table sounds (no audio files to download). Each impact recorded
// by the physics pre-simulation is replayed through one of these, scaled by
// how hard the hit was:
//   die  - two dice clacking: bright, short, pitched click
//   wall - die hitting the wooden tray wall: hollow knock
//   floor- die landing on felt: soft muffled thud
// Scenes can tweak the character (e.g. a casino's padded rail vs. bare wood).

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem("fob.muted") === "1"; } catch {}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// Browsers only allow audio after a user gesture; call this from one
// (the Roll button, Start Game, etc.).
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume();
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("fob.muted", m ? "1" : "0"); } catch {}
  if (master) master.gain.value = m ? 0 : 0.9;
}

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

const DEFAULT_PROFILE = { floor: 1, wall: 1, die: 1 };

// v: impact speed (game units/s). when: AudioContext time (or now).
export function playImpact(kind, v, when, profile = DEFAULT_PROFILE) {
  if (!ctx || muted || ctx.state !== "running") return;
  const t = when ?? ctx.currentTime;
  const s = Math.min(1, Math.max(0, (v - 1) / 14)); // 0..1 strength
  if (s <= 0.01) return;
  const vol = (0.15 + 0.85 * s) * (profile[kind] ?? 1);
  const jitter = 0.9 + Math.random() * 0.2;
  if (kind === "die") {
    noise(t, 0.04, "bandpass", 3800 * jitter, 2.5, 0.55 * vol, 0.035);
    tone(t, 2600 * jitter, 0.18 * vol, 0.05);
    tone(t, 4100 * jitter, 0.08 * vol, 0.03);
  } else if (kind === "wall") {
    noise(t, 0.08, "bandpass", 1100 * jitter, 6, 0.9 * vol, 0.07);
    tone(t, 420 * jitter, 0.22 * vol, 0.06, "triangle");
  } else {
    noise(t, 0.06, "lowpass", 900 * jitter, 0.8, 0.7 * vol, 0.05);
    tone(t, 150 * jitter, 0.3 * vol, 0.07);
  }
}

export function audioNow() {
  return ctx ? ctx.currentTime : 0;
}
