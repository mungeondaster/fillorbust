// The 3D dice table: renderer, camera, dice, and roll playback.
//
// Public interface used by game.js (unchanged from the hand-rolled version):
//   new Dice3D(container)
//   dice[i].value / dice[i].state ('table' | 'tray')
//   rollIndices(indices, forcedValues?) -> Promise<{ [index]: value }>
//   holdDice(indices), resetAll(), resize()
// New:
//   setScene(id) -> Promise   (Kitchen Table, Classic Felt, ...)
//
// Physics is a recorded cannon-es pre-simulation (see physics.js); this file
// plays it back, plus sound. Scenery comes from js/scenes/*.
import * as THREE from "./vendor/three.module.min.js";
import { simulateRoll, PHYS, FACE_NORMALS } from "./physics.js?v=59";
import { playImpact, sfx } from "./sound.js?v=59";
import { SCENES, getSceneId, saveSceneId } from "./scenes/index.js?v=59";
import { pipTextures, roundedBoxGeometry } from "./scenes/common.js?v=59";

const HALF = 0.5;
const UP = new THREE.Vector3(0, 1, 0);

// Held dice sit in the tray's side strip, out of the play area.
const TRAY_Z = PHYS.zMax + 1.4;
const TRAY_SLOTS = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5].map((x) => [x, TRAY_Z]);
const REST_SLOTS = [[-4.2, -1.2], [-2.4, 0.9], [-0.6, -0.9], [1.2, 0.9], [3.0, -1.2], [4.5, 0.9]];

// Everything that must be in frame, whatever the screen shape: the tray's
// outer rim including the held-dice strip.
const FRAME_BOX = new THREE.Box3(new THREE.Vector3(-9.7, 0, -5.7), new THREE.Vector3(9.7, 1.2, 8.2));

// Local face normals in BoxGeometry material-group order (+X,-X,+Y,-Y,+Z,-Z).
const LOCAL_NORMALS = FACE_NORMALS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
const NORMAL_FOR_VALUE = {};
FACE_NORMALS.forEach(([x, y, z, v]) => { NORMAL_FOR_VALUE[v] = new THREE.Vector3(x, y, z); });

export function detectQuality() {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let tier = "high";
  if (coarse) tier = cores <= 4 || mem <= 3 ? "low" : "medium";
  return {
    tier,
    pixelRatio: Math.min(window.devicePixelRatio || 1, { low: 1.25, medium: 1.75, high: 2 }[tier]),
    shadowMap: { low: 512, medium: 1024, high: 2048 }[tier],
    antialias: tier !== "low",
  };
}

class Die {
  constructor(geo) {
    this.mesh = new THREE.Mesh(geo, []);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.value = 1;
    this.state = "table";
    this.tween = null;   // { fromP, toP, fromQ, toQ, t, dur, arc, onDone }
    this.snap = null;    // final true-up after playback
  }

  // Value showing on top for the mesh's current orientation.
  topFace() {
    let best = -Infinity, bestIdx = 0;
    const w = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      w.copy(LOCAL_NORMALS[i]).applyQuaternion(this.mesh.quaternion);
      if (w.y > best) { best = w.y; bestIdx = i; }
    }
    return { value: FACE_NORMALS[bestIdx][3], dot: best, idx: bestIdx };
  }
}

export class Dice3D {
  constructor(container) {
    this.container = container;
    this.quality = detectQuality();
    this.scene = new THREE.Scene();
    this.sceneRoot = new THREE.Group();
    this.scene.add(this.sceneRoot);

    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 400);
    this.cameraCfg = { pitchDeg: 52, margin: 1.04 };

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality.antialias,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.playback = null;
    this._clock = new THREE.Clock();
    this._running = false;
    this._renderFrames = 0;
    this._tick = this._tick.bind(this);

    this._diceGeo = roundedBoxGeometry(1, 0.12, this.quality.tier === "low" ? 3 : 5);
    this.dice = [];
    for (let i = 0; i < 6; i++) {
      const die = new Die(this._diceGeo);
      die.mesh.position.set(REST_SLOTS[i][0], HALF, REST_SLOTS[i][1]);
      this.scene.add(die.mesh);
      this.dice.push(die);
    }
    this._setDiceStyle({});

