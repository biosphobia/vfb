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
	distance = clampf(radius * 2.6, min_distance, max_distance)
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
