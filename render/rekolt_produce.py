"""
Rekolt — procedural produce renders for the landing page.

Run headless once Blender is installed:

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" ^
        --background --python render\\rekolt_produce.py

Output: render/out/<subject>.png — square, transparent background, Cycles.
Drop them into assets/produce/ and the page picks them up.

Render one subject only:
    blender --background --python render/rekolt_produce.py -- --only ravioli

Faster preview (fewer samples, half resolution):
    blender --background --python render/rekolt_produce.py -- --draft

Honest note on what this can and cannot do
------------------------------------------
Pasta renders well here: matte surface, simple colour, geometric form. Ravioli
and lasagne sheets are the strongest subjects in this file by a wide margin.
The vegetables are procedural approximations — good enough as supporting
imagery on a dark ground at moderate size, not a substitute for photography of
the actual produce. Shoot the real thing when you can; this exists so the page
is not empty in the meantime.
"""

import sys
import math
import os

import bpy
import bmesh
from mathutils import Vector

# ── Settings ───────────────────────────────────────────────────────────────
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DRAFT = "--draft" in ARGS
ONLY = None
if "--only" in ARGS:
    ONLY = ARGS[ARGS.index("--only") + 1]

RES = 640 if DRAFT else 1000
SAMPLES = 48 if DRAFT else 180

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


# ── Scene helpers ──────────────────────────────────────────────────────────
def wipe():
    """Empty the file completely, including orphaned data blocks."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials,
                  bpy.data.objects, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"

    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        try:
            prefs.preferences.compute_device_type = "CUDA"
            for dev in prefs.preferences.devices:
                dev.use = True
            scene.cycles.device = "GPU"
        except Exception:
            scene.cycles.device = "CPU"

    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.transmission_bounces = 6

    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # Filmic/AgX crush saturation badly on a product shot against transparency —
    # pale food comes out bone white. Standard keeps the albedo we authored;
    # contrast comes from the light rig instead.
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.35
    scene.view_settings.gamma = 1.0


def add_camera(location=(0, -3.4, 1.5), look_at=(0, 0, 0.28), lens=58):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = location

    direction = Vector(look_at) - Vector(location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def add_area(name, location, energy, size, rotation=(0, 0, 0), color=(1, 1, 1)):
    light_data = bpy.data.lights.new(name, type="AREA")
    light_data.energy = energy
    light_data.size = size
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    light.rotation_euler = rotation
    bpy.context.collection.objects.link(light)
    return light


def studio_light():
    """Three-point rig. Strong directional key for form, deep fill so shadows
    stay rich against the page's near-black ground, cool rim to separate the
    silhouette from it."""
    key = add_area("key", (-1.9, -2.0, 2.6), 85, 1.8, color=(1.0, 0.95, 0.86))
    key.rotation_euler = (Vector((0, 0, 0.2)) - key.location).to_track_quat("-Z", "Y").to_euler()

    fill = add_area("fill", (2.4, -1.4, 0.7), 14, 2.6, color=(0.78, 0.86, 1.0))
    fill.rotation_euler = (Vector((0, 0, 0.2)) - fill.location).to_track_quat("-Z", "Y").to_euler()

    rim = add_area("rim", (1.1, 2.4, 1.9), 70, 1.2, color=(0.88, 1.0, 0.80))
    rim.rotation_euler = (Vector((0, 0, 0.25)) - rim.location).to_track_quat("-Z", "Y").to_euler()

    top = add_area("top", (0.2, 0.1, 3.2), 30, 2.4, color=(1.0, 0.98, 0.94))
    top.rotation_euler = (0, 0, 0)


# ── Shading helpers ────────────────────────────────────────────────────────
def organic_material(name, base, rough=0.34, sss=0.22, sss_color=None,
                     bump_scale=28.0, bump_strength=0.14, spec=0.5):
    """Principled BSDF with subsurface and a procedural noise bump."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = rough

    # Blender renamed these sockets across versions; set defensively.
    for key, val in (("Subsurface Weight", sss), ("Subsurface", sss)):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val
            break
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = sss_color or (0.5, 0.18, 0.12)
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break

    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = bump_scale
    tex.inputs["Detail"].default_value = 8.0
    tex.inputs["Roughness"].default_value = 0.6

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength

    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def voronoi_material(name, base, scale=18.0, rough=0.3, strength=0.3):
    """For citrus pith and other cellular skins."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = rough

    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = scale
    vor.feature = "DISTANCE_TO_EDGE"

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.invert = True

    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def shade_smooth(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True


def subdivide(obj, levels=2, render_levels=3):
    mod = obj.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = render_levels
    return mod


def displace(obj, strength=0.02, scale=0.6, noise_type="STUCCI"):
    tex = bpy.data.textures.new(f"{obj.name}_disp", type="CLOUDS")
    tex.noise_scale = scale
    mod = obj.modifiers.new("disp", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    mod.mid_level = 0.5
    return mod


# ── Subjects ───────────────────────────────────────────────────────────────
def build_ravioli():
    """A crimped pillow. The best subject in this file — pasta is matte and
    geometric, which is exactly what procedural shading handles well."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=48,
                                    size=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "ravioli"

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)

    DOME = 0.30          # filled centre ends here
    SHOULDER = 0.38      # dome has fallen to the border by here
    HALF = 0.5

    for v in bm.verts:
        x, y = v.co.x, v.co.y
        edge = max(abs(x), abs(y))

        # 1. Filled centre: a real pillow. Chebyshev distance would dome this
        #    into a square pyramid with creases down the diagonals, so the
        #    falloff uses a superellipse — rounded-square, no creases.
        soft = ((abs(x) / HALF) ** 4.0 + (abs(y) / HALF) ** 4.0) ** 0.25 * HALF
        if soft < SHOULDER:
            t = min(1.0, soft / SHOULDER)
            v.co.z += (math.cos(t * math.pi * 0.5) ** 1.25) * 0.20

        # 2. Sealed border: flat, and pressed with fork tines running
        #    perpendicular to whichever edge this vertex belongs to.
        if edge > DOME:
            along = y if abs(x) > abs(y) else x
            ramp = min(1.0, (edge - DOME) / (HALF - DOME))
            v.co.z += math.sin(along * 74.0) * 0.017 * ramp

        # 3. Scalloped outer trim, so the silhouette is not a hard square.
        if edge > HALF - 0.035:
            along = y if abs(x) > abs(y) else x
            scallop = abs(math.sin(along * 37.0)) * 0.016
            if abs(x) > abs(y):
                v.co.x -= math.copysign(scallop, x)
            else:
                v.co.y -= math.copysign(scallop, y)

    bm.to_mesh(mesh)
    bm.free()

    solidify = obj.modifiers.new("solid", "SOLIDIFY")
    solidify.thickness = 0.03
    solidify.offset = 0

    subdivide(obj, 2, 3)
    displace(obj, strength=0.004, scale=0.12)   # semolina tooth
    shade_smooth(obj)

    obj.data.materials.append(organic_material(
        "pasta", base=(0.88, 0.66, 0.23), rough=0.72, sss=0.14,
        sss_color=(0.35, 0.24, 0.10), bump_scale=340, bump_strength=0.26, spec=0.18))

    obj.rotation_euler = (0, 0, math.radians(18))
    return obj, (0, -2.55, 1.85), (0, 0, 0.02)


