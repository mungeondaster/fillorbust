"""Builds the Kitchen Table scene for Fill or Bust.

Run headless (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_kitchen.py

Inputs:  ../fill-or-bust-art-src (CC0 Poly Haven assets, fetched by tools/fetch-art.mjs)
Outputs: assets/scenes/kitchen/kitchen.glb          geometry + base textures
         assets/scenes/kitchen/lm_table.png / lm_tray.png   baked lightmaps (UV channel 2)
         assets/scenes/kitchen/scene.json           lightmap scale + bake info

Units: 1 Blender unit = 1 die = 16 mm (so a 1 m object is 62.5 units). The
dice tray's inner play area matches PLAY in js/dice3d.js exactly
(x -9..9, z -5..5, felt surface at y = 0), plus a held-dice strip at z 5.3..7.5.

Lighting strategy (the big mobile win): every static surface's lighting --
lamp pool, soft shadows from the props, bounce light -- is baked once here
into a lightmap. At runtime those surfaces are drawn unlit (MeshBasicMaterial
+ lightMap), so phones pay nothing for it. Only the dice and the props get
real-time light.
"""
import bpy, bmesh, os, math, json
import numpy as np
from mathutils import Vector, Matrix, Euler

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.abspath(os.path.join(REPO, "..", "fill-or-bust-art-src"))
OUT = os.path.join(REPO, "assets", "scenes", "kitchen")
os.makedirs(OUT, exist_ok=True)

S = 62.5          # Blender units per meter
TABLE_Y = -0.4    # tabletop height (game y); tray felt sits at y = 0
RUNNER_Y = TABLE_Y + 0.08
LM_SIZE = 1024
SAMPLES = 4096


def g(x, y, z):
    """Game coords (y-up, +z toward the player) -> Blender coords (z-up)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- setup ---
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.sample_clamp_indirect = 2.0  # kills bounce-light fireflies
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.cycles.device = "GPU"
except Exception as e:  # CPU fallback still works, just slower
    print("GPU unavailable:", e)

export_col = bpy.data.collections.new("Export")
bake_only_col = bpy.data.collections.new("BakeOnly")
scene.collection.children.link(export_col)
scene.collection.children.link(bake_only_col)


def link(ob, col):
    for c in ob.users_collection:
        c.objects.unlink(ob)
    col.objects.link(ob)


# ------------------------------------------------------------ materials ---
def load_img(path, noncolor=False, max_size=None):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    if max_size and im.size[0] > max_size:
        im.scale(max_size, max_size)
    return im


def tex_mat(name, folder, prefix, res="2k", tint=None, rough_mul=1.0, max_size=1024):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    base = os.path.join(ART, "textures", folder, prefix)
    diff = nt.nodes.new("ShaderNodeTexImage")
    diff.image = load_img(f"{base}_diff_{res}.jpg", max_size=max_size)
    if tint:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(diff.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*tint, 1)
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    else:
        nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    # Only the color texture: these surfaces are drawn unlit with a baked
    # lightmap at runtime, so normal/roughness maps would never be used (and
    # baking a tiling normal map into a low-res lightmap just aliases).
    bsdf.inputs["Roughness"].default_value = 0.7 * rough_mul
    return m


def flat_mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def srgb(hexstr):
    """Hex sRGB -> linear RGB tuple for Blender color inputs."""
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


table_mat = tex_mat("TableWood", "wood_table_worn", "wood_table_worn")
tray_mat = tex_mat("TrayWood", "wood_table_worn", "wood_table_worn", tint=srgb("8a5a3c"))
runner_mat = tex_mat("Gingham", "gingham_check", "gingham_check")
felt_mat = flat_mat("Felt", srgb("1d5a3a"), rough=0.95)
paper_mat = flat_mat("Paper", srgb("f4efe2"), rough=0.9)
pencil_paint = flat_mat("PencilPaint", srgb("f2b81e"), rough=0.45)
pencil_wood = flat_mat("PencilWood", srgb("dcb27c"), rough=0.8)
pencil_lead = flat_mat("PencilLead", srgb("2a2a2a"), rough=0.4, metal=0.3)
pencil_ferrule = flat_mat("PencilFerrule", srgb("c9c4b8"), rough=0.3, metal=1.0)
pencil_eraser = flat_mat("PencilEraser", srgb("e88a8a"), rough=0.85)


# ------------------------------------------------------------- geometry ---
def box(name, xmin, xmax, ymin, ymax, zmin, zmax, mat, tile=None, bevel=0.0, col=export_col, drop_bottom=True, drop_top=False):
    """Axis-aligned box in game coords, with world-space box-projected UVs
    (so tiling textures keep a consistent physical scale across objects)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = xmax - xmin, zmax - zmin, ymax - ymin  # blender x, y, z extents
    center = g((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    if drop_bottom:
        # Everything here rests on something -- its underside is never seen,
        # and would otherwise eat half of the lightmap's resolution.
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context="FACES_ONLY")
    if drop_top:
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.9], context="FACES_ONLY")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    me.materials.append(mat)
    if bevel > 0:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        apply_mods(ob)
    if tile:
        box_project_uv(ob, tile)
    return ob


