import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'output/250MW/Campus_250MW_Detailed.blend'))
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=12;s.render.resolution_x=1500;s.render.resolution_y=1000;s.render.resolution_percentage=100
cam=s.camera;cam.data.type='ORTHO';cam.data.clip_end=10000
# Isolate an existing hall in the render, without changing the saved asset.
for o in s.objects:
 if o.type not in {'MESH','CURVE','FONT','EMPTY'}:continue
 if o.instance_collection:
  o.hide_render=not o.name.startswith('DC01_')
 elif o.users_collection and o.users_collection[0].name not in ['01_SITE','11_LABELS']:
  o.hide_render=not (o.name.startswith('DC01_') or o.name.startswith('D2_DC01'))
for o in bpy.data.collections['11_LABELS'].objects:o.hide_render=True
cam.location=(-105,-118,64);target=Vector((-153,-54,1));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=93
s.render.filepath=str(ROOT/'output/250MW/detail-hall.png');bpy.ops.render.render(write_still=True)
cam.location=(-176,-87,13);target=Vector((-179,-72,1.5));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=17
s.render.filepath=str(ROOT/'output/250MW/detail-racks.png');bpy.ops.render.render(write_still=True)
print('RENDER_COMPLETE',flush=True)
