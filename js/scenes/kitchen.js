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
import { feltTexture } from "./common.js?v=55";
import { paintCardFace } from "../cardArt.js?v=55";

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

// The printed card back (js/cardArt.js), same as the 2D draw pile.
function cardBackTexture() {
  return canvasTex(390, 546, (x, w, h) => paintCardFace(x, "BACK", w, h));
}

// The real box is black all over.
function boxSideTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#0d0d0d";
    x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(255,255,255,0.18)";
    x.lineWidth = 3;
    x.strokeRect(9, 9, w - 18, h - 18);
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

// The box front, after the real Fill or Bust box: black, with the title
// running up the left edge, giant dice faces one to six (the top row cropped
// by the edge), and a spread of the game's cards in the corner.
//
// The cover is portrait. The box lies on its long side on the table (see
// BOX_YAW in the build script), so the cover is turned to put the title
// along the top, reading left to right from the player's seat -- just how
// the real box looks lying there.
export function paintBoxCover(x, w, h) {
  x.fillStyle = "#0b0b0b";
  x.fillRect(0, 0, w, h);

  // Dice faces 1-6 in two columns, the top row running off the edge.
  const S = w * 0.352, gap = w * 0.019;
  const x0 = w * 0.267, y0 = -S * 0.41;
  const PIPS = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  for (let v = 1; v <= 6; v++) {
    const col = (v - 1) % 2, row = Math.floor((v - 1) / 2);
    const dx = x0 + col * (S + gap), dy = y0 + row * (S + gap);
    x.fillStyle = "#fbfbf7";
    x.beginPath(); x.roundRect(dx, dy, S, S, S * 0.04); x.fill();
    x.fillStyle = "#0b0b0b";
    for (const [px, py] of PIPS[v]) {
      x.beginPath();
      x.arc(dx + S / 2 + px * S * 0.29, dy + S / 2 + py * S * 0.29, S * 0.088, 0, Math.PI * 2);
      x.fill();
    }
  }

  // FILL OR BUST! up the left side, tops of the letters facing left.
  const capH = w * 0.19;
  x.save();
  x.translate(w * 0.125, h / 2);
  x.rotate(-Math.PI / 2);
  x.font = `${capH / 0.87}px Anton, Impact, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "alphabetic";
  const title = "FILL OR BUST!";
  x.scale((h * 0.95) / x.measureText(title).width, 1);
  x.fillStyle = "#fbfbf7";
  x.fillText(title, 0, capH / 2);
  x.restore();
  x.fillStyle = "#fbfbf7";
  x.font = `${w * 0.03}px sans-serif`;
  x.fillText("®", w * 0.02, w * 0.045);

  // The fan of cards, white-edged, two rows.
  const cw = w * 0.235, ch = cw * 1.4;
  const card = (id, cx, cy, deg) => {
    x.save();
    x.translate(w * cx, h * cy);
    x.rotate((deg * Math.PI) / 180);
    x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 14; x.shadowOffsetY = 5;
    x.fillStyle = "#fbfbf7";
    const b = cw * 0.045;
    x.beginPath(); x.roundRect(-cw / 2 - b, -ch / 2 - b, cw + 2 * b, ch + 2 * b, cw * 0.07); x.fill();
    x.shadowColor = "transparent";
    x.beginPath(); x.roundRect(-cw / 2, -ch / 2, cw, ch, cw * 0.05); x.clip();
    x.translate(-cw / 2, -ch / 2);
    paintCardFace(x, id, cw, ch);
    x.restore();
  };
  card("FILL_1000", 0.42, 0.63, -13);
  card("DOUBLE_TROUBLE", 0.63, 0.615, -2);
  card("BONUS_500", 0.84, 0.63, 10);
  card("VENGEANCE", 0.43, 0.83, -8);
  card("MUST_BUST", 0.64, 0.835, 3);
  card("NO_DICE", 0.85, 0.83, 13);
}

function cardBoxFrontTexture() {
  return canvasTex(630, 885, (x, w, h) => {
    x.translate(w, h);
    x.rotate(Math.PI); // see paintBoxCover
    paintBoxCover(x, w, h);
  });
}

export default {
  id: "kitchen",
  name: "Kitchen Table",

  async build({ root, renderer, quality }) {
    const texLoader = new THREE.TextureLoader();
    const [gltf, info, lmTable, lmTray] = await Promise.all([
      new GLTFLoader().loadAsync(BASE + "kitchen.glb?v=55"),
      fetch(BASE + "scene.json?v=55").then((r) => r.json()),
      loadTex(texLoader, BASE + "lm_table.jpg?v=55"),
      loadTex(texLoader, BASE + "lm_tray.jpg?v=55"),
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
        document.fonts.load("40px Anton"),
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