def apply_mods(ob):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def box_project_uv(ob, tile, rotate=0.0):
    me = ob.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    c, s = math.cos(rotate), math.sin(rotate)
    mw = ob.matrix_world
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.y, co.z
            u, v = u * c - v * s, u * s + v * c
            uv.data[li].uv = (u / tile, v / tile)


# Table: a big farmhouse table (2.24 m x 1.44 m); the far end fades into fog.
table = box("Table", -70, 70, TABLE_Y - 2.5, TABLE_Y, -65, 25, table_mat, tile=S * 0.9)

# Gingham runner behind the tray, along the table's length.
runner = box("Runner", -70, 70, TABLE_Y, RUNNER_Y, -27, -7.2, runner_mat, tile=S * 0.35)

# Dice tray. Inner play area x -9..9, z -5..5; held strip z 5.3..7.5.
W = 0.6        # wall thickness
WALL_TOP = 1.15
tray_parts = [
    box("TrayBase", -9 - W, 9 + W, TABLE_Y, -0.02, -5 - W, 7.5 + W, tray_mat, tile=S * 0.5, bevel=0.15, drop_top=True),
    box("TrayWallL", -9 - W, -9, -0.02, WALL_TOP, -5 - W, 7.5 + W, tray_mat, tile=S * 0.5, bevel=0.14),
    box("TrayWallR", 9, 9 + W, -0.02, WALL_TOP, -5 - W, 7.5 + W, tray_mat, tile=S * 0.5, bevel=0.14),
    box("TrayWallB", -9, 9, -0.02, WALL_TOP, -5 - W, -5, tray_mat, tile=S * 0.5, bevel=0.14),
    box("TrayWallF", -9, 9, -0.02, WALL_TOP, 7.5, 7.5 + W, tray_mat, tile=S * 0.5, bevel=0.14),
    box("TrayDivider", -9, 9, -0.02, 0.55, 5.0, 5.3, tray_mat, tile=S * 0.5, bevel=0.1),
]
tray_felt = [
    box("TrayFeltPlay", -9, 9, -0.04, 0.0, -5, 5, felt_mat, tile=6),
    box("TrayFeltHold", -9, 9, -0.04, 0.0, 5.3, 7.5, felt_mat, tile=6),
]


def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


tray = join("TrayFrame", tray_parts)
felt = join("TrayFelt", tray_felt)

# Scorepad: a stack of paper with its top face mapped 0..1 so the game can
# draw its own canvas texture (header, tally marks) onto it.
pad_rot = math.radians(-9)
pad = box("ScorePad", -3.25, 3.25, TABLE_Y, TABLE_Y + 0.35, -4.75, 4.75, paper_mat)
pad.data.uv_layers.new(name="UVMap")
uvl = pad.data.uv_layers["UVMap"]
for poly in pad.data.polygons:
    for li in poly.loop_indices:
        co = pad.data.vertices[pad.data.loops[li].vertex_index].co
        if poly.normal.z > 0.9:
            uvl.data[li].uv = ((co.x + 3.25) / 6.5, (co.y + 4.75) / 9.5)
        else:
            uvl.data[li].uv = (0.02, 0.02)  # sides: plain paper edge
