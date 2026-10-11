# Example: the procedural grey-box of the era-outfit case (top-down camera, rug, sofa, lying figure, ceiling fan).
# Layout numbers are pixel positions measured on that source; reuse the helpers (P, box, capsule) for other scenes.
# Grey-box (白模) of the era-outfit reel: top-down static camera, rug, sofa, a lying mannequin, a 3-blade ceiling fan
# that sweeps right->left at the measured times. Run: E:/blender.exe -b -P era_scene.py -- <out_dir> <mode: grey|depth>
import bpy, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_grey')
MODE = argv[1] if len(argv) > 1 else 'grey'
FPS, DUR = 30, 15.16
W, H = 720, 1280

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, round(DUR * FPS)

def P(x, y, z=0.0):
    """image pixel (x right, y down) -> world (1 unit = 100 px, Y up)"""
    return Vector((x / 100 - 3.6, 6.4 - y / 100, z))

def shade(obj, grey, height):
    # grey: colour in the grey render; height: brightness in the depth-like render (closer to camera = brighter)
    v = grey if MODE == 'grey' else height
    obj.color = (v, v, v, 1)

def box(name, x0, y0, x1, y1, z0, z1, grey, height, bevel=0.0):
    c = (P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    bpy.ops.mesh.primitive_cube_add(location=c)
    o = bpy.context.object; o.name = name
    o.scale = (abs(x1 - x0) / 200, abs(y1 - y0) / 200, (z1 - z0) / 2)
    if bevel:
        m = o.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 4
    shade(o, grey, height); return o

def capsule(name, a, b, r, z, grey, height):
    pa, pb = P(*a, z), P(*b, z)
    d = pb - pa
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(pa + pb) / 2, vertices=24)
    o = bpy.context.object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    shade(o, grey, height)
    for p in (pa, pb):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=24, ring_count=12)
        shade(bpy.context.object, grey, height)
    return o

# floor, rug, sofa (positions measured on the source frame)
box('floor', -200, -200, 920, 1480, -0.05, 0.0, 0.42, 0.05)
box('rug', 165, 150, 760, 1165, 0.0, 0.02, 0.78, 0.10)
box('sofa_base', -40, 90, 178, 1195, 0.0, 0.45, 0.36, 0.30, bevel=0.06)
box('sofa_seat1', 0, 380, 165, 645, 0.45, 0.62, 0.40, 0.36, bevel=0.05)
box('sofa_seat2', 0, 655, 165, 1045, 0.45, 0.62, 0.40, 0.36, bevel=0.05)

# lying mannequin (coarse): head, torso, hips, legs, arms
MZ, MG, MH = 0.18, 0.88, 0.25
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.42, location=P(398, 405, MZ + 0.1), segments=32, ring_count=16)
o = bpy.context.object; o.scale = (1, 1.15, 0.9); shade(o, MG, MH)
capsule('neck', (398, 455), (398, 490), 0.12, MZ, MG, MH)
capsule('torso', (398, 520), (398, 760), 0.72, MZ, MG, MH)
capsule('hips', (398, 780), (398, 900), 0.68, MZ, MG, MH)
capsule('leg_l', (370, 900), (378, 1135), 0.26, MZ, MG, MH)
capsule('leg_r', (430, 900), (415, 1135), 0.26, MZ, MG, MH)
capsule('upper_arm_l', (330, 500), (262, 580), 0.17, MZ, MG, MH)
capsule('fore_arm_l', (262, 580), (345, 645), 0.15, MZ, MG, MH)
capsule('upper_arm_r', (470, 500), (525, 620), 0.17, MZ, MG, MH)
capsule('fore_arm_r', (525, 620), (590, 740), 0.15, MZ, MG, MH)
for x in (378, 415):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, location=P(x, 1150, MZ), segments=16, ring_count=8)
    o = bpy.context.object; o.scale = (0.8, 1.5, 0.8); shade(o, MG, MH)
