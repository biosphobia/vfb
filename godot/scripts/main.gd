extends Node3D
## VFB Fly Explorer – scene orchestrator.
## World units are millimetres. The fly actor walks on a floor at y = 0.

const RIG_GENERATED := "res://assets/generated/fly/fly_rig.json"
const RIG_DEFAULT := "res://assets/fly_rig_default.json"
const BODY_GLB := "res://assets/generated/fly/fly_body.glb"
const MANIFEST := "res://assets/generated/vfb/manifest.json"
const VFB_DIR := "res://assets/generated/vfb/"
const FLOOR_RADIUS := 30.0
const LAYER_BODY := 1
const LAYER_BRAIN := 2
const REACT_SECONDS := 4.0

var camera: OrbitCamera
var ui: ExplorerUI
var vfb: VfbClient
var fly: Node3D
var model: Node3D
var rig: FlyRig
var brain: BrainAnchor
var rig_data := {}
var manifest := {}
var body_meshes: Array[MeshInstance3D] = []
var _xray := false
var _xray_mat: StandardMaterial3D
var _press_pos := Vector2.ZERO
var _press_valid := false
var _term_cache := {}
var _fly_yaw := 0.0
var _placeholder := false
var _bundled_loaded := false


func _ready() -> void:
	_setup_world()
	vfb = VfbClient.new()
	add_child(vfb)

	rig_data = _load_json(RIG_GENERATED)
	if rig_data.is_empty():
		rig_data = _load_json(RIG_DEFAULT)
	manifest = _load_json(MANIFEST)

	fly = Node3D.new()
	fly.name = "Fly"
	add_child(fly)
	if ResourceLoader.exists(BODY_GLB):
		var ps: PackedScene = load(BODY_GLB)
		model = ps.instantiate()
	else:
		model = PlaceholderFly.build(rig_data)
		_placeholder = true
	model.name = "Model"
	model.position.y = float(rig_data.get("ground_offset_mm", 0.0))
	fly.add_child(model)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh != null:
			body_meshes.append(mi)
			mi.create_trimesh_collision()
			for body in mi.get_children():
				if body is StaticBody3D:
					body.collision_layer = LAYER_BODY
					body.collision_mask = 0
	_xray_mat = StandardMaterial3D.new()
	_xray_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_xray_mat.albedo_color = Color(0.75, 0.6, 0.4, 0.16)
	_xray_mat.cull_mode = BaseMaterial3D.CULL_BACK
	_xray_mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_OPAQUE_ONLY  # keep depth so the brain reads inside the head

	rig = FlyRig.new()
	add_child(rig)
	rig.setup(model, rig_data)

	brain = BrainAnchor.new()
	brain.name = "BrainAnchor"
	var head := model.find_child("c_head", true, false)
	(head if head != null else model).add_child(brain)
	var hc: Array = rig_data.get("head_center_local_mm", [0.2, 0.0, 0.02])
	brain.head_offset_mm = Vector3(float(hc[0]), float(hc[1]), float(hc[2]))
	if not manifest.is_empty():
		var c: Array = manifest.get("template_center_um", [0, 0, 0])
		brain.template_center_um = Vector3(float(c[0]), float(c[1]), float(c[2]))
		brain.um_to_mm = float(manifest.get("um_to_mm", 0.001))
		brain.center_known = true
	brain.apply_calibration()
	brain.selection_changed.connect(_on_brain_selection)

	camera = OrbitCamera.new()
	add_child(camera)
	camera.follow = fly
	camera.follow_offset = Vector3(0.6, 0.9, 0)
	camera.focus_on(fly.global_position + camera.follow_offset, 3.2)

	ui = ExplorerUI.new()
	add_child(ui)
	_connect_ui()
	rig.behaviour_changed.connect(func(b): ui.set_behaviour(b))

	var msgs := []
	msgs.append("placeholder body (run tools/build_fly_body.py for NeuroMechFly)" if _placeholder else "NeuroMechFly body, %d joints" % rig.joint_count())
	if manifest.is_empty():
		msgs.append("no bundled VFB set – search loads live from virtualflybrain.org")
	else:
		msgs.append("%d bundled VFB objects" % manifest.get("objects", []).size())
	ui.set_status(" · ".join(msgs))
	print("VFB Fly Explorer: " + " | ".join(msgs))
	if not manifest.is_empty():
		_load_bundled.call_deferred()


func _setup_world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.07, 0.08, 0.1)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.65, 0.75)
	env.ambient_light_energy = 0.4
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, 35, 0)
	sun.light_energy = 0.9
	sun.shadow_enabled = not OS.has_feature("web")
	sun.directional_shadow_max_distance = 40.0
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, -140, 0)
	fill.light_energy = 0.3
	fill.light_color = Color(0.7, 0.8, 1.0)
	add_child(fill)

	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(FLOOR_RADIUS * 2.0, FLOOR_RADIUS * 2.0)
	floor.mesh = plane
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.13, 0.14, 0.17)
	fm.roughness = 0.95
	floor.material_override = fm
	add_child(floor)
	add_child(_grid_mesh(FLOOR_RADIUS, 1.0))


