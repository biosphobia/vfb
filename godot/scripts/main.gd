extends Node3D
## VFB Fly Explorer – scene orchestrator.
## World units are millimetres. The fly actor walks on a floor at y = 0.

const RIG_GENERATED := "res://assets/generated/fly/fly_rig.json"
const RIG_DEFAULT := "res://assets/fly_rig_default.json"
const BODY_GLB := "res://assets/generated/fly/fly_body.glb"
const MANIFEST := "res://assets/generated/vfb/manifest.json"
const VFB_DIR := "res://assets/generated/vfb/"
const DEFAULT_API := "https://vfb-fly-explorer-api.onrender.com"
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
var brain_view: BrainView
var activity: BrainActivity
var narrator: Narrator
var watch: YouTubeWatch
var rig_data := {}
var manifest := {}
var body_meshes: Array[MeshInstance3D] = []
var api_base := ""
var _xray := false
var _xray_mat: StandardMaterial3D
var _press_pos := Vector2.ZERO
var _press_valid := false
var _term_cache := {}
var _fly_yaw := 0.0
var _placeholder := false
var _bundled_loaded := false
var _face_viewer := false
var _poked_timer := 0.0
var _ctx_timer := 0.0
var _idle_variant := 0
var _idle_variant_timer := 0.0
var _selected_label := ""
var _touch := false


func _ready() -> void:
	_touch = WebBridge.is_touch_device()
	var dpr := WebBridge.device_pixel_ratio()
	get_tree().root.content_scale_factor = clampf(dpr, 1.0, 3.0)
	api_base = WebBridge.api_base()
	if api_base.is_empty():
		api_base = DEFAULT_API

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
			mi.layers = LAYER_BODY
			mi.create_trimesh_collision()
			for body in mi.get_children():
				if body is StaticBody3D:
					body.collision_layer = LAYER_BODY
					body.collision_mask = 0
	_xray_mat = StandardMaterial3D.new()
	_xray_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_xray_mat.albedo_color = Color(0.75, 0.6, 0.4, 0.16)
	_xray_mat.cull_mode = BaseMaterial3D.CULL_BACK
	_xray_mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_OPAQUE_ONLY

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

	brain_view = BrainView.new()
	add_child(brain_view)
	brain_view.setup(get_world_3d(), brain)
	brain_view.fit_radius(0.45)

	activity = BrainActivity.new()
	activity.brain = brain
	add_child(activity)

	narrator = Narrator.new()
	add_child(narrator)
	narrator.setup(vfb, api_base)
	narrator.updated.connect(func(d, f, fo): ui.set_story(d, f, fo))
	narrator.line_added.connect(func(t, ai): ui.add_story_line(t, ai))

	watch = YouTubeWatch.new()
	add_child(watch)
	watch.setup(vfb, api_base)
	watch.video_changed.connect(_on_video_changed)
	watch.plan_ready.connect(func(plan):
		ui.set_video_plan(plan)
		ui.set_status("The fly seems %s about this video." % str(plan.get("mood", "curious")))
		narrator.set_context(_context()))
	watch.beat.connect(_on_beat)
	watch.playing_changed.connect(func(_on): narrator.set_context(_context()))

	ui = ExplorerUI.new()
	add_child(ui)
	ui.set_touch(_touch)
	ui.set_brain_texture(brain_view.texture())
	_connect_ui()
	rig.behaviour_changed.connect(func(b): ui.set_behaviour(b))
	var labels := {}
	var colors := {}
	for s in BrainActivity.SYSTEMS:
		labels[s] = activity.system_label(s)
		colors[s] = activity.system_color(s)
	ui.set_meters(activity.levels, labels, colors)

	var msgs := []
	msgs.append("placeholder body (run tools/build_fly_body.py for NeuroMechFly)" if _placeholder else "NeuroMechFly body, %d joints" % rig.joint_count())
	if manifest.is_empty():
		msgs.append("no bundled VFB set – search loads live from virtualflybrain.org")
	else:
		msgs.append("%d bundled VFB objects" % manifest.get("objects", []).size())
	print("VFB Fly Explorer: " + " | ".join(msgs))
	ui.set_status("Loading the brain map…" if not manifest.is_empty() else "Ready. Search Virtual Fly Brain to add anatomy.")
	if not manifest.is_empty():
		_load_bundled.call_deferred()
	_check_api.call_deferred()
	var v := WebBridge.query_param("v")
	if not v.is_empty():
		_start_video.call_deferred(v)