pad.rotation_euler = (0, 0, -pad_rot)
pad.location = g(14.2, 0, 0.6) - g(0, 0, 0)
bpy.context.view_layer.update()


def cyl(name, verts, r1, r2, depth, mat):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    link(ob, export_col)
    return ob


# Pencil: built along +Z, then laid on the table.
R = 0.22
parts = []
body = cyl("PencilBody", 6, R, R, 10.0, pencil_paint); body.location = (0, 0, 0); parts.append(body)
cone = cyl("PencilCone", 6, R, 0.06, 1.3, pencil_wood); cone.location = (0, 0, 5.65); parts.append(cone)
lead = cyl("PencilLead", 6, 0.06, 0.005, 0.25, pencil_lead); lead.location = (0, 0, 6.42); parts.append(lead)
ferr = cyl("PencilFerrule", 16, R * 1.04, R * 1.04, 0.7, pencil_ferrule); ferr.location = (0, 0, -5.35); parts.append(ferr)
eras = cyl("PencilEraser", 16, R * 0.98, R * 0.98, 0.55, pencil_eraser); eras.location = (0, 0, -5.95); parts.append(eras)
for p in parts:
    bpy.ops.object.select_all(action="DESELECT"); p.select_set(True)
    bpy.context.view_layer.objects.active = p
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pencil = join("Pencil", parts)
# Lay it down flat on a hex face, angled across the right of the tray.
pencil.rotation_euler = Euler((math.radians(90), 0, 0), "XYZ")
pencil.rotation_euler.rotate(Euler((0, 0, math.radians(-62))))
pencil.location = g(14.4, TABLE_Y + 0.35 + R * 0.87, 1.2)
for poly in pencil.data.polygons:
    poly.use_smooth = False


# ---------------------------------------------------------------- props ---
def import_gltf(asset):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ART, "models", asset, asset + ".gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        link(o, export_col)
    return {o.name: o for o in new}


def place(ob, x, z, base_y, rot_deg=0.0, scale=S, decimate=None, extra_rot=None):
    """Scale to game units, optionally decimate, rest its bottom on base_y."""
    ob.scale = (scale, scale, scale)
    ob.rotation_euler = Euler((0, 0, math.radians(rot_deg)))
    if extra_rot:
        ob.rotation_euler.rotate(extra_rot)
    ob.location = (0, 0, 0)
    bpy.context.view_layer.update()
    if decimate:
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris > decimate:
            mod = ob.modifiers.new("Dec", "DECIMATE")
            mod.ratio = decimate / tris
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    apply_mods(ob)
    zs = [v.co.z for v in ob.data.vertices]
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    target = g(x, base_y, z)
    ob.location = (target.x - cx, target.y - cy, target.z - min(zs))
    return ob


tea = import_gltf("tea_set_01")
for nm in ("tea_set_01_cup_small_02", "tea_set_01_plate_large_circular_03",
           "tea_set_01_plate_large_square_01", "tea_set_01_saucer_circular_03"):
    bpy.data.objects.remove(tea.pop(nm))
saucer = place(tea["tea_set_01_saucer_circular_04"], 16.5, -13.5, RUNNER_Y, decimate=900)
cup = place(tea["tea_set_01_cup_small_01"], 16.5, -13.5, RUNNER_Y + 0.75, rot_deg=-35, decimate=1600)
teapot = place(tea["tea_set_01_teapot_01"], 27.0, -19.5, RUNNER_Y, rot_deg=-120, decimate=2600)
teapot_lid = tea["tea_set_01_teapot_01_lid"]
sugar = place(tea["tea_set_01_sugar_cup_01"], 5.5, -21.0, RUNNER_Y, rot_deg=15, decimate=1600)
sugar_lid = tea["tea_set_01_sugar_cup_01_lid"]


