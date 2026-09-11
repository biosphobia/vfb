class_name ExplorerUI
extends CanvasLayer
## All 2D UI, built in code: search / results, loaded-object list, term info,
## behaviour controls, display toggles and brain calibration.

signal search_requested(term: String)
signal result_activated(id: String)
signal load_requested(id: String)
signal load_bundled_requested
signal clear_requested
signal behaviour_selected(behaviour: int)
signal body_visible_toggled(on: bool)
signal xray_toggled(on: bool)
signal brain_visible_toggled(on: bool)
signal follow_toggled(on: bool)
signal focus_requested(what: String)
signal object_visibility_toggled(id: String, on: bool)
signal object_selected(id: String)
signal object_removed(id: String)
signal calibration_changed(offset_mm: Vector3, scale: float)
signal gait_changed(step_hz: float, stride_deg: float)
signal startle_requested

var search_box: LineEdit
var results: ItemList
var loaded: ItemList
var info_title: Label
var info_text: RichTextLabel
var thumb: TextureRect
var load_button: Button
var status: Label
var behaviour_buttons: Array[Button] = []
var _result_ids: Array[String] = []
var _loaded_ids: Array[String] = []
var _current_term_id := ""
var _cal_x: SpinBox
var _cal_y: SpinBox
var _cal_z: SpinBox
var _cal_s: SpinBox
var xray_check: CheckBox


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.name = "Root"
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# ---------------- left panel: search + loaded ----------------
	var left := _panel(root)
	left.set_anchors_and_offsets_preset(Control.PRESET_LEFT_WIDE)
	left.offset_left = 10
	left.offset_top = 10
	left.offset_right = 300
	left.offset_bottom = -110
	var lv := VBoxContainer.new()
	lv.add_theme_constant_override("separation", 6)
	left.add_child(lv)
	var title := Label.new()
	title.text = "VFB Fly Explorer"
	title.add_theme_font_size_override("font_size", 18)
	lv.add_child(title)
	var sub := Label.new()
	sub.text = "Search Virtual Fly Brain (label or VFB_/FBbt_ id)"
	sub.add_theme_font_size_override("font_size", 11)
	sub.modulate = Color(1, 1, 1, 0.7)
	lv.add_child(sub)
	var sh := HBoxContainer.new()
	lv.add_child(sh)
	search_box = LineEdit.new()
	search_box.placeholder_text = "e.g. mushroom body, DA1 lPN, VFB_00101567"
	search_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search_box.text_submitted.connect(func(t): search_requested.emit(t))
	sh.add_child(search_box)
	var sb := Button.new()
	sb.text = "Search"
	sb.pressed.connect(func(): search_requested.emit(search_box.text))
	sh.add_child(sb)
	var rl := Label.new()
	rl.text = "Results (double-click to open)"
	rl.add_theme_font_size_override("font_size", 11)
	lv.add_child(rl)
	results = ItemList.new()
	results.custom_minimum_size = Vector2(0, 150)
	results.size_flags_vertical = Control.SIZE_EXPAND_FILL
	results.item_activated.connect(func(i): result_activated.emit(_result_ids[i]))
	results.item_selected.connect(func(i): result_activated.emit(_result_ids[i]))
	lv.add_child(results)

	var ll := HBoxContainer.new()
	lv.add_child(ll)
	var lll := Label.new()
	lll.text = "Loaded in 3D (click: select, X: remove)"
	lll.add_theme_font_size_override("font_size", 11)
	lll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ll.add_child(lll)
	var bundled := Button.new()
	bundled.text = "Load starter set"
	bundled.tooltip_text = "Load the neuropils and example neurons bundled with the app"
	bundled.pressed.connect(func(): load_bundled_requested.emit())
	ll.add_child(bundled)
	var clr := Button.new()
	clr.text = "Clear"
	clr.pressed.connect(func(): clear_requested.emit())
	ll.add_child(clr)
	loaded = ItemList.new()
	loaded.size_flags_vertical = Control.SIZE_EXPAND_FILL
	loaded.custom_minimum_size = Vector2(0, 120)
	loaded.item_selected.connect(_on_loaded_selected)
	loaded.item_clicked.connect(_on_loaded_clicked)
	loaded.allow_reselect = true
	lv.add_child(loaded)
	var lhint := Label.new()
	lhint.text = "Right-click an item to toggle visibility"
	lhint.add_theme_font_size_override("font_size", 10)
	lhint.modulate = Color(1, 1, 1, 0.6)
	lv.add_child(lhint)

	# ---------------- right panel: term info ----------------
	var right := _panel(root)
	right.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
	right.offset_left = -300
	right.offset_top = 10
	right.offset_right = -10
	right.offset_bottom = -110
	var rv := VBoxContainer.new()
	rv.add_theme_constant_override("separation", 6)
	right.add_child(rv)
	info_title = Label.new()
	info_title.text = "Term info"
	info_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info_title.add_theme_font_size_override("font_size", 16)
	rv.add_child(info_title)
	thumb = TextureRect.new()
	thumb.custom_minimum_size = Vector2(0, 150)
	thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	thumb.visible = false
	rv.add_child(thumb)
	load_button = Button.new()
	load_button.text = "Load 3D into fly"
	load_button.visible = false
	load_button.pressed.connect(func(): load_requested.emit(_current_term_id))
	rv.add_child(load_button)
	info_text = RichTextLabel.new()
	info_text.bbcode_enabled = true
	info_text.fit_content = false
	info_text.scroll_active = true
	info_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	info_text.text = "Search for anatomy on the left, or press [b]Load starter set[/b].\n\n" + _help_text()
	rv.add_child(info_text)

	# ---------------- bottom bar: behaviour + display ----------------
	var bottom := _panel(root)
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 10
	bottom.offset_right = -10
	bottom.offset_top = -100
	bottom.offset_bottom = -10
	var bv := VBoxContainer.new()
	bottom.add_child(bv)
	var row1 := HBoxContainer.new()
	row1.add_theme_constant_override("separation", 8)
	bv.add_child(row1)
	_label(row1, "Behaviour:")
	for i in range(3):
		var b := Button.new()
		b.text = ["Idle", "Walk", "Fly"][i]
		b.toggle_mode = true
		b.pressed.connect(func(): behaviour_selected.emit(i))
		row1.add_child(b)
		behaviour_buttons.append(b)
	var startle := Button.new()
	startle.text = "Startle!"
	startle.pressed.connect(func(): startle_requested.emit())
	row1.add_child(startle)
	row1.add_child(VSeparator.new())
	_label(row1, "Step Hz")
	var hz := HSlider.new()
	hz.min_value = 0.5
	hz.max_value = 8.0
	hz.step = 0.1
	hz.value = 2.5
	hz.custom_minimum_size = Vector2(110, 0)
	row1.add_child(hz)
	_label(row1, "Stride °")
	var stride := HSlider.new()
	stride.min_value = 5
	stride.max_value = 40
	stride.value = 20
	stride.custom_minimum_size = Vector2(110, 0)
	row1.add_child(stride)
	hz.value_changed.connect(func(v): gait_changed.emit(v, stride.value))
	stride.value_changed.connect(func(v): gait_changed.emit(hz.value, v))
	row1.add_child(VSeparator.new())
	_check(row1, "Body", true, func(on): body_visible_toggled.emit(on))
	xray_check = _check(row1, "X-ray body", false, func(on): xray_toggled.emit(on))
	_check(row1, "Brain", true, func(on): brain_visible_toggled.emit(on))
	_check(row1, "Follow fly", true, func(on): follow_toggled.emit(on))
	var ff := Button.new()
	ff.text = "Focus fly"
	ff.pressed.connect(func(): focus_requested.emit("fly"))
	row1.add_child(ff)
	var fb := Button.new()
	fb.text = "Focus brain"
	fb.pressed.connect(func(): focus_requested.emit("brain"))
	row1.add_child(fb)

	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 8)
	bv.add_child(row2)
	_label(row2, "Brain placement (mm, head frame):")
	_cal_x = _spin(row2, "x", 0.0)
	_cal_y = _spin(row2, "y", 0.0)
	_cal_z = _spin(row2, "z", 0.0)
	_label(row2, "scale")
	_cal_s = _spin(row2, "", 1.0, 0.1, 5.0, 0.05)
	for s in [_cal_x, _cal_y, _cal_z, _cal_s]:
		s.value_changed.connect(func(_v): calibration_changed.emit(
			Vector3(_cal_x.value, _cal_y.value, _cal_z.value), _cal_s.value))
	row2.add_child(VSeparator.new())
	_label(row2, "WASD / arrows: walk & turn   Space: fly   F: focus   Click: select   Right-drag: orbit   Wheel: zoom")

	status = Label.new()
	status.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	status.offset_top = 10
	status.add_theme_font_size_override("font_size", 12)
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status.text = ""
	root.add_child(status)
	set_behaviour(0)


