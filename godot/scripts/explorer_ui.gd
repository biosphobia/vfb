class_name ExplorerUI
extends CanvasLayer
## All 2D UI. Two layouts share the same content panels:
##  * desktop  – Explore panel left, Fly / Brain part / Watch tabs right, action bar bottom
##  * compact  – full-screen 3D, bottom tab bar opening a sheet, joystick + big buttons
## Wording is aimed at curious visitors, not developers.

signal search_requested(term: String)
signal result_activated(id: String)
signal load_requested(id: String)
signal load_bundled_requested
signal clear_requested
signal behaviour_selected(behaviour: int)
signal startle_requested
signal gait_changed(step_hz: float, stride_deg: float)
signal body_visible_toggled(on: bool)
signal xray_toggled(on: bool)
signal brain_visible_toggled(on: bool)
signal follow_toggled(on: bool)
signal focus_requested(what: String)
signal object_visibility_toggled(id: String, on: bool)
signal object_selected(id: String)
signal object_removed(id: String)
signal calibration_changed(offset_mm: Vector3, scale: float)
signal video_requested(text: String)
signal video_stop_requested
signal video_play_toggled(on: bool)
signal share_requested
signal ai_toggled(on: bool)
signal brain_view_tapped

const TABS := ["fly", "brain", "explore", "watch", "more"]
const TAB_TITLES := {"fly": "The fly", "brain": "Brain part", "explore": "Explore", "watch": "Watch", "more": "More"}
const TAB_ICONS := {"fly": "FLY", "brain": "BRAIN", "explore": "FIND", "watch": "WATCH", "more": "MORE"}

var compact := false
var touch := false
var joystick: VirtualJoystick
var joystick_value: Vector2:
	get:
		return joystick.value if joystick != null and joystick.visible else Vector2.ZERO

# widgets referenced from main
var search_box: LineEdit
var results: ItemList
var loaded: ItemList
var info_title: Label
var info_text: RichTextLabel
var thumb: TextureRect
var load_button: Button
var status: Label
var doing_label: Label
var feeling_label: Label
var focus_label: Label
var story_log: RichTextLabel
var ai_check: CheckBox
var meters := {}          # system -> ProgressBar
var meter_box: VBoxContainer
var brain_pip: PanelContainer
var brain_pip_tex: TextureRect
var video_box: LineEdit
var video_slot: Control
var video_thumb: TextureRect
var video_title: Label
var video_summary: Label
var video_notes: RichTextLabel
var video_play_btn: Button
var video_stop_btn: Button
var share_btn: Button
var open_yt_btn: Button
var welcome: PanelContainer

var _root: Control
var _top: PanelContainer
var _left: PanelContainer
var _right: PanelContainer
var _bottom: PanelContainer
var _sheet: PanelContainer
var _sheet_body: MarginContainer
var _tabbar: HBoxContainer
var _tab_buttons := {}
var _compact_actions: VBoxContainer
var _contents := {}       # name -> Control
var _right_tabs: HBoxContainer
var _right_body: MarginContainer
var _right_tab_buttons := {}
var _active_tab := "fly"
var _sheet_open := false
var _behaviour_buttons: Array[Button] = []
var _compact_behaviour_buttons := {}
var _result_ids: Array[String] = []
var _loaded_ids: Array[String] = []
var _current_term_id := ""
var _cal_x: SpinBox
var _cal_y: SpinBox
var _cal_z: SpinBox
var _cal_s: SpinBox
var _xray_check: CheckBox
var _follow_check: CheckBox
var _has_video := false
var _last_size := Vector2.ZERO
var _api_available := false


func _ready() -> void:
	layer = 10
	var theme := Theme.new()
	theme.default_font_size = 15
	_root = Control.new()
	_root.name = "Root"
	_root.theme = theme
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	_build_contents()
	_build_frames()
	_build_welcome()
	get_viewport().size_changed.connect(_relayout)
	_relayout()
	set_behaviour(0)


# ============================================================ content panels
var _holder: Control


