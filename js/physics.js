// Real rigid-body dice physics (cannon-es), run as a *pre-simulation*.
//
// A roll is simulated start-to-finish in one go (a few milliseconds of CPU,
// even on phones) before anything moves on screen, and the recorded
// trajectory is then played back by dice3d.js. Doing it this way buys three
// things a live simulation can't:
//
//  1. A throw that would end with a die cocked against a wall or another die
//     is silently re-thrown with new randomness -- players only ever see
//     clean results.
//  2. Online replays: another player's roll arrives as final values only.
//     We simulate a fresh throw locally, see which face lands up, and then
//     relabel the die (rotate its visual by one of the cube's 24 symmetries)
//     so the authoritative value is the one on top. The collider is a cube
//     either way, so the motion is identical and the relabel is invisible.
//  3. Sound: every impact is recorded with its strength and replayed in sync.

import * as CANNON from "./vendor/cannon-es.js";

export const PHYS = {
  // Play area (inner faces of the tray walls), matching dice3d.js PLAY.
  xMin: -9, xMax: 9, zMin: -5, zMax: 5,
  ceiling: 9,
  half: 0.5,
  gravity: -95,
  dt: 1 / 120,
  maxTime: 6,
  settleTime: 0.3,
};

// Local face normals -> pip values (matches dice3d.js material layout).
export const FACE_NORMALS = [
  [1, 0, 0, 1], [-1, 0, 0, 6],
  [0, 1, 0, 2], [0, -1, 0, 5],
  [0, 0, 1, 3], [0, 0, -1, 4],
];

const FLAT_DOT = 0.985; // ~10 degrees: anything worse counts as cocked

function topFace(q) {
  // World "up" in the die's local frame is q^-1 * (0,1,0); the face whose
  // local normal is closest to that is the one showing.
  const inv = new CANNON.Quaternion(-q.x, -q.y, -q.z, q.w);
  const up = inv.vmult(new CANNON.Vec3(0, 1, 0));
  let best = -2, bestF = FACE_NORMALS[0];
  for (const f of FACE_NORMALS) {
    const d = f[0] * up.x + f[1] * up.y + f[2] * up.z;
    if (d > best) { best = d; bestF = f; }
  }
  return { value: bestF[3], normal: bestF, dot: best };
}

function buildWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
  world.allowSleep = false;
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 14;

  const diceMat = new CANNON.Material("dice");
  const feltMat = new CANNON.Material("felt");
  const wallMat = new CANNON.Material("wall");
  // Felt grabs the dice (high friction, dead bounce); the wooden walls are
  // slick and lively; dice-on-dice is in between.
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, feltMat, { friction: 0.36, restitution: 0.28 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.12, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.2, restitution: 0.42 }));

  const floor = new CANNON.Body({ mass: 0, material: feltMat });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.userData = { kind: "floor" };
  world.addBody(floor);

  const T = 2; // wall slab thickness (beyond the inner face)
  const H = PHYS.ceiling;
  const w = PHYS.xMax - PHYS.xMin, d = PHYS.zMax - PHYS.zMin;
  const slab = (hx, hy, hz, x, y, z) => {
    const b = new CANNON.Body({ mass: 0, material: wallMat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    b.position.set(x, y, z);
    b.userData = { kind: "wall" };
    world.addBody(b);
  };
  slab(T / 2, H / 2, d / 2 + T, PHYS.xMin - T / 2, H / 2, 0);
  slab(T / 2, H / 2, d / 2 + T, PHYS.xMax + T / 2, H / 2, 0);
  slab(w / 2 + T, H / 2, T / 2, 0, H / 2, PHYS.zMin - T / 2);
  slab(w / 2 + T, H / 2, T / 2, 0, H / 2, PHYS.zMax + T / 2);
  slab(w / 2 + T, T / 2, d / 2 + T, 0, H + T / 2, 0); // invisible lid

  return { world, diceMat };
}

function randomQuat(rand) {
  // Uniform random rotation (Shoemake).
  const u1 = rand(), u2 = rand() * Math.PI * 2, u3 = rand() * Math.PI * 2;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return new CANNON.Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}

// One attempt. Returns null if the dice never settle, or (when requireFlat)
// if any die ends cocked.
function attempt(count, rand, requireFlat) {
  const { world, diceMat } = buildWorld();
  const bodies = [];
  const spacing = 1.55;
  for (let k = 0; k < count; k++) {
    const b = new CANNON.Body({
      mass: 1,
      material: diceMat,
      shape: new CANNON.Box(new CANNON.Vec3(PHYS.half, PHYS.half, PHYS.half)),
      linearDamping: 0.06,
      angularDamping: 0.08,
    });
    // Launch from a loose cluster just inside the left wall, slightly up off
    // the felt, like dice leaving a hand.
    const z = (k - (count - 1) / 2) * spacing + (rand() - 0.5) * 0.3;
    b.position.set(PHYS.xMin + 1.2 + (rand() - 0.5) * 0.4, 1.4 + rand() * 1.4, z);
    b.quaternion.copy(randomQuat(rand));
    b.velocity.set(22 + rand() * 12, 1 + rand() * 4, (rand() - 0.5) * 7 - z * 0.35);
    b.angularVelocity.set((rand() - 0.5) * 40, (rand() - 0.5) * 40, (rand() - 0.5) * 40);
    b.userData = { kind: "die", k };
    world.addBody(b);
    bodies.push(b);
  }

  const events = [];
  const lastHit = new Array(count).fill(-1);
  let t = 0;
  bodies.forEach((b, k) => {
    b.addEventListener("collide", (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < 1.2 || t - lastHit[k] < 0.035) return;
      lastHit[k] = t;
      const other = e.body === b ? e.target : e.body;
      const kind = other.userData?.kind || "floor";
      // A die-die hit fires on both dice; keep just one copy.
      if (kind === "die" && other.userData.k < k) return;
      events.push({ t, v, kind, die: k });
    });
  });

  const stride = 7;
  const frames = [];
  const steps = Math.ceil(PHYS.maxTime / PHYS.dt);
  let still = 0;
  const pushFrame = () => {
    const f = new Float32Array(count * stride);
    bodies.forEach((b, k) => {
      const o = k * stride;
      f[o] = b.position.x; f[o + 1] = b.position.y; f[o + 2] = b.position.z;
      f[o + 3] = b.quaternion.x; f[o + 4] = b.quaternion.y; f[o + 5] = b.quaternion.z; f[o + 6] = b.quaternion.w;
    });
    frames.push(f);
  };
  pushFrame();
  for (let s = 0; s < steps; s++) {
    world.step(PHYS.dt);
    t += PHYS.dt;
    pushFrame();
    const moving = bodies.some((b) => b.velocity.length() > 0.08 || b.angularVelocity.length() > 0.12);
    still = moving ? 0 : still + PHYS.dt;
    if (still >= PHYS.settleTime) break;
  }
  if (requireFlat && still < PHYS.settleTime) return null;

  const results = bodies.map((b) => topFace(b.quaternion));
  if (requireFlat && results.some((r) => r.dot < FLAT_DOT)) return null;
  return { frames, stride, dt: PHYS.dt, events, results };
}

// Simulate a throw of `count` dice. Always returns a usable roll: if a dozen
// throws all end cocked (vanishingly rare), the next one that merely settles
// is accepted and dice3d's final settle-snap squares it up.
export function simulateRoll(count, rand = Math.random) {
  for (let i = 0; i < 12; i++) {
    const r = attempt(count, rand, true);
    if (r) return r;
  }
  for (;;) {
    const r = attempt(count, rand, false);
    if (r) return r;
  }
}