    // Dynamic dice shadows on top of baked-lighting surfaces.
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 12.5),
      new THREE.ShadowMaterial({ opacity: 0.5 })
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.set(0, 0.003, 1.25);
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.visible = false;
    this.scene.add(this.shadowCatcher);

    // Gold ring on the felt under each selected die (mirrors the 2D row).
    const ringGeo = new THREE.RingGeometry(0.74, 0.9, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = this.dice.map(() => {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xf0d878, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false,
      }));
      ring.visible = false;
      ring.renderOrder = 2;
      this.scene.add(ring);
      return ring;
    });

    // Click/tap a die on the table to (de)select it. main.js decides what's
    // clickable (isDieClickable) and what a click does (onDieClick).
    this.isDieClickable = () => false;
    this.onDieClick = null;
    this._raycaster = new THREE.Raycaster();
    const canvas = this.renderer.domElement;
    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._raycaster.setFromCamera(ndc, this.camera);
      const hit = this._raycaster.intersectObjects(this.dice.map((d) => d.mesh), false)[0];
      if (!hit) return -1;
      const i = this.dice.findIndex((d) => d.mesh === hit.object);
      return this.isDieClickable(i) ? i : -1;
    };
    canvas.addEventListener("click", (e) => {
      const i = pick(e);
      if (i >= 0) this.onDieClick?.(i);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      canvas.style.cursor = pick(e) >= 0 ? "pointer" : "";
    });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => this._onVisibility());

    this.resize();
    this.sceneId = null;
    this._sceneLoad = this.setScene(getSceneId());
  }

  static get scenes() {
    return SCENES.map(({ id, name }) => ({ id, name }));
  }

  // ------------------------------------------------------------- scenes ---
  async setScene(id) {
    const entry = SCENES.find((s) => s.id === id) || SCENES[0];
    const token = (this._sceneToken = {});
    let built, root;
    try {
      const mod = (await entry.load()).default;
      root = new THREE.Group();
      built = await mod.build({ root, renderer: this.renderer, quality: this.quality });
    } catch (err) {
      console.error(`Scene "${entry.id}" failed to load, using Classic Felt`, err);
      if (entry.id !== "classic") return this.setScene("classic");
      return;
    }
    if (token !== this._sceneToken) return; // a newer setScene() won the race

    this._disposeTree(this.sceneRoot);
    this.scene.remove(this.sceneRoot);
    this.sceneRoot = root;
    this.scene.add(root);
    this.sceneId = entry.id;
    saveSceneId(entry.id);

    this.scene.background = built.background ?? null;
    this.scene.environment = built.environment ?? null;
    this.scene.environmentIntensity = built.environmentIntensity ?? 1;
    this._fogCfg = built.fog || null;
    this.scene.fog = this._fogCfg ? new THREE.Fog(this._fogCfg.color, 10, 100) : null;
    this.renderer.toneMapping = built.toneMapping ?? THREE.NoToneMapping;
    this.renderer.toneMappingExposure = built.exposure ?? 1;
    this.soundProfile = built.sound;
    this.cameraCfg = { pitchDeg: 52, margin: 1.04, ...built.camera };
    const sc = built.shadowCatcher;
    this.shadowCatcher.visible = !!sc;
    if (sc) {
      this.shadowCatcher.material.opacity = sc.opacity ?? 0.5;
      this.shadowCatcher.material.color.set(sc.color ?? 0x000000);
    }
    this._setDiceStyle(built.dice || {});
    this.resize();
  }

  _setDiceStyle(style) {
    const mats = [];
    for (let idx = 0; idx < 6; idx++) {
      const value = FACE_NORMALS[idx][3];
      const { map, bumpMap } = pipTextures(value, style);
      mats.push(new THREE.MeshStandardMaterial({
        map,
        bumpMap: style.bump === false ? null : bumpMap,
        bumpScale: 1.6,
        roughness: style.roughness ?? 0.35,
        metalness: 0.0,
      }));
    }
    const old = this.dice[0].mesh.material;
    for (const die of this.dice) die.mesh.material = mats;
    if (Array.isArray(old)) old.forEach((m) => { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); });
    this._kick();
  }

  _disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const k of ["map", "lightMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "bumpMap"]) {
          m[k]?.dispose?.();
        }
        m.dispose();
      }
      if (o.isLight && o.shadow?.map) o.shadow.map.dispose();
    });
  }

  // ------------------------------------------------------------- camera ---
  // Keep a fixed viewing angle and back the camera off just far enough that
  // the whole tray fits -- on a tall phone that means more table shows
  // above/below; on a wide monitor, more on the sides.
  //
  // A scene can also name a "nice to have" area (camera.extra: a prop it
  // would like in frame, e.g. the kitchen's card box). It's included only
  // when that costs the tray almost nothing -- i.e. when the screen shape
  // leaves spare room anyway -- and dropped otherwise.
  _fitCamera() {
    const { pitchDeg, margin, extra } = this.cameraCfg;
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const place = (target, dist) => {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
    };
    const solve = (box) => {
      const target = box.getCenter(new THREE.Vector3());
      const corners = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      const lim = 1 / margin;
      const fits = (dist) => {
        place(target, dist);
        return corners.every((c) => {
          const p = c.clone().project(this.camera);
          return Math.abs(p.x) <= lim && Math.abs(p.y) <= lim;
        });
      };
      let lo = 5, hi = 200;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      return { target, dist: hi };
    };
    let best = solve(FRAME_BOX);
    if (extra) {
      const withExtra = solve(FRAME_BOX.clone().union(extra));
      if (withExtra.dist <= best.dist * 1.08) best = withExtra;
    }
    place(best.target, best.dist);
    if (this._fogCfg && this.scene.fog) {
      this.scene.fog.near = best.dist * this._fogCfg.near;
      this.scene.fog.far = best.dist * this._fogCfg.far;
    }
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.renderer.setSize(w, h);
    this._fitCamera();
    this._renderFrames = Math.max(this._renderFrames, 2);
    this._kick();
  }

  setSelected(indices) {
    this.rings.forEach((ring, i) => {
      const on = indices.includes(i) && this.dice[i].state === "table";
      ring.visible = on;
      if (on) ring.position.set(this.dice[i].mesh.position.x, 0.012, this.dice[i].mesh.position.z);
    });
    this._renderFrames = Math.max(this._renderFrames, 1);
    this._kick();
  }

  // -------------------------------------------------------------- moves ---
  _tween(die, toP, toQ, dur, arc = 0.3) {
    return new Promise((resolve) => {
      die.tween = {
        fromP: die.mesh.position.clone(), toP,
        fromQ: die.mesh.quaternion.clone(), toQ: toQ || die.mesh.quaternion.clone(),
        t: 0, dur, arc, onDone: resolve,
      };
      this._kick();
    });
  }

  // instant: jump straight there (used while catching up on missed moves).
  holdDice(indices, instant = false) {
    for (const i of indices) this.dice[i].state = "tray";
    sfx("grab", { vol: 0.35, rate: 1.1 });
    let k = 0;
    for (const die of this.dice) {
      if (die.state !== "tray") continue;
      const [x, z] = TRAY_SLOTS[k++];
      if (instant) {
        die.tween = null;
        die.mesh.quaternion.copy(this._flatQuat(die));
        die.mesh.position.set(x, HALF, z);
      } else {
        this._tween(die, new THREE.Vector3(x, HALF, z), this._flatQuat(die), 0.45, 0.6);
      }
    }
    if (instant) {
      this._renderFrames = Math.max(this._renderFrames, 2);
      this._kick();
    }
  }

  resetAll() {
    this.playback = null;
    this.dice.forEach((die, i) => {
      die.state = "table";
      die.tween = null;
      die.snap = null;
      die.mesh.position.set(REST_SLOTS[i][0], HALF, REST_SLOTS[i][1]);
      die.mesh.quaternion.identity();
    });
    this._renderFrames = Math.max(this._renderFrames, 2);
    this._kick();
  }

  // Current orientation, trued up so the showing face is exactly flat.
  _flatQuat(die) {
    const top = die.topFace();
    const n = LOCAL_NORMALS[top.idx].clone().applyQuaternion(die.mesh.quaternion);
    return new THREE.Quaternion().setFromUnitVectors(n, UP).multiply(die.mesh.quaternion);
  }

  // Throw the given dice. Resolves with { index: value } once they've all
  // landed. With forcedValues ({ index: value }, from another player's roll)
  // the same kind of fully-simulated throw is shown, relabeled so the
  // authoritative values come up.
  // instant: skip the throw and put the dice straight where it lands (used
  // while catching up on missed moves).
  async rollIndices(indices, forcedValues, instant = false) {
    for (const ring of this.rings) ring.visible = false;
    const sim = simulateRoll(indices.length);
    const f0 = sim.frames[0];
    const S = sim.stride;

    const plan = indices.map((i, k) => {
      const natural = sim.results[k].value;
      const want = forcedValues?.[i] ?? natural;
      // Relabel: a cube symmetry R with R * n(want) = n(natural), so the
      // face the physics put on top carries the wanted pips.
      const R = new THREE.Quaternion().setFromUnitVectors(NORMAL_FOR_VALUE[want], NORMAL_FOR_VALUE[natural]);
      return { i, k, want, R };
    });

    if (instant) {
      this.playback = null;
      const fl = sim.frames[sim.frames.length - 1];
      const results = {};
      for (const { i, k, want, R } of plan) {
        const die = this.dice[i];
        const o = k * S;
        die.tween = null;
        die.snap = null;
        die.mesh.position.set(fl[o], HALF, fl[o + 2]);
        die.mesh.quaternion.set(fl[o + 3], fl[o + 4], fl[o + 5], fl[o + 6]).multiply(R);
        die.mesh.quaternion.copy(this._flatQuat(die));
        die.value = want;
        results[i] = want;
      }
      this._renderFrames = Math.max(this._renderFrames, 2);
      this._kick();
      return results;
    }

    // Scoop the dice into the throwing hand (the sim's start pose).
    sfx("grab", { vol: 0.75 });
    await Promise.all(plan.map(({ i, k, R }) => {
      const die = this.dice[i];
      die.snap = null;
      const o = k * S;
      const p = new THREE.Vector3(f0[o], f0[o + 1], f0[o + 2]);
      const q = new THREE.Quaternion(f0[o + 3], f0[o + 4], f0[o + 5], f0[o + 6]).multiply(R);
      return this._tween(die, p, q, 0.32, 0.8);
    }));

    return new Promise((resolve) => {
      this.playback = { sim, plan, t: 0, ev: 0, resolve };
      this._kick();
    });
  }

  _stepPlayback(dt) {
    const pb = this.playback;
    const { sim, plan } = pb;
    pb.t += dt;
    const last = sim.frames.length - 1;
    const fpos = Math.min(pb.t / sim.dt, last);
    const a = Math.floor(fpos), b = Math.min(a + 1, last), u = fpos - a;
    const FA = sim.frames[a], FB = sim.frames[b], S = sim.stride;
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (const { i, k, R } of plan) {
      const die = this.dice[i];
      const o = k * S;
      die.mesh.position.set(
        FA[o] + (FB[o] - FA[o]) * u,
        FA[o + 1] + (FB[o + 1] - FA[o + 1]) * u,
        FA[o + 2] + (FB[o + 2] - FA[o + 2]) * u
      );
      qa.set(FA[o + 3], FA[o + 4], FA[o + 5], FA[o + 6]);
      qb.set(FB[o + 3], FB[o + 4], FB[o + 5], FB[o + 6]);
      die.mesh.quaternion.slerpQuaternions(qa, qb, u).multiply(R);
    }
    while (pb.ev < sim.events.length && sim.events[pb.ev].t <= pb.t) {
      const e = sim.events[pb.ev++];
      playImpact(e.kind, e.v, undefined, this.soundProfile);
    }
    if (fpos >= last) {
      this.playback = null;
      const results = {};
      let pending = plan.length;
      for (const { i, want } of plan) {
        const die = this.dice[i];
        die.value = want;
        die.snap = { from: die.mesh.quaternion.clone(), to: this._flatQuat(die), t: 0, dur: 0.08 };
        die.snap.done = () => {
          results[i] = want;
          if (--pending === 0) pb.resolve(results);
        };
      }
    }
  }

  // --------------------------------------------------------------- loop ---
  // Render only while something is moving: an idle table costs no GPU/
  // battery at all, which matters over a long family game on phones.
  _kick() {
    // A hidden tab gets no animation frames at all, which would freeze a
    // roll halfway (and with it the game, for everyone waiting on this
    // player). So while hidden, everything in motion just finishes at once.
    if (document.hidden) {
      if (!this._flushQueued) {
        this._flushQueued = true;
        setTimeout(() => {
          this._flushQueued = false;
          this._flush();
        }, 0);
      }
      return;
    }
    if (this._running) return;
    this._running = true;
    this._clock.getDelta();
    requestAnimationFrame(this._tick);
  }

  _flush() {
    for (let n = 0; n < 50 && this._advance(1); n++);
    this._renderFrames = Math.max(this._renderFrames, 2);
  }

  _onVisibility() {
    if (document.hidden) {
      this._flush();
    } else {
      this._renderFrames = Math.max(this._renderFrames, 2);
      this._kick(); // (a frame requested before hiding is simply delivered now)
    }
  }

  _tick() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const busy = this._advance(dt) | this._render();
    if (busy) requestAnimationFrame(this._tick);
    else this._running = false;
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
    if (this._renderFrames > 0) {
      this._renderFrames--;
      return true;
    }
    return false;
  }

  // Moves everything in motion forward by dt seconds; true while anything is.
  _advance(dt) {
    let busy = false;

    if (this.playback) {
      this._stepPlayback(dt);
      busy = true;
    }
    for (const die of this.dice) {
      if (die.tween) {
        const tw = die.tween;
        tw.t += dt;
        const p = Math.min(tw.t / tw.dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        die.mesh.position.lerpVectors(tw.fromP, tw.toP, e);
        die.mesh.position.y += Math.sin(p * Math.PI) * tw.arc;
        die.mesh.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, e);
        if (p >= 1) {
          die.tween = null;
          tw.onDone?.();
        }
        busy = true;
      }
      if (die.snap) {
        const s = die.snap;
        s.t += dt;
        const p = Math.min(s.t / s.dur, 1);
        die.mesh.quaternion.slerpQuaternions(s.from, s.to, p);
        if (p >= 1) {
          die.mesh.position.y = HALF;
          die.snap = null;
          s.done?.();
        }
        busy = true;
      }
    }
    return busy;
  }
}
