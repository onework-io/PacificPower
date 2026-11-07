from pathlib import Path
exec((Path(__file__).parent/'dc250_common.py').read_text())
# Metric concept campus. 8 halls x 250 rack positions x 100 kW = 200 MW IT.
# 250 MW facility boundary / 1.25 assumed design ratio; annual PUE is not peak sizing.
scene=bpy.context.scene;scene.name='250MW_Facility_200MW_IT'
for k,v in {'facility_capacity_MW':250.,'assumed_design_ratio':1.25,'IT_planning_MW':200.,'hall_count':8,'rack_count':2000,'average_rack_kW':100.}.items():scene[k]=v
box('SITE_440x310m',(0,0,-.7),(440,310,1.4),'slab')
label('250 MW | AI DATA CENTER',(-205,-143,.12),7)
label('FACILITY CAPACITY 250 MW  /  IT PLAN 200 MW  /  ASSUMED RATIO 1.25',(-205,-132,.12),2.5)
label('8 x 25 MW IT BLOCKS  /  2,000 RACK POSITIONS  /  CONCEPT MODEL',(-205,-125,.12),2.5,'cyan')
# Road network and pedestrian strips
for y in [-113,4,121]:
 box('Road',(0,y,.04),(420,10,.12),'dark')
 for x in range(-200,205,12):box('Road_mark',(x,y,.12),(5,.18,.02),'white')
for x in [-209,-109,-9,91,207]:box('Cross_road',(x,4,.04),(8,238,.12),'dark')
# Linked rack asset: objects editable once, with 2000 placed instances.
asset=bpy.data.collections.new('ASSET_RACK_100kW_assumed');collections['ASSET']=asset
box('Rack_shell',(0,0,1.25),(.8,1.2,2.4),'rack','ASSET')
for k in range(6):box('Compute_tray',(0,-.61,.4+k*.32),(.69,.03,.22),'metal','ASSET')
for x,mat in [(-.32,'cyan'),(.32,'orange')]:box('Rack_PDU',(x,.5,1.2),(.06,.1,2.1),mat,'ASSET')
rack_count=0
for b in range(8):
 col=b%4;row=b//4;x=-158+col*100;y=-54+row*117;tag=f'DC{b+1:02d}'
 # Hall and surrounding compound: removable roof collection
 box(tag+'_floor',(x,y,.15),(64,64,.3),'floor',asset=True)
 box(tag+'_back_wall',(x,y+31.7,3.5),(64,.5,7),'white')
 box(tag+'_side_wall',(x-31.7,y,3.5),(.5,64,7),'white')
 for xx in [-31,31]:
  for yy in [-31,0,31]:box(tag+'_column',(x+xx,y+yy,3.5),(.5,.5,7),'metal')
 label(tag+' / 25 MW IT',(x-29,y-30,.34),2)
 label('250 RACKS / 100 kW AVG',(x-29,y-27,.34),1,'cyan')
 if '12_ROOFS' not in collections:
  c=bpy.data.collections.new('12_ROOFS_TOGGLE');scene.collection.children.link(c);collections['12_ROOFS']=c;c.hide_render=True;c.hide_viewport=True
 box(tag+'_roof',(x,y,7.4),(65,65,.4),'white','12_ROOFS')
 for r in range(10):
  yy=y-20+r*4.4
  for j in range(25):
   xx=x-26+j*1.5;name=f'{tag}_R{r+1:02d}_{j+1:02d}'
   o=bpy.data.objects.new(name,None);o.instance_type='COLLECTION';o.instance_collection=asset;collections['02_IT_RACKS'].objects.link(o);o.location=(xx,yy,.3);o['IT_kW_assumed']=100;o['rack_id']=name;rack_count+=1
  if r%2==0:box(tag+'_cold_aisle',(x-8,yy+2.2,.32),(37,2.5,.03),'cyan')
  # Each row has primary interface CDU, actual rating unselected.
  cabinet(tag+f'_CDU{r+1:02d}',x+15,yy,1.2,2.2,'04_COOLING','white')
  for dy,mat in [(-.22,'cyan'),(.22,'red')]:
   pipe(tag+f'_TCS_row{r+1}_{mat}',[(x-26,yy+dy,3.1),(x+15,yy+dy,3.1),(x+15,yy+dy,1.5)],mat,'08_PIPES_TCS',.08)
  for dy,mat,xx in [(-.6,'cyan',x-29),(.6,'orange',x-28.5)]:
   pipe(tag+f'_BUS_row{r+1}_{mat}',[(xx,yy+dy,4),(x+10,yy+dy,4)],mat,'09_POWER_ROUTES',.09)
  pipe(tag+f'_FIBER_row{r+1}',[(x+12,yy,4.6),(x-26,yy,4.6)],'purple','10_FIBER_ROUTES',.06)
  for dx,mat in [(0,'green'),(.55,'orange')]:
   pipe(tag+f'_FWS_CDU{r+1}_{mat}',[(x+19+dx,yy,1.1),(x+15.5,yy+(-.2 if dx==0 else .2),1.1)],mat,'07_PIPES_FWS',.11)
 # segregated spines and on-site switch/UPS gallery represented as grouped equipment
 for dx,mat in [(0,'green'),(.55,'orange')]:pipe(tag+'_FWS_spine_'+mat,[(x+19+dx,y-20,1.1),(x+19+dx,y+40,1.1),(x+5,y+40+dx,1.1)],mat,'07_PIPES_FWS',.2)
 for xx,mat in [(x-29,'cyan'),(x-28.5,'orange')]:
  pipe(tag+'_LV_spine_'+mat,[(xx,y-24,4),(xx,y+20.2,4)],mat,'09_POWER_ROUTES',.12)
  pipe(tag+'_UPS_to_spine_'+mat,[(x+25,y-24,1),(xx,y-24,1),(xx,y-24,4)],mat,'09_POWER_ROUTES',.14)
 for k,n in enumerate(['MV-LV_A','MV-LV_B','UPS_A','UPS_B','BATTERY_A','BATTERY_B','MMR','BMS']):
  cabinet(tag+'_'+n,x+26,y-24+k*6,2.8,3.5,'05_NETWORK' if n=='MMR' else '03_POWER')
 pipe(tag+'_fiber_spine',[(x+26,y+12,2),(x+26,y+12,4.6),(x+12,y+12,4.6),(x+12,y-20,4.6),(x+12,y+19.6,4.6)],'purple','10_FIBER_ROUTES',.07)
 # cooling yard: grouped modules are spatial allowances, not selected thermal capacities
 for j in range(4):
  xx=x-25+j*13
  box(tag+f'_COOLING_MODULE_{j+1}',(xx,y+41,2.2),(10,6,3.8),'white','04_COOLING',True)
  for fx in [-3,0,3]:cyl('Fan',(xx+fx,y+41,4.2),1.1,.2,'dark')
  for ddy,mat in [(-1,'green'),(1,'orange')]:pipe(tag+'_cooler_branch',[(xx,y+41+ddy,1.1),(xx,y+47+ddy,1.1)],mat,'07_PIPES_FWS',.18)
 for ddy,mat in [(-1,'green'),(1,'orange')]:pipe(tag+'_yard_header',[(x-25,y+47+ddy,1.1),(x+20,y+47+ddy,1.1),(x+20,y+40+(0 if ddy==-1 else .55),1.1),(x+5,y+40+(0 if ddy==-1 else .55),1.1)],mat,'07_PIPES_FWS',.22)
 # exterior generation bays: reserve space, ratings TBD
 for j in range(3):
  xx=x+40;yy=y-22+j*18
  box(tag+f'_GEN_GROUP_{j+1}',(xx,yy,2.5),(8,12,4.4),'white','03_POWER',True)
  for d in [-2,2]:cyl('Generator_exhaust',(xx+d,yy+3,5.4),.35,2,'metal','03_POWER')
  pipe(tag+'_GEN_feeder',[(xx,yy,.8),(x+32,yy,.8),(x+32,y-24,.8),(x+26,y-24,.8)],'yellow','09_POWER_ROUTES',.16)
 label('COOLING',(x-27,y+35,.35),1.5)
 # dual site feeder paths, differing heights/offsets (schematic)
 for ofs,mat in [(0,'cyan'),(1.5,'orange')]:
  pipe(tag+'_MV_feeder_'+mat,[(x+ofs,136+ofs,1),(x-35+ofs,136+ofs,1),(x-35+ofs,y-24,1),(x+26,y-24+ofs,1)],mat,'09_POWER_ROUTES',.24)