func _grid_mesh(radius: float, step: float) -> MeshInstance3D:
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var n := int(radius / step)
	for i in range(-n, n + 1):
		var x := i * step
		var c := Color(0.25, 0.27, 0.32, 1.0) if i % 5 == 0 else Color(0.18, 0.19, 0.23, 1.0)
		verts.append(Vector3(x, 0.001, -radius)); verts.append(Vector3(x, 0.001, radius))
		verts.append(Vector3(-radius, 0.001, x)); verts.append(Vector3(radius, 0.001, x))
		for _k in range(4):
			cols.append(c)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = cols
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	mi.material_override = m
	return mi


func _load_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var parsed = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


# ---------------------------------------------------------------- UI wiring
func _connect_ui() -> void:
	ui.search_requested.connect(_on_search)
	ui.result_activated.connect(func(id): _show_term(id))
	ui.load_requested.connect(func(id): _load_remote(id))
	ui.load_bundled_requested.connect(_load_bundled)
	ui.clear_requested.connect(func():
		brain.clear()
		ui.clear_loaded()
		_bundled_loaded = false)
	ui.behaviour_selected.connect(func(b): rig.behaviour = b)
	ui.startle_requested.connect(func(): rig.startle())
	ui.gait_changed.connect(func(hz, stride):
		rig.step_hz = hz
		rig.stride_deg = stride)
	ui.body_visible_toggled.connect(func(on): model.visible = on)
	ui.xray_toggled.connect(_set_xray)
	ui.brain_visible_toggled.connect(func(on): brain.visible = on)
	ui.follow_toggled.connect(func(on): camera.follow = fly if on else null)
	ui.focus_requested.connect(_focus)
	ui.object_visibility_toggled.connect(func(id, on):
		brain.set_object_visible(id, on)
		ui.set_loaded_visible(id, on))
	ui.object_selected.connect(func(id): _select_object(id, false))
	ui.object_removed.connect(func(id):
		brain.remove_object(id)
		ui.remove_loaded(id))
	ui.calibration_changed.connect(func(off, s):
		brain.user_offset_mm = off
		brain.user_scale = s
		brain.apply_calibration())


func _set_xray(on: bool) -> void:
	_xray = on
	ui.set_xray(on)
	for mi in body_meshes:
		var count := mi.mesh.get_surface_count() if mi.mesh != null else 0
		for i in range(count):
			mi.set_surface_override_material(i, _xray_mat if on else null)
		if on:
			mi.material_override = _xray_mat
		else:
			mi.material_override = null if not _placeholder else mi.material_override
	if on and _placeholder:
		for mi in body_meshes:
			mi.material_override = _xray_mat


func _focus(what: String) -> void:
	if what == "brain":
		camera.follow = null
		var box := brain.combined_aabb()
		if box.size.length() > 0.0:
			camera.focus_on(box.get_center(), maxf(0.3, box.size.length() * 0.5))
		else:
			camera.focus_on(brain.global_position, 0.6)
	else:
		camera.follow = fly
		camera.focus_on(fly.global_position + camera.follow_offset, 2.2)


# ---------------------------------------------------------------- input
func _unhandled_input(event: InputEvent) -> void:
	if camera.handle_input(event):
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_press_pos = mb.position
				_press_valid = true
			elif _press_valid and mb.position.distance_to(_press_pos) < 6.0:
				_pick(mb.position)
				_press_valid = false
	elif event is InputEventKey and event.pressed and not event.echo and not ui.is_typing():
		var k := event as InputEventKey
		match k.keycode:
			KEY_SPACE:
				rig.behaviour = FlyRig.Behaviour.IDLE if rig.behaviour == FlyRig.Behaviour.FLY else FlyRig.Behaviour.FLY
			KEY_1:
				rig.behaviour = FlyRig.Behaviour.IDLE
			KEY_2:
				rig.behaviour = FlyRig.Behaviour.WALK
			KEY_3:
				rig.behaviour = FlyRig.Behaviour.FLY
			KEY_F:
				_focus("brain")
			KEY_HOME:
				_focus("fly")
			KEY_X:
				_set_xray(not _xray)


