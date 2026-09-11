class_name BrainView
extends Node
## Picture-in-picture camera on the brain, sharing the main World3D.
## Only visual layer 2 (brain objects) is rendered, so the body never hides it.

var viewport: SubViewport
var camera: Camera3D
var target: Node3D
var orbit_speed := 0.35
var distance := 1.1
var _angle := 0.0
var _pitch := deg_to_rad(18.0)
var enabled := true


func setup(world: World3D, brain_target: Node3D, size: Vector2i = Vector2i(360, 240)) -> void:
	target = brain_target
	viewport = SubViewport.new()
	viewport.size = size
	viewport.world_3d = world
	viewport.own_world_3d = false
	viewport.transparent_bg = false
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.msaa_3d = Viewport.MSAA_2X if not OS.has_feature("web") else Viewport.MSAA_DISABLED
	add_child(viewport)
	camera = Camera3D.new()
	camera.near = 0.005
	camera.far = 50.0
	camera.fov = 40.0
	camera.cull_mask = 2  # brain layer only
	viewport.add_child(camera)
	camera.current = true


func set_size(size: Vector2i) -> void:
	if viewport != null and size.x > 8 and size.y > 8:
		viewport.size = size


func set_enabled(on: bool) -> void:
	enabled = on
	if viewport != null:
		viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED


func texture() -> Texture2D:
	return viewport.get_texture() if viewport != null else null


func fit_radius(r: float) -> void:
	distance = clampf(r * 2.4, 0.3, 6.0)


func _process(delta: float) -> void:
	if not enabled or target == null or camera == null:
		return
	_angle += delta * orbit_speed
	var center := target.global_position
	var basis := target.global_transform.basis.orthonormalized()
	# orbit in the head's horizontal plane (head frame: x anterior, y left, z up)
	var dir := Vector3(cos(_angle) * cos(_pitch), sin(_angle) * cos(_pitch), sin(_pitch))
	var pos := center + basis * dir * distance
	camera.look_at_from_position(pos, center, basis.z)
