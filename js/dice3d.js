import * as THREE from "./vendor/three.module.min.js";
import { FACE_TO_BOX_MATERIAL } from "./constants.js?v=20";

const DIE_SIZE = 1;
const HALF = DIE_SIZE / 2;

// The rectangular play space the dice physically roll around in. Dice
// bounce off these bounds like the walls of a dice tray.
const PLAY = { xMin: -9, xMax: 9, zMin: -5, zMax: 5 };

// Held dice are set aside on the felt just beyond the rail, outside the
// active play surface, so they read clearly as "out of play" for this turn.
const TRAY_Z = PLAY.zMax + 1.35;
const TRAY_SLOTS = [
  [-4.5, 0, TRAY_Z], [-2.7, 0, TRAY_Z], [-0.9, 0, TRAY_Z],
  [0.9, 0, TRAY_Z], [2.7, 0, TRAY_Z], [4.5, 0, TRAY_Z],
];
const REST_SLOTS = [
  [-4.2, 0, -1.2], [-2.4, 0, 0.9], [-0.6, 0, -0.9],
  [1.2, 0, 0.9], [3.0, 0, -1.2], [4.5, 0, 0.9],
];

const GRAVITY = -30;
const RESTITUTION_GROUND = 0.24;
const RESTITUTION_WALL = 0.4;
const RESTITUTION_DICE = 0.5;
// Retention rates are expressed per-second and applied as rate^dt each
// substep, so the effect stays the same regardless of substep count/fps.
// Friction is what actually stops a die -- gravity/hop just gets it onto
// the table quickly, so distance traveled is governed almost entirely by
// this constant (see LAUNCH_FRICTION_K below), not by how long it's airborne.
const GROUND_FRICTION_PS = 0.22;
const LAUNCH_FRICTION_K = -Math.log(GROUND_FRICTION_PS);
// Once a die is lying flat on a face (not tumbling anymore), the full face
// is in contact with the felt and sliding friction is far higher than while
// it bounces and rolls on edges/corners. Speeds below the stop threshold
// are killed outright -- a flat die grips the cloth and stops dead.
const FLAT_FRICTION_PS = 0.0002;
const FLAT_STOP_SPEED = 1.2;
const FLAT_DOT_THRESH = 0.99;
const ANGULAR_DAMPING_GROUND_PS = 0.2;
const ANGULAR_DAMPING_AIR_PS = 0.92;
// Once a grounded die's tumble drops below this rate, it no longer has the
// energy to roll over another edge -- gravity tips it onto its nearest face.
const TIP_ANG_THRESH = 4.0;
// How fast the tip-over pulls the nearest face flat, in rad/s per radian of
// misalignment (higher = snappier tip; scaled so a die on its edge at 45deg
// flops flat in roughly a quarter second, like a real die's final wobble).
const TIP_RATE = 10;
const SETTLE_LIN_THRESH = 0.05;
const SETTLE_ANG_THRESH = 0.09;
const SETTLE_FLAT_THRESH = 0.9995; // top-face dot with UP required to rest
const SETTLE_TIME = 0.25;
const MAX_ROLL_TIME = 5.5;
const SUBSTEPS = 3;

const UP = new THREE.Vector3(0, 1, 0);

// Pure rotations (Euler XYZ) that bring a given pip value to face up (+Y),
// starting from the die's identity orientation (see FACE_TO_BOX_MATERIAL).
const FACE_UP_EULER = {
  2: [0, 0, 0],
  5: [Math.PI, 0, 0],
  1: [0, 0, Math.PI / 2],
  6: [0, 0, -Math.PI / 2],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
};

// Local face normals in BoxGeometry material-group order: [+X,-X,+Y,-Y,+Z,-Z]
const LOCAL_FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const INDEX_TO_VALUE = [1, 6, 2, 5, 3, 4];