func _process(delta: float) -> void:
	var fwd := 0.0
	var turn := 0.0
	if not ui.is_typing():
		if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
			fwd += 1.0
		if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
			fwd -= 1.0
		if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
			turn += 1.0
		if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
			turn -= 1.0
	rig.drive(fwd, turn)
	_fly_yaw += rig.turn_rate_rad_s * delta
	fly.rotation.y = _fly_yaw
	var step := fly.global_transform.basis.x * rig.forward_speed_mm_s * delta
	var p := fly.position + step
	var flat := Vector2(p.x, p.z)
	if flat.length() > FLOOR_RADIUS - 2.0:
		flat = flat.normalized() * (FLOOR_RADIUS - 2.0)
		# turn back toward the centre when hitting the edge
		_fly_yaw += delta * 1.5
	fly.position = Vector3(flat.x, rig.hover_height_mm, flat.y)


func _pick(pos: Vector2) -> void:
	var cam := camera.camera
	var from := cam.project_ray_origin(pos)
	var dir := cam.project_ray_normal(pos)
	var space := get_world_3d().direct_space_state
	if brain.visible:
		var pb := PhysicsRayQueryParameters3D.create(from, from + dir * 1000.0, LAYER_BRAIN)
		var hit := space.intersect_ray(pb)
		if not hit.is_empty():
			var col: Object = hit.get("collider")
			if col != null and col.has_meta("vfb_id"):
				_select_object(str(col.get_meta("vfb_id")), true)
				return
	if model.visible:
		var pm := PhysicsRayQueryParameters3D.create(from, from + dir * 1000.0, LAYER_BODY)
		var hit2 := space.intersect_ray(pm)
		if not hit2.is_empty():
			var col2: Object = hit2.get("collider")
			var seg: String = str((col2 as Node).get_parent().name) if col2 is Node else "body"
			ui.set_status("Poked the fly's %s" % str(seg).replace("_", " "))
			rig.startle()
			brain.select("")
			return
	brain.select("")


# ---------------------------------------------------------------- objects
func _select_object(id: String, from_3d: bool) -> void:
	brain.select(id)
	ui.highlight_loaded(id)
	if id == "":
		return
	var o: Dictionary = brain.objects.get(id, {})
	if from_3d:
		_react_to(str(o.get("label", "")))
	_show_term(id)


func _on_brain_selection(id: String) -> void:
	ui.highlight_loaded(id)


func _react_to(label: String) -> void:
	var l := label.to_lower()
	if l.contains("wing") or l.contains("flight") or l.contains("haltere"):
		rig.react("fly", REACT_SECONDS * 0.6)
	elif l.contains("leg") or l.contains("motor") or l.contains("descending") or l.contains("walk"):
		rig.react("walk", REACT_SECONDS)
	elif l.contains("antenna") or l.contains("olfactory") or l.contains("odor") or l.contains("johnston"):
		rig.react("antenna", REACT_SECONDS)
	elif l.contains("mushroom") or l.contains("kenyon") or l.contains("central complex") or l.contains("ellipsoid"):
		rig.react("think", REACT_SECONDS)


func _color_for(id: String, kind: String) -> Color:
	var h := fmod(float(id.hash() % 1000) / 1000.0, 1.0)
	return Color.from_hsv(h, 0.35, 0.85) if kind == "neuropil" else Color.from_hsv(h, 0.85, 1.0)


func _load_bundled() -> void:
	if _bundled_loaded or manifest.is_empty():
		return
	_bundled_loaded = true
	var objs: Array = manifest.get("objects", [])
	var n := 0
	for o in objs:
		var id := str(o.get("id", ""))
		var path: String = VFB_DIR + str(o.get("file", ""))
		if id.is_empty() or brain.has_object(id) or not ResourceLoader.exists(path):
			continue
		var ps = load(path)
		if not (ps is PackedScene):
			continue
		var inst: Node = ps.instantiate()
		var mis := inst.find_children("*", "MeshInstance3D", true, false)
		if mis.is_empty():
			inst.free()
			continue
		var mesh: Mesh = (mis[0] as MeshInstance3D).mesh
		inst.free()
		var c: Array = o.get("color", [0.8, 0.8, 0.8, 1.0])
		var color := Color(float(c[0]), float(c[1]), float(c[2]))
		var kind := str(o.get("kind", "neuron"))
		brain.add_object(id, str(o.get("label", id)), kind, mesh, color, {"format": str(o.get("format", "glb")), "bundled": true})
		ui.add_loaded(id, str(o.get("label", id)), kind, color)
		n += 1
		if n % 6 == 0:
			ui.set_status("Loading starter set… %d / %d" % [n, objs.size()])
			await get_tree().process_frame
	ui.set_status("Loaded %d bundled VFB objects" % n)


func _term(id: String) -> Dictionary:
	if _term_cache.has(id):
		return _term_cache[id]
	var info := await vfb.term_info(id)
	if not info.is_empty():
		_term_cache[id] = info
	return info


