class_name Narrator
extends Node
## Live, plain-language description of what the fly is doing, feeling and
## reacting to. Programmatic by default; when an API base is configured and the
## service has a Claude key, richer lines replace the generated ones.

signal updated(doing: String, feeling: String, focus: String)
signal line_added(text: String, from_ai: bool)

var api_base := ""
var ai_available := false
var ai_enabled := true
var lines: Array[Dictionary] = []   # {text, ai, time}
var doing := ""
var feeling := ""
var focus := ""
var _ctx := {}
var _last_key := ""
var _since_line := 0.0
var _since_ai := 0.0
var _ai_busy := false
var _http: VfbClient
var _rng := RandomNumberGenerator.new()
var _mood_words := {
	"curious": ["curious", "interested", "attentive"],
	"excited": ["excited", "buzzing with energy", "keyed up"],
	"hungry": ["hungry", "tempted", "eager to taste"],
	"scared": ["alarmed", "on edge", "ready to bolt"],
	"groovy": ["playful", "in the groove", "upbeat"],
	"sleepy": ["calm", "drowsy", "relaxed"],
}


func setup(http: VfbClient, base: String) -> void:
	_http = http
	api_base = base.trim_suffix("/")
	_rng.randomize()
	if api_base != "":
		_check_health()


func _check_health() -> void:
	var data = await _http.get_json(api_base + "/api/health")
	ai_available = data is Dictionary and bool(data.get("ai", false))


## Called a few times per second by main with the current context.
func set_context(ctx: Dictionary) -> void:
	_ctx = ctx
	_compose()


func _compose() -> void:
	var beh := str(_ctx.get("behaviour", "idle"))
	var moving: bool = _ctx.get("moving", false)
	var watching: bool = _ctx.get("watching", false)
	var playing: bool = _ctx.get("video_playing", false)
	var mood := str(_ctx.get("mood", ""))
	var reaction := str(_ctx.get("reaction", ""))
	var title := str(_ctx.get("video_title", ""))
	var sel := str(_ctx.get("selected_label", ""))
	var top: Array = _ctx.get("top_systems", [])
	var top_label := str(top[0][0]) if top.size() > 0 else ""

	# Doing
	if reaction == "startle":
		doing = "Startled! Jumping back with a burst of wing beats."
	elif reaction == "feed":
		doing = "Extending its proboscis to taste."
	elif reaction == "groove":
		doing = "Bobbing its head and flicking its wings to the beat."
	elif reaction == "antenna":
		doing = "Twitching its antennae to sample the air."
	elif reaction == "think":
		doing = "Pausing to process something familiar."
	elif beh == "fly":
		doing = "Hovering, wings beating around 200 times a second."
	elif beh == "walk" or moving:
		doing = "Walking with a tripod gait: three legs down, three legs swinging."
	elif watching:
		doing = "Standing still, facing the video, eyes locked on the motion."
	else:
		doing = ["Resting and grooming, antennae gently scanning.", "Standing still, taking in the surroundings.",
			"Idling, abdomen pulsing as it breathes."][int(_ctx.get("idle_variant", 0)) % 3]

	# Feeling
	var f := ""
	if reaction == "startle" or mood == "scared":
		f = "Alarmed. Its escape reflexes are primed."
	elif mood != "" and _mood_words.has(mood):
		var words: Array = _mood_words[mood]
		f = words[int(_ctx.get("idle_variant", 0)) % words.size()].capitalize() + "."
	elif beh == "fly":
		f = "Energised. Flying costs a lot, so it will not stay up long."
	elif moving or beh == "walk":
		f = "Purposeful. It is heading somewhere."
	else:
		f = "Calm and alert."
	if top_label != "":
		f += " Busiest brain system right now: " + str(_ctx.get("top_system_label", top_label)).to_lower() + "."
	feeling = f

	# Focus
	if watching and title != "":
		focus = ("Watching “%s”" % title) + (" (playing)." if playing else " (paused).")
	elif sel != "":
		focus = "Looking at the %s you selected." % sel
	elif _ctx.get("poked", false):
		focus = "Reacting to being poked."
	else:
		focus = "Nothing in particular. Try selecting a brain part or sharing a video."

	updated.emit(doing, feeling, focus)
	var key := doing + "|" + focus + "|" + mood
	if key != _last_key:
		_last_key = key
		_since_line = 999.0


func _process(delta: float) -> void:
	_since_line += delta
	_since_ai += delta
	if _since_line > 6.0 and doing != "":
		_since_line = 0.0
		var text := doing + " " + feeling
		if not lines.is_empty() and lines[-1]["text"] == text:
			return
		_push(text, false)
		if ai_enabled and ai_available and not _ai_busy and _since_ai > 14.0:
			_since_ai = 0.0
			_ask_ai()


func _push(text: String, from_ai: bool) -> void:
	lines.append({"text": text, "ai": from_ai, "time": Time.get_ticks_msec()})
	if lines.size() > 12:
		lines.pop_front()
	line_added.emit(text, from_ai)


func _ask_ai() -> void:
	_ai_busy = true
	var body := JSON.stringify({"state": _ctx})
	var req := HTTPRequest.new()
	req.timeout = 45.0
	add_child(req)
	var err := req.request(api_base + "/api/narrate", PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		_ai_busy = false
		return
	var res: Array = await req.request_completed
	req.queue_free()
	_ai_busy = false
	if res[0] != HTTPRequest.RESULT_SUCCESS or res[1] != 200:
		return
	var data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	if data is Dictionary and bool(data.get("ai", false)) and str(data.get("text", "")) != "":
		_push(str(data["text"]), true)