def place_lid(lid, on, rot_deg):
    zs = [(on.matrix_world @ v.co).z for v in on.data.vertices]
    top = max(zs)
    lid.scale = (S, S, S)
    lid.rotation_euler = Euler((0, 0, math.radians(rot_deg)))
    lid.location = (0, 0, 0)
    bpy.context.view_layer.update()
    mod = lid.modifiers.new("Dec", "DECIMATE"); mod.ratio = 0.35
    bpy.ops.object.select_all(action="DESELECT"); lid.select_set(True)
    bpy.context.view_layer.objects.active = lid
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    apply_mods(lid)
    xs = [v.co.x for v in lid.data.vertices]; ys = [v.co.y for v in lid.data.vertices]
    lz = [v.co.z for v in lid.data.vertices]
    ox = [(on.matrix_world @ v.co) for v in on.data.vertices]
    # Center the lid over the vessel's opening (its top ring), not its
    # overall bbox (a teapot's spout/handle skew that).
    ring = [p for p in ox if p.z > top - 0.6]
    rcx = sum(p.x for p in ring) / len(ring); rcy = sum(p.y for p in ring) / len(ring)
    lid.location = (rcx - (min(xs) + max(xs)) / 2, rcy - (min(ys) + max(ys)) / 2, top - 0.9 - min(lz))


place_lid(teapot_lid, teapot, -120)
place_lid(sugar_lid, sugar, 15)

bowl = place(import_gltf("wooden_bowl_01")["wooden_bowl_01"], -19.0, -15.5, RUNNER_Y, decimate=3000)
apple_src = import_gltf("food_apple_01")["food_apple_01"]
apple2_src = apple_src.copy(); apple2_src.data = apple_src.data.copy(); export_col.objects.link(apple2_src)
apple3_src = apple_src.copy(); apple3_src.data = apple_src.data.copy(); export_col.objects.link(apple3_src)
apple1 = place(apple_src, -21.3, -16.5, RUNNER_Y + 1.1, rot_deg=20, decimate=1400,
               extra_rot=Euler((math.radians(12), 0, 0)))
apple2 = place(apple2_src, -16.6, -15.0, RUNNER_Y + 1.1, rot_deg=140, decimate=1400,
               extra_rot=Euler((0, math.radians(-15), 0)))
lemon = place(import_gltf("lemon")["lemon"], -19.2, -12.2, RUNNER_Y + 1.6, rot_deg=70, decimate=900,
              extra_rot=Euler((math.radians(90), 0, 0)))
# One stray apple on the bare table, left of the tray.
apple3 = place(apple3_src, -15.5, -1.0, TABLE_Y, rot_deg=-50, decimate=1400)
for o in (apple1, apple2, apple3):
    o.name = o.name.replace("food_", "")

# Pendant lamp: bake-only (above the camera), its shade shapes the light pool.
lamp = import_gltf("hanging_industrial_lamp")["hanging_industrial_lamp"]
link(lamp, bake_only_col)
lamp.scale = (S, S, S)
bpy.context.view_layer.update()
zs = [(lamp.matrix_world @ v.co).z for v in lamp.data.vertices]
LAMP_X, LAMP_Z, SHADE_BOTTOM = 0.0, -3.0, TABLE_Y + 40.0
lamp.location = g(LAMP_X, 0, LAMP_Z) + Vector((0, 0, SHADE_BOTTOM - min(zs)))

bulb = bpy.data.lights.new("Bulb", "POINT")
bulb.energy = 300000
bulb.color = (1.0, 0.78, 0.52)
bulb.shadow_soft_size = 2.0
bulb_ob = bpy.data.objects.new("Bulb", bulb)
bake_only_col.objects.link(bulb_ob)
bulb_ob.location = g(LAMP_X, SHADE_BOTTOM + 3.5, LAMP_Z)