func _build_contents() -> void:
	_holder = Control.new()
	_holder.name = "Holder"
	_holder.visible = false
	_root.add_child(_holder)
	_contents["explore"] = _build_explore()
	_contents["fly"] = _build_story()
	_contents["brain"] = _build_part()
	_contents["watch"] = _build_watch()
	_contents["more"] = _build_more()
	for c in _contents.values():
		_holder.add_child(c)


func _build_explore() -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_heading(v, "Find a brain part")
	_hint(v, "Type a name like “mushroom body”, “antennal lobe” or a neuron type.")
	var sh := HBoxContainer.new()
	v.add_child(sh)
	search_box = LineEdit.new()
	search_box.placeholder_text = "e.g. mushroom body"
	search_box.custom_minimum_size.y = 40
	search_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search_box.text_submitted.connect(func(t): search_requested.emit(t))
	sh.add_child(search_box)
	var sb := _button(sh, "Search", func(): search_requested.emit(search_box.text))
	sb.custom_minimum_size.y = 40
	results = ItemList.new()
	results.custom_minimum_size = Vector2(0, 140)
	results.size_flags_vertical = Control.SIZE_EXPAND_FILL
	results.item_activated.connect(func(i): result_activated.emit(_result_ids[i]))
	results.item_selected.connect(func(i): result_activated.emit(_result_ids[i]))
	v.add_child(results)
	var lh := HBoxContainer.new()
	v.add_child(lh)
	var ll := _heading(lh, "In the fly right now")
	ll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_button(lh, "Add all", func(): load_bundled_requested.emit()).tooltip_text = "Put every bundled brain region and example neuron back"
	_button(lh, "Clear", func(): clear_requested.emit())
	loaded = ItemList.new()
	loaded.size_flags_vertical = Control.SIZE_EXPAND_FILL
	loaded.custom_minimum_size = Vector2(0, 120)
	loaded.allow_reselect = true
	loaded.item_selected.connect(func(i): object_selected.emit(_loaded_ids[i]))
	loaded.item_clicked.connect(_on_loaded_clicked)
	v.add_child(loaded)
	var row := HBoxContainer.new()
	v.add_child(row)
	_button(row, "Hide / show", func():
		var sel := loaded.get_selected_items()
		if sel.size() > 0:
			var hidden := loaded.get_item_text(sel[0]).ends_with("(hidden)")
			object_visibility_toggled.emit(_loaded_ids[sel[0]], hidden))
	_button(row, "Remove", func():
		var sel := loaded.get_selected_items()
		if sel.size() > 0:
			object_removed.emit(_loaded_ids[sel[0]]))
	return v


func _build_story() -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_heading(v, "What the fly is doing")
	doing_label = _para(v, "Waking up…")
	_heading(v, "How it feels")
	feeling_label = _para(v, "")
	_heading(v, "Paying attention to")
	focus_label = _para(v, "")
	_heading(v, "Brain activity right now")
	_hint(v, "Which parts of the brain are busiest. Illustrative, based on what the fly is doing.")
	meter_box = VBoxContainer.new()
	meter_box.add_theme_constant_override("separation", 3)
	v.add_child(meter_box)
	var lh := HBoxContainer.new()
	v.add_child(lh)
	var l := _heading(lh, "Story so far")
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ai_check = CheckBox.new()
	ai_check.text = "Richer story (AI)"
	ai_check.button_pressed = true
	ai_check.visible = false
	ai_check.toggled.connect(func(on): ai_toggled.emit(on))
	lh.add_child(ai_check)
	story_log = RichTextLabel.new()
	story_log.bbcode_enabled = true
	story_log.scroll_following = true
	story_log.custom_minimum_size = Vector2(0, 110)
	story_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(story_log)
	return v


func _build_part() -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	info_title = Label.new()
	info_title.text = "Tap a glowing part of the brain"
	info_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info_title.add_theme_font_size_override("font_size", 18)
	v.add_child(info_title)
	thumb = TextureRect.new()
	thumb.custom_minimum_size = Vector2(0, 140)
	thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	thumb.visible = false
	v.add_child(thumb)
	load_button = _button(v, "Show it inside the fly", func(): load_requested.emit(_current_term_id))
	load_button.visible = false
	info_text = RichTextLabel.new()
	info_text.bbcode_enabled = true
	info_text.scroll_active = true
	info_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	info_text.custom_minimum_size = Vector2(0, 120)
	info_text.meta_clicked.connect(func(meta): WebBridge.open_url(str(meta)))
	info_text.text = ("Every glowing shape inside the head is a real brain region or neuron from " +
		"[url=https://virtualflybrain.org]Virtual Fly Brain[/url], mapped by scientists.\n\n" +
		"Tap one to read what it does. Use [b]Explore[/b] to find more.")
	v.add_child(info_text)
	return v


