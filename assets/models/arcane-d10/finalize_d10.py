"""Bake portable color, export merged GLB, and render the reverse angle."""
import bpy
import json
from pathlib import Path
OUT=Path(__file__).resolve().parent
scene=bpy.context.scene
body=bpy.data.objects['D10 | Ten congruent kite faces']
root=bpy.data.objects['D10 | Rotate this control']
dice=body.users_collection[0]
ink=body.data.materials[0]
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(island_margin=.035)
bpy.ops.object.mode_set(mode='OBJECT')
img=bpy.data.images.new('Noctiluca | Baked enamel albedo',1024,1024,alpha=False)
img.colorspace_settings.name='sRGB'
node=ink.node_tree.nodes.new('ShaderNodeTexImage')
node.name='Portable enamel color'
node.image=img
ink.node_tree.nodes.active=node
for mat in list(body.data.materials)[1:]:
    im=mat.node_tree.nodes.new('ShaderNodeTexImage')
    im.image=img
    mat.node_tree.nodes.active=im
for modifier in body.modifiers:
    modifier.show_render=False
scene.cycles.samples=16
scene.render.bake.margin=16
bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'})
for modifier in body.modifiers:
    modifier.show_render=True
scene.cycles.samples=80
img.filepath_raw=str(OUT/'enamel-basecolor.png')
img.file_format='PNG'
img.save()
img.pack()
ink.node_tree.links.new(node.outputs['Color'],ink.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

# All display details are real geometry; the export is a single mesh with
# material groups, centered upright at the origin and without the display base.
export_col=bpy.data.collections.new('Temporary GLB conversion')
scene.collection.children.link(export_col)
depsgraph=bpy.context.evaluated_depsgraph_get()
copies=[]
for ob in list(dice.objects):
    if ob.type not in {'MESH','CURVE','FONT'}:
        continue
    mesh=bpy.data.meshes.new_from_object(ob.evaluated_get(depsgraph),preserve_all_data_layers=True,depsgraph=depsgraph)
    copy=bpy.data.objects.new(ob.name,mesh)
    export_col.objects.link(copy)
    copy.matrix_world=ob.matrix_local.copy()
    copies.append(copy)
bpy.ops.object.select_all(action='DESELECT')
for ob in copies:
    ob.select_set(True)
bpy.context.view_layer.objects.active=copies[0]
bpy.ops.object.join()
merged=bpy.context.object
merged.name='NOCTILUCA D10'
merged.scale=(.01,.01,.01)
merged.data.calc_loop_triangles()
triangle_count=len(merged.data.loop_triangles)
bpy.ops.export_scene.gltf(filepath=str(OUT/'noctiluca-d10.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_cameras=False,export_lights=False)
bpy.data.objects.remove(merged,do_unlink=True)
bpy.data.collections.remove(export_col)

# Record an independent geometric check of edge lengths and diagonals.
rows=[]
for face in body.data.polygons:
    vs=[body.data.vertices[i].co for i in face.vertices]
    rows.append(sorted([(vs[i]-vs[(i+1)%4]).length for i in range(4)])+sorted([(vs[0]-vs[2]).length,(vs[1]-vs[3]).length]))
error=max(abs(a-b) for row in rows for a,b in zip(rows[0],row))
assert error<1e-6
report=json.loads((OUT/'validation.json').read_text())
report['edge_and_diagonal_congruence_error']=error
report['export_triangles']=triangle_count
report['portable_color_texture']='enamel-basecolor.png (embedded in GLB and packed in blend)'
report['export_meshes']=1
report['glb_units']='meters; scale 0.01 converts Blender centimeter design units'
(OUT/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.file.pack_all()
scene.render.filepath=str(OUT/'hero.png')
root.rotation_euler.z+=2.5
scene.render.filepath=str(OUT/'reverse.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'noctiluca-d10.blend'))
bpy.ops.render.render('INVOKE_DEFAULT',write_still=True)
print('FINAL_EXPORT_OK',triangle_count,'triangles; reverse render started')
