// "Kitchen Table": a walnut dice tray on a farmhouse table under a warm
// pendant lamp, with a gingham runner, fruit bowl, tea set and a scorepad.
//
// Built by tools/blender/build_kitchen.py. Every static surface's lighting
// (the lamp pool, prop shadows, bounce light) is baked into two lightmaps,
// so the table, runner, tray and pad render unlit -- nearly free on phones.
// Only the dice and props get real-time light.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "../vendor/addons/environments/RoomEnvironment.js";
import { feltTexture } from "./common.js?v=33";

const BASE = "assets/scenes/kitchen/";
const FOG = 0x140d08;

function loadTex(loader, url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}

function scorepadTexture() {
  const w = 512, h = 748;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#f6f1e3";
  x.fillRect(0, 0, w, h);
  // Ruled lines + margin, like a cheap score pad.
  x.strokeStyle = "rgba(70,110,170,0.35)";
  x.lineWidth = 2;
  for (let y = 150; y < h - 20; y += 44) {
    x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
  }
  x.strokeStyle = "rgba(200,60,60,0.45)";
  x.beginPath(); x.moveTo(88, 0); x.lineTo(88, h); x.stroke();
  x.strokeStyle = "rgba(70,110,170,0.35)";
  x.beginPath(); x.moveTo(300, 120); x.lineTo(300, h); x.stroke();
  // Pencil handwriting.
  x.fillStyle = "rgba(55,55,60,0.85)";
  x.font = "700 52px 'Fredoka', 'Comic Sans MS', cursive";
  x.textAlign = "center";
  x.fillText("FILL or BUST", w / 2, 82);
  x.font = "500 30px 'Fredoka', 'Comic Sans MS', cursive";
  x.textAlign = "left";
  const rows = [["Mom", "2,450"], ["Dad", "3,100"], ["Gran", "1,900"]];
  rows.forEach(([n, s], i) => {
    x.fillText(n, 104, 182 + i * 44);
    x.fillText(s, 316, 182 + i * 44);
  });
  // A few tally strikes for flavor.
  x.strokeStyle = "rgba(55,55,60,0.7)";
  x.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    x.beginPath(); x.moveTo(110 + i * 16, 340); x.lineTo(114 + i * 16, 372); x.stroke();
  }
  x.beginPath(); x.moveTo(100, 366); x.lineTo(172, 346); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function canvasTex(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function drawStripes(x, w, h, stripe) {
  x.fillStyle = "#7a1f2b";
  x.fillRect(0, 0, w, h);
  x.strokeStyle = "#8f2534";
  x.lineWidth = stripe;
  for (let d = -h; d < w + h; d += stripe * 2) {
    x.beginPath(); x.moveTo(d, h); x.lineTo(d + h, 0); x.stroke();
  }
}

function goldFrame(x, w, h, inset, width) {
  x.strokeStyle = "#d4af37";
  x.lineWidth = width;
  x.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
}

// Same red-striped back as the 2D draw pile, so the deck reads as "ours".
function cardBackTexture() {
  return canvasTex(390, 550, (x, w, h) => {
    drawStripes(x, w, h, 11);
    goldFrame(x, w, h, 7, 10);
  });
}

function boxSideTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#7a1f2b";
    x.fillRect(0, 0, w, h);
    goldFrame(x, w, h, 10, 6);
  });
}

// Deck edge: cream with fine lines, one per few cards.
function cardEdgeTexture() {
  return canvasTex(64, 256, (x, w, h) => {
    x.fillStyle = "#f1e9d6";
    x.fillRect(0, 0, w, h);
    for (let y = 2; y < h; y += 5) {
      x.fillStyle = `rgba(90,70,40,${0.12 + Math.random() * 0.12})`;
      x.fillRect(0, y, w, 1.4);
    }
  });
}

// The box front: the game's logo, in the same Cinzel gold as the title
// screen, on deep felt green. The box lies on its side (see BOX_YAW in the
// build script), so the artwork is laid out landscape and rotated 90 degrees
// onto the portrait texture -- it then reads upright from the player's seat.
function cardBoxFrontTexture() {
  return canvasTex(630, 885, (x, cw) => {
    x.translate(cw, 0);
    x.rotate(Math.PI / 2);
    const w = 885, h = 630;
    const bg = x.createRadialGradient(w * 0.55, h / 2, 40, w / 2, h / 2, w * 0.6);
    bg.addColorStop(0, "#1a6e44");
    bg.addColorStop(0.55, "#0f5132");
    bg.addColorStop(1, "#08301e");
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    goldFrame(x, w, h, 22, 6);
    goldFrame(x, w, h, 36, 2);

    // Two dice, mid-tumble.
    const die = (cx, cy, s, rot, pips) => {
      x.save();
      x.translate(cx, cy); x.rotate(rot);
      x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowBlur = 16; x.shadowOffsetY = 8;
      x.fillStyle = "#fbf6ea";
      x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, s * 0.18); x.fill();
      x.shadowColor = "transparent";
      x.fillStyle = "#16100b";
      const q = s * 0.26;
      for (const [px, py] of pips) {
        x.beginPath(); x.arc(px * q, py * q, s * 0.09, 0, Math.PI * 2); x.fill();
      }
      x.restore();
    };
    die(195, 230, 140, -0.3, [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]);
    die(250, 395, 120, 0.26, [[0, 0]]);
    x.fillStyle = "#a8231b"; // red ace, matching the kitchen dice
    x.save(); x.translate(250, 395); x.beginPath(); x.arc(0, 0, 120 * 0.13, 0, Math.PI * 2); x.fill(); x.restore();

    const gold = x.createLinearGradient(0, 120, 0, 480);
    gold.addColorStop(0, "#f7e7a1");
    gold.addColorStop(0.5, "#e2c158");
    gold.addColorStop(1, "#b98f26");
    const tx = 600;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.shadowColor = "rgba(0,0,0,0.55)"; x.shadowBlur = 10; x.shadowOffsetY = 5;
    x.fillStyle = gold;
    x.font = "700 132px Cinzel, Georgia, serif";
    x.fillText("FILL", tx, 200);
    x.fillStyle = "#fdfaf3";
    x.font = "italic 600 52px Cinzel, Georgia, serif";
    x.fillText("or", tx, 304);
    x.fillStyle = gold;
    x.font = "700 132px Cinzel, Georgia, serif";
    x.fillText("BUST", tx, 408);
    x.shadowColor = "transparent";
    x.fillStyle = "rgba(253,250,243,0.85)";
    x.font = "600 30px Fredoka, sans-serif";
    x.fillText("A dice & card push-your-luck game", w / 2, 548);
  });
}