func _build_watch() -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_heading(v, "Show the fly a video")
	_hint(v, "Paste a YouTube link. The fly turns to watch and reacts to what it sees.")
	var row := HBoxContainer.new()
	v.add_child(row)
	video_box = LineEdit.new()
	video_box.placeholder_text = "https://youtube.com/watch?v=…"
	video_box.custom_minimum_size.y = 40
	video_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	video_box.text_submitted.connect(func(t): video_requested.emit(t))
	row.add_child(video_box)
	_button(row, "Show", func(): video_requested.emit(video_box.text)).custom_minimum_size.y = 40
	video_slot = Control.new()
	video_slot.custom_minimum_size = Vector2(0, 170)
	video_slot.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	video_slot.visible = false
	v.add_child(video_slot)
	video_thumb = TextureRect.new()
	video_thumb.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	video_thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	video_thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	video_thumb.visible = not WebBridge.is_web()
	video_slot.add_child(video_thumb)
	video_title = Label.new()
	video_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	video_title.add_theme_font_size_override("font_size", 16)
	v.add_child(video_title)
	var brow := HBoxContainer.new()
	v.add_child(brow)
	video_play_btn = _button(brow, "Play reaction", func():
		video_play_btn.button_pressed = not video_play_btn.button_pressed
		video_play_btn.text = "Pause reaction" if video_play_btn.button_pressed else "Play reaction"
		video_play_toggled.emit(video_play_btn.button_pressed))
	video_play_btn.visible = false
	open_yt_btn = _button(brow, "Open on YouTube", func(): WebBridge.open_url("https://www.youtube.com/watch?v=" + _video_id))
	open_yt_btn.visible = false
	share_btn = _button(brow, "Copy share link", func(): share_requested.emit())
	share_btn.visible = false
	video_stop_btn = _button(brow, "Stop", func(): video_stop_requested.emit())
	video_stop_btn.visible = false
	video_summary = _para(v, "")
	video_notes = RichTextLabel.new()
	video_notes.bbcode_enabled = true
	video_notes.scroll_following = true
	video_notes.custom_minimum_size = Vector2(0, 90)
	video_notes.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(video_notes)
	return v


var _video_id := ""


func _build_more() -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_heading(v, "View")
	var g := HFlowContainer.new()
	v.add_child(g)
	_check(g, "Show body", true, func(on): body_visible_toggled.emit(on))
	_xray_check = _check(g, "See-through body", false, func(on): xray_toggled.emit(on))
	_check(g, "Show brain", true, func(on): brain_visible_toggled.emit(on))
	_follow_check = _check(g, "Camera follows fly", true, func(on): follow_toggled.emit(on))
	var f := HBoxContainer.new()
	v.add_child(f)
	_button(f, "Look at brain", func(): focus_requested.emit("brain"))
	_button(f, "Look at fly", func(): focus_requested.emit("fly"))
	_button(f, "Show tips", func(): welcome.visible = true)
	_heading(v, "Walking")
	var r1 := HBoxContainer.new()
	v.add_child(r1)
	_label(r1, "Speed")
	var hz := HSlider.new()
	hz.min_value = 0.5
	hz.max_value = 8.0
	hz.step = 0.1
	hz.value = 2.5
	hz.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r1.add_child(hz)
	_label(r1, "Step size")
	var stride := HSlider.new()
	stride.min_value = 5
	stride.max_value = 40
	stride.value = 20
	stride.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r1.add_child(stride)
	hz.value_changed.connect(func(val): gait_changed.emit(val, stride.value))
	stride.value_changed.connect(func(val): gait_changed.emit(hz.value, val))
	_heading(v, "Advanced: brain position in the head")
	_hint(v, "The brain map is placed in the head by estimate. Nudge it here (millimetres) if it looks off.")
	var r2 := HFlowContainer.new()
	v.add_child(r2)
	_cal_x = _spin(r2, "x ", 0.0)
	_cal_y = _spin(r2, "y ", 0.0)
	_cal_z = _spin(r2, "z ", 0.0)
	_cal_s = _spin(r2, "size ", 1.0, 0.1, 5.0, 0.05)
	for s in [_cal_x, _cal_y, _cal_z, _cal_s]:
		s.value_changed.connect(func(_v): calibration_changed.emit(Vector3(_cal_x.value, _cal_y.value, _cal_z.value), _cal_s.value))
	_heading(v, "About")
	var about := RichTextLabel.new()
	about.bbcode_enabled = true
	about.fit_content = true
	about.meta_clicked.connect(func(meta): WebBridge.open_url(str(meta)))
	about.text = ("Body: [url=https://github.com/NeLy-EPFL/flygym]NeuroMechFly[/url] (EPFL). " +
		"Brain: [url=https://virtualflybrain.org]Virtual Fly Brain[/url]. " +
		"Behaviour and the brain-activity glow are illustrative, not measurements. " +
		"Code: [url=https://github.com/biosphobia/vfb]github.com/biosphobia/vfb[/url].")
	v.add_child(about)
	return v