func _help_text() -> String:
	return ("[b]How it works[/b]\n" +
		"• The body is NeuroMechFly (Apache-2.0), an articulated micro-CT model of an adult fly.\n" +
		"• Brain anatomy comes from Virtual Fly Brain in JRC2018Unisex template space and is placed inside the head.\n" +
		"• Click a neuron or neuropil in 3D to read its VFB term info. Neurons named after legs, wings or antennae make the fly react.\n" +
		"• Downloads at runtime go straight to virtualflybrain.org; the starter set is bundled at build time.")


func _panel(parent: Control) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.09, 0.1, 0.13, 0.86)
	sb.corner_radius_top_left = 8
	sb.corner_radius_top_right = 8
	sb.corner_radius_bottom_left = 8
	sb.corner_radius_bottom_right = 8
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	p.add_theme_stylebox_override("panel", sb)
	parent.add_child(p)
	return p


func _label(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	parent.add_child(l)
	return l


func _check(parent: Control, text: String, on: bool, cb: Callable) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = on
	c.toggled.connect(cb)
	parent.add_child(c)
	return c


func _spin(parent: Control, prefix: String, value: float, mn: float = -2.0, mx: float = 2.0, step: float = 0.01) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = mn
	s.max_value = mx
	s.step = step
	s.value = value
	s.prefix = prefix
	s.custom_minimum_size = Vector2(90, 0)
	parent.add_child(s)
	return s


# ---------------- API used by main.gd ----------------
func set_status(text: String) -> void:
	status.text = text


func set_xray(on: bool) -> void:
	xray_check.set_pressed_no_signal(on)


func set_behaviour(b: int) -> void:
	for i in range(behaviour_buttons.size()):
		behaviour_buttons[i].set_pressed_no_signal(i == b)


func set_results(items: Array) -> void:
	results.clear()
	_result_ids.clear()
	for it in items:
		var id := str(it.get("id", ""))
		var label := str(it.get("label", id))
		var facets = it.get("facets", [])
		var tag := ""
		if facets is Array:
			if facets.has("Individual"):
				tag = " [image]"
			elif facets.has("Class"):
				tag = " [class]"
		results.add_item("%s%s" % [label, tag])
		results.set_item_tooltip(results.item_count - 1, id)
		_result_ids.append(id)


func set_term_info(summary: Dictionary, loadable: bool, extra_bbcode: String = "") -> void:
	_current_term_id = str(summary.get("id", ""))
	info_title.text = "%s  (%s)" % [summary.get("label", ""), _current_term_id]
	var t := ""
	var types: Array = summary.get("types", [])
	var shown: Array = []
	for ty in types:
		if not ["Entity", "Class", "Individual", "Thing", "Anatomy"].has(str(ty)):
			shown.append(str(ty))
	if not shown.is_empty():
		t += "[color=#9ad]%s[/color]\n" % ", ".join(shown)
	if not str(summary.get("description", "")).is_empty():
		t += "\n%s\n" % summary["description"]
	if not str(summary.get("comment", "")).is_empty():
		t += "\n[i]%s[/i]\n" % summary["comment"]
	var parents: Array = summary.get("parents", [])
	if not parents.is_empty():
		t += "\n[b]Is a:[/b] %s\n" % ", ".join(parents)
	var ds: Array = summary.get("datasets", [])
	if not ds.is_empty():
		t += "\n[b]Dataset:[/b] %s\n[b]Licence:[/b] %s\n" % [", ".join(ds), ", ".join(summary.get("licenses", []))]
	t += extra_bbcode
	t += "\n[url=https://virtualflybrain.org/term/%s]Open on virtualflybrain.org[/url]" % _current_term_id
	info_text.text = t
	load_button.visible = loadable
	thumb.visible = false


func set_thumbnail(tex: Texture2D) -> void:
	thumb.texture = tex
	thumb.visible = tex != null


func add_loaded(id: String, label: String, kind: String, color: Color) -> void:
	if _loaded_ids.has(id):
		return
	loaded.add_item("%s  ·  %s" % [label, kind])
	var i := loaded.item_count - 1
	loaded.set_item_custom_fg_color(i, color.lightened(0.25))
	loaded.set_item_tooltip(i, id)
	_loaded_ids.append(id)


func remove_loaded(id: String) -> void:
	var i := _loaded_ids.find(id)
	if i >= 0:
		loaded.remove_item(i)
		_loaded_ids.remove_at(i)


func highlight_loaded(id: String) -> void:
	var i := _loaded_ids.find(id)
	if i >= 0:
		loaded.select(i)
	else:
		loaded.deselect_all()


func set_loaded_visible(id: String, on: bool) -> void:
	var i := _loaded_ids.find(id)
	if i >= 0:
		var base := loaded.get_item_text(i).trim_suffix("  (hidden)")
		loaded.set_item_text(i, base if on else base + "  (hidden)")


func clear_loaded() -> void:
	loaded.clear()
	_loaded_ids.clear()


func _on_loaded_selected(i: int) -> void:
	object_selected.emit(_loaded_ids[i])


func _on_loaded_clicked(i: int, _pos: Vector2, button: int) -> void:
	if button == MOUSE_BUTTON_RIGHT:
		var hidden := loaded.get_item_text(i).ends_with("(hidden)")
		object_visibility_toggled.emit(_loaded_ids[i], hidden)


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var k := event as InputEventKey
		if (k.keycode == KEY_DELETE or k.keycode == KEY_X) and loaded.has_focus():
			var sel := loaded.get_selected_items()
			if sel.size() > 0:
				object_removed.emit(_loaded_ids[sel[0]])


func is_typing() -> bool:
	var f := get_viewport().gui_get_focus_owner()
	return f is LineEdit or f is SpinBox or (f != null and f.get_parent() is SpinBox)
