class_name BrainAnchor
extends Node3D
## Holds VFB anatomy (neuropils, neurons) in template space, positioned inside
## the fly's head. Objects are clickable through StaticBody3D shapes on layer 2.

signal object_added(id: String)
signal object_removed(id: String)
signal selection_changed(id: String)

const LAYER_BRAIN := 2
const NEUROPIL_ALPHA := 0.22
const NEUROPIL_ALPHA_SELECTED := 0.55

var objects := {}      # id -> Dictionary
var selected_id := ""
var um_to_mm := 0.001
var template_center_um := Vector3.ZERO
var center_known := false
## Template axes -> head axes (see README "Coordinate frames").
var template_basis := Basis(Vector3(0, 1, 0), Vector3(0, 0, -1), Vector3(-1, 0, 0))
var head_offset_mm := Vector3.ZERO
var user_offset_mm := Vector3.ZERO
var user_scale := 1.0


func apply_calibration() -> void:
	transform = Transform3D(template_basis.scaled(Vector3.ONE * user_scale), head_offset_mm + user_offset_mm)


func has_object(id: String) -> bool:
	return objects.has(id)


func add_object(id: String, label: String, kind: String, mesh: Mesh, color: Color, meta: Dictionary = {}) -> void:
	if objects.has(id):
		remove_object(id)
	if mesh == null or mesh.get_surface_count() == 0:
		push_warning("BrainAnchor: empty mesh for %s" % id)
		return
	var mi := MeshInstance3D.new()
	mi.name = id
	mi.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.6
	mat.metallic = 0.0
	if kind == "neuropil":
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.albedo_color.a = NEUROPIL_ALPHA
		mat.cull_mode = BaseMaterial3D.CULL_BACK
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_OPAQUE_ONLY
	else:
		mat.albedo_color.a = 1.0
		if meta.get("format", "") == "swc":
			mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = mat
	mi.layers = 2  # visual layer 2: rendered by the brain view camera
	mi.set_meta("vfb_id", id)
	add_child(mi)

	var body := StaticBody3D.new()
	body.name = "col"
	body.collision_layer = LAYER_BRAIN
	body.collision_mask = 0
	body.set_meta("vfb_id", id)
	var shape := CollisionShape3D.new()
	shape.shape = mesh.create_trimesh_shape()
	body.add_child(shape)
	mi.add_child(body)

	objects[id] = {
		"id": id, "label": label, "kind": kind, "node": mi, "body": body,
		"material": mat, "color": color, "meta": meta, "visible": true,
	}
	object_added.emit(id)


func remove_object(id: String) -> void:
	if not objects.has(id):
		return
	var o: Dictionary = objects[id]
	(o["node"] as Node).queue_free()
	objects.erase(id)
	if selected_id == id:
		selected_id = ""
		selection_changed.emit("")
	object_removed.emit(id)


func clear() -> void:
	for id in objects.keys():
		remove_object(id)


func set_object_visible(id: String, vis: bool) -> void:
	if objects.has(id):
		objects[id]["visible"] = vis
		(objects[id]["node"] as MeshInstance3D).visible = vis
		(objects[id]["body"] as StaticBody3D).collision_layer = LAYER_BRAIN if vis else 0


func select(id: String) -> void:
	if selected_id != "" and objects.has(selected_id):
		_style(objects[selected_id], false)
	selected_id = id if objects.has(id) else ""
	if selected_id != "":
		_style(objects[selected_id], true)
	selection_changed.emit(selected_id)


func _style(o: Dictionary, highlighted: bool) -> void:
	var mat: StandardMaterial3D = o["material"]
	var color: Color = o["color"]
	if o["kind"] == "neuropil":
		mat.albedo_color.a = NEUROPIL_ALPHA_SELECTED if highlighted else NEUROPIL_ALPHA
	mat.emission_enabled = highlighted
	mat.emission = color
	mat.emission_energy_multiplier = 0.9 if highlighted else 0.0


func object_aabb(id: String) -> AABB:
	if not objects.has(id):
		return AABB()
	var mi: MeshInstance3D = objects[id]["node"]
	return mi.global_transform * mi.get_aabb()


func combined_aabb() -> AABB:
	var box := AABB()
	var first := true
	for id in objects:
		var b := object_aabb(id)
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	return box


## Offset (in template micrometres) applied to runtime downloads so they line up
## with the bundled set. Learned from the first loaded object when no manifest exists.
func learn_center_from_mesh(mesh: Mesh) -> void:
	if center_known or mesh == null:
		return
	var b := mesh.get_aabb()
	template_center_um = (b.position + b.size * 0.5) / um_to_mm
	center_known = true