func _check_api() -> void:
	var data = await vfb.get_json(api_base + "/api/health")
	var ok: bool = data is Dictionary and bool(data.get("ai", false))
	narrator.ai_available = ok
	ui.set_api_available(ok)


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
	ui.startle_requested.connect(func():
		rig.startle()
		_poked_timer = 2.0)
	ui.gait_changed.connect(func(hz, stride):
		rig.step_hz = hz
		rig.stride_deg = stride)
	ui.body_visible_toggled.connect(func(on): model.visible = on)
	ui.xray_toggled.connect(_set_xray)
	ui.brain_visible_toggled.connect(func(on): brain.visible = on)
	ui.follow_toggled.connect(func(on): camera.follow = fly if on else null)
	ui.focus_requested.connect(_focus)
	ui.brain_view_tapped.connect(func():
		_set_xray(true)
		_focus("brain"))
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
	ui.video_requested.connect(_start_video)
	ui.video_stop_requested.connect(func():
		watch.stop()
		_face_viewer = false
		rig.look_pitch_deg = 0.0
		rig.look_yaw_deg = 0.0)
	ui.video_play_toggled.connect(func(on): watch.simulate_play(on))
	ui.share_requested.connect(func():
		var url := WebBridge.share_url(str(watch.info.get("id", "")))
		WebBridge.copy_text(url)
		ui.set_status("Link copied: " + url))
	ui.ai_toggled.connect(func(on): narrator.ai_enabled = on)


func _set_xray(on: bool) -> void:
	_xray = on
	ui.set_xray(on)
	for mi in body_meshes:
		mi.material_override = _xray_mat if on else null
		if not on and _placeholder:
			pass  # placeholder keeps its own per-part material via child nodes


func _focus(what: String) -> void:
	if what == "brain":
		camera.follow = null
		ui.set_follow(false)
		var box := brain.combined_aabb()
		if box.size.length() > 0.0:
			camera.focus_on(box.get_center(), maxf(0.3, box.size.length() * 0.5))
		else:
			camera.focus_on(brain.global_position, 0.6)
	else:
		camera.follow = fly
		ui.set_follow(true)
		camera.focus_on(fly.global_position + camera.follow_offset, 3.2)


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
			elif _press_valid and mb.position.distance_to(_press_pos) < 8.0:
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
	var js := ui.joystick_value
	if js.length() > 0.05:
		fwd = js.y
		turn = -js.x
	rig.drive(fwd, turn)
	_poked_timer = maxf(0.0, _poked_timer - delta)

	# face the viewer when watching a video and not being driven
	if _face_viewer and absf(fwd) < 0.01 and absf(turn) < 0.01 and rig.behaviour != FlyRig.Behaviour.WALK:
		var to_cam := camera.camera.global_position - fly.global_position
		var want := atan2(-to_cam.z, to_cam.x)
		_fly_yaw = lerp_angle(_fly_yaw, want, minf(1.0, delta * 1.5))
	_fly_yaw += rig.turn_rate_rad_s * delta
	fly.rotation.y = _fly_yaw
	var step := fly.global_transform.basis.x * rig.forward_speed_mm_s * delta
	var p := fly.position + step
	var flat := Vector2(p.x, p.z)
	if flat.length() > FLOOR_RADIUS - 2.0:
		flat = flat.normalized() * (FLOOR_RADIUS - 2.0)
		_fly_yaw += delta * 1.5
	fly.position = Vector3(flat.x, rig.hover_height_mm, flat.y)

	_ctx_timer += delta
	_idle_variant_timer += delta
	if _idle_variant_timer > 9.0:
		_idle_variant_timer = 0.0
		_idle_variant += 1
	if _ctx_timer > 0.25:
		_ctx_timer = 0.0
		var ctx := _context()
		activity.set_context(ctx)
		ctx["top_systems"] = activity.top_systems(3)
		ctx["top_system_label"] = activity.system_label(str(ctx["top_systems"][0][0])) if ctx["top_systems"].size() > 0 else ""
		ctx["brain_levels"] = activity.levels.duplicate()
		narrator.set_context(ctx)
		ui.set_meters(activity.levels, {}, {})
		_update_video_overlay()