# ============================================================ frames
func _build_frames() -> void:
	# top bar
	_top = _panel(_root, 0.7)
	var th := HBoxContainer.new()
	th.add_theme_constant_override("separation", 10)
	_top.add_child(th)
	var title := Label.new()
	title.text = "VFB Fly Explorer"
	title.add_theme_font_size_override("font_size", 17)
	th.add_child(title)
	status = Label.new()
	status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	status.add_theme_font_size_override("font_size", 13)
	status.modulate = Color(1, 1, 1, 0.8)
	status.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	th.add_child(status)

	# live brain picture-in-picture
	brain_pip = _panel(_root, 0.85)
	var pv := VBoxContainer.new()
	brain_pip.add_child(pv)
	var pl := Label.new()
	pl.text = "Live brain view"
	pl.add_theme_font_size_override("font_size", 12)
	pv.add_child(pl)
	brain_pip_tex = TextureRect.new()
	brain_pip_tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	brain_pip_tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	brain_pip_tex.custom_minimum_size = Vector2(240, 150)
	brain_pip_tex.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pv.add_child(brain_pip_tex)
	brain_pip.gui_input.connect(func(ev):
		if (ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT) or (ev is InputEventScreenTouch and ev.pressed):
			brain_view_tapped.emit())
	brain_pip.tooltip_text = "Tap to look at the brain up close"

	# desktop frames
	_left = _panel(_root)
	_right = _panel(_root)
	var rv := VBoxContainer.new()
	rv.add_theme_constant_override("separation", 6)
	_right.add_child(rv)
	_right_tabs = HBoxContainer.new()
	rv.add_child(_right_tabs)
	for t in ["fly", "brain", "watch"]:
		var b := Button.new()
		b.text = TAB_TITLES[t]
		b.toggle_mode = true
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(func(): _show_tab(t))
		_right_tabs.add_child(b)
		_right_tab_buttons[t] = b
	_right_body = MarginContainer.new()
	_right_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	rv.add_child(_right_body)

	_bottom = _panel(_root)
	var bh := HFlowContainer.new()
	bh.add_theme_constant_override("h_separation", 8)
	_bottom.add_child(bh)
	for i in range(3):
		var b := Button.new()
		b.text = ["Rest", "Walk", "Fly"][i]
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(70, 38)
		b.pressed.connect(func(): behaviour_selected.emit(i))
		bh.add_child(b)
		_behaviour_buttons.append(b)
	_button(bh, "Poke", func(): startle_requested.emit()).custom_minimum_size = Vector2(70, 38)
	bh.add_child(VSeparator.new())
	_button(bh, "Look at brain", func(): focus_requested.emit("brain"))
	_button(bh, "Look at fly", func(): focus_requested.emit("fly"))
	_button(bh, "See-through", func(): _xray_check.button_pressed = not _xray_check.button_pressed)
	_button(bh, "Explore...", func(): _show_tab("explore"))
	_button(bh, "More...", func(): _show_tab("more"))
	var hint := Label.new()
	hint.text = "W A S D walk · Space fly · drag to orbit · wheel to zoom · click a brain part"
	hint.add_theme_font_size_override("font_size", 12)
	hint.modulate = Color(1, 1, 1, 0.65)
	bh.add_child(hint)

	# compact frames
	_sheet = _panel(_root, 0.94)
	var sv := VBoxContainer.new()
	sv.add_theme_constant_override("separation", 4)
	_sheet.add_child(sv)
	var handle := Button.new()
	handle.text = "Close"
	handle.flat = true
	handle.pressed.connect(func(): _set_sheet(false))
	sv.add_child(handle)
	_sheet_body = MarginContainer.new()
	_sheet_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sv.add_child(_sheet_body)

	_tabbar = HBoxContainer.new()
	_tabbar.add_theme_constant_override("separation", 4)
	_root.add_child(_tabbar)
	for t in TABS:
		var b := Button.new()
		b.text = TAB_TITLES[t]
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(0, 54)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.add_theme_font_size_override("font_size", 14)
		b.pressed.connect(func(): _tab_pressed(t))
		_tabbar.add_child(b)
		_tab_buttons[t] = b

	joystick = VirtualJoystick.new()
	_root.add_child(joystick)

	_compact_actions = VBoxContainer.new()
	_compact_actions.add_theme_constant_override("separation", 8)
	_root.add_child(_compact_actions)
	for t in [["Fly", 2], ["Walk", 1], ["Rest", 0]]:
		var b := Button.new()
		b.text = t[0]
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(76, 46)
		var idx: int = t[1]
		b.pressed.connect(func(): behaviour_selected.emit(idx))
		_compact_actions.add_child(b)
		_compact_behaviour_buttons[idx] = b
	var poke := Button.new()
	poke.text = "Poke"
	poke.custom_minimum_size = Vector2(76, 46)
	poke.pressed.connect(func(): startle_requested.emit())
	_compact_actions.add_child(poke)