if os.environ.get('BLOCKOUT_ROBE') == '1':
    # finer grey-box: a person in a long robe -- short hair cap, a flared robe from shoulders to ankles, wide sleeves,
    # so the depth control reads "clothed person", not a smooth mannequin
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.46, location=P(398, 385, MZ + 0.18), segments=32, ring_count=16)
    o = bpy.context.object; o.scale = (1.0, 0.9, 0.55); shade(o, 0.70, 0.30)          # hair
    top, hem = P(398, 495, MZ + 0.15), P(398, 1110, MZ + 0.15)
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.85, radius2=1.35, depth=(hem - top).length, location=(top + hem) / 2)
    o = bpy.context.object; o.rotation_euler = (math.radians(90), 0, 0); o.scale = (1.0, 0.45, 1.0)
    m = o.modifiers.new('bev', 'BEVEL'); m.width = 0.15; m.segments = 4; shade(o, 0.80, 0.28)   # robe
    capsule('sleeve_l', (330, 505), (262, 585), 0.30, MZ + 0.1, 0.80, 0.28)
    capsule('sleeve_r', (470, 505), (530, 630), 0.30, MZ + 0.1, 0.80, 0.28)

# ceiling fan: hub + 3 long blades on a rotating empty, high above everything
HUB = (370, 20)
bpy.ops.object.empty_add(location=P(*HUB, 3.0)); fan = bpy.context.object; fan.name = 'fan'
bpy.ops.mesh.primitive_cylinder_add(radius=1.9, depth=0.3, location=P(*HUB, 3.2), vertices=64)
hub = bpy.context.object; shade(hub, 0.55, 0.95); hub.parent = fan; hub.matrix_parent_inverse = fan.matrix_world.inverted()
bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=0.3, location=P(*HUB, 3.4), vertices=64)
cap = bpy.context.object; shade(cap, 0.62, 1.0); cap.parent = fan; cap.matrix_parent_inverse = fan.matrix_world.inverted()
BLADE_LEN, BLADE_W = 10.2, 1.95
for k in range(3):
    ang = math.radians(-25 - 120 * k)            # image angles 25, 145, 265 deg (y down) -> world negative
    d = Vector((math.cos(ang), math.sin(ang), 0))
    c = P(*HUB, 3.0) + d * (BLADE_LEN / 2 + 0.6)
    bpy.ops.mesh.primitive_cube_add(location=c)
    b = bpy.context.object; b.name = f'blade{k}'
    b.scale = (BLADE_LEN / 2, BLADE_W / 2, 0.06); b.rotation_euler = (0, 0, ang)
    m = b.modifiers.new('bev', 'BEVEL'); m.width = 0.5; m.segments = 8
    shade(b, 0.58, 0.9)
    b.parent = fan; b.matrix_parent_inverse = fan.matrix_world.inverted()

# sweeps: fan angle per frame fitted to the blade position tracked on the source (fan_keys.json: [frame, deg])
import json, os
keys = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fan_keys.json')))
fan.rotation_euler = (0, 0, 0); fan.keyframe_insert('rotation_euler', index=2, frame=1)
for f, deg in keys:
    fan.rotation_euler[2] = math.radians(deg); fan.keyframe_insert('rotation_euler', index=2, frame=f)

# top-down orthographic camera
bpy.ops.object.camera_add(location=(0, 0, 20)); cam = bpy.context.object
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 12.8; cam.rotation_euler = (0, 0, 0)
sc.camera = cam

# Workbench: object colours, soft studio light, shadows + cavity for the grey render; flat for the depth-like render
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.color_type = 'OBJECT'
sh.light = 'STUDIO' if MODE == 'grey' else 'FLAT'
sh.show_shadows = MODE == 'grey'
sh.show_cavity = MODE == 'grey'
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = OUT.rstrip('/') + '/f_'
if len(argv) > 2:                                    # preview: only the listed frames
    for f in map(int, argv[2].split(',')):
        sc.frame_set(f); sc.render.filepath = OUT.rstrip('/') + f'/p_{f:04d}.png'
        bpy.ops.render.render(write_still=True)
    print('PREVIEW', argv[2])
else:
    bpy.ops.render.render(animation=True)
    print('RENDERED', sc.frame_end)
