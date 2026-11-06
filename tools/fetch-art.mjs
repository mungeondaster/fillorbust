// Downloads the CC0 Poly Haven source assets used to build the 3D scenes into
// ../fill-or-bust-art-src (outside the repo). Only the processed, phone-sized
// output of tools/blender/*.py is committed. Run: node tools/fetch-art.mjs
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fill-or-bust-art-src");

const TEXTURES = { wood_table_worn: "2k", gingham_check: "2k" };
const TEXTURE_MAPS = ["Diffuse", "nor_gl", "Rough"];
const HDRIS = { kiara_interior: "2k" };
const MODELS = {
  tea_set_01: "1k",
  wooden_bowl_01: "1k",
  food_apple_01: "1k",
  lemon: "1k",
  hanging_industrial_lamp: "1k",
};

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function fetchTo(url, dest) {
  if (await exists(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log("  ", dest.replace(ROOT, ""));
}

async function files(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`);
  return res.json();
}

for (const [id, res] of Object.entries(TEXTURES)) {
  console.log("texture", id);
  const f = await files(id);
  for (const map of TEXTURE_MAPS) {
    const entry = f[map][res].jpg;
    await fetchTo(entry.url, join(ROOT, "textures", id, entry.url.split("/").pop()));
  }
}

for (const [id, res] of Object.entries(HDRIS)) {
  console.log("hdri", id);
  const f = await files(id);
  const entry = f.hdri[res].hdr;
  await fetchTo(entry.url, join(ROOT, "hdri", entry.url.split("/").pop()));
}

for (const [id, res] of Object.entries(MODELS)) {
  console.log("model", id);
  const f = await files(id);
  const g = f.gltf[res].gltf;
  const dir = join(ROOT, "models", id);
  await fetchTo(g.url, join(dir, `${id}.gltf`));
  for (const [rel, inc] of Object.entries(g.include)) {
    await fetchTo(inc.url, join(dir, rel));
  }
}
console.log("done ->", ROOT);