var welcome_blocker: ColorRect


func _build_welcome() -> void:
	welcome_blocker = ColorRect.new()
	welcome_blocker.color = Color(0, 0, 0, 0.55)
	welcome_blocker.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	welcome_blocker.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(welcome_blocker)
	welcome = _panel(_root, 0.96)
	welcome.visibility_changed.connect(func(): welcome_blocker.visible = welcome.visible)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	welcome.add_child(v)
	var t := Label.new()
	t.text = "Meet the fly"
	t.add_theme_font_size_override("font_size", 24)
	v.add_child(t)
	var body := RichTextLabel.new()
	body.bbcode_enabled = true
	body.fit_content = true
	body.custom_minimum_size = Vector2(0, 10)
	body.text = ("This is a fruit fly with its [b]real brain map[/b] inside its head, built from " +
		"scientists' data at Virtual Fly Brain.\n\n" +
		"- [b]Tap a glowing part[/b] of the brain to learn what it does.\n" +
		"- [b]Walk it around[/b] with the joystick or W A S D, make it fly, poke it.\n" +
		"- [b]Show it a YouTube video[/b] and watch how it reacts.\n" +
		"- Read the live story of what it is doing and feeling.")
	v.add_child(body)
	var b := Button.new()
	b.text = "Start exploring"
	b.custom_minimum_size = Vector2(0, 46)
	b.pressed.connect(func(): welcome.visible = false)
	v.add_child(b)