# Soft room light from the HDRI, kept dim so the lamp pool reads.
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
env = wnt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(ART, "hdri", "kiara_interior_2k.hdr"))
bg = wnt.nodes["Background"]
bg.inputs["Strength"].default_value = 0.2
wnt.links.new(env.outputs["Color"], bg.inputs["Color"])

# Shrink every prop texture: these are seen small on a phone.
for im in bpy.data.images:
    if im.source == "FILE" and im.filepath.lower().endswith(".jpg") and "models" in im.filepath and im.size[0] > 512:
        im.scale(512, 512)


# ----------------------------------------------------------------- bake ---
def setup_lightmap(objs, image):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        me = o.data
        if "UVMap" not in me.uv_layers:
            me.uv_layers.new(name="UVMap")
        lm = me.uv_layers.get("Lightmap") or me.uv_layers.new(name="Lightmap")
        me.uv_layers.active = lm
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        for slot in o.material_slots:
            nt = slot.material.node_tree
            node = nt.nodes.get("LM") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "LM"
            node.image = image
            nt.nodes.active = node


def bake(objs, image):
    setup_lightmap(objs, image)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    scene.render.bake.margin = 12
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=12)


lm_table = bpy.data.images.new("lm_table", LM_SIZE, LM_SIZE, float_buffer=True)
lm_tray = bpy.data.images.new("lm_tray", LM_SIZE, LM_SIZE, float_buffer=True)
table_group = [table, runner, pad]
tray_group = [tray, felt]
bake(table_group, lm_table)
bake(tray_group, lm_tray)


def px(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def blur(rgb):
    # Light 5x5 box blur: smooths leftover path-tracing noise; lighting is
    # low-frequency so this costs no visible detail.
    r = 2
    p = np.pad(rgb, ((r, r), (r, r), (0, 0)), mode="edge")
    h, w = rgb.shape[:2]
    acc = sum(p[r + dy:r + dy + h, r + dx:r + dx + w] for dy in range(-r, r + 1) for dx in range(-r, r + 1))
    return acc / float((2 * r + 1) ** 2)


a_t, a_r = px(lm_table)[..., :3], px(lm_tray)[..., :3]
lum = np.concatenate([a_t.reshape(-1, 3), a_r.reshape(-1, 3)]).max(axis=1)
peak = float(np.percentile(lum[lum > 1e-5], 99.5))
scale = 0.95 / peak


def save_lm(arr, name):
    lin = np.clip(blur(arr) * scale, 0, 1)
    enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    h, w = enc.shape[:2]
    rgba = np.concatenate([enc, np.ones((h, w, 1), np.float32)], axis=2)
    out = bpy.data.images.new(name + "_out", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(rgba.astype(np.float32).ravel())
    out.filepath_raw = os.path.join(OUT, name + ".jpg")
    out.file_format = "JPEG"
    out.save()


save_lm(a_t, "lm_table")
save_lm(a_r, "lm_tray")

# Remove bake target nodes so they don't confuse the exporter.
for o in table_group + tray_group:
    for slot in o.material_slots:
        n = slot.material.node_tree.nodes.get("LM")
        if n:
            slot.material.node_tree.nodes.remove(n)
    o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    o["lightmap"] = "lm_table" if o in table_group else "lm_tray"

# ---------------------------------------------------------------- export ---
bpy.ops.object.select_all(action="DESELECT")
for o in export_col.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "kitchen.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_extras=True,
    export_lights=False,
    export_cameras=False,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)

info = {
    "lightmapScale": 1.0 / scale,
    "lamp": {"x": LAMP_X, "y": SHADE_BOTTOM + 3.5, "z": LAMP_Z},
    "tableY": TABLE_Y,
}
with open(os.path.join(OUT, "scene.json"), "w") as f:
    json.dump(info, f, indent=2)

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in export_col.objects if o.type == "MESH")
print("BUILD_OK tris=%d peak=%.4f" % (tris, peak))