func _context() -> Dictionary:
	var beh: String = ["idle", "walk", "fly"][rig.behaviour]
	var sel_system := activity.system_of(_selected_label) if _selected_label != "" else ""
	return {
		"behaviour": beh,
		"moving": absf(rig.forward_speed_mm_s) > 0.05,
		"poked": _poked_timer > 0.0,
		"watching": watch.has_video(),
		"video_playing": watch.playing,
		"video_title": watch.title(),
		"mood": watch.mood(),
		"reaction": rig.is_reacting(),
		"selected_label": _selected_label,
		"selected_system": sel_system,
		"idle_variant": _idle_variant,
		"loaded_objects": brain.objects.size(),
	}


func _update_video_overlay() -> void:
	if not WebBridge.is_web() or not watch.has_video():
		return
	var info := ui.video_slot_rect()
	var rect: Rect2 = info["rect"] if info["visible"] else ui.mini_video_rect()
	var f := get_tree().root.content_scale_factor / maxf(WebBridge.device_pixel_ratio(), 0.01)
	WebBridge.set_video_rect(Rect2(rect.position * f, rect.size * f), true)


func _pick(pos: Vector2) -> void:
	if ui.is_sheet_open():
		return
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
			ui.set_status("You poked the fly's %s!" % str(seg).replace("_", " ").trim_prefix("c ").trim_prefix("l ").trim_prefix("r "))
			rig.startle()
			_poked_timer = 2.0
			brain.select("")
			return
	brain.select("")


# ---------------------------------------------------------------- video
func _start_video(text: String) -> void:
	if not watch.load(text):
		ui.set_status("That doesn't look like a YouTube link.")
		return
	ui.set_status("Loading video…")
	ui.show_watch_tab()
	_face_viewer = true
	rig.look_pitch_deg = -8.0
	if ui.compact:
		pass


func _on_video_changed(info: Dictionary) -> void:
	ui.set_video(info, watch.thumbnail())
	if info.is_empty():
		WebBridge.set_video_rect(Rect2(), false)
		ui.set_status("Video stopped.")
	else:
		_update_video_overlay()
	narrator.set_context(_context())


func _on_beat(action: String, note: String) -> void:
	match action:
		"look":
			_face_viewer = true
			rig.react("antenna", 1.5)
		"startle":
			rig.startle()
			_poked_timer = 1.5
		"walk":
			rig.react("walk", 3.0)
		"fly":
			rig.react("fly", 2.5)
		"feed":
			rig.react("feed", 3.5)
		"groove":
			rig.react("groove", 4.0)
		"antenna":
			rig.react("antenna", 3.0)
		"think":
			rig.react("think", 3.0)
		"rest":
			rig.react("rest")
	if note != "":
		ui.add_video_note(note)
		ui.add_story_line(note, bool(watch.plan.get("ai", false)))


# ---------------------------------------------------------------- objects
func _select_object(id: String, from_3d: bool) -> void:
	brain.select(id)
	ui.highlight_loaded(id)
	_selected_label = ""
	if id == "":
		return
	var o: Dictionary = brain.objects.get(id, {})
	_selected_label = str(o.get("label", ""))
	if from_3d:
		_react_to(_selected_label)
	_show_term(id)


func _on_brain_selection(id: String) -> void:
	ui.highlight_loaded(id)
	if id == "":
		_selected_label = ""


