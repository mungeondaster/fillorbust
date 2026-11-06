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
import { feltTexture } from "./common.js?v=24";

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

export default {
  id: "kitchen",
  name: "Kitchen Table",

  async build({ root, renderer, quality }) {
    const texLoader = new THREE.TextureLoader();
    const [gltf, info, lmTable, lmTray] = await Promise.all([
      new GLTFLoader().loadAsync(BASE + "kitchen.glb"),
      fetch(BASE + "scene.json").then((r) => r.json()),
      loadTex(texLoader, BASE + "lm_table.jpg"),
      loadTex(texLoader, BASE + "lm_tray.jpg"),
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
    const pad = scorepadTexture();
    pad.flipY = false; // glTF UV convention, like every texture on this model

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
      camera: { pitchDeg: 56, margin: 1.06 },
      dice: {
        body: ["#fffdf7", "#efe8d8"],
        pip: "#15100c",
        onePip: "#a8231b",
        roughness: 0.28,
      },
      sound: { floor: 1, wall: 1, die: 1 },
    };
  },
};