# ============================================================ layout
func _relayout() -> void:
	var vs := _root.size
	if vs == Vector2.ZERO:
		vs = get_viewport().get_visible_rect().size
	compact = vs.x < 980 or vs.y < 540 or (touch and vs.x < 1280)
	_root.theme.default_font_size = 16 if compact else 15
	var top_h := 44.0
	_top.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	_top.offset_left = 8
	_top.offset_right = -8
	_top.offset_top = 8
	_top.offset_bottom = 8 + top_h

	welcome.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	var ww := minf(460.0, vs.x - 32.0)
	welcome.offset_left = -ww * 0.5
	welcome.offset_right = ww * 0.5
	welcome.offset_top = -170
	welcome.offset_bottom = 170

	_left.visible = not compact
	_right.visible = not compact
	_bottom.visible = not compact
	_sheet.visible = compact and _sheet_open
	_tabbar.visible = compact
	joystick.visible = compact and touch and not _sheet_open
	_compact_actions.visible = compact and not _sheet_open

	for c in _contents.values():
		if c.get_parent() != _holder:
			c.get_parent().remove_child(c)
			_holder.add_child(c)
	if compact:
		var tab_h := 64.0
		_tabbar.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
		_tabbar.offset_left = 6
		_tabbar.offset_right = -6
		_tabbar.offset_top = -tab_h - 6
		_tabbar.offset_bottom = -6
		var sheet_h := minf(vs.y * 0.58, 520.0)
		_sheet.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
		_sheet.offset_left = 6
		_sheet.offset_right = -6
		_sheet.offset_top = -tab_h - 10 - sheet_h
		_sheet.offset_bottom = -tab_h - 10
		joystick.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
		joystick.offset_left = 12
		joystick.offset_top = -tab_h - 20 - joystick.custom_minimum_size.y
		joystick.offset_right = 12 + joystick.custom_minimum_size.x
		joystick.offset_bottom = -tab_h - 20
		_compact_actions.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
		_compact_actions.offset_right = -12
		_compact_actions.offset_bottom = -tab_h - 20
		_compact_actions.offset_left = -12 - 76
		_compact_actions.offset_top = -tab_h - 20 - 4 * 54
		brain_pip_tex.custom_minimum_size = Vector2(150, 96)
		brain_pip.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
		brain_pip.offset_right = -8
		brain_pip.offset_top = 8 + top_h + 8
		brain_pip.offset_left = -8 - 168
		brain_pip.offset_bottom = 8 + top_h + 8 + 130
		_mount(_contents[_active_tab], _sheet_body)
	else:
		var lw := 300.0
		var rw := 340.0
		_left.set_anchors_and_offsets_preset(Control.PRESET_LEFT_WIDE)
		_left.offset_left = 8
		_left.offset_top = 8 + top_h + 8
		_left.offset_right = 8 + lw
		_left.offset_bottom = -70
		_right.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
		_right.offset_left = -8 - rw
		_right.offset_right = -8
		_right.offset_top = 8 + top_h + 8
		_right.offset_bottom = -70
		_bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
		_bottom.offset_left = 8
		_bottom.offset_right = -8
		_bottom.offset_top = -62
		_bottom.offset_bottom = -8
		brain_pip_tex.custom_minimum_size = Vector2(240, 150)
		brain_pip.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
		brain_pip.offset_right = -8 - rw - 10
		brain_pip.offset_left = -8 - rw - 10 - 262
		brain_pip.offset_top = 8 + top_h + 8
		brain_pip.offset_bottom = 8 + top_h + 8 + 186
		_mount(_contents["explore"], _left)
		var right_tab := _active_tab if _active_tab in ["fly", "brain", "watch"] else "fly"
		_mount(_contents[right_tab], _right_body)
		for t in _right_tab_buttons:
			_right_tab_buttons[t].set_pressed_no_signal(t == right_tab)
		# explore / more live in popups on desktop
		if _active_tab in ["explore", "more"]:
			_mount_popup(_contents[_active_tab])
	for t in _tab_buttons:
		_tab_buttons[t].set_pressed_no_signal(compact and _sheet_open and t == _active_tab)


var _popup: PanelContainer


func _mount_popup(content: Control) -> void:
	if _popup == null:
		_popup = _panel(_root, 0.96)
		var v := VBoxContainer.new()
		_popup.add_child(v)
		var close := Button.new()
		close.text = "Close"
		close.flat = true
		close.pressed.connect(func():
			_popup.visible = false
			_active_tab = "fly"
			_relayout())
		v.add_child(close)
		var body := MarginContainer.new()
		body.name = "Body"
		body.size_flags_vertical = Control.SIZE_EXPAND_FILL
		v.add_child(body)
	_popup.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_popup.offset_left = -220
	_popup.offset_right = 220
	_popup.offset_top = -260
	_popup.offset_bottom = 260
	_popup.visible = true
	_mount(content, _popup.get_node("Body") if _popup.has_node("Body") else _popup.get_child(0).get_child(1))


