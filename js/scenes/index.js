// Scene registry. Each scene is purely cosmetic and local to this device --
// in online games every player can pick their own without affecting anyone.
// To add one (casino, saloon...): create js/scenes/<id>.js exporting
// { id, name, build(ctx) } and list it here.
export const SCENES = [
  { id: "kitchen", name: "Kitchen Table", load: () => import("./kitchen.js?v=55") },
  { id: "classic", name: "Classic Felt", load: () => import("./classic.js?v=55") },
];

const KEY = "fob.scene";
export const DEFAULT_SCENE = "kitchen";

// The table picker is hidden for now, so everyone gets the default table
// (a choice saved earlier is ignored until the picker comes back).
export const SCENE_PICKER = false;

export function getSceneId() {
  if (!SCENE_PICKER) return DEFAULT_SCENE;
  let id = null;
  try { id = localStorage.getItem(KEY); } catch {}
  return SCENES.some((s) => s.id === id) ? id : DEFAULT_SCENE;
}

export function saveSceneId(id) {
  try { localStorage.setItem(KEY, id); } catch {}
}
