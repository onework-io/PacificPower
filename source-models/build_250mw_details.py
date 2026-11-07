from pathlib import Path
exec((Path(__file__).parent/'dc250_common.py').read_text())
scene=bpy.context.scene;scene.name='Rack_CDU_Component_Study'
box('Display_plinth',(1,0,-.15),(12,8,.3),'slab')
label('GPU RACK + CDU',(-4.5,-3.4,.05),.55)
label('EDITABLE COMPONENT STUDY / NOT A VENDOR CAD MODEL',(-4.5,-2.8,.05),.18,'cyan')
# Open-frame rack with rails, tray slides and rear service manifolds.
x=-2.5
box('Rack_base',(x,0,.13),(.9,1.4,.16),'rack','02_IT_RACKS',True)
box('Rack_top',(x,0,2.55),(.9,1.4,.12),'rack','02_IT_RACKS')
for dx in [-.41,.41]:
 for dy in [-.62,.62]:
  box('Frame_post',(x+dx,dy,1.35),(.065,.065,2.4),'metal','02_IT_RACKS')
  for j in range(20):box('Rail_mount_hole',(x+dx,dy-.035,.28+j*.11),(.022,.008,.035),'dark','02_IT_RACKS')
for k in range(8):
 z=.35+k*.245
 box(f'GPU_TRAY_{k+1}',(x,0,z),(.73,1.1,.18),'metal','02_IT_RACKS')
 box('Tray_front',(x,-.56,z),(.73,.035,.19),'rack','02_IT_RACKS')
 for dx in [-.27,.27]:box('Handle',(x+dx,-.61,z),(.08,.07,.09),'white','02_IT_RACKS')
 for j in range(4):box('Vent',(x-.16+j*.1,-.582,z),(.05,.015,.08),'dark','02_IT_RACKS')
 for dx,mat in [(-.18,'cyan'),(.18,'red')]:
  pipe('Flexible_coolant_hose',[(x+dx,.54,z),(x+dx,.78,z),(x+(-.5 if dx<0 else .5),.78,z),(x+(-.5 if dx<0 else .5),.64,z)],mat,'08_PIPES_TCS',.018)
  cyl('Quick_disconnect',(x+(-.5 if dx<0 else .5),.64,z),.04,.07,mat,'08_PIPES_TCS')
 box('Status_LED',(x+.04,-.583,z),(.04,.015,.025),'green','02_IT_RACKS')
for dx,mat in [(-.5,'cyan'),(.5,'red')]:
 pipe('Rack_manifold_'+mat,[(x+dx,.64,.25),(x+dx,.64,2.85)],mat,'08_PIPES_TCS',.04)
 for z in [.25,2.7]:cyl('Isolation_valve',(x+dx,.64,z),.07,.12,'metal','08_PIPES_TCS')
for dx,mat in [(-.34,'cyan'),(.34,'orange')]:
 box('Rack_PDU_'+mat,(x+dx,.5,1.3),(.08,.08,2.15),mat,'03_POWER')
 for k in range(12):box('PDU_socket',(x+dx,.55,.35+k*.16),(.04,.015,.06),'dark','03_POWER')
box('ToR_switch',(x,0,2.35),(.73,.8,.12),'white','05_NETWORK')
for j in range(16):box('SFP_port',(x-.32+j*.042,-.41,2.35),(.025,.02,.035),'dark','05_NETWORK')
label('01 / 100 kW RACK POSITION',(-3.5,-1.5,.08),.2)
# CDU opened cabinet, visually separate FWS and TCS ports.
x=1
box('CDU_base',(x,0,.12),(1.6,1.25,.2),'white','04_COOLING',True)
box('CDU_rear',(x,.6,1.15),(1.6,.08,2.2),'white','04_COOLING')
for dx in [-.76,.76]:box('CDU_upright',(x+dx,0,1.15),(.08,1.25,2.2),'metal','04_COOLING')
box('CDU_top',(x,0,2.25),(1.6,1.25,.12),'white','04_COOLING')
for j in range(18):box('HX_plate_'+str(j),(x,.37-j*.026,1.5),(.7,.018,.85),'metal','04_COOLING')
for xx in [x-.4,x+.4]:
 for z in [1.02,1.96]:pipe('HX_tie_rod',[(xx,-.2,z),(xx,.5,z)],'dark','04_COOLING',.018)
