"""Add editable visual detail to the existing 250 MW concept; no engineering ratings inferred.
Run: Blender --background --python scripts/detail-campus.py
Input is the tracked downloadable base model; writes output/250MW/Campus_250MW_Detailed.blend.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'/'250MW'; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'app/public/downloads/Campus_250MW.blend'))
scene=bpy.context.scene
# Re-running against an already enhanced source does not accumulate details.
for o in list(bpy.data.objects):
 if o.get('detail_revision')=='video-detail-v2':bpy.data.objects.remove(o,do_unlink=True)
cols={c.name:c for c in bpy.data.collections}
mats={m.name:m for m in bpy.data.materials}
count={}
def material(name,color,metal=.3):
 m=mats.get(name) or bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.4;mats[name]=m
material('copper',(.65,.24,.08),.65);material('porcelain',(.22,.12,.07));material('screen-blue',(.025,.24,.32));material('steel-light',(.6,.67,.7),.7)
def mesh(n,v,f,loc,mat,col):
 data=bpy.data.meshes.new(n);data.from_pydata(v,[],f);data.materials.append(mats[mat]);data.update()
 o=bpy.data.objects.new('D2_'+n,data);cols[col].objects.link(o);o.location=loc;o['detail_revision']='video-detail-v2';o['designStatus']='visual concept; dimensions and equipment selection unverified';count[col]=count.get(col,0)+1;return o
def box(n,loc,size,mat,col):
 v=[(x*size[0]/2,y*size[1]/2,z*size[2]/2) for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
 return mesh(n,v,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],loc,mat,col)
def cyl(n,loc,r,length,mat,col,axis=(0,0,1),sides=12):
 v=[(r*math.cos(i*math.tau/sides),r*math.sin(i*math.tau/sides),z) for z in [-length/2,length/2] for i in range(sides)]
 f=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]+[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
 o=mesh(n,v,f,loc,mat,col);o.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler();return o
def line(n,a,b,r,mat,col):
 d=Vector(b)-Vector(a);return cyl(n,(Vector(a)+Vector(b))/2,r,d.length,mat,col,d)
def valve(n,loc,mat,col):
 x,y,z=loc;cyl(n+'_body',loc,.23,.5,mat,col,(1,0,0));cyl(n+'_flangeA',(x-.27,y,z),.3,.07,'steel-light',col,(1,0,0));cyl(n+'_flangeB',(x+.27,y,z),.3,.07,'steel-light',col,(1,0,0));line(n+'_stem',(x,y,z),(x,y,z+.5),.045,'metal',col);cyl(n+'_wheel',(x,y,z+.5),.24,.05,'red',col)
def bushing(n,x,y,z,col):
 cyl(n+'_core',(x,y,z),.13,1.5,'porcelain',col)
 for i in range(7):cyl(n+'_rib',(x,y,z-.6+i*.2),.24,.07,'porcelain',col)
 cyl(n+'_terminal',(x,y,z+.85),.1,.22,'copper',col)
# Shared rack asset: low-poly repeated detail, all 2,000 stable rack identifiers retained.
ac='ASSET_RACK_100kW_assumed'
for x in [-.37,.37]:
 box('rack_upright',(x,-.635,1.25),(.045,.05,2.38),'steel-light',ac)
for z in [.08,2.42]:box('rack_crossmember',(0,-.64,z),(.78,.05,.05),'steel-light',ac)
for k in range(12):
 z=.25+k*.175
 box('server_face',(0,-.65,z),(.66,.055,.135),'metal',ac)
 box('server_vent',(-.12,-.682,z),(.35,.012,.075),'dark',ac)
 box('server_pull',(.26,-.7,z),(.065,.045,.065),'steel-light',ac)
 box('server_status',(.17,-.69,z),(.025,.018,.025),'green',ac)
for x,mat in [(-.28,'cyan'),(.28,'red')]:
 cyl('rear_liquid_manifold',(x,.64,1.25),.035,2.1,mat,ac,sides=8)
 for z in [.5,1.1,1.7,2.2]:line('rack_liquid_branch',(x,.64,z),(0,.68,z),.015,mat,ac)
box('rear_cable_manager',(0,.65,1.25),(.07,.06,2.25),'purple',ac)
# Hall infrastructure and detailed equipment.
for b in range(8):
 x=-158+(b%4)*100;y=-54+(b//4)*117;tag=f'DC{b+1:02d}';pc='03_POWER';cc='04_COOLING'
 for r in range(10):
  yy=y-20+r*4.4
  # Cable ladder above each rack row, visibly separate A/B rails and rungs.
  for xx in [x-25,x-17,x-9,x-1,x+7]:
   box(tag+'_tray_rung',(xx,yy-.6,4.02),(.07,.65,.07),'steel-light','09_POWER_ROUTES')
   line(tag+'_hanger',(xx,yy-.9,4.05),(xx,yy-.9,6.6),.025,'metal','09_POWER_ROUTES')
  for dy in [-.94,-.26]:box(tag+'_tray_rail',(x-8,yy+dy,4.03),(36,.055,.11),'metal','09_POWER_ROUTES')
  # CDU indicators, skid, inspection panel, flanged tie-ins.
  box(tag+'_CDU_skid',(x+15,yy,.2),(1.65,1.4,.15),'metal',cc)
  box(tag+'_CDU_service_panel',(x+15,yy-.535,1.25),(.9,.045,1.1),'metal',cc)
  box(tag+'_CDU_HMI',(x+15,yy-.57,1.8),(.42,.035,.27),'screen-blue',cc)
  box(tag+'_CDU_handle',(x+15.42,yy-.59,1.2),(.035,.04,.3),'dark',cc)
  for dy,mat in [(-.2,'green'),(.2,'orange')]:valve(tag+'_CDU_valve',(x+17.1,yy+dy,1.1),mat,'07_PIPES_FWS')
  # Rack-drop hose pairs at row ends, representative accessible connection detail.
  for j in [0,12,24]:
   xx=x-26+j*1.5
   for dy,mat in [(-.22,'cyan'),(.22,'red')]:line(tag+'_rack_drop',(xx,yy+dy,3.1),(xx,yy+.64,2.1),.025,mat,'08_PIPES_TCS')
 # Switchgear front bays, meters, lever handles and base plinths.
 for k in range(6):
  yy=y-24+k*6
  box(tag+'_switch_plinth',(x+26,yy,.16),(3.2,1.5,.22),'dark',pc)
  for dx in [-.85,0,.85]:
   box(tag+'_switch_door',(x+26+dx,yy-.53,1.9),(.79,.04,2.95),'white',pc)
   box(tag+'_relay_display',(x+26+dx,yy-.57,2.65),(.4,.035,.28),'screen-blue',pc)
   box(tag+'_breaker_handle',(x+26+dx+.22,yy-.59,1.65),(.05,.07,.25),'dark',pc)
   for dz,mat in [(0,'red'),(.13,'green')]:cyl(tag+'_status',(x+26+dx-.23,yy-.575,2.05+dz),.035,.03,mat,pc,(0,1,0),8)
 # Open illustrative busbar inspection frame; un-rated visual reference.
 for dx in [24.5,27.5]:box(tag+'_bus_support',(x+dx,y+11,4.5),(.1,.1,2),'metal',pc)
 for i in range(3):
  yy=y+10.8+i*.22
  box(tag+'_busbar',(x+26,yy,5.1),(3.4,.08,.13),'copper',pc)
  for dx in [24.8,27.2]:cyl(tag+'_bus_insulator',(x+dx,yy,4.85),.09,.4,'porcelain',pc)
 # Air-cooler coil fins and fan impellers replace flat disc appearance.
 for j in range(4):
  xx=x-25+j*13
  for side in [-1,1]:
   for n in range(16):box(tag+'_cooler_coil',(xx-4.6+n*.61,y+41+side*3.03,2.3),(.17,.07,3.1),'metal',cc)
  for fx in [-3,0,3]:
   cyl(tag+'_fan_rim',(xx+fx,y+41,4.31),1.14,.12,'steel-light',cc,sides=20)
   cyl(tag+'_fan_well',(xx+fx,y+41,4.39),1.03,.08,'dark',cc,sides=20)
   cyl(tag+'_fan_hub',(xx+fx,y+41,4.51),.22,.15,'metal',cc)
   for n in range(5):
    ang=n*math.tau/5;o=box(tag+'_fan_blade',(xx+fx+.5*math.cos(ang),y+41+.5*math.sin(ang),4.47),(.85,.17,.045),'metal',cc);o.rotation_euler.z=ang+.2
   for dx in [-.65,0,.65]:box(tag+'_fan_guard',(xx+fx+dx,y+41,4.57),(.035,1.7,.035),'steel-light',cc)
  for dy,mat in [(-1,'green'),(1,'orange')]:valve(tag+'_cooler_isolation',(xx,y+46+dy,1.1),mat,'07_PIPES_FWS')
 # Pump skid, twin motors and vertical expansion vessel.
 box(tag+'_pump_skid',(x+22,y+42,.3),(4.5,5,.3),'metal',cc)
 for dy in [-1.3,1.3]:
  cyl(tag+'_pump_motor',(x+22,y+42+dy,1.15),.48,1.5,'green',cc,(1,0,0))
  cyl(tag+'_pump_volute',(x+20.9,y+42+dy,1.15),.6,.55,'metal',cc,(1,0,0))
  for k in range(6):cyl(tag+'_motor_fin',(x+21.4+k*.22,y+42+dy,1.15),.53,.055,'metal',cc,(1,0,0))
 cyl(tag+'_expansion_vessel',(x+26,y+43,1.8),.65,2.7,'white',cc)
 for j in range(3):
  xx=x+40;yy=y-22+j*18
  box(tag+'_gen_plinth',(xx,yy,.35),(9,13,.3),'metal',pc)
  for k in range(12):box(tag+'_gen_louver',(xx-4.04,yy-4.5+k*.7,2.5),(.08,.15,3.1),'dark',pc)
  box(tag+'_gen_access_door',(xx,yy-6.04,2.4),(2.2,.06,3.1),'metal',pc)
  box(tag+'_gen_handle',(xx+.8,yy-6.1,2.4),(.1,.08,.5),'dark',pc)
  for dx in [-2,2]:cyl(tag+'_silencer',(xx+dx,yy+3,5.5),.65,1.25,'metal',pc)
 # Pipe saddle posts: regular visual supports, not a validated support design.
 for yy in [y-20,y-7,y+6,y+19,y+32]:
  for dx in [19,19.55]:
   box(tag+'_pipe_foot',(x+dx,yy,.35),(.65,.6,.15),'metal','07_PIPES_FWS')
   line(tag+'_pipe_support',(x+dx,yy,.4),(x+dx,yy,.85),.07,'metal','07_PIPES_FWS')
# Outdoor transformers: oil conservator, radiator banks, porcelain sheds, gantry.
for i in range(8):
 x=-170+i*48;col='03_POWER';tag=f'TR{i+1:02d}'
 box(tag+'_bund',(x,139,.5),(15,12,.3),'floor',col)
 for side in [-1,1]:
  for k in range(13):box(tag+'_radiator',(x-5+k*.82,139+side*4.65,3.4),(.12,1.2,4.1),'metal',col)
 cyl(tag+'_oil_conservator',(x,139,8.1),.75,8,'steel-light',col,(1,0,0),20)
 line(tag+'_oil_pipe',(x-4,139,8.1),(x-4,139,5.5),.13,'metal',col)
 for dx in [-3,0,3]:
  bushing(tag,x+dx,136.4,7.4,col)
  line(tag+'_jumper',(x+dx,136.4,8.25),(x+dx,133,9),.065,'copper',col)
 for dx in [-7,7]:
  box(tag+'_gantry_column',(x+dx,132,5.2),(.22,.3,10),'metal',col)
  line(tag+'_gantry_brace',(x+dx,132,2),(x+dx+(-2 if dx>0 else 2),132,7),.08,'metal',col)
 box(tag+'_gantry_beam',(x,132,10.2),(14.5,.35,.3),'metal',col)
 for dx in [-3,0,3]:bushing(tag+'_gantry',x+dx,132,9,col)
 box(tag+'_control_cabinet',(x+9,139,1.6),(1.6,1.1,2.7),'white',col)
 box(tag+'_control_meter',(x+9,138.43,2.1),(.7,.03,.4),'screen-blue',col)
scene['detail_revision']='video-detail-v2'
scene['reference_video']='AQNi05GQ4VRAB7ZvF6_1JKFzI1tXS9pvNPhopICIjZIuUh3IsSpST6h1CT11Q9FGPkoAEDdQU28yk9h3inN53N6P3oyGPyxrMXccNryPscqfmg.mp4'
scene['reference_limit']='Visual reference only: source video electrical ratings and topology are not adopted.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Campus_250MW_Detailed.blend'))
(OUT/'detail-manifest.json').write_text(json.dumps({'revision':'video-detail-v2','addedObjectsByCollection':count,'rackInstances':2000,'capacityMW':250,'sourceVideo':scene['reference_video'],'designStatus':'concept visual detail, not construction approved'},indent=2))
print('DETAIL_COMPLETE',count,flush=True)