func _mount(content: Control, parent: Control) -> void:
	if content.get_parent() == parent:
		content.visible = true
		return
	if content.get_parent() != null:
		content.get_parent().remove_child(content)
	parent.add_child(content)
	content.visible = true
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _show_tab(name: String) -> void:
	_active_tab = name
	if compact:
		_sheet_open = true
	elif name == "explore":
		_mount(_contents["explore"], _left)  # already there; flash it
	if _popup != null and name in ["fly", "brain", "watch"]:
		_popup.visible = false
	_relayout()


func _tab_pressed(name: String) -> void:
	if _sheet_open and _active_tab == name:
		_set_sheet(false)
		return
	_active_tab = name
	_set_sheet(true)


func _set_sheet(open: bool) -> void:
	_sheet_open = open
	_relayout()


func is_sheet_open() -> bool:
	return compact and _sheet_open


## Rect of the video area in logical pixels, plus whether the Watch panel is on screen.
func video_slot_rect() -> Dictionary:
	var visible_now := video_slot.is_visible_in_tree() and _has_video
	return {"rect": video_slot.get_global_rect(), "visible": visible_now}


func mini_video_rect() -> Rect2:
	var top := 8.0 + 44.0 + 8.0
	return Rect2(Vector2(8, top), Vector2(176, 99))


# ============================================================ helpers
func _panel(parent: Control, alpha: float = 0.86) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.09, 0.1, 0.13, alpha)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	p.add_theme_stylebox_override("panel", sb)
	parent.add_child(p)
	return p


func _heading(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 13)
	l.modulate = Color(0.6, 0.8, 1.0)
	l.uppercase = true
	parent.add_child(l)
	return l


func _hint(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 12)
	l.modulate = Color(1, 1, 1, 0.65)
	parent.add_child(l)
	return l


