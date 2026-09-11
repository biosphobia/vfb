class_name BrainActivity
extends Node
## Real-time "activity" model for the brain view. Each VFB neuropil is mapped to
## a functional system by its name; systems light up depending on what the fly is
## doing. This is an illustrative model, not a simulation of real neural data.

const SYSTEMS := {
	"vision": {"label": "Seeing", "words": ["medulla", "lobula", "optic", "lamina", "ocell"], "color": Color(0.35, 0.75, 1.0)},
	"smell": {"label": "Smelling", "words": ["antennal lobe", "lateral horn", "olfact"], "color": Color(0.55, 0.95, 0.45)},
	"touch": {"label": "Touch & hearing", "words": ["mechanosensory", "wedge", "vest", "saddle", "johnston", "flange", "cantle", "epaulette", "antler"], "color": Color(1.0, 0.85, 0.35)},
	"navigation": {"label": "Steering", "words": ["fan-shaped", "ellipsoid", "protocerebral bridge", "nodul", "bulb", "lateral accessory", "central complex", "gall", "round body"], "color": Color(1.0, 0.55, 0.3)},
	"memory": {"label": "Memory & learning", "words": ["mushroom body", "calyx", "pedunculus", "kenyon", "lobe of adult mushroom", "crepine"], "color": Color(0.95, 0.4, 0.95)},
	"motor": {"label": "Moving", "words": ["gnathal", "posterior slope", "inferior bridge", "prow", "gorget", "descending", "motor", "inferior clamp", "superior clamp", "rubus"], "color": Color(1.0, 0.35, 0.4)},
	"taste": {"label": "Tasting", "words": ["gnathal", "prow", "saddle", "gustatory", "proboscis"], "color": Color(1.0, 0.7, 0.2)},
	"higher": {"label": "Deciding", "words": ["superior medial", "superior lateral", "superior intermediate", "anterior ventrolateral", "posterior ventrolateral", "posterior lateral protocerebrum", "anterior optic tubercle", "protocerebrum"], "color": Color(0.7, 0.75, 1.0)},
}

var levels := {}          # system -> 0..1 (smoothed)
var targets := {}         # system -> 0..1
var brain: BrainAnchor
var _assignments := {}    # object id -> system
var _t := 0.0
var _noise_seed := 0.0
var _pulse := 0.0


func _ready() -> void:
	for s in SYSTEMS:
		levels[s] = 0.1
		targets[s] = 0.1
	_noise_seed = randf() * 100.0


func system_of(label: String) -> String:
	var l := label.to_lower()
	for s in SYSTEMS:
		for w in SYSTEMS[s]["words"]:
			if l.contains(w):
				return s
	return "higher"


func system_label(s: String) -> String:
	return SYSTEMS.get(s, {}).get("label", s)


func system_color(s: String) -> Color:
	return SYSTEMS.get(s, {}).get("color", Color.WHITE)


func top_systems(n: int = 3) -> Array:
	var arr := []
	for s in levels:
		arr.append([s, levels[s]])
	arr.sort_custom(func(a, b): return a[1] > b[1])
	return arr.slice(0, n)


## ctx keys: behaviour ("idle"/"walk"/"fly"), moving(bool), poked(bool), watching(bool),
## video_playing(bool), mood(String), reaction(String), selected_system(String), feeding(bool)
func set_context(ctx: Dictionary) -> void:
	var t := {}
	for s in SYSTEMS:
		t[s] = 0.08
	var beh := str(ctx.get("behaviour", "idle"))
	if beh == "walk" or ctx.get("moving", false):
		t["motor"] = 0.85
		t["navigation"] = 0.75
		t["vision"] = 0.5
		t["touch"] = 0.45
	elif beh == "fly":
		t["motor"] = 1.0
		t["vision"] = 0.9
		t["navigation"] = 0.85
		t["touch"] = 0.7   # halteres
	else:
		t["vision"] = 0.3
		t["smell"] = 0.25
		t["higher"] = 0.2
	if ctx.get("watching", false):
		t["vision"] = maxf(t["vision"], 0.95 if ctx.get("video_playing", false) else 0.6)
		t["higher"] = maxf(t["higher"], 0.6)
	var mood := str(ctx.get("mood", ""))
	if mood == "hungry" or ctx.get("feeding", false):
		t["taste"] = 0.95
		t["smell"] = 0.9
	if mood == "scared":
		t["motor"] = maxf(t["motor"], 0.7)
		t["higher"] = 0.7
	if mood == "groovy":
		t["touch"] = maxf(t["touch"], 0.8)
	if ctx.get("poked", false):
		t["touch"] = 1.0
		t["motor"] = 1.0
	var reaction := str(ctx.get("reaction", ""))
	if reaction == "antenna":
		t["smell"] = 1.0
		t["touch"] = 0.7
	elif reaction == "think":
		t["memory"] = 1.0
		t["higher"] = 0.9
	elif reaction == "feed":
		t["taste"] = 1.0
	var sel := str(ctx.get("selected_system", ""))
	if sel != "" and t.has(sel):
		t[sel] = maxf(t[sel], 0.9)
	targets = t


func _process(delta: float) -> void:
	_t += delta
	_pulse = 0.5 + 0.5 * sin(_t * 5.0)
	for s in SYSTEMS:
		var noise := 0.06 * sin(_t * (1.3 + 0.37 * float(SYSTEMS.keys().find(s))) + _noise_seed)
		var goal: float = clampf(float(targets.get(s, 0.1)) + noise, 0.0, 1.0)
		levels[s] = lerpf(float(levels[s]), goal, minf(1.0, delta * 2.5))
	if brain == null:
		return
	for id in brain.objects:
		var o: Dictionary = brain.objects[id]
		var s: String = _assignments.get(id, "")
		if s == "":
			s = system_of(str(o.get("label", "")))
			_assignments[id] = s
		var lv: float = levels[s]
		var mat: StandardMaterial3D = o["material"]
		if brain.selected_id == id:
			continue  # selection highlight owns the material
		var glow := lv * (0.55 + 0.45 * _pulse)
		mat.emission_enabled = glow > 0.12
		mat.emission = system_color(s)
		mat.emission_energy_multiplier = glow * (1.6 if o["kind"] == "neuron" else 0.9)
		if o["kind"] == "neuropil":
			mat.albedo_color.a = BrainAnchor.NEUROPIL_ALPHA + 0.35 * lv