func _react_to(label: String) -> void:
	var l := label.to_lower()
	if l.contains("wing") or l.contains("flight") or l.contains("haltere"):
		rig.react("fly", REACT_SECONDS * 0.6)
	elif l.contains("leg") or l.contains("motor") or l.contains("descending") or l.contains("walk"):
		rig.react("walk", REACT_SECONDS)
	elif l.contains("antenna") or l.contains("olfactory") or l.contains("odor") or l.contains("johnston") or l.contains("lateral horn"):
		rig.react("antenna", REACT_SECONDS)
	elif l.contains("gnathal") or l.contains("gustatory") or l.contains("prow") or l.contains("saddle"):
		rig.react("feed", REACT_SECONDS * 0.8)
	elif l.contains("mushroom") or l.contains("kenyon") or l.contains("central complex") or l.contains("ellipsoid") or l.contains("fan-shaped") or l.contains("calyx"):
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
			ui.set_status("Loading the brain map… %d of %d" % [n, objs.size()])
			await get_tree().process_frame
	ui.set_status("Ready. %d brain regions and neurons are in place." % n)
	var box := brain.combined_aabb()
	if box.size.length() > 0.0:
		brain_view.fit_radius(box.size.length() * 0.5)


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
	ui.set_status("Searching Virtual Fly Brain for “%s”…" % t)
	var items := await vfb.search(t)
	ui.set_results(items)
	ui.set_status("%d results. Double-tap one to read about it." % items.size() if not items.is_empty() else "Nothing found. Try another word.")


func _show_term(id: String) -> void:
	ui.set_status("Reading about %s…" % id)
	var info := await _term(id)
	if info.is_empty():
		ui.set_status("Could not reach Virtual Fly Brain right now.")
		return
	var s := VfbClient.summary_of(info)
	var images := VfbClient.images_of(info)
	var examples := VfbClient.examples_of(info)
	var domains := VfbClient.domains_of(info)
	var extra := ""
	if not domains.is_empty():
		extra += "\n[b]%d regions[/b] are listed under Explore – pick one, then “Show it inside the fly”.\n" % domains.size()
		ui.set_results(domains.map(func(d): return {"id": d["id"], "label": d["label"], "facets": ["Individual"]}))
	elif not examples.is_empty():
		extra += "\n[b]%d example neurons[/b] are listed under Explore – pick one, then “Show it inside the fly”.\n" % examples.size()
		ui.set_results(examples.map(func(e): return {"id": e["id"], "label": e["label"], "facets": ["Individual"]}))
	ui.set_term_info(s, not images.is_empty(), extra)
	ui.set_status("")
	if not images.is_empty() and images[0].has("thumbnail"):
		var bytes := await vfb.fetch_bytes(str(images[0]["thumbnail"]))
		if not bytes.is_empty() and ui.info_title.text == str(s.get("label", "")):
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
		ui.set_status("Could not reach Virtual Fly Brain right now.")
		return
	var s := VfbClient.summary_of(info)
	var images := VfbClient.images_of(info)
	if images.is_empty():
		ui.set_status("This one has no 3D shape to show.")
		return
	var template_id := str(manifest.get("template", {}).get("id", "VFB_00101567"))
	var img: Dictionary = images[0]
	for cand in images:
		if str(cand.get("template", "")) == template_id:
			img = cand
			break
	if str(img.get("template", "")) != template_id and not str(img.get("template", "")).is_empty():
		ui.set_status("This shape comes from a different brain template, so its position is approximate.")
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
		ui.set_status("Downloading the 3D shape of %s…" % s.get("label", id))
		var bytes := await vfb.fetch_bytes(str(img[key]))
		if bytes.is_empty():
			continue
		ui.set_status("Building the shape…")
		await get_tree().process_frame
		mesh = ObjParser.parse(bytes, brain.um_to_mm, offset)
		fmt = "obj"
		src = str(img[key])
		if mesh.get_surface_count() > 0:
			break
		mesh = null
	if mesh == null and img.has("swc"):
		ui.set_status("Downloading the skeleton of %s…" % s.get("label", id))
		var bytes := await vfb.fetch_bytes(str(img["swc"]))
		if not bytes.is_empty():
			mesh = SwcParser.parse(bytes, brain.um_to_mm, offset)
			fmt = "swc"
			src = str(img["swc"])
			kind = "neuron"
	if mesh == null or mesh.get_surface_count() == 0:
		ui.set_status("Sorry, that shape could not be loaded.")
		return
	var color := _color_for(id, kind)
	brain.add_object(id, str(s.get("label", id)), kind, mesh, color, {"format": fmt, "source": src})
	if not brain.center_known:
		brain.learn_center_from_mesh(mesh)
		var shift := brain.template_center_um * brain.um_to_mm
		(brain.objects[id]["node"] as Node3D).position = -shift
	ui.add_loaded(id, str(s.get("label", id)), kind, color)
	ui.set_status("%s is now inside the fly." % s.get("label", id))
	_select_object(id, false)
