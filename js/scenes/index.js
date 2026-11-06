// Scene registry. Each scene is purely cosmetic and local to this device --
// in online games every player can pick their own without affecting anyone.
// To add one (casino, saloon...): create js/scenes/<id>.js exporting
// { id, name, build(ctx) } and list it here.
export const SCENES = [
  { id: "kitchen", name: "Kitchen Table", load: () => import("./kitchen.js?v=32") },
  { id: "classic", name: "Classic Felt", load: () => import("./classic.js?v=32") },
];

const KEY = "fob.scene";
export const DEFAULT_SCENE = "kitchen";

export function getSceneId() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch {}
  return SCENES.some((s) => s.id === id) ? id : DEFAULT_SCENE;
}

export function saveSceneId(id) {
  try { localStorage.setItem(KEY, id); } catch {}
}
