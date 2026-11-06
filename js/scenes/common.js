// Shared building blocks for scenes: procedural textures and dice geometry.
import * as THREE from "../vendor/three.module.min.js";

export function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Tileable felt cloth: base color + per-pixel grain + faint crossed weave.
export function feltTexture(base = "#0f5132", size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
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
  ctx.lineWidth = 1;
  for (const [style, dir] of [["rgba(0,0,0,0.06)", 1], ["rgba(255,255,255,0.035)", -1]]) {
    ctx.strokeStyle = style;
    for (let x = -size; x < size * 2; x += 5) {
      ctx.beginPath();
      ctx.moveTo(dir > 0 ? x : x + size, 0);
      ctx.lineTo(dir > 0 ? x + size : x, size);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const PIP_LAYOUTS = (c, q) => ({
  1: [[c, c]],
  2: [[c - q, c - q], [c + q, c + q]],
  3: [[c - q, c - q], [c, c], [c + q, c + q]],
  4: [[c - q, c - q], [c + q, c - q], [c - q, c + q], [c + q, c + q]],
  5: [[c - q, c - q], [c + q, c - q], [c, c], [c - q, c + q], [c + q, c + q]],
  6: [[c - q, c - q], [c + q, c - q], [c - q, c], [c + q, c], [c - q, c + q], [c + q, c + q]],
});

// Default dice look; scenes override any of these.
export const DEFAULT_DICE_STYLE = {
  body: ["#fdfaf3", "#eee7d6"], // gradient corner-to-corner
  pip: "#120c08",
  onePip: null,                   // e.g. "#b3261e" for a red ace
  pipScale: 0.09,
  roughness: 0.35,
  bump: true,
};

// Color map + matching bump map (pips recessed into the face).
export function pipTextures(value, style) {
  const s = { ...DEFAULT_DICE_STYLE, ...style };
  const size = 256;
  const make = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    return canvas;
  };
  const color = make(), bump = make();
  const cx = color.getContext("2d"), bx = bump.getContext("2d");
  const grad = cx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, s.body[0]);
  grad.addColorStop(1, s.body[1]);
  cx.fillStyle = grad;
  cx.fillRect(0, 0, size, size);
  cx.strokeStyle = "rgba(0,0,0,0.12)";
  cx.lineWidth = 6;
  cx.strokeRect(3, 3, size - 6, size - 6);
  bx.fillStyle = "#fff";
  bx.fillRect(0, 0, size, size);

  const r = size * s.pipScale * (value === 1 && s.onePip ? 1.45 : 1);
  const pipColor = value === 1 && s.onePip ? s.onePip : s.pip;
  const c = size / 2, q = size * 0.26;
  for (const [x, y] of PIP_LAYOUTS(c, q)[value]) {
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    const g = cx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r * 1.1);
    g.addColorStop(0, shade(pipColor, 0.25));
    g.addColorStop(1, pipColor);
    cx.fillStyle = g;
    cx.fill();
    // Bump: a soft-edged dish, darkest (deepest) in the middle.
    const bg = bx.createRadialGradient(x, y, 0, x, y, r * 1.12);
    bg.addColorStop(0, "#000");
    bg.addColorStop(0.75, "#222");
    bg.addColorStop(1, "#fff");
    bx.fillStyle = bg;
    bx.beginPath();
    bx.arc(x, y, r * 1.12, 0, Math.PI * 2);
    bx.fill();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bumpMap = new THREE.CanvasTexture(bump);
  return { map, bumpMap };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => clampByte(Math.round(v + (255 - v) * amt));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// Box with rounded edges/corners (vertices pulled toward a smaller core box
// then pushed out to a fixed radius).
export function roundedBoxGeometry(size, radius, segments) {
  const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const pos = geo.attributes.position;
  const core = size / 2 - radius;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
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
