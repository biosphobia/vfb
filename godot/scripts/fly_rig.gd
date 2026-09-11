class_name FlyRig
extends Node
## Procedural animation for the NeuroMechFly body: tripod-gait walking,
## wing flapping, and idle micro-motions. Fully data-driven from fly_rig.json
## (joint DOF axes measured by forward kinematics in tools/build_fly_body.py).
##
## Segment-local frames follow MuJoCo: x = anterior, y = left, z = up.
## DOF rotations are intrinsic: basis = rest * Rx(yaw) * Ry(pitch) * Rz(roll).

enum Behaviour { IDLE, WALK, FLY }

signal behaviour_changed(behaviour: int)

const TRIPOD_A := ["lf", "rm", "lh"]
const TRIPOD_B := ["rf", "lm", "rh"]

var behaviour: int = Behaviour.IDLE:
	set(v):
		if v != behaviour:
			behaviour = v
			behaviour_changed.emit(v)

## Tunables (exposed in the UI)
var step_hz := 2.5
var stride_deg := 20.0
var lift_deg := 24.0
var flap_hz := 9.0
var flap_deg := 40.0
var idle_amount := 1.0

## Locomotion outputs (read by the owner to move the actor)
var forward_speed_mm_s := 0.0
var turn_rate_rad_s := 0.0
var hover_height_mm := 0.0

var _joints := {}   # name -> {node: Node3D, rest: Basis}
var _legs := {}     # leg -> meta from rig json
var _wings := {}    # node -> meta
var _t := 0.0
var _walk_blend := 0.0
var _fly_blend := 0.0
var _phase := 0.0
var _flap_phase := 0.0
var _stride_mm := 0.7   # per cycle, derived from probes
var _drive := 0.0       # -1..1 from input (forward/back)
var _turn := 0.0        # -1..1 from input
var _drive_hold := 0.0
var _startle := 0.0
var _react_walk := 0.0
var _react_antenna := 0.0
var _react_think := 0.0
var _rng := RandomNumberGenerator.new()


func setup(model_root: Node, rig: Dictionary) -> void:
	_joints.clear()
	for n in rig.get("nodes", []):
		var node := model_root.find_child(str(n["name"]), true, false)
		if node is Node3D:
			_joints[str(n["name"])] = {"node": node, "rest": (node as Node3D).transform.basis}
	_legs = rig.get("legs", {})
	_wings = rig.get("wings", {})
	# Stride length from the front-leg sweep probe (mm per 10 degrees)
	var lf: Dictionary = _legs.get("lf", {})
	var probes: Dictionary = lf.get("probes", {})
	var sweep_dof: String = lf.get("sweep_dof", "coxa.roll")
	if probes.has(sweep_dof):
		var per10: float = absf(float(probes[sweep_dof][0]))
		_stride_mm = maxf(0.2, per10 / 10.0 * stride_deg * 2.0)
	_rng.randomize()
	set_process(true)


func joint_count() -> int:
	return _joints.size()


## Called every frame by the owner with the current input (both in -1..1).
func drive(forward: float, turn: float) -> void:
	_drive = clampf(forward, -1.0, 1.0)
	_turn = clampf(turn, -1.0, 1.0)
	if absf(_drive) > 0.01 or absf(_turn) > 0.01:
		_drive_hold = 0.35


func startle() -> void:
	_startle = 1.4


## Anatomy-driven reactions: "fly", "walk", "antenna", "think".
func react(kind: String, seconds: float = 4.0) -> void:
	match kind:
		"fly":
			_startle = seconds
		"walk":
			_react_walk = seconds
		"antenna":
			_react_antenna = seconds
		"think":
			_react_think = seconds


func _process(delta: float) -> void:
	if _joints.is_empty():
		return
	_t += delta
	_drive_hold = maxf(0.0, _drive_hold - delta)
	_startle = maxf(0.0, _startle - delta)
	_react_walk = maxf(0.0, _react_walk - delta)
	_react_antenna = maxf(0.0, _react_antenna - delta)
	_react_think = maxf(0.0, _react_think - delta)

	var moving := _drive_hold > 0.0
	var want_walk := behaviour == Behaviour.WALK or (behaviour == Behaviour.IDLE and (moving or _react_walk > 0.0))
	var want_fly := behaviour == Behaviour.FLY or _startle > 0.0
	_walk_blend = move_toward(_walk_blend, 1.0 if (want_walk and not want_fly) else 0.0, delta * 3.0)
	_fly_blend = move_toward(_fly_blend, 1.0 if want_fly else 0.0, delta * 2.5)

	var gait_speed := step_hz * (1.0 + 0.6 * absf(_drive)) if moving else step_hz
	_phase = fmod(_phase + TAU * gait_speed * delta * _walk_blend, TAU)
	_flap_phase = fmod(_flap_phase + TAU * flap_hz * delta * _fly_blend, TAU)

	var dir := _drive if moving else (1.0 if (behaviour == Behaviour.WALK or _react_walk > 0.0) else 0.0)
	forward_speed_mm_s = _stride_mm * gait_speed * dir * _walk_blend
	forward_speed_mm_s += 6.0 * _drive * _fly_blend
	turn_rate_rad_s = _turn * 1.6 * maxf(_walk_blend, _fly_blend)
	hover_height_mm = 1.2 * _fly_blend + 0.12 * sin(_flap_phase) * _fly_blend

	var pose := {}  # node -> [yaw, pitch, roll] degrees
	_idle_pose(pose)
	_walk_pose(pose, dir)
	_fly_pose(pose)
	_apply(pose)


