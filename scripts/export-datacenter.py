import bpy,json,struct
from pathlib import Path
from mathutils import Matrix
ROOT=Path(__file__).resolve().parents[1];dest=ROOT/'3D-datacenter';dest.mkdir(exist_ok=True)
# Enhanced output when generated locally; otherwise use tracked downloadable model.
source_path=ROOT/'output/250MW/Campus_250MW_Detailed.blend'
if not source_path.exists():source_path=ROOT/'app/public/downloads/Campus_250MW.blend'
bpy.ops.wm.open_mainfile(filepath=str(source_path))
source=bpy.context.scene;deps=bpy.context.evaluated_depsgraph_get();batches={};manifest=[];instances={}
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
  if bucket not in instances:
   for child in obj.instance_collection.objects:add(child,child.matrix_world,bucket)
  instances.setdefault(bucket,[]).append([obj.location.x,obj.location.z,-obj.location.y])
  manifest.append({'assetId':obj.name,'partId':bucket,'positionBlenderM':list(obj.location),'planningITkW':None})
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
 # Share rack geometry on the GPU: one mesh per material with 250 translations.
 # This keeps all 2,000 locations while avoiding duplicated server geometry.
 if bucket in instances:
  raw=path.read_bytes();jslen=struct.unpack_from('<I',raw,12)[0]
  doc=json.loads(raw[20:20+jslen]);binstart=20+jslen
  binlen=struct.unpack_from('<I',raw,binstart)[0];binary=raw[binstart+8:binstart+8+binlen]
  binary+=b'\0'*((-len(binary))%4);offset=len(binary)
  translations=instances[bucket]
  extra=b''.join(struct.pack('<3f',*p) for p in translations);binary+=extra
  view=len(doc.setdefault('bufferViews',[]));doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(extra)})
  accessor=len(doc.setdefault('accessors',[]));doc['accessors'].append({'bufferView':view,'componentType':5126,'count':len(translations),'type':'VEC3','min':[min(p[i] for p in translations) for i in range(3)],'max':[max(p[i] for p in translations) for i in range(3)]})
  for node in doc['nodes']:
   if 'mesh' in node:node.setdefault('extensions',{})['EXT_mesh_gpu_instancing']={'attributes':{'TRANSLATION':accessor}}
  doc.setdefault('extensionsUsed',[]).append('EXT_mesh_gpu_instancing');doc.setdefault('extensionsRequired',[]).append('EXT_mesh_gpu_instancing')
  doc['buffers'][0]['byteLength']=len(binary)
  payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4);binary+=b'\0'*((-len(binary))%4)
  result=struct.pack('<III',0x46546c67,2,12+8+len(payload)+8+len(binary))+struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(binary),0x004e4942)+binary
  path.write_bytes(result)
 catalog.append({'id':bucket,'file':path.name,'bytes':path.stat().st_size})
 for o in list(new.objects):bpy.data.objects.remove(o,do_unlink=True)
 print('EXPORTED',bucket,path.stat().st_size,flush=True)
(dest/'catalog.json').write_text(json.dumps(catalog,indent=2))
(dest/'assets.json').write_text(json.dumps(manifest,indent=2))
print('COMPLETE',len(catalog),len(manifest),flush=True)