export default {
  id: "kitchen",
  name: "Kitchen Table",

  async build({ root, renderer, quality }) {
    const texLoader = new THREE.TextureLoader();
    const [gltf, info, lmTable, lmTray] = await Promise.all([
      new GLTFLoader().loadAsync(BASE + "kitchen.glb?v=33"),
      fetch(BASE + "scene.json?v=33").then((r) => r.json()),
      loadTex(texLoader, BASE + "lm_table.jpg?v=33"),
      loadTex(texLoader, BASE + "lm_tray.jpg?v=33"),
    ]);
    const lightmaps = { lm_table: lmTable, lm_tray: lmTray };
    for (const t of Object.values(lightmaps)) {
      t.flipY = false;          // glTF UV convention
      t.channel = 1;            // second UV set (TEXCOORD_1)
      t.colorSpace = THREE.SRGBColorSpace; // stored sRGB-encoded, see build script
    }
    // MeshBasicMaterial scales lightmaps by 1/PI; undo that and the bake's
    // normalization so 1.0 in the image == the lighting Blender computed.
    const lmIntensity = Math.PI * info.lightmapScale * 0.62;

    const felt = feltTexture("#1d5a3a");
    // The card box's logo uses the game's own web fonts; make sure they're
    // ready before painting it onto a canvas (falls back gracefully if not).
    try {
      await Promise.all([
        document.fonts.load("700 64px Cinzel"),
        document.fonts.load("600 24px Fredoka"),
      ]);
    } catch {}
    const pad = scorepadTexture();
    const printed = {
      CardBoxFront: cardBoxFrontTexture(),
      CardBoxSide: boxSideTexture(),
      CardBack: cardBackTexture(),
      CardEdge: cardEdgeTexture(),
    };
    for (const t of [pad, ...Object.values(printed)]) {
      t.flipY = false; // glTF UV convention, like every texture on this model
      t.anisotropy = quality.tier === "low" ? 2 : 8;
    }

    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const lmName = o.userData.lightmap;
      if (lmName) {
        const old = o.material;
        const mat = new THREE.MeshBasicMaterial({
          map: old.map || null,
          lightMap: lightmaps[lmName],
          lightMapIntensity: lmIntensity,
        });
        if (old.name === "TrayWood") mat.color.set(0xd2a07a);
        if (old.name === "Felt") mat.map = felt;
        if (old.name === "Paper") {
          mat.map = pad;
          mat.lightMapIntensity = lmIntensity * 0.9;
        }
        if (mat.map) mat.map.anisotropy = quality.tier === "low" ? 2 : 8;
        o.material = mat;
        old.dispose();
      } else {
        // Props: real-time lit, but their shadows are already baked onto
        // the table, so they neither cast nor receive dynamic shadows.
        o.castShadow = false;
        o.receiveShadow = false;
        const print = printed[o.material.name];
        if (print) {
          o.material.map = print;
          o.material.color.set(0xffffff);
          o.material.needsUpdate = true;
        }
        if (o.material.normalMap && quality.tier === "low") {
          o.material.normalMap = null;
          o.material.needsUpdate = true;
        }
      }
    });
    root.add(gltf.scene);

    // Real-time light for dice and props, matching the baked lamp.
    const lamp = info.lamp;
    const spot = new THREE.SpotLight(0xffd6a8, 5.2, 0, 0.62, 0.85, 0);
    spot.position.set(lamp.x, lamp.y, lamp.z);
    spot.target.position.set(0, 0, 0.5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    spot.shadow.camera.near = 25;
    spot.shadow.camera.far = 60;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.03;
    spot.shadow.radius = 3;
    root.add(spot, spot.target);

    const hemi = new THREE.HemisphereLight(0xb7c3d6, 0x3a2416, 0.9);
    root.add(hemi);

    // Soft reflections on the dice/teapot glaze.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    return {
      background: new THREE.Color(FOG),
      fog: { color: FOG, near: 1.25, far: 3.2 }, // multiples of camera distance
      environment: env,
      environmentIntensity: 0.35,
      toneMapping: THREE.NeutralToneMapping,
      exposure: 1.0,
      shadowCatcher: { opacity: 0.55, color: 0x1a0e06 },
      camera: {
        pitchDeg: 56,
        margin: 1.06,
        // The card box in front of the tray (see BOX_X/BOX_Z in the build
        // script): framed in whenever the screen shape leaves room.
        extra: new THREE.Box3(new THREE.Vector3(-10, 0, 8), new THREE.Vector3(-4, 1.5, 12.2)),
      },
      dice: {
        body: ["#fffdf7", "#efe8d8"],
        pip: "#15100c",
        onePip: "#a8231b",
        roughness: 0.28,
      },
      // Felt-lined walnut tray: muffled landings, lively wooden walls.
      sound: { floor: 1, wall: 1.1, die: 0.9, feltCutoff: 2400 },
    };
  },
};
