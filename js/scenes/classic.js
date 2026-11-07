// "Classic Felt": the original look -- a plain felt table with a thin wooden
// rail. Fully procedural (nothing to download), so it's also the instant
// fallback while another scene loads, and the lightest option for old phones.
import * as THREE from "../vendor/three.module.min.js";
import { feltTexture } from "./common.js?v=55";

export default {
  id: "classic",
  name: "Classic Felt",

  async build({ root, quality }) {
    const hemi = new THREE.HemisphereLight(0xfff6e5, 0x33261a, 0.65);
    root.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2da, 1.15);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 9, bottom: -8, near: 1, far: 40 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    root.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
    fill.position.set(-8, 6, -4);
    root.add(fill);

    const feltMap = feltTexture();
    feltMap.colorSpace = THREE.NoColorSpace; // matches the original look exactly
    feltMap.repeat.set(6, 4);
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.95 })
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    root.add(felt);

    const railMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1e, roughness: 0.6, metalness: 0.1 });
    const h = 0.5, t = 0.18, w = 18 + t * 2, d = 10 + t * 2;
    for (const [sx, sz, px, pz] of [[w, t, 0, -5 - t / 2], [w, t, 0, 5 + t / 2], [t, d, -9 - t / 2, 0], [t, d, 9 + t / 2, 0]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), railMat);
      rail.position.set(px, h / 2 - 0.05, pz);
      rail.castShadow = rail.receiveShadow = true;
      root.add(rail);
    }

    return {
      background: null, // transparent: the page's own green shows through
      fog: null,
      toneMapping: THREE.NoToneMapping,
      shadowCatcher: false,
      camera: { pitchDeg: 52, margin: 1.04 },
      dice: {},
      sound: { floor: 1, wall: 0.8, die: 1, feltCutoff: 3200 },
    };
  },
};