def build_lasagne():
    """A single ruffled sheet, draped."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=64, y_subdivisions=44,
                                    size=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "lasagne"

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)

    for v in bm.verts:
        x, y = v.co.x * 1.5, v.co.y
        # gentle drape across the length, ruffle along the long edges
        v.co.x = x
        v.co.z += math.sin(x * 2.1) * 0.06 + math.cos(y * 1.7) * 0.03
        if abs(y) > 0.42:
            v.co.z += math.sin(x * 16.0) * 0.035

    bm.to_mesh(mesh)
    bm.free()

    solidify = obj.modifiers.new("solid", "SOLIDIFY")
    solidify.thickness = 0.012
    subdivide(obj, 2, 3)
    shade_smooth(obj)

    obj.data.materials.append(organic_material(
        "pasta_sheet", base=(0.91, 0.78, 0.45), rough=0.66, sss=0.12,
        sss_color=(0.4, 0.3, 0.15), bump_scale=120, bump_strength=0.06, spec=0.22))

    obj.rotation_euler = (0, 0, math.radians(-14))
    obj.scale = (1.25, 1.25, 1.25)
    return obj, (0, -3.1, 1.7), (0, 0, 0.0)


def build_tomato():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=0.5)
    obj = bpy.context.active_object
    obj.name = "tomato"
    obj.scale = (1.0, 1.0, 0.84)
    bpy.ops.object.transform_apply(scale=True)

    # lobes
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for v in bm.verts:
        ang = math.atan2(v.co.y, v.co.x)
        r = math.hypot(v.co.x, v.co.y)
        if r > 1e-6:
            lobe = 1.0 + math.cos(ang * 5.0) * 0.016
            v.co.x *= lobe
            v.co.y *= lobe
    bm.to_mesh(mesh)
    bm.free()

    subdivide(obj, 1, 2)
    shade_smooth(obj)
    obj.data.materials.append(organic_material(
        "tomato_skin", base=(0.62, 0.05, 0.03), rough=0.17, sss=0.35,
        sss_color=(0.7, 0.15, 0.1), bump_scale=60, bump_strength=0.05, spec=0.75))

    # calyx
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=0.17, radius2=0.02,
                                    depth=0.1, location=(0, 0, 0.42))
    calyx = bpy.context.active_object
    calyx.name = "tomato_calyx"
    calyx.rotation_euler = (math.radians(180), 0, 0)
    shade_smooth(calyx)
    calyx.data.materials.append(organic_material(
        "calyx", base=(0.13, 0.28, 0.07), rough=0.55, sss=0.18,
        sss_color=(0.2, 0.4, 0.1), bump_scale=140, bump_strength=0.25, spec=0.3))

    return obj, (0, -2.8, 1.3), (0, 0, 0.1)


def build_orange():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=0.5)
    obj = bpy.context.active_object
    obj.name = "orange"
    obj.scale = (1.0, 1.0, 0.94)
    bpy.ops.object.transform_apply(scale=True)
    subdivide(obj, 1, 2)
    shade_smooth(obj)
    obj.data.materials.append(voronoi_material(
        "orange_peel", base=(0.86, 0.36, 0.03), scale=44.0, rough=0.42, strength=0.22))
    return obj, (0, -2.7, 1.2), (0, 0, 0.05)


def build_cucumber():
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.19, depth=1.5)
    obj = bpy.context.active_object
    obj.name = "cucumber"

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for v in bm.verts:
        t = v.co.z / 0.75
        taper = 1.0 - 0.16 * (t ** 2)
        v.co.x *= taper
        v.co.y *= taper
        ang = math.atan2(v.co.y, v.co.x)
        ridge = 1.0 + math.cos(ang * 9.0) * 0.03
        v.co.x *= ridge
        v.co.y *= ridge
    bm.to_mesh(mesh)
    bm.free()

    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.06
    bevel.segments = 8
    subdivide(obj, 1, 2)
    displace(obj, strength=0.008, scale=0.18)
    shade_smooth(obj)
    obj.data.materials.append(organic_material(
        "cucumber_skin", base=(0.07, 0.24, 0.05), rough=0.3, sss=0.2,
        sss_color=(0.2, 0.45, 0.12), bump_scale=140, bump_strength=0.3, spec=0.6))

    obj.rotation_euler = (math.radians(74), 0, math.radians(28))
    return obj, (0, -2.9, 1.1), (0, 0, 0.0)


def build_beetroot():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=56, ring_count=36, radius=0.46)
    obj = bpy.context.active_object
    obj.name = "beetroot"

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for v in bm.verts:
        t = (v.co.z + 0.46) / 0.92          # 0 at bottom, 1 at top
        pinch = 0.55 + 0.45 * (t ** 0.55)
        v.co.x *= pinch
        v.co.y *= pinch
        if t < 0.12:                        # draw the root out to a tail
            v.co.z -= (0.12 - t) * 1.6
    bm.to_mesh(mesh)
    bm.free()

    subdivide(obj, 1, 2)
    displace(obj, strength=0.012, scale=0.3)
    shade_smooth(obj)
    obj.data.materials.append(organic_material(
        "beet_skin", base=(0.21, 0.02, 0.08), rough=0.46, sss=0.3,
        sss_color=(0.45, 0.05, 0.18), bump_scale=70, bump_strength=0.2, spec=0.35))
    return obj, (0, -2.7, 1.25), (0, 0, 0.0)


def build_garlic():
    """A bulb, built from overlapping clove ellipsoids."""
    parent = bpy.data.objects.new("garlic", None)
    bpy.context.collection.objects.link(parent)

    mat = organic_material("garlic_skin", base=(0.90, 0.87, 0.80), rough=0.55,
                           sss=0.4, sss_color=(0.6, 0.5, 0.45),
                           bump_scale=110, bump_strength=0.18, spec=0.3)

    for i in range(9):
        ang = (i / 9.0) * math.tau
        bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=26, radius=0.2)
        clove = bpy.context.active_object
        clove.name = f"clove_{i}"
        clove.scale = (0.62, 0.62, 1.5)
        clove.location = (math.cos(ang) * 0.17, math.sin(ang) * 0.17, 0.0)
        clove.rotation_euler = (math.radians(9) * math.cos(ang),
                                math.radians(9) * math.sin(ang), 0)
        shade_smooth(clove)
        clove.data.materials.append(mat)
        clove.parent = parent

    # neck
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.07, radius2=0.015,
                                    depth=0.22, location=(0, 0, 0.36))
    neck = bpy.context.active_object
    shade_smooth(neck)
    neck.data.materials.append(organic_material(
        "garlic_neck", base=(0.72, 0.68, 0.55), rough=0.8, sss=0.1,
        bump_scale=200, bump_strength=0.3, spec=0.15))
    neck.parent = parent

    return parent, (0, -2.6, 1.2), (0, 0, 0.05)


def build_ginger():
    """Knobbly rhizome from a metaball chain."""
    mball = bpy.data.metaballs.new("ginger")
    mball.resolution = 0.045
    mball.render_resolution = 0.02
    obj = bpy.data.objects.new("ginger", mball)
    bpy.context.collection.objects.link(obj)

    segments = [
        ((0.00, 0.00, 0.00), 0.26),
        ((0.34, 0.05, 0.02), 0.22),
        ((0.62, -0.04, 0.01), 0.18),
        ((-0.30, -0.06, 0.03), 0.20),
        ((-0.55, 0.04, 0.00), 0.15),
        ((0.16, 0.24, 0.04), 0.14),
        ((-0.14, -0.26, 0.02), 0.13),
        ((0.48, 0.22, 0.00), 0.11),
    ]
    for loc, rad in segments:
        el = mball.elements.new()
        el.co = Vector(loc)
        el.radius = rad

    obj.scale = (1.0, 1.0, 0.62)
    obj.data.materials.append(organic_material(
        "ginger_skin", base=(0.76, 0.62, 0.37), rough=0.62, sss=0.24,
        sss_color=(0.5, 0.38, 0.2), bump_scale=55, bump_strength=0.35, spec=0.2))
    return obj, (0, -2.6, 1.35), (0, 0, 0.0)


def build_coconut():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=56, ring_count=36, radius=0.46)
    obj = bpy.context.active_object
    obj.name = "coconut"
    obj.scale = (0.92, 0.92, 1.05)
    bpy.ops.object.transform_apply(scale=True)
    subdivide(obj, 1, 2)
    displace(obj, strength=0.02, scale=0.22)
    shade_smooth(obj)
    obj.data.materials.append(organic_material(
        "coir", base=(0.29, 0.17, 0.09), rough=0.88, sss=0.05,
        bump_scale=190, bump_strength=0.55, spec=0.1))
    return obj, (0, -2.7, 1.2), (0, 0, 0.0)


def _coriander_leaflet(name, length=0.42):
    """One cotomili leaflet: a fan, deeply lobed at the outer edge, tapering
    to a narrow base. Built as an n-gon from a polar profile."""
    bm = bmesh.new()
    verts = []
    steps = 54
    for i in range(steps + 1):
        a = math.radians(-88 + (176 * i / steps))
        # fan profile: three deep lobes, each notched, on a narrow base
        # Coriander lobes are rounded scallops, not spines: keep the harmonics
        # low-frequency and the profile exponent below 1 so nothing comes to a point.
        lobe = 1.0 + 0.30 * math.cos(a * 3.0) - 0.09 * math.cos(a * 6.0)
        notch = 1.0 - 0.05 * abs(math.sin(a * 6.0))
        r = length * (0.20 + 0.80 * max(0.0, math.cos(a * 0.95)) ** 0.78) * lobe * notch
        x = math.sin(a) * r
        y = math.cos(a) * r
        z = (r / length) ** 2 * 0.045          # slight cupping
        verts.append(bm.verts.new((x, y, z)))
    verts.append(bm.verts.new((0.0, -0.02, 0.0)))   # base point
    bm.faces.new(verts)
    bm.normal_update()

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    solid = obj.modifiers.new("solid", "SOLIDIFY")
    solid.thickness = 0.0035
    subdivide(obj, 1, 2)
    shade_smooth(obj)
    return obj


def build_coriander():
    """Cotomili — a cut bunch. Leaflets instanced along splayed stems."""
    parent = bpy.data.objects.new("coriander", None)
    bpy.context.collection.objects.link(parent)

    leaf_mat = organic_material(
        "cotomili_leaf", base=(0.14, 0.42, 0.09), rough=0.42, sss=0.38,
        sss_color=(0.18, 0.45, 0.12), bump_scale=180, bump_strength=0.22, spec=0.4)
    stem_mat = organic_material(
        "cotomili_stem", base=(0.22, 0.46, 0.11), rough=0.5, sss=0.3,
        sss_color=(0.2, 0.45, 0.12), bump_scale=240, bump_strength=0.2, spec=0.35)

    import random
    random.seed(7)

    for s in range(7):
        splay = math.radians(-46 + s * 15.5)
        lean = math.radians(20 + random.uniform(-8, 10))
        height = 0.62 + random.uniform(-0.09, 0.13)

        # stem
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.008, depth=height)
        stem = bpy.context.active_object
        stem.name = f"stem_{s}"
        stem.location = (math.sin(splay) * 0.05, math.cos(splay) * 0.02, height / 2 - 0.12)
        stem.rotation_euler = (lean * math.cos(splay), lean * math.sin(splay), 0)
        shade_smooth(stem)
        stem.data.materials.append(stem_mat)
        stem.parent = parent

        # leaflets clustered at the stem head
        top_z = height - 0.14
        for k in range(7):
            lf = _coriander_leaflet(f"leaflet_{s}_{k}", length=0.115 + random.uniform(-0.022, 0.03))
            spin = splay + math.radians(-64 + k * 21 + random.uniform(-14, 14))
            tilt = math.radians(74 + random.uniform(-20, 16))
            lf.location = (
                math.sin(splay) * (0.05 + top_z * math.sin(lean)) + math.sin(spin) * 0.075,
                math.cos(splay) * (0.02 + top_z * math.sin(lean)) + math.cos(spin) * 0.075,
                top_z * math.cos(lean) - 0.10,
            )
            lf.rotation_euler = (tilt, random.uniform(-0.4, 0.4), spin)
            lf.data.materials.append(leaf_mat)
            lf.parent = parent

    return parent, (0, -1.55, 0.92), (0, 0, 0.30)


def build_basket():
    """A shallow market basket, loaded. The weave is suggested by banded
    displacement rather than modelled withies — at page size it reads, and
    modelling every strand costs render time for detail nobody sees."""
    parent = bpy.data.objects.new("basket", None)
    bpy.context.collection.objects.link(parent)

    # ── the basket shell
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.70, depth=0.42,
                                        end_fill_type="NOTHING",
                                        location=(0, 0, 0.21))
    shell = bpy.context.active_object
    shell.name = "basket_shell"

    mesh = shell.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.subdivide_edges(
        bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-5],
        cuts=22, use_grid_fill=False)
    for v in bm.verts:
        t = (v.co.z + 0.21) / 0.42              # 0 at foot, 1 at rim
        taper = 0.74 + 0.26 * t                 # narrower at the base
        band = math.sin(v.co.z * 86.0) * 0.02   # suggested weave
        k = taper * (1.0 + band)
        v.co.x *= k
        v.co.y *= k
    bm.to_mesh(mesh)
    bm.free()

    solid = shell.modifiers.new("solid", "SOLIDIFY")
    solid.thickness = 0.03
    subdivide(shell, 1, 2)
    shade_smooth(shell)
    shell.data.materials.append(organic_material(
        "wicker", base=(0.40, 0.25, 0.10), rough=0.86, sss=0.06,
        bump_scale=150, bump_strength=0.6, spec=0.12))
    shell.parent = parent

    # ── rim
    bpy.ops.mesh.primitive_torus_add(major_radius=0.72, minor_radius=0.032,
                                     major_segments=96, minor_segments=16,
                                     location=(0, 0, 0.42))
    rim = bpy.context.active_object
    shade_smooth(rim)
    rim.data.materials.append(organic_material(
        "rim_cane", base=(0.34, 0.20, 0.08), rough=0.8, sss=0.05,
        bump_scale=260, bump_strength=0.45, spec=0.14))
    rim.parent = parent

    # ── the load: real Rekolt lines, arranged the way a basket fills
    tomato_mat = organic_material("b_tomato", base=(0.58, 0.05, 0.03), rough=0.18,
                                  sss=0.35, sss_color=(0.7, 0.15, 0.1),
                                  bump_scale=70, bump_strength=0.05, spec=0.75)
    orange_mat = voronoi_material("b_orange", base=(0.84, 0.35, 0.03),
                                  scale=52.0, rough=0.44, strength=0.22)
    beet_mat = organic_material("b_beet", base=(0.21, 0.02, 0.08), rough=0.46,
                                sss=0.3, sss_color=(0.45, 0.05, 0.18),
                                bump_scale=80, bump_strength=0.2, spec=0.35)
    leaf_mat = organic_material("b_leaf", base=(0.13, 0.36, 0.07), rough=0.45,
                                sss=0.35, sss_color=(0.18, 0.45, 0.12),
                                bump_scale=170, bump_strength=0.25, spec=0.4)

    import random
    random.seed(19)

    load = [
        ((-0.30, -0.10, 0.44), 0.155, tomato_mat),
        ((-0.05, -0.26, 0.45), 0.150, tomato_mat),
        (( 0.24, -0.14, 0.44), 0.145, orange_mat),
        (( 0.36,  0.14, 0.45), 0.150, orange_mat),
        (( 0.06,  0.10, 0.50), 0.160, tomato_mat),
        ((-0.30,  0.24, 0.44), 0.140, beet_mat),
        (( 0.02,  0.36, 0.44), 0.135, beet_mat),
        ((-0.42,  0.02, 0.43), 0.130, orange_mat),
    ]
    for i, (loc, rad, mat) in enumerate(load):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=44, ring_count=28,
                                             radius=rad, location=loc)
        o = bpy.context.active_object
        o.name = f"load_{i}"
        o.scale = (1.0, 1.0, random.uniform(0.82, 0.95))
        o.rotation_euler = (random.uniform(0, 3), random.uniform(0, 3), random.uniform(0, 3))
        subdivide(o, 1, 2)
        shade_smooth(o)
        o.data.materials.append(mat)
        o.parent = parent

    # a few leaves spilling over the rim, so it reads as market produce
    for j in range(5):
        lf = _coriander_leaflet(f"basket_leaf_{j}", length=0.13)
        a = math.radians(20 + j * 63)
        lf.location = (math.sin(a) * 0.62, math.cos(a) * 0.62, 0.46)
        lf.rotation_euler = (math.radians(66), random.uniform(-0.5, 0.5), a + math.pi)
        lf.data.materials.append(leaf_mat)
        lf.parent = parent

    return parent, (0, -2.35, 1.45), (0, 0, 0.24)


SUBJECTS = {
    "ravioli": build_ravioli,
    "coriander": build_coriander,
    "basket": build_basket,
    "lasagne": build_lasagne,
    "tomato": build_tomato,
    "orange": build_orange,
    "cucumber": build_cucumber,
    "beetroot": build_beetroot,
    "garlic": build_garlic,
    "ginger": build_ginger,
    "coconut": build_coconut,
}


def render_subject(name, builder):
    wipe()
    setup_scene()
    studio_light()

    _obj, cam_loc, look_at = builder()
    add_camera(location=cam_loc, look_at=look_at)

    path = os.path.join(OUT, f"{name}.png")
    bpy.context.scene.render.filepath = path
    print(f"[rekolt] rendering {name} -> {path}  ({RES}px, {SAMPLES} samples)")
    bpy.ops.render.render(write_still=True)
    return path


def main():
    targets = SUBJECTS
    if ONLY:
        if ONLY not in SUBJECTS:
            print(f"[rekolt] unknown subject '{ONLY}'. Available: {', '.join(SUBJECTS)}")
            return
        targets = {ONLY: SUBJECTS[ONLY]}

    written = []
    for name, builder in targets.items():
        try:
            written.append(render_subject(name, builder))
        except Exception as exc:                      # keep the batch going
            print(f"[rekolt] FAILED {name}: {exc}")

    print(f"\n[rekolt] wrote {len(written)} file(s) to {OUT}")
    for p in written:
        print("  " + p)


if __name__ == "__main__":
    main()
