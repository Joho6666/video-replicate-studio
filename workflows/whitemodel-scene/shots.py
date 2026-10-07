# 用法: blender --background --python shots.py   （输出到 ./shots/S1..S3.png，可用环境变量 WM_OUT 改目录）
import bpy, math, random, os
OUT=os.environ.get('WM_OUT', os.path.join(os.getcwd(),'shots'))
os.makedirs(OUT,exist_ok=True)
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'; sc.render.resolution_x, sc.render.resolution_y = 1280,720
sh=sc.display.shading; sh.light='STUDIO'; sh.color_type='SINGLE'; sh.single_color=(0.82,0.82,0.8)
sh.show_cavity=True; sh.show_shadows=True; sh.shadow_intensity=0.55
sh.show_object_outline=True; sh.object_outline_color=(0.1,0.1,0.1)
sc.view_settings.view_transform='Standard'
w=bpy.data.worlds.new('w'); sc.world=w; w.color=(0.55,0.6,0.66)
def box(n,loc,s,rz=0):
    bpy.ops.mesh.primitive_cube_add(location=loc); o=bpy.context.object; o.name=n; o.scale=s; o.rotation_euler[2]=rz; return o
def cyl(r,d,loc,v=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=r,depth=d,location=loc,vertices=v); return bpy.context.object
# ground
box('floor',(0,40,-0.05),(80,80,0.05))
# street canyon y 2..28
for i in range(8):
    y=2+i*3.6
    for side in (-1,1):
        h=random.uniform(4,8.5); box(f'b{side}{i}',(side*6.2,y,h/2),(1.8,1.6,h/2))
        # window recesses
        for k in range(int(h//1.6)):
            box(f'w{side}{i}{k}',(side*(6.2-1.8+0.02),y,1.2+k*1.6),(0.05,0.35,0.5))
for i in range(6): cyl(0.28,4,(-2.4,4+i*4,2))
# steps
for i in range(5): box(f'st{i}',(0,18+i*0.9,0.12*(i+1)),(3,0.45,0.12*(i+1)))
# gate with arch (stone wall with opening) at y=28
box('gateL',(-3.2,28,3.2),(1.6,0.7,3.2)); box('gateR',(3.2,28,3.2),(1.6,0.7,3.2))
box('lintel',(0,28,6.1),(4.8,0.7,0.5))
box('cap',(0,28,6.9),(5.2,0.9,0.3))
# plaza beyond y>31: ring of buildings, central monument and fountain
for i in range(14):
    a=math.pi*(0.08+i*0.84/13)
    x=22*math.cos(a)*1.0; y=44+14*math.sin(a)*1.3
    h=random.uniform(6,12); box(f'pb{i}',(x,y,h/2),(2.6,2.6,h/2),a)
cyl(3.5,0.5,(0,44,0.25),48); cyl(1.2,3,(0,44,2),32)
box('obelisk',(0,44,8),(0.7,0.7,6)); 
for i in range(10):
    a=i*math.tau/10; cyl(0.2,3,(7*math.cos(a),44+7*math.sin(a),1.5),16)
for (x,y) in []:
    cyl(0.22,1.3,(x,y,0.9),16); bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16,location=(x,y,1.78)); cyl(0.1,0.9,(x,y,0.3),12)
bpy.ops.object.camera_add(); cam=bpy.context.object; sc.camera=cam; cam.data.lens=28
shots={ 'S1':((0,-3,1.6),(86,0,0)),
        'S2':((-0.3,12.0,1.8),(85,0,-1)),
        'S3':((0,29.5,2.0),(85,0,0)) }
for n,(loc,rot) in shots.items():
    cam.location=loc; cam.rotation_euler=[math.radians(r) for r in rot]
    sc.render.filepath=os.path.join(OUT,f'{n}.png')
    bpy.ops.render.render(write_still=True)
