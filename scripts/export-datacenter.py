import bpy,json
from pathlib import Path
from mathutils import Matrix
ROOT=Path(__file__).resolve().parents[1];dest=ROOT/'3D-datacenter';dest.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'output/250MW/Campus_250MW.blend'))
source=bpy.context.scene;deps=bpy.context.evaluated_depsgraph_get();batches={};manifest=[]
def add(obj,transform,bucket):
 if obj.type not in {'MESH','CURVE'}:return
 mesh=obj.data if obj.type=='MESH' else obj.evaluated_get(deps).to_mesh()
 verts=[tuple(transform@v.co) for v in mesh.vertices]
 for mi,mat in enumerate(mesh.materials):
  if mat is None:continue
  entry=batches.setdefault(bucket,{}).setdefault(mat.name,{'verts':[],'faces':[],'mat':mat})
  offset=len(entry['verts']);entry['verts'].extend(verts)
  entry['faces'].extend([tuple(offset+i for i in p.vertices) for p in mesh.polygons if p.material_index==mi])
 if obj.type=='CURVE':obj.evaluated_get(deps).to_mesh_clear()
for obj in list(source.objects):
 if obj.type=='EMPTY' and obj.instance_collection:
  bucket=obj.name[:4].lower()+'-racks'
  for child in obj.instance_collection.objects:add(child,obj.matrix_world@child.matrix_world,bucket)
  manifest.append({'assetId':obj.name,'partId':bucket,'positionBlenderM':list(obj.location),'planningITkW':100})
 elif obj.type in {'MESH','CURVE'}:
  col=obj.users_collection[0].name
  bucket={'01_SITE':'site','03_POWER':'power','04_COOLING':'cooling','05_NETWORK':'network','07_PIPES_FWS':'fws','08_PIPES_TCS':'tcs','09_POWER_ROUTES':'power-routes','10_FIBER_ROUTES':'fiber'}.get(col)
  if col=='01_SITE' and ('_wall' in obj.name or '_column' in obj.name):bucket='shell'
  if bucket:add(obj,obj.matrix_world,bucket)
print('BATCHED',len(batches),flush=True)
new=bpy.data.scenes.new('Web_export');bpy.context.window.scene=new
catalog=[]
for bucket,materials in batches.items():
 for name,d in materials.items():
  mesh=bpy.data.meshes.new(bucket+'_'+name);mesh.from_pydata(d['verts'],[],d['faces']);mesh.materials.append(d['mat']);mesh.update()
  obj=bpy.data.objects.new(bucket+'_'+name,mesh);new.collection.objects.link(obj);obj['assetGroupId']=bucket;obj['source']='Campus_250MW.blend';obj['designStatus']='concept'
 path=dest/(bucket+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_active_scene=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
 catalog.append({'id':bucket,'file':path.name,'bytes':path.stat().st_size})
 for o in list(new.objects):bpy.data.objects.remove(o,do_unlink=True)
 print('EXPORTED',bucket,path.stat().st_size,flush=True)
(dest/'catalog.json').write_text(json.dumps(catalog,indent=2))
(dest/'assets.json').write_text(json.dumps(manifest,indent=2))
print('COMPLETE',len(catalog),len(manifest),flush=True)
