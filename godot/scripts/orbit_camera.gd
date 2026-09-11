class_name OrbitCamera
extends Node3D
## Orbit / pan / zoom camera rig. Right- or middle-drag orbits, shift-drag or
## left-drag on empty space pans, wheel zooms. `target` is the orbit centre.

var camera: Camera3D
var yaw := deg_to_rad(-35.0)
var pitch := deg_to_rad(22.0)
var distance := 9.0
var target := Vector3(0, 1.0, 0)
var min_distance := 0.15
var max_distance := 400.0
var follow: Node3D = null
var follow_offset := Vector3(0, 1.0, 0)
var _dragging := false
var _panning := false
var _last_mouse := Vector2.ZERO
var _smooth_target := Vector3.ZERO
var _touches := {}       # index -> position
var _pinch_dist := 0.0
var _pinch_mid := Vector2.ZERO
var touch_orbit_enabled := true


func _ready() -> void:
	camera = Camera3D.new()
	camera.near = 0.01
	camera.far = 2000.0
	camera.fov = 45.0
	camera.current = true
	add_child(camera)
	_smooth_target = target
	_update()


func focus_on(center: Vector3, radius: float) -> void:
	target = center
	var vs := get_viewport().get_visible_rect().size if is_inside_tree() else Vector2(16, 9)
	var portrait := maxf(1.0, vs.y / maxf(vs.x, 1.0))  # portrait screens need more distance
	distance = clampf(radius * 2.6 * portrait, min_distance, max_distance)
	_update()


func _update() -> void:
	var rot := Basis.from_euler(Vector3(-pitch, yaw, 0.0))
	var offset := rot * Vector3(0, 0, distance)
	camera.global_transform = Transform3D(rot, _smooth_target + offset)


func _process(delta: float) -> void:
	if follow != null:
		target = follow.global_position + follow_offset
	_smooth_target = _smooth_target.lerp(target, minf(1.0, delta * 8.0))
	_update()


func handle_input(event: InputEvent) -> bool:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			_touches[t.index] = t.position
		else:
			_touches.erase(t.index)
		if _touches.size() == 2:
			var pts := _touches.values()
			_pinch_dist = (pts[0] as Vector2).distance_to(pts[1])
			_pinch_mid = ((pts[0] as Vector2) + pts[1]) * 0.5
		return false  # let taps through for picking
	if event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		_touches[d.index] = d.position
		if _touches.size() >= 2:
			var pts := _touches.values()
			var dist: float = (pts[0] as Vector2).distance_to(pts[1])
			var mid: Vector2 = ((pts[0] as Vector2) + pts[1]) * 0.5
			if _pinch_dist > 1.0:
				distance = clampf(distance * (_pinch_dist / maxf(dist, 1.0)), min_distance, max_distance)
			var rot := Basis.from_euler(Vector3(-pitch, yaw, 0.0))
			var scale := distance * 0.0016
			var delta := mid - _pinch_mid
			target += rot * Vector3(-delta.x * scale, delta.y * scale, 0.0)
			follow = null
			_pinch_dist = dist
			_pinch_mid = mid
			return true
		if touch_orbit_enabled:
			yaw -= d.relative.x * 0.008
			pitch = clampf(pitch + d.relative.y * 0.008, deg_to_rad(-85.0), deg_to_rad(85.0))
			return true
		return false
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = clampf(distance * 0.88, min_distance, max_distance)
			return true
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = clampf(distance / 0.88, min_distance, max_distance)
			return true
		if mb.button_index == MOUSE_BUTTON_RIGHT or mb.button_index == MOUSE_BUTTON_MIDDLE:
			_dragging = mb.pressed
			_panning = mb.button_index == MOUSE_BUTTON_MIDDLE or mb.shift_pressed
			_last_mouse = mb.position
			return true
	elif event is InputEventMouseMotion and _dragging:
		var mm := event as InputEventMouseMotion
		var d := mm.relative
		if _panning:
			var rot := Basis.from_euler(Vector3(-pitch, yaw, 0.0))
			var scale := distance * 0.0016
			target += rot * Vector3(-d.x * scale, d.y * scale, 0.0)
			follow = null
		else:
			yaw -= d.x * 0.008
			pitch = clampf(pitch + d.y * 0.008, deg_to_rad(-85.0), deg_to_rad(85.0))
		return true
	return false
