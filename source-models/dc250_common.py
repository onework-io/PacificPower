import bpy, math, json, csv
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'output'/'250MW'; OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
 if c.name!='Collection': bpy.data.collections.remove(c)
collections={}
for n in ['01_SITE','02_IT_RACKS','03_POWER','04_COOLING','05_NETWORK','06_SAFETY_CONTROLS','07_PIPES_FWS','08_PIPES_TCS','09_POWER_ROUTES','10_FIBER_ROUTES','11_LABELS']:
 c=bpy.data.collections.new(n); bpy.context.scene.collection.children.link(c); collections[n]=c
mats={}
for n,col in {'slab':(.055,.09,.13),'floor':(.2,.29,.34),'rack':(.025,.04,.06),'metal':(.36,.46,.53),'white':(.77,.86,.9),'cyan':(.02,.75,1),'orange':(1,.35,.035),'green':(.02,.7,.42),'red':(.95,.07,.15),'purple':(.65,.15,1),'yellow':(1,.78,.07),'dark':(.01,.02,.025)}.items():
 m=bpy.data.materials.new(n);m.diffuse_color=(*col,1);m.use_nodes=True;p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=.35;p.inputs['Roughness'].default_value=.38;mats[n]=m
inventory=[]; routes=[]
def put(o,n,mat,coll):
 o.name=n;o.data.materials.append(mats[mat]);
 for c in list(o.users_collection):c.objects.unlink(o)
 collections[coll].objects.link(o);return o
def box(n,loc,size,mat='metal',coll='01_SITE',asset=False):
 verts=[(dx*size[0]/2,dy*size[1]/2,dz*size[2]/2) for dx,dy,dz in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
 mesh=bpy.data.meshes.new(n);mesh.from_pydata(verts,[],[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]);mesh.update()
 o=bpy.data.objects.new(n,mesh);o.location=loc;put(o,n,mat,coll)
 bevel=o.modifiers.new('Soft edges','BEVEL');bevel.width=.035;bevel.segments=2;o.modifiers.new('Normals','WEIGHTED_NORMAL')
 if asset: inventory.append({'id':n,'system':coll,'x_m':loc[0],'y_m':loc[1],'z_m':loc[2],'width_m':size[0],'depth_m':size[1],'height_m':size[2]})
 return o
def cyl(n,loc,r,depth,mat='metal',coll='04_COOLING'):
 verts=[(r*math.cos(i*math.tau/24),r*math.sin(i*math.tau/24),z) for z in [-depth/2,depth/2] for i in range(24)]
 faces=[tuple(reversed(range(24))),tuple(range(24,48))]+[(i,(i+1)%24,(i+1)%24+24,i+24) for i in range(24)]
 mesh=bpy.data.meshes.new(n);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(n,mesh);o.location=loc;return put(o,n,mat,coll)

def pipe(n,pts,mat,coll,r=.055):
 d=bpy.data.curves.new(n,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=3;s=d.splines.new('POLY');s.points.add(len(pts)-1)
 for p,co in zip(s.points,pts):p.co=(*co,1)
 o=bpy.data.objects.new(n,d);collections[coll].objects.link(o);d.materials.append(mats[mat]);o['system']=coll;o['concept_route']=True
 routes.append({'id':n,'system':coll,'points_m':pts,'visual_radius_m':r});return o
def label(t,loc,size=.35,mat='white'):
 d=bpy.data.curves.new(t,'FONT');d.body=t;d.size=size;d.extrude=.001;o=bpy.data.objects.new(t,d);collections['11_LABELS'].objects.link(o);o.location=loc;d.materials.append(mats[mat]);return o
def cabinet(n,x,y,w=1.2,h=2.4,coll='03_POWER',mat='metal'):
 box(n,(x,y,h/2+.2),(w,1,h),mat,coll,True);box(n+'_screen',(x,y-.511,h*.7),(.38,.025,.28),'dark',coll);box(n+'_status',(x+.3,y-.53,h*.7),(.05,.03,.12),'green',coll)
 for z in [.45,.6,.75]:box(n+'_vent',(x,y-.52,z),(w*.7,.03,.035),'dark',coll)
 label(n,(x-w/2,y-.85,.23),.19)
def finish(name,camloc,target,scale,res=(1800,1250)):
 scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
 scene.world.color=(.3,.3,.3)
 bpy.ops.object.light_add(type='SUN',location=(0,0,100));sun=bpy.context.object;sun.rotation_euler=(.35,-.4,-.3);sun.data.energy=2
 bpy.ops.object.camera_add(location=camloc);cam=bpy.context.object;cam.name='Overview';cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.clip_end=10000;cam.data.ortho_scale=scale;scene.camera=cam
 scene.render.resolution_x,scene.render.resolution_y=res;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX';scene['design_status']='Concept geometry; equipment ratings and engineering verification pending'
 for a in bpy.context.screen.areas:
  if a.type=='VIEW_3D':a.spaces.active.region_3d.view_perspective='CAMERA'
 with open(OUT/(name+'_equipment.csv'),'w') as f:
  w=csv.DictWriter(f,fieldnames=inventory[0].keys());w.writeheader();w.writerows(inventory)
 (OUT/(name+'_routes.json')).write_text(json.dumps(routes,indent=2))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')))
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
 print('COMPLETE',name,len(inventory),len(routes),flush=True)