func _on_search(term: String) -> void:
	var t := term.strip_edges()
	if t.is_empty():
		return
	if VfbClient.looks_like_id(t):
		_show_term(t)
		return
	ui.set_status("Searching VFB for “%s”…" % t)
	var items := await vfb.search(t)
	ui.set_results(items)
	ui.set_status("%d results" % items.size() if not items.is_empty() else "No results (%s)" % vfb.last_error)


func _show_term(id: String) -> void:
	ui.set_status("Fetching term info for %s…" % id)
	var info := await _term(id)
	if info.is_empty():
		ui.set_status("No term info for %s – %s" % [id, vfb.last_error])
		return
	var s := VfbClient.summary_of(info)
	var images := VfbClient.images_of(info)
	var examples := VfbClient.examples_of(info)
	var domains := VfbClient.domains_of(info)
	var extra := ""
	if not domains.is_empty():
		extra += "\n[b]%d painted domains[/b] listed in Results – double-click to open, then Load 3D.\n" % domains.size()
		ui.set_results(domains.map(func(d): return {"id": d["id"], "label": d["label"], "facets": ["Individual"]}))
	elif not examples.is_empty():
		extra += "\n[b]%d example images[/b] listed in Results – double-click one, then Load 3D.\n" % examples.size()
		ui.set_results(examples.map(func(e): return {"id": e["id"], "label": e["label"], "facets": ["Individual"]}))
	if not images.is_empty():
		var tl := str(images[0].get("template_label", images[0].get("template", "")))
		extra += "\n[b]3D image in template:[/b] %s\n" % tl
	ui.set_term_info(s, not images.is_empty(), extra)
	ui.set_status("")
	if not images.is_empty() and images[0].has("thumbnail"):
		var bytes := await vfb.fetch_bytes(str(images[0]["thumbnail"]))
		if not bytes.is_empty() and ui.info_title.text.contains(id):
			var img := Image.new()
			if img.load_png_from_buffer(bytes) == OK:
				ui.set_thumbnail(ImageTexture.create_from_image(img))


func _load_remote(id: String) -> void:
	if id.is_empty():
		return
	if brain.has_object(id):
		_select_object(id, false)
		return
	var info := await _term(id)
	if info.is_empty():
		ui.set_status("Cannot load %s: %s" % [id, vfb.last_error])
		return
	var s := VfbClient.summary_of(info)
	var images := VfbClient.images_of(info)
	if images.is_empty():
		ui.set_status("%s has no 3D image" % id)
		return
	var template_id := str(manifest.get("template", {}).get("id", "VFB_00101567"))
	var img: Dictionary = images[0]
	for cand in images:
		if str(cand.get("template", "")) == template_id:
			img = cand
			break
	if str(img.get("template", "")) != template_id and not str(img.get("template", "")).is_empty():
		ui.set_status("Note: %s is registered to %s, not %s – placement will be approximate" % [id, img.get("template_label", img.get("template")), template_id])
	var kind := "neuron"
	for ty in s.get("types", []):
		if str(ty).to_lower().contains("neuropil") or str(ty).to_lower().contains("region"):
			kind = "neuropil"
	var offset := brain.template_center_um if brain.center_known else Vector3.ZERO
	var mesh: ArrayMesh = null
	var fmt := ""
	var src := ""
	for key in ["obj", "obj_alt"]:
		if not img.has(key):
			continue
		ui.set_status("Downloading mesh for %s…" % s.get("label", id))
		var bytes := await vfb.fetch_bytes(str(img[key]))
		if bytes.is_empty():
			continue
		ui.set_status("Parsing %d KB OBJ…" % (bytes.size() / 1024))
		await get_tree().process_frame
		mesh = ObjParser.parse(bytes, brain.um_to_mm, offset)
		fmt = "obj"
		src = str(img[key])
		if mesh.get_surface_count() > 0:
			break
		mesh = null
	if mesh == null and img.has("swc"):
		ui.set_status("Downloading skeleton for %s…" % s.get("label", id))
		var bytes := await vfb.fetch_bytes(str(img["swc"]))
		if not bytes.is_empty():
			mesh = SwcParser.parse(bytes, brain.um_to_mm, offset)
			fmt = "swc"
			src = str(img["swc"])
			kind = "neuron"
	if mesh == null or mesh.get_surface_count() == 0:
		ui.set_status("No loadable mesh for %s (%s)" % [id, vfb.last_error])
		return
	var color := _color_for(id, kind)
	brain.add_object(id, str(s.get("label", id)), kind, mesh, color, {"format": fmt, "source": src})
	if not brain.center_known:
		brain.learn_center_from_mesh(mesh)
		var shift := brain.template_center_um * brain.um_to_mm
		(brain.objects[id]["node"] as Node3D).position = -shift
	ui.add_loaded(id, str(s.get("label", id)), kind, color)
	ui.set_status("Loaded %s (%s)" % [s.get("label", id), fmt])
	_select_object(id, false)