for xx in [x-.4,x+.4]:
 cyl('Pump_motor',(xx,0,.5),.17,.45,'green')
 cyl('Pump_housing',(xx,0,.77),.2,.14,'metal')
 pipe('Pump_branch',[(x-.65,.25,.75),(xx,.25,.75),(xx,0,.75),(xx,-.35,.75),(x+.65,-.35,.75)],'cyan','08_PIPES_TCS',.035)
for dx,mat in [(-.62,'green'),(.62,'orange')]:
 pipe('FWS_CDU_'+mat,[(x+dx,.42,2.8),(x+dx,.42,1.6),(x+(-.27 if dx<0 else .27),.4,1.6)],mat,'07_PIPES_FWS',.045)
 cyl('FWS_strainer',(x+dx,.42,2.02),.075,.2,'metal')
for dx,mat in [(-.65,'cyan'),(.65,'red')]:
 pipe('TCS_CDU_'+mat,[(x+dx,-.35,.75),(x+dx,-.35,1.4),(x+(-.25 if dx<0 else .25),-.15,1.4)],mat,'08_PIPES_TCS',.04)
 pipe('CDU_to_rack_'+mat,[(x+dx,-.35,.75),(x+dx,-.35,3.05 if dx<0 else 3.3),(-3 if dx<0 else -2,-.35,3.05 if dx<0 else 3.3),(-3 if dx<0 else -2,.64,3.05 if dx<0 else 3.3),(-3 if dx<0 else -2,.64,2.85)],mat,'08_PIPES_TCS',.04)
 for z in [1.1,2.4]:
  cyl('Valve_body',(x+dx,-.35,z),.065,.12,'metal')
  box('Valve_handle',(x+dx,-.35,z+.08),(.18,.035,.025),'yellow','04_COOLING')
box('Control_HMI',(x,-.64,2.1),(.5,.06,.22),'dark','06_SAFETY_CONTROLS')
for dx in [-.65,.65]:
 o=cyl('Pressure_gauge',(x+dx,-.42,1.85),.085,.035,'white');o.rotation_euler.x=math.pi/2
label('02 / CDU - OPEN SERVICE VIEW',(-.15,-1.5,.08),.2)
# Detached compute tray / exploded cold-plate assembly.
x=4
box('Exploded_tray',(x,0,.3),(1.7,1.25,.12),'metal','02_IT_RACKS',True)
box('Motherboard',(x,0,.4),(1.5,1.1,.04),'green','02_IT_RACKS')
for dx in [-.42,.42]:
 for dy in [-.3,.3]:
  box('GPU_package',(x+dx,dy,.48),(.28,.28,.08),'dark','02_IT_RACKS')
  box('Cold_plate',(x+dx,dy,.85),(.32,.32,.06),'orange','02_IT_RACKS')
  for dd in [-.1,.1]:cyl('Cold_plate_bolt',(x+dx+dd,dy-.1,.9),.012,.04,'metal')
  pipe('Coldplate_supply',[(x-.8,dy,1.1),(x+dx-.1,dy,1.1),(x+dx-.1,dy,.88)],'cyan','08_PIPES_TCS',.018)
  pipe('Coldplate_return',[(x+dx+.1,dy,.88),(x+dx+.1,dy,1.2),(x+.8,dy,1.2)],'red','08_PIPES_TCS',.018)
for yy in [-.48,.48]:
 for j in range(6):box('DIMM',(x-.55+j*.22,yy,.55),(.15,.025,.2),'green','02_IT_RACKS')
label('03 / GPU COLD PLATES - EXPLODED',(2.7,-1.5,.08),.17)
# Facility loop goes only to CDU primary ports, rack loop remains distinct.
for dx,mat in [(-.62,'green'),(.62,'orange')]:
 pipe('FWS_external_'+mat,[(1+dx,.42,2.8),(1+dx,1.7,2.8),(5,1.7+(0 if dx<0 else .35),2.8)],mat,'07_PIPES_FWS',.045)
label('FWS / TO COOLING PLANT',(2,2.4,.1),.23,'green')
label('TCS SUPPLY',(-3.5,2,.1),.22,'cyan');label('TCS RETURN',(-3.5,2.5,.1),.22,'red')
bpy.ops.object.light_add(type='AREA',location=(0,-5,8));l=bpy.context.object;l.data.energy=1800;l.data.shape='DISK';l.data.size=7;l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
finish('Rack_CDU_Detailed',(10,-14,11),(0.7,0,1),14,(1600,1200))
