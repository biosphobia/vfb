class_name VirtualJoystick
extends Control
## Simple on-screen joystick for touch devices. `value` is in -1..1 on both axes
## (x = turn, y = forward).

var value := Vector2.ZERO
var radius := 60.0
var _touch_index := -1
var _center := Vector2.ZERO


func _ready() -> void:
	custom_minimum_size = Vector2(radius * 2.4, radius * 2.4)
	mouse_filter = Control.MOUSE_FILTER_STOP


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed and _touch_index < 0:
			_touch_index = t.index
			_center = size * 0.5
			_update(t.position)
			accept_event()
		elif not t.pressed and t.index == _touch_index:
			_release()
			accept_event()
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		if d.index == _touch_index:
			_update(d.position)
			accept_event()
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed and _touch_index < 0:
				_touch_index = 999
				_center = size * 0.5
				_update(mb.position)
			elif not mb.pressed and _touch_index == 999:
				_release()
			accept_event()
	elif event is InputEventMouseMotion and _touch_index == 999:
		_update((event as InputEventMouseMotion).position)
		accept_event()


func _update(p: Vector2) -> void:
	var v := (p - _center) / radius
	if v.length() > 1.0:
		v = v.normalized()
	value = Vector2(v.x, -v.y)
	queue_redraw()


func _release() -> void:
	_touch_index = -1
	value = Vector2.ZERO
	queue_redraw()


func _draw() -> void:
	var c := size * 0.5
	draw_circle(c, radius * 1.15, Color(1, 1, 1, 0.08))
	draw_arc(c, radius * 1.15, 0, TAU, 48, Color(1, 1, 1, 0.35), 2.0, true)
	var knob := c + Vector2(value.x, -value.y) * radius
	draw_circle(knob, radius * 0.42, Color(1, 1, 1, 0.55))
	draw_circle(knob, radius * 0.42, Color(0.3, 0.7, 1.0, 0.9), false, 2.0, true)