# North utility yard and network entries
box('UTILITY_YARD',(0,138,.2),(385,22,.4),'floor')
for i in range(8):
 x=-170+i*48
 box(f'TRANSFORMER_BAY_{i+1}',(x,139,3.6),(12,8,6.6),'metal','03_POWER',True)
 for j in range(7):box('Radiator_fin',(x-6.2+j*2.05,139,3.4),(.2,9,4.5),'white','03_POWER')
 for dx in [-3,0,3]:cyl('Bushing',(x+dx,139,7.7),.35,2,'white','03_POWER')
label('UTILITY / TRANSFORMER YARD - RATINGS TBD',(-180,150,.2),2)
for x,mat in [(-215,'cyan'),(215,'orange')]:pipe('UTILITY_ENTRY_'+mat,[(x,154,2),(x,138,2),(-170 if x<0 else 166,138,2)],mat,'09_POWER_ROUTES',.4)
assert rack_count==2000
# dedicated inspection camera
bpy.ops.object.camera_add(location=(-108,-105,67));c=bpy.context.object;c.name='Detail_DC01';c.rotation_euler=(Vector((-158,-54,0))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=92
(OUT/'capacity.json').write_text(json.dumps({'facility_MW':250,'assumed_design_ratio':1.25,'IT_MW':200,'non_IT_budget_MW':50,'blocks':8,'IT_MW_per_block':25,'rack_positions_per_block':250,'rack_positions':rack_count,'average_rack_kW':100,'site_dimensions_m':[440,310],'equipment_ratings':'TBD; plant symbols represent grouped spatial allowances'},indent=2))
scene.view_settings.exposure=.5
finish('Campus_250MW',(420,-540,510),(0,0,0),580)