function pipTexture(value) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#fdfaf3");
  grad.addColorStop(1, "#eee7d6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);

  const pip = (x, y) => {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.09, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - 8, y - 8, 4, x, y, size * 0.1);
    g.addColorStop(0, "#3a2a20");
    g.addColorStop(1, "#0c0806");
    ctx.fillStyle = g;
    ctx.fill();
  };

  const c = size / 2, q = size * 0.26;
  const layouts = {
    1: [[c, c]],
    2: [[c - q, c - q], [c + q, c + q]],
    3: [[c - q, c - q], [c, c], [c + q, c + q]],
    4: [[c - q, c - q], [c + q, c - q], [c - q, c + q], [c + q, c + q]],
    5: [[c - q, c - q], [c + q, c - q], [c, c], [c - q, c + q], [c + q, c + q]],
    6: [[c - q, c - q], [c + q, c - q], [c - q, c], [c + q, c], [c - q, c + q], [c + q, c + q]],
  };
  layouts[value].forEach(([x, y]) => pip(x, y));

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// A tileable felt-cloth texture: a base green with fine per-pixel grain (the
// weave of the fabric) plus faint diagonal thread lines. This is a stand-in
// "image" the same way a real photographed felt texture would be used --
// swapping this out for new THREE.TextureLoader().load('assets/felt.jpg')
// later is a one-line change, everything downstream (repeat/wrap) is the same.
function feltTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f5132";
  ctx.fillRect(0, 0, size, size);

  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 22;
    data[i] = clampByte(data[i] + grain);
    data[i + 1] = clampByte(data[i + 1] + grain);
    data[i + 2] = clampByte(data[i + 2] + grain);
  }
  ctx.putImageData(image, 0, 0);

  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  for (let x = -size; x < size * 2; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  for (let x = -size; x < size * 2; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x + size, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// A BoxGeometry whose corners/edges are rounded off: each vertex is pulled
// in toward a smaller "core" box and then pushed back out along that offset
// direction, clamped to a fixed radius -- the standard rounded-box trick.
// Flat face vertices are untouched; only near edges/corners does this bend.
function roundedBoxGeometry(size, radius, segments) {
  const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const pos = geo.attributes.position;
  const core = size / 2 - radius;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -core, core);
    const cy = THREE.MathUtils.clamp(v.y, -core, core);
    const cz = THREE.MathUtils.clamp(v.z, -core, core);
    n.set(v.x - cx, v.y - cy, v.z - cz);
    const len = n.length();
    if (len > 1e-8) {
      n.multiplyScalar(radius / len);
      pos.setXYZ(i, cx + n.x, cy + n.y, cz + n.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

class Die {
  constructor(scene, materials) {
    const geo = roundedBoxGeometry(DIE_SIZE, DIE_SIZE * 0.12, 5);
    this.mesh = new THREE.Mesh(geo, materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.value = 1;
    this.state = "table"; // 'table' | 'tray'

    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.physicsActive = false;
    this.settleTimer = 0;
    this.rollTime = 0;
    this.snapping = false;
    this.forcedValue = undefined;
    this._resolve = null;
  }

  setPosition(slot, y = HALF) {
    this.mesh.position.set(slot[0], y, slot[2]);
  }

  faceUpQuaternion(value) {
    const [x, y, z] = FACE_UP_EULER[value];
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  }

  // The face closest to pointing up: its value, its world-space normal, and
  // how flat it is (dot=1 means perfectly face-up, ~0.577 means on a corner).
  topFace() {
    let best = -Infinity;
    let bestIdx = 0;
    const world = new THREE.Vector3();
    const bestNormal = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      world.copy(LOCAL_FACE_NORMALS[i]).applyQuaternion(this.mesh.quaternion);
      if (world.y > best) {
        best = world.y;
        bestIdx = i;
        bestNormal.copy(world);
      }
    }
    return { value: INDEX_TO_VALUE[bestIdx], normal: bestNormal, dot: best };
  }

  // Same idea as topFace(), but for a specific value rather than whichever is
  // naturally closest to up -- lets a networked roll be forced to a known
  // outcome while still using the die's real current orientation/heading.
  worldNormalForValue(value) {
    const idx = INDEX_TO_VALUE.indexOf(value);
    return LOCAL_FACE_NORMALS[idx].clone().applyQuaternion(this.mesh.quaternion);
  }

  readTopValue() {
    return this.topFace().value;
  }
}

export class Dice3D {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    const w = container.clientWidth, h = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 120);
    this.camera.position.set(0, 15.5, 12.5);
    this.camera.lookAt(0, 0, 0.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this._buildScene();
    this._buildDice();

    window.addEventListener("resize", () => this.resize());
    this._animate = this._animate.bind(this);
    this._clock = new THREE.Clock();
    requestAnimationFrame(this._animate);
  }

  _buildScene() {
    const hemi = new THREE.HemisphereLight(0xfff6e5, 0x33261a, 0.65);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2da, 1.15);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    // Tightened to the actual table+tray footprint (was a much wider ±12
    // square) so the shadow map resolution isn't wasted on empty area.
    key.shadow.camera.left = -11;
    key.shadow.camera.right = 11;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    // A depth bias this large was detaching the shadow from the die and
    // shrinking it down to a thin offset sliver ("peter-panning"). A small
    // normalBias handles acne on the rounded dice much more cleanly.
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
    fill.position.set(-8, 6, -4);
    this.scene.add(fill);

    const feltGeo = new THREE.PlaneGeometry(30, 20);
    const feltMap = feltTexture();
    feltMap.repeat.set(6, 4); // tile the 512px texture across the 30x20 plane
    const feltMat = new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.95 });
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    this._buildRail();
  }

  _buildRail() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1e, roughness: 0.6, metalness: 0.1 });
    const h = 0.5, t = 0.18;
    const w = PLAY.xMax - PLAY.xMin + t * 2;
    const d = PLAY.zMax - PLAY.zMin + t * 2;

    const mkRail = (sx, sy, sz, px, py, pz) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), railMat);
      rail.position.set(px, py, pz);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);
    };
    mkRail(w, h, t, 0, h / 2 - 0.05, PLAY.zMin - t / 2);
    mkRail(w, h, t, 0, h / 2 - 0.05, PLAY.zMax + t / 2);
    mkRail(t, h, d, PLAY.xMin - t / 2, h / 2 - 0.05, 0);
    mkRail(t, h, d, PLAY.xMax + t / 2, h / 2 - 0.05, 0);
  }

  _makeMaterials() {
    const mats = [];
    for (let matIdx = 0; matIdx < 6; matIdx++) {
      const value = Object.keys(FACE_TO_BOX_MATERIAL).find(
        (v) => FACE_TO_BOX_MATERIAL[v] === matIdx
      );
      mats.push(
        new THREE.MeshStandardMaterial({
          map: pipTexture(Number(value)),
          roughness: 0.35,
          metalness: 0.05,
        })
      );
    }
    return mats;
  }

  _buildDice() {
    this.dice = [];
    for (let i = 0; i < 6; i++) {
      const die = new Die(this.scene, this._makeMaterials());
      die.setPosition(REST_SLOTS[i]);
      this.dice.push(die);
    }
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _relayout(slots, indices, animate = true) {
    indices.forEach((i, k) => {
      const die = this.dice[i];
      const slot = slots[k];
      const targetPos = new THREE.Vector3(slot[0], HALF, slot[2]);
      if (!animate) {
        die.mesh.position.copy(targetPos);
      } else {
        die._moveTween = { from: die.mesh.position.clone(), to: targetPos, t: 0, dur: 0.45 };
      }
    });
  }

  _tweenTo(die, targetPos, dur) {
    return new Promise((resolve) => {
      die._moveTween = { from: die.mesh.position.clone(), to: targetPos, t: 0, dur, onDone: resolve };
    });
  }

  // Animate holding dice (move to tray)
  holdDice(indices) {
    for (const i of indices) this.dice[i].state = "tray";
    let trayI = 0;
    for (const die of this.dice) {
      if (die.state !== "tray") continue;
      const slot = TRAY_SLOTS[trayI++];
      die.mesh.position.y = HALF;
      die._moveTween = { from: die.mesh.position.clone(), to: new THREE.Vector3(slot[0], HALF, slot[2]), t: 0, dur: 0.45 };
    }
  }

  // Move everything back to the table (new turn / hot dice / after bust reveal)
  resetAll() {
    for (const die of this.dice) {
      die.state = "table";
      die.physicsActive = false;
      die.snapping = false;
      die.vel.set(0, 0, 0);
      die.angVel.set(0, 0, 0);
      die.settleTimer = 0;
    }
    this._relayout(REST_SLOTS, [0, 1, 2, 3, 4, 5], false);
    for (const die of this.dice) die.mesh.quaternion.identity();
  }

  // Gather the given dice into a bunched cluster at the left edge of the
  // play space, then launch them rolling across the table with simple but
  // bounded rigid-body physics. Resolves with { index: finalValue } once
  // every die has come to rest -- the value is read from each die's actual
  // settled orientation, not chosen in advance.
  //
  // `forcedValues` (optional, { [index]: value }) makes specific dice settle
  // on a known outcome instead of whatever their own physics lands on --
  // used to replay another player's already-rolled result over the network:
  // the tumble is still fully simulated locally (same gather/launch/bounce),
  // only the final settle target is overridden.
  async rollIndices(indices, forcedValues) {
    const count = indices.length;
    // Space the gather line wider than the collision separation distance
    // (DIE_SIZE * sqrt2), otherwise the dice shove each other apart the
    // instant physics kicks in and some get knocked backwards off the line.
    const spacing = DIE_SIZE * Math.SQRT2 * 1.1;
    const gatherPromises = indices.map((i, k) => {
      const die = this.dice[i];
      const zSpread = (k - (count - 1) / 2) * spacing;
      const x = PLAY.xMin + 1.1 + (Math.random() - 0.5) * 0.4;
      const z = zSpread + (Math.random() - 0.5) * 0.2;
      return this._tweenTo(die, new THREE.Vector3(x, HALF, z), 0.4);
    });
    await Promise.all(gatherPromises);
    await wait(90);

    return new Promise((resolve) => {
      const results = {};
      let pending = count;
      indices.forEach((i) => {
        const die = this.dice[i];

        // Aim for a specific travel distance rather than picking a raw speed
        // and hoping friction stops it somewhere reasonable: since friction
        // dominates (gravity/hop just gets the die onto the felt quickly),
        // distance-traveled ~= speed / LAUNCH_FRICTION_K, so we solve for the
        // speed that lands within a controlled, varied, in-bounds zone.
        const targetDist = 5 + Math.random() * 4.5; // ~28%-53% of the table width
        const vz = (Math.random() - 0.5) * 4.5;
        const vx = Math.max(1, targetDist * LAUNCH_FRICTION_K - Math.abs(vz) * 0.15);
        die.vel.set(vx, 1.6 + Math.random() * 1.2, vz);

        // Initial spin: mostly a forward tumble axis (perpendicular to the
        // travel direction) plus some chaotic wobble, set once and left to
        // decay naturally -- not recomputed from velocity every frame, so it
        // tumbles like a thrown die instead of rolling like a smooth wheel.
        const dir = new THREE.Vector3(vx, 0, vz).normalize();
        const rollAxis = new THREE.Vector3().crossVectors(UP, dir).normalize();
        const rollSpeed = (Math.hypot(vx, vz) / HALF) * 0.75;
        die.angVel.copy(rollAxis).multiplyScalar(rollSpeed);
        die.angVel.x += (Math.random() - 0.5) * 9;
        die.angVel.y += (Math.random() - 0.5) * 9;
        die.angVel.z += (Math.random() - 0.5) * 9;

        die.physicsActive = true;
        die.snapping = false;
        die.settleTimer = 0;
        die.rollTime = 0;
        die.forcedValue = forcedValues ? forcedValues[i] : undefined;
        die._resolve = (value) => {
          results[i] = value;
          pending--;
          if (pending === 0) resolve(results);
        };
      });
    });
  }

  _stepPhysics(dt) {
    for (const die of this.dice) {
      if (!die.physicsActive) continue;
      die.rollTime += dt;

      die.vel.y += GRAVITY * dt;
      die.mesh.position.addScaledVector(die.vel, dt);

      const grounded = die.mesh.position.y <= HALF + 0.02;

      // Angular velocity just decays over time -- fast while grounded (the
      // tumble dies down in step with the slide), slow while airborne (it
      // keeps tumbling mid-hop). It is never recomputed from linear velocity,
      // which is what made the die look like a smoothly rolling wheel.
      const angDampMul = grounded
        ? Math.pow(ANGULAR_DAMPING_GROUND_PS, dt)
        : Math.pow(ANGULAR_DAMPING_AIR_PS, dt);
      die.angVel.multiplyScalar(angDampMul);

      const angSpeed = die.angVel.length();
      if (angSpeed > 0.0001) {
        const axis = die.angVel.clone().normalize();
        const dq = new THREE.Quaternion().setFromAxisAngle(axis, angSpeed * dt);
        die.mesh.quaternion.premultiply(dq).normalize();
      }

      // Tip-over: once a grounded die is tumbling too slowly to roll over
      // another edge, gravity tips it onto whichever face is already
      // closest to up. This is applied *during* the simulation, so the die
      // visibly wobbles flat as it stops -- it never rests on an edge
      // waiting for a cosmetic fix-up afterwards. The pull strengthens as
      // the tumble fades (fully taking over when angVel ~ 0).
      if (grounded && angSpeed < TIP_ANG_THRESH) {
        const top = die.topFace();
        const misalign = Math.acos(THREE.MathUtils.clamp(top.dot, -1, 1));
        if (misalign > 0.0005) {
          const tipAxis = new THREE.Vector3().crossVectors(top.normal, UP);
          if (tipAxis.lengthSq() > 1e-10) {
            tipAxis.normalize();
            const fade = 1 - angSpeed / TIP_ANG_THRESH;
            const step = Math.min(misalign, TIP_RATE * misalign * fade * dt + 0.5 * fade * dt);
            const dq = new THREE.Quaternion().setFromAxisAngle(tipAxis, step);
            die.mesh.quaternion.premultiply(dq).normalize();
          }
        }
      }

      // Bounce (impact only) is separate from continuous rolling friction
      // below, so friction scales with elapsed time, not substep count.
      if (die.mesh.position.y < HALF) {
        die.mesh.position.y = HALF;
        if (die.vel.y < 0) {
          die.vel.y = -die.vel.y * RESTITUTION_GROUND;
          if (die.vel.y < 0.6) die.vel.y = 0;
        }
      }
      if (grounded) {
        // While tumbling, only edges/corners touch the felt (light rolling
        // friction). Once the die lies flat on a face, the whole face grips
        // the cloth: sliding friction jumps way up and low speeds stop dead.
        const flatContact =
          die.angVel.length() < TIP_ANG_THRESH && die.topFace().dot >= FLAT_DOT_THRESH;
        const frictionMul = Math.pow(
          flatContact ? FLAT_FRICTION_PS : GROUND_FRICTION_PS,
          dt
        );
        die.vel.x *= frictionMul;
        die.vel.z *= frictionMul;
        if (flatContact && Math.hypot(die.vel.x, die.vel.z) < FLAT_STOP_SPEED) {
          die.vel.x = 0;
          die.vel.z = 0;
        }
      }

      const xLimit = PLAY.xMax - HALF, xMinL = PLAY.xMin + HALF;
      const zLimit = PLAY.zMax - HALF, zMinL = PLAY.zMin + HALF;
      if (die.mesh.position.x > xLimit) {
        die.mesh.position.x = xLimit;
        die.vel.x = -Math.abs(die.vel.x) * RESTITUTION_WALL;
      } else if (die.mesh.position.x < xMinL) {
        die.mesh.position.x = xMinL;
        die.vel.x = Math.abs(die.vel.x) * RESTITUTION_WALL;
      }
      if (die.mesh.position.z > zLimit) {
        die.mesh.position.z = zLimit;
        die.vel.z = -Math.abs(die.vel.z) * RESTITUTION_WALL;
      } else if (die.mesh.position.z < zMinL) {
        die.mesh.position.z = zMinL;
        die.vel.z = Math.abs(die.vel.z) * RESTITUTION_WALL;
      }
    }

    this._resolveDiceCollisions();

    for (const die of this.dice) {
      if (!die.physicsActive) continue;
      const linSpeed = die.vel.length();
      const angSpeed = die.angVel.length();
      const grounded = die.mesh.position.y <= HALF + 0.01;
      // A die only counts as settled once it is slow AND flat -- the
      // tip-over above keeps working until the face is flush, so a die
      // paused on an edge is not "done", it still has tipping to do.
      const flat = grounded && die.topFace().dot >= SETTLE_FLAT_THRESH;
      if (flat && linSpeed < SETTLE_LIN_THRESH && angSpeed < SETTLE_ANG_THRESH) {
        die.settleTimer += dt;
      } else {
        die.settleTimer = 0;
      }
      if (die.settleTimer >= SETTLE_TIME || die.rollTime >= MAX_ROLL_TIME) {
        this._beginSnap(die);
      }
    }
  }

  // Simple equal-mass 2D (XZ-plane) impulse collision between dice: bodies
  // that are still rolling bounce off each other (and off already-settled
  // dice, treated as immovable) with real velocity exchange, not just a
  // positional nudge.
  _resolveDiceCollisions() {
    const bodies = this.dice.filter((d) => d.physicsActive || d.state === "table");
    // Worst-case safe separation for two unit-square footprints at any
    // relative yaw (their diagonal, not just their flat width) -- this
    // guarantees the boxes never visually intersect, regardless of rotation.
    const minDist = DIE_SIZE * Math.SQRT2;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const aActive = a.physicsActive, bActive = b.physicsActive;
        if (!aActive && !bActive) continue;

        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.0001 || dist >= minDist) continue;
        const nx = dx / dist, nz = dz / dist;

        const overlap = minDist - dist;
        if (aActive && bActive) {
          a.mesh.position.x -= nx * overlap * 0.5;
          a.mesh.position.z -= nz * overlap * 0.5;
          b.mesh.position.x += nx * overlap * 0.5;
          b.mesh.position.z += nz * overlap * 0.5;
        } else if (aActive) {
          a.mesh.position.x -= nx * overlap;
          a.mesh.position.z -= nz * overlap;
        } else {
          b.mesh.position.x += nx * overlap;
          b.mesh.position.z += nz * overlap;
        }

        const relVX = (bActive ? b.vel.x : 0) - (aActive ? a.vel.x : 0);
        const relVZ = (bActive ? b.vel.z : 0) - (aActive ? a.vel.z : 0);
        const relDotN = relVX * nx + relVZ * nz;
        if (relDotN >= 0) continue; // separating already

        const massFactor = aActive && bActive ? 0.5 : 1;
        const impulse = -(1 + RESTITUTION_DICE) * relDotN * massFactor;
        const kick = Math.min(Math.abs(impulse) * 3, 14);
        if (aActive) {
          a.vel.x -= nx * impulse;
          a.vel.z -= nz * impulse;
          a.angVel.add(new THREE.Vector3((Math.random() - 0.5) * kick, (Math.random() - 0.5) * kick, (Math.random() - 0.5) * kick));
        }
        if (bActive) {
          b.vel.x += nx * impulse;
          b.vel.z += nz * impulse;
          b.angVel.add(new THREE.Vector3((Math.random() - 0.5) * kick, (Math.random() - 0.5) * kick, (Math.random() - 0.5) * kick));
        }
      }
    }
  }

  // Finalize a settled die. Thanks to the tip-over physics the die is
  // already lying flat (or within a fraction of a degree of it), so this is
  // the *minimal* rotation that trues up the face -- it preserves the die's
  // current yaw/heading rather than spinning to some canonical pose, making
  // the correction imperceptible.
  _beginSnap(die) {
    die.physicsActive = false;
    die.snapping = true;
    const forced = die.forcedValue;
    const value = forced ?? die.topFace().value;
    const normal = forced ? die.worldNormalForValue(forced) : die.topFace().normal;
    die.value = value;
    die.forcedValue = undefined;
    const align = new THREE.Quaternion().setFromUnitVectors(normal, UP);
    die._snapFrom = die.mesh.quaternion.clone();
    die._snapTo = align.multiply(die.mesh.quaternion).normalize();
    die._snapT = 0;
    if (forced) {
      // A forced correction can be a much bigger turn than the usual
      // "true up the flush face" nudge (e.g. this die's own physics landed
      // on the opposite face from the authoritative result) -- scale the
      // duration with the angle so it reads as a quick corrective flip
      // instead of a jarring instant pop.
      const dot = THREE.MathUtils.clamp(Math.abs(die._snapFrom.dot(die._snapTo)), -1, 1);
      const angle = 2 * Math.acos(dot);
      die._snapDur = THREE.MathUtils.clamp((angle / Math.PI) * 0.4, 0.1, 0.4);
    } else {
      die._snapDur = 0.1;
    }
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this._stepPhysics(sub);

    for (const die of this.dice) {
      if (die.snapping) {
        die._snapT += dt;
        const p = Math.min(die._snapT / die._snapDur, 1);
        die.mesh.quaternion.slerpQuaternions(die._snapFrom, die._snapTo, p);
        die.mesh.position.y = HALF;
        if (p >= 1) {
          die.snapping = false;
          const cb = die._resolve;
          die._resolve = null;
          if (cb) cb(die.value);
        }
      }

      if (die._moveTween) {
        const mt = die._moveTween;
        mt.t += dt;
        const p = Math.min(mt.t / mt.dur, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        die.mesh.position.lerpVectors(mt.from, mt.to, ease);
        die.mesh.position.y = HALF + Math.sin(p * Math.PI) * 0.3;
        if (p >= 1) {
          die.mesh.position.y = HALF;
          die._moveTween = null;
          if (mt.onDone) mt.onDone();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