func _acc(pose: Dictionary, node: String, dof: String, deg: float) -> void:
	if not pose.has(node):
		pose[node] = [0.0, 0.0, 0.0]
	var idx := 0 if dof == "yaw" else (1 if dof == "pitch" else 2)
	pose[node][idx] += deg


func _acc_dof(pose: Dictionary, leg: String, dof_spec: String, deg: float) -> void:
	# dof_spec like "coxa.roll"
	var seg := dof_spec.get_slice(".", 0)
	var axis := dof_spec.get_slice(".", 1)
	_acc(pose, "%s_%s" % [leg, seg], axis, deg)


func _idle_pose(pose: Dictionary) -> void:
	var k := idle_amount * (1.0 + 3.0 * minf(1.0, _react_antenna))
	if _react_think > 0.0:
		# "thinking": head bobs and the proboscis extends a little
		_acc(pose, "c_head", "pitch", sin(_t * 6.0) * 5.0)
		_acc(pose, "c_rostrum", "pitch", 12.0 * minf(1.0, _react_think))
		_acc(pose, "c_haustellum", "pitch", 10.0 * minf(1.0, _react_think))
	# breathing abdomen
	var breath := sin(_t * 2.2) * 2.0 * k
	_acc(pose, "c_abdomen12", "pitch", breath)
	_acc(pose, "c_abdomen3", "pitch", breath * 0.5)
	# antenna twitch
	var tw := sin(_t * 3.1) * 4.0 * k + sin(_t * 7.3) * 1.5 * k
	_acc(pose, "l_pedicel", "pitch", tw)
	_acc(pose, "r_pedicel", "pitch", -tw * 0.8)
	_acc(pose, "l_funiculus", "roll", sin(_t * 5.0) * 3.0 * k)
	_acc(pose, "r_funiculus", "roll", -sin(_t * 5.0 + 1.0) * 3.0 * k)
	# head scanning
	_acc(pose, "c_head", "roll", sin(_t * 0.7) * 6.0 * k * (1.0 - _walk_blend))
	_acc(pose, "c_head", "pitch", sin(_t * 1.1) * 2.0 * k)
	# halteres rest
	_acc(pose, "l_haltere", "pitch", sin(_t * 1.5) * 2.0)
	_acc(pose, "r_haltere", "pitch", sin(_t * 1.5) * 2.0)


func _walk_pose(pose: Dictionary, dir: float) -> void:
	if _walk_blend <= 0.001:
		return
	var amp := _walk_blend
	for leg in _legs:
		var m: Dictionary = _legs[leg]
		var phase := _phase + (0.0 if TRIPOD_A.has(leg) else PI)
		# Front foot at phase 0, back at PI; swing (lift) while returning forward.
		var sweep := cos(phase) * stride_deg * amp * signf(dir if dir != 0.0 else 1.0)
		var swing := maxf(0.0, -sin(phase))
		var lift := swing * lift_deg * amp
		_acc_dof(pose, leg, m.get("sweep_dof", "coxa.roll"), sweep * float(m.get("sweep_sign_forward", 1)))
		_acc_dof(pose, leg, m.get("lift_dof", "trochanterfemur.pitch"), lift * float(m.get("lift_sign_up", 1)))
		_acc_dof(pose, leg, m.get("flex_dof", "tibia.pitch"), lift * 0.7 * float(m.get("flex_sign_up", 1)))
		# tarsi follow the tibia a little
		for i in range(1, 6):
			_acc(pose, "%s_tarsus%d" % [leg, i], "pitch", -lift * 0.08)
	# body bob & head steadying
	_acc(pose, "c_head", "pitch", -sin(_phase * 2.0) * 1.5 * amp)
	_acc(pose, "c_abdomen12", "pitch", sin(_phase * 2.0) * 1.5 * amp)


func _fly_pose(pose: Dictionary) -> void:
	if _fly_blend <= 0.001:
		return
	var amp := _fly_blend
	var flap := sin(_flap_phase) * flap_deg * amp
	for wing in _wings:
		var m: Dictionary = _wings[wing]
		_acc(pose, wing, m.get("flap_dof", "yaw"), flap * float(m.get("flap_sign_up", 1)))
		# slight feathering on the downstroke
		_acc(pose, wing, "pitch", cos(_flap_phase) * 8.0 * amp)
	var h := sin(_flap_phase + PI) * 25.0 * amp
	_acc(pose, "l_haltere", "yaw", h)
	_acc(pose, "r_haltere", "yaw", -h)
	# tuck legs
	for leg in _legs:
		var m: Dictionary = _legs[leg]
		_acc_dof(pose, leg, m.get("lift_dof", "trochanterfemur.pitch"), 28.0 * amp * float(m.get("lift_sign_up", 1)))
		_acc_dof(pose, leg, m.get("flex_dof", "tibia.pitch"), 30.0 * amp * float(m.get("flex_sign_up", 1)))
	_acc(pose, "c_abdomen12", "pitch", -8.0 * amp)
	_acc(pose, "c_abdomen3", "pitch", -6.0 * amp)


func _apply(pose: Dictionary) -> void:
	for node_name in _joints:
		var j: Dictionary = _joints[node_name]
		var rest: Basis = j["rest"]
		var n: Node3D = j["node"]
		if pose.has(node_name):
			var a: Array = pose[node_name]
			var rot := Basis(Vector3(1, 0, 0), deg_to_rad(a[0])) \
				* Basis(Vector3(0, 1, 0), deg_to_rad(a[1])) \
				* Basis(Vector3(0, 0, 1), deg_to_rad(a[2]))
			n.transform.basis = rest * rot
		else:
			n.transform.basis = rest