func _para(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(l)
	return l


func _label(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 13)
	parent.add_child(l)
	return l


func _button(parent: Control, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size.y = 34
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


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
	s.custom_minimum_size = Vector2(100, 34)
	parent.add_child(s)
	return s


# ============================================================ API used by main
func set_status(text: String) -> void:
	status.text = text


func set_touch(on: bool) -> void:
	touch = on
	_relayout()


func set_api_available(on: bool) -> void:
	_api_available = on
	ai_check.visible = on


func set_brain_texture(tex: Texture2D) -> void:
	brain_pip_tex.texture = tex


func set_xray(on: bool) -> void:
	_xray_check.set_pressed_no_signal(on)


func set_follow(on: bool) -> void:
	_follow_check.set_pressed_no_signal(on)


func set_behaviour(b: int) -> void:
	for i in range(_behaviour_buttons.size()):
		_behaviour_buttons[i].set_pressed_no_signal(i == b)
	for i in _compact_behaviour_buttons:
		_compact_behaviour_buttons[i].set_pressed_no_signal(i == b)


func set_story(doing: String, feeling: String, focus: String) -> void:
	doing_label.text = doing
	feeling_label.text = feeling
	focus_label.text = focus


func add_story_line(text: String, from_ai: bool) -> void:
	story_log.append_text(("[color=#ffd27a]AI[/color] " if from_ai else "[color=#7ab8ff]-[/color] ") + text + "\n")


func set_meters(levels: Dictionary, labels: Dictionary, colors: Dictionary) -> void:
	if meters.is_empty():
		for s in levels:
			var row := HBoxContainer.new()
			var l := Label.new()
			l.text = labels.get(s, s)
			l.custom_minimum_size.x = 130
			l.add_theme_font_size_override("font_size", 13)
			row.add_child(l)
			var pb := ProgressBar.new()
			pb.min_value = 0
			pb.max_value = 1
			pb.show_percentage = false
			pb.custom_minimum_size = Vector2(0, 12)
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			var fill := StyleBoxFlat.new()
			fill.bg_color = colors.get(s, Color.WHITE)
			fill.set_corner_radius_all(4)
			pb.add_theme_stylebox_override("fill", fill)
			var bg := StyleBoxFlat.new()
			bg.bg_color = Color(1, 1, 1, 0.08)
			bg.set_corner_radius_all(4)
			pb.add_theme_stylebox_override("background", bg)
			row.add_child(pb)
			meter_box.add_child(row)
			meters[s] = pb
	for s in levels:
		if meters.has(s):
			meters[s].value = levels[s]


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
				tag = "  (3D)"
			elif facets.has("Class"):
				tag = "  (group)"
		results.add_item("%s%s" % [label, tag])
		results.set_item_tooltip(results.item_count - 1, id)
		_result_ids.append(id)


func set_term_info(summary: Dictionary, loadable: bool, extra_bbcode: String = "") -> void:
	_current_term_id = str(summary.get("id", ""))
	info_title.text = str(summary.get("label", ""))
	var t := ""
	var types: Array = summary.get("types", [])
	var shown: Array = []
	for ty in types:
		if not ["Entity", "Class", "Individual", "Thing", "Anatomy", "Nervous_system", "Cell"].has(str(ty)):
			shown.append(str(ty).replace("_", " ").to_lower())
	if not shown.is_empty():
		t += "[color=#9ad]%s[/color]\n" % ", ".join(shown)
	if not str(summary.get("description", "")).is_empty():
		t += "\n%s\n" % summary["description"]
	if not str(summary.get("comment", "")).is_empty():
		t += "\n[i]%s[/i]\n" % summary["comment"]
	var parents: Array = summary.get("parents", [])
	if not parents.is_empty():
		t += "\n[b]It is a kind of:[/b] %s\n" % ", ".join(parents)
	var ds: Array = summary.get("datasets", [])
	if not ds.is_empty():
		t += "\n[b]Data from:[/b] %s (%s)\n" % [", ".join(ds), ", ".join(summary.get("licenses", []))]
	t += extra_bbcode
	t += "\n[url=https://virtualflybrain.org/term/%s]Read more on Virtual Fly Brain[/url]" % _current_term_id
	info_text.text = t
	load_button.visible = loadable
	thumb.visible = false
	if compact:
		_active_tab = "brain"
		_set_sheet(true)
	else:
		_show_tab("brain")


func set_thumbnail(tex: Texture2D) -> void:
	thumb.texture = tex
	thumb.visible = tex != null


func add_loaded(id: String, label: String, kind: String, color: Color) -> void:
	if _loaded_ids.has(id):
		return
	loaded.add_item("%s  ·  %s" % [label, "region" if kind == "neuropil" else "neuron"])
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


func _on_loaded_clicked(i: int, _pos: Vector2, button: int) -> void:
	if button == MOUSE_BUTTON_RIGHT:
		var hidden := loaded.get_item_text(i).ends_with("(hidden)")
		object_visibility_toggled.emit(_loaded_ids[i], hidden)


func set_video(info: Dictionary, tex: Texture2D) -> void:
	_has_video = info.has("id")
	_video_id = str(info.get("id", ""))
	video_slot.visible = _has_video
	video_thumb.texture = tex
	video_title.text = str(info.get("title", "")) + ((" · " + str(info.get("author", ""))) if str(info.get("author", "")) != "" else "")
	video_play_btn.visible = _has_video and not WebBridge.is_web()
	open_yt_btn.visible = _has_video
	share_btn.visible = _has_video
	video_stop_btn.visible = _has_video
	if not _has_video:
		video_summary.text = ""
		video_notes.text = ""
		video_play_btn.button_pressed = false
		video_play_btn.text = "Play reaction"


func set_video_plan(plan: Dictionary) -> void:
	var mood := str(plan.get("mood", "curious"))
	var tag := "  (AI)" if bool(plan.get("ai", false)) else ""
	video_summary.text = "Mood: %s%s\n%s" % [mood.capitalize(), tag, str(plan.get("summary", ""))]
	video_notes.text = ""


func add_video_note(text: String) -> void:
	video_notes.append_text("- " + text + "\n")


func show_watch_tab() -> void:
	_active_tab = "watch"
	if compact:
		_set_sheet(true)
	else:
		_relayout()


func is_typing() -> bool:
	var f := get_viewport().gui_get_focus_owner()
	return f is LineEdit or f is SpinBox or (f != null and f.get_parent() is SpinBox)
