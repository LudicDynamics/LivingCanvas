"""NOCTILUCA / D10. Original procedural model, authored in this task.
Run in Blender 5.2. Creates its own scene and preserves existing scenes.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector, Matrix
from collections import Counter

OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
if bpy.data.objects.get('D10 | Rotate this control'):
    raise RuntimeError('This model is already open. Rebuild in a fresh Blender file.')
scene = bpy.data.scenes.new('NOCTILUCA | D10 Atelier')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 0.01
scene['design'] = 'NOCTILUCA / Ten-sided astral relic'
scene['numbering'] = '0-9; zero means ten for d10 rolls. Opposite faces sum to 9.'
if hasattr(scene, 'blendermcp_port'):
    scene.blendermcp_port = 9877
    scene.blendermcp_server_running = hasattr(bpy.types, 'blendermcp_server') and bpy.types.blendermcp_server.running

def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

dice = collection('DICE | Noctiluca')
studio = collection('STUDIO | Obsidian altar')
lights = collection('LIGHTING | Atelier')
root = bpy.data.objects.new('D10 | Rotate this control', None)
dice.objects.link(root)
root.empty_display_type = 'PLAIN_AXES'
root.empty_display_size = 0.35

def link_obj(obj, col=dice, parent=True):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    if col == dice and parent:
        obj.parent = root
    return obj

def material(name, color, metal=0, rough=.3, emission=None, strength=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = strength
    return m

gold = material('01 | Brushed antique electrum', (.52,.29,.075), .82, .25)
silver = material('02 | Warm platinum numerals', (.81,.74,.49), .72, .2)
ink = material('03 | Abyssal sapphire enamel', (.009,.027,.055), .28, .31)
teal = material('04 | Glacial aether inlay', (.035,.47,.6), .55, .2, (.018,.65,.92), 1.4)
black = material('05 | Volcanic basalt', (.012,.016,.022), .35, .32)
muted = material('06 | Engraved smoked bronze', (.09,.065,.031), .72, .35)

# Restrained mineral grain, kept away from the numerals. Portable base values
# remain in the Principled shader for GLB consumers without procedural nodes.
nt = ink.node_tree
p = nt.nodes.get('Principled BSDF')
p.inputs['Coat Weight'].default_value = .22
p.inputs['Coat Roughness'].default_value = .26
p.inputs['Specular IOR Level'].default_value = .25
tex = nt.nodes.new('ShaderNodeTexNoise')
tex.inputs['Scale'].default_value = 5.5
tex.inputs['Detail'].default_value = 5
tex.inputs['Roughness'].default_value = .72
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = .2
ramp.color_ramp.elements[0].color = (.0025,.008,.018,1)
ramp.color_ramp.elements[1].position = .82
ramp.color_ramp.elements[1].color = (.021,.075,.105,1)
nt.links.new(tex.outputs['Fac'], ramp.inputs[0])
nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
fine = nt.nodes.new('ShaderNodeTexNoise')
fine.inputs['Scale'].default_value = 155
fine.inputs['Detail'].default_value = 2
bump = nt.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = .095
bump.inputs['Distance'].default_value = .008
nt.links.new(fine.outputs['Fac'], bump.inputs['Height'])
nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])

def mesh_obj(name, vertices, faces, mat, col=dice):
    me = bpy.data.meshes.new(name)
    me.from_pydata(vertices, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if col == dice:
        ob.parent = root
    ob.data.materials.append(mat)
    return ob

def curve(name, points, radius, mat, closed=False, col=dice):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 1
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new('POLY')
    sp.points.add(len(points)-1)
    for p, v in zip(sp.points, points):
        p.co = (*v, 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    if col == dice:
        ob.parent = root
    cu.materials.append(mat)
    return ob

R, H = 1.1, 1.35
c = math.cos(math.pi/5)
h = H*(1-c)/(1+c)
vertices = [Vector((0,0,H)), Vector((0,0,-H))]
vertices += [Vector((R*math.cos(i*math.pi/5), R*math.sin(i*math.pi/5), h if i%2 == 0 else -h)) for i in range(10)]
faces = []
for i in range(5):
    k = i*2
    faces.append([0,2+k,2+(k+1)%10,2+(k+2)%10])
for i in range(5):
    k = i*2+1
    faces.append([1,2+k,2+(k+1)%10,2+(k+2)%10])
for f in faces:
    vs = [vertices[k] for k in f]
    n = (vs[1]-vs[0]).cross(vs[2]-vs[0])
    if n.dot(sum(vs, Vector())/4) < 0:
        f.reverse()

centers, normals, areas = [], [], []
for f in faces:
    v = [vertices[k] for k in f]
    n = (v[1]-v[0]).cross(v[2]-v[0]).normalized()
    center = sum(v,Vector())/4
    centers.append(center)
    normals.append(n)
    assert max(abs((p-v[0]).dot(n)) for p in v) < 1e-6, 'Nonplanar face'
    assert max((p-v[0]).dot(n) for p in vertices) < 1e-6, 'Nonconvex body'
    areas.append(sum((v[i]-v[0]).cross(v[i+1]-v[0]).length/2 for i in (1,2)))
edges = Counter(tuple(sorted((f[i], f[(i+1)%4]))) for f in faces for i in range(4))
assert len(edges) == 20 and all(count == 2 for count in edges.values())
assert max(areas)-min(areas) < 1e-6
numbers = [0,7,4,1,6] + [None]*5
opposites = []
for i in range(5):
    j = min(range(5,10),key=lambda j:normals[i].dot(normals[j]))
    assert normals[i].dot(normals[j]) < -.999999
    numbers[j] = 9-numbers[i]
    opposites.append([i,j])
assert sorted(numbers) == list(range(10))

body = mesh_obj('D10 | Ten congruent kite faces', vertices, faces, ink)
body.data.materials.append(gold)
body['logical_faces'] = 10
body['geometry'] = 'Pentagonal trapezohedron; planar congruent kites'
bevel = body.modifiers.new('Precision electrum edge chamfer', 'BEVEL')
bevel.width = .023
bevel.segments = 4
bevel.affect = 'EDGES'
bevel.material = 1
bevel.harden_normals = True
normal = body.modifiers.new('Preserve planar face reflections', 'WEIGHTED_NORMAL')
normal.keep_sharp = True
normal.weight = 50

fontfile = Path('C:/Windows/Fonts/timesbd.ttf')
font = bpy.data.fonts.load(str(fontfile)) if fontfile.exists() else None

def face_text(name, text, center, x, y, n, size, mat):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = size
    cu.extrude = .003
    cu.bevel_depth = .0025
    cu.bevel_resolution = 3
    cu.resolution_u = 16
    if font:
        cu.font = font
    ob = bpy.data.objects.new(name, cu)
    dice.objects.link(ob)
    ob.parent = root
    ob.matrix_basis = Matrix(((x.x,y.x,n.x,center.x),(x.y,y.y,n.y,center.y),(x.z,y.z,n.z,center.z),(0,0,0,1)))
    cu.materials.append(mat)
    return ob

for idx, (f, center, n, number) in enumerate(zip(faces, centers, normals, numbers)):
    pole = vertices[0 if idx<5 else 1]
    y = (pole-center).normalized()
    x = y.cross(n).normalized()
    def pt(a,b,z=.012):
        return center + a*x + b*y + n*z
    tag = f'{number:02d}'
    # Concentric filigree follows the true kite boundary.
    for scale, radius, mat, label in ((.89,.007,gold,'Outer wire'),(.815,.0033,muted,'Inner engraving')):
        curve(f'Face {tag} | {label}', [center+(vertices[k]-center)*scale+n*.006 for k in f], radius, mat, True)
    # Crown-shaped open flourish in the long tip; small luminous diamond.
    curve(f'Face {tag} | Astrolabe crown', [pt(-.14,.39),pt(-.09,.48),pt(0,.63),pt(.09,.48),pt(.14,.39)], .006, gold)
    curve(f'Face {tag} | Crown diamond', [pt(0,.56),pt(.048,.475),pt(0,.39),pt(-.048,.475)], .006, silver, True)
    gemvs = [pt(0,.527,.015),pt(.025,.474,.015),pt(0,.421,.015),pt(-.025,.474,.015),pt(0,.474,.038)]
    mesh_obj(f'Face {tag} | Aether-cut gem',gemvs,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],teal)
    # Readable isolated numeral with unobstructed negative space.
    numeral = face_text(f'Face {tag} | Numeral', str(number), pt(0,-.045,.012),x,y,n,.64,silver)
    numeral['value'] = number
    numeral['face_index'] = idx
    if number in (6,9):
        curve(f'Face {tag} | Reading underline',[pt(-.082,-.285),pt(.082,-.285)],.009,silver)
    # A deliberately quieter lower compass mark.
    curve(f'Face {tag} | Lower seal',[pt(-.074,-.343),pt(0,-.385),pt(.074,-.343)],.005,gold)
    curve(f'Face {tag} | Lower light',[pt(-.032,-.369,.018),pt(0,-.393,.018),pt(.032,-.369,.018)],.0035,teal)
    # Symmetric side ticks give the artifact an instrument-made character.
    for side in (-1,1):
        for j in range(3):
            a = side*(.308-j*.019)
            b = .06-j*.058
            curve(f'Face {tag} | Index {side} {j}',[pt(a,b),pt(a-side*.029,b+.018)],.004,gold)

root.rotation_euler = tuple(math.radians(a) for a in (12,-17,-90))
root.location.z = 1.74
root['units'] = 'Centimeter design units; base body 22 mm across ring, 27 mm tip to tip'
root['usage'] = 'Select this empty to move or rotate the complete die. 0 is 10.'

def cylinder(name,radius,depth,z,mat,vertices_count=128):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices_count,radius=radius,depth=depth,location=(0,0,z))
    ob = link_obj(bpy.context.object,studio)
    ob.name = name
    ob.data.materials.append(mat)
    be = ob.modifiers.new('Machined edge','BEVEL')
    be.width = .025
    be.segments = 3
    ob.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return ob

cylinder('Altar | Basalt plinth',1.85,.20,-.06,black)
cylinder('Altar | Electrum lower rim',1.86,.026,-.142,gold)
cylinder('Altar | Polished upper lip',1.83,.019,.042,muted)
cylinder('Altar | Obsidian inset',1.76,.012,.055,black)
for radius, thickness, mat in ((1.63,.009,gold),(1.56,.004,teal),(1.30,.004,muted),(.60,.004,muted)):
    curve('Altar | Engraved orbit',[(radius*math.cos(a*math.tau/180),radius*math.sin(a*math.tau/180),.064) for a in range(180)],thickness,mat,True,studio)
for i in range(60):
    a=i*math.tau/60
    r0=1.45 if i%5==0 else 1.50
    curve('Altar | Degree mark',[(r0*math.cos(a),r0*math.sin(a),.064),(1.54*math.cos(a),1.54*math.sin(a),.064)],.005 if i%5==0 else .0025,gold if i%5==0 else muted,col=studio)
for i in range(10):
    a=i*math.tau/10
    r1,r2=.67,1.24
    curve('Altar | Decagonal sigil',[(r1*math.cos(a-.06),r1*math.sin(a-.06),.064),(r2*math.cos(a),r2*math.sin(a),.064),(r1*math.cos(a+.06),r1*math.sin(a+.06),.064)],.0038,muted,col=studio)

bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.18))
floor=link_obj(bpy.context.object,studio)
floor.name='Studio | Charcoal sweep'
floor.data.materials.append(material('07 | Charcoal velvet',(.011,.014,.019),.15,.43))

def aim(ob, target):
    ob.rotation_euler = (Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()

camera_data=bpy.data.cameras.new('Portrait 85mm')
camera=bpy.data.objects.new('Camera | Hero',camera_data)
lights.objects.link(camera)
camera.location=(5.0,-8.0,5.25)
aim(camera,(0,0,1.35))
camera.data.type='ORTHO'
camera.data.ortho_scale=5.05
camera.data.lens=85
scene.camera=camera

def area(name,loc,power,color,size,target,size_y=None):
    dat=bpy.data.lights.new(name,'AREA')
    dat.energy=power
    dat.color=color
    dat.shape='DISK' if size_y is None else 'RECTANGLE'
    dat.size=size
    if size_y is not None:
        dat.size_y=size_y
    ob=bpy.data.objects.new(name,dat)
    lights.objects.link(ob)
    ob.location=loc
    aim(ob,target)
    return ob

area('Key | Champagne softbox',(-4,-2,6),430,(1,.83,.64),4,(0,0,1.3),3)
area('Rim | Arctic strip',(3,1.4,4.5),850,(.23,.67,1),2.8,(0,0,1.5),1.0)
area('Fill | Pearl',(.5,-4,2.8),90,(.74,.88,1),2.5,(0,0,1.5))
area('Rim | Bronze',(-3,2,2.5),420,(1,.45,.15),2,(0,0,1.2),.65)
area('Top | Satin highlight',(0,.5,6.5),350,(.83,.92,1),2.0,(0,0,0))
world=bpy.data.worlds.new('Midnight studio')
scene.world=world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.035,.055,.08,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.32
scene.render.engine='CYCLES'
scene.cycles.samples=80
scene.cycles.use_denoising=True
scene.cycles.max_bounces=8
device_names=[]
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX'
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use=dev.type=='OPTIX'
        if dev.use:
            device_names.append(dev.name)
    if device_names:
        scene.cycles.device='GPU'
except Exception as exc:
    print('GPU unavailable; using CPU:',exc)
scene.render.resolution_x=1500
scene.render.resolution_y=1500
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.render.filepath=str(OUT/'hero.png')

# Select just the die and place the viewport at the composed camera.
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active=root
for area_ in bpy.context.screen.areas:
    if area_.type=='VIEW_3D':
        area_.spaces.active.region_3d.view_perspective='CAMERA'
        area_.spaces.active.overlay.show_overlays=False
        area_.spaces.active.shading.type='MATERIAL'

report={'logical_faces':10,'vertices':12,'edges':20,'closed_manifold':True,'convex':True,'all_kites_planar':True,'face_areas':areas,'congruent_area_error':max(areas)-min(areas),'number_by_face':numbers,'opposite_face_pairs':opposites,'opposites_sum':9,'labels_6_9_underlined':True,'gpu':device_names,'base_tip_to_tip_mm':27,'base_ring_diameter_mm':22,'scene':scene.name,'note':'Decorative digital model. Physical roll balance and print preparation are not validated.'}
(OUT/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
for ob in dice.objects:
    ob.select_set(True)
# GLB converts curves and text after the explicit conversion below.
exports=bpy.data.collections.new('EXPORT | Converted die meshes')
scene.collection.children.link(exports)
duplicates=[]
depsgraph=bpy.context.evaluated_depsgraph_get()
for ob in list(dice.objects):
    if ob.type not in {'MESH','CURVE','FONT'}:
        continue
    evaluated=ob.evaluated_get(depsgraph)
    me=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=depsgraph)
    duplicate=bpy.data.objects.new(ob.name,me)
    exports.objects.link(duplicate)
    # Export in upright modeling coordinates, with the die centered on origin.
    duplicate.matrix_world=Matrix.Scale(.01,4) @ ob.matrix_local
    duplicates.append(duplicate)
bpy.ops.object.select_all(action='DESELECT')
for ob in duplicates:
    ob.select_set(True)
bpy.context.view_layer.objects.active=duplicates[0]
bpy.ops.export_scene.gltf(filepath=str(OUT/'noctiluca-d10.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_cameras=False,export_lights=False,export_yup=True)
for ob in duplicates:
    me=ob.data
    bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.meshes.remove(me)
bpy.data.collections.remove(exports)
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'noctiluca-d10.blend'))
print('NOCTILUCA_BUILD_OK',json.dumps(report))
