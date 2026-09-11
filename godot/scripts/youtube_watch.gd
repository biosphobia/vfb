class_name YouTubeWatch
extends Node
## "Show the fly a video". Parses YouTube links, fetches the title (API service
## first, then noembed which allows cross-origin requests), builds a reaction
## plan (AI via the service when available, otherwise keyword based) and plays
## the plan's beats while the video is playing.

signal video_changed(info: Dictionary)          # {id, title, author, thumbnail}
signal plan_ready(plan: Dictionary)             # {mood, summary, beats, ai}
signal beat(action: String, note: String)
signal playing_changed(playing: bool)

const NOEMBED := "https://noembed.com/embed?url=https://www.youtube.com/watch?v="

var info := {}
var plan := {}
var playing := false
var elapsed := 0.0
var api_base := ""
var _http: VfbClient
var _next_beat := 0
var _thumb: Texture2D


func setup(http: VfbClient, base: String) -> void:
	_http = http
	api_base = base.trim_suffix("/")
	WebBridge.expose("onPlayerState", _on_player_state)


static func extract_id(text: String) -> String:
	var t := text.strip_edges()
	if t.is_empty():
		return ""
	var re := RegEx.new()
	re.compile("(?:v=|youtu\\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{6,20})")
	var m := re.search(t)
	if m:
		return m.get_string(1)
	var re2 := RegEx.new()
	re2.compile("^[A-Za-z0-9_-]{6,20}$")
	if re2.search(t):
		return t
	return ""


func mood() -> String:
	return str(plan.get("mood", ""))


func title() -> String:
	return str(info.get("title", ""))


func has_video() -> bool:
	return info.has("id")


func thumbnail() -> Texture2D:
	return _thumb


func load(text: String) -> bool:
	var vid := extract_id(text)
	if vid.is_empty():
		return false
	stop()
	info = {"id": vid, "title": "", "author": "", "thumbnail": "https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid}
	plan = {}
	_next_beat = 0
	elapsed = 0.0
	video_changed.emit(info)
	WebBridge.load_video(vid)
	_fetch_meta(vid)
	return true


func stop() -> void:
	if has_video():
		WebBridge.stop_video()
	info = {}
	plan = {}
	_thumb = null
	_set_playing(false)
	video_changed.emit({})


func _fetch_meta(vid: String) -> void:
	var data = null
	if api_base != "":
		data = await _http.get_json(api_base + "/api/youtube?id=" + vid)
	if not (data is Dictionary) or str(data.get("title", "")).is_empty():
		var nb = await _http.get_json(NOEMBED + vid)
		if nb is Dictionary and nb.has("title"):
			data = {"id": vid, "title": str(nb.get("title", "")), "author": str(nb.get("author_name", "")),
				"thumbnail": str(nb.get("thumbnail_url", info.get("thumbnail", "")))}
	if info.get("id", "") != vid:
		return  # a newer video replaced this one
	if data is Dictionary:
		info["title"] = str(data.get("title", ""))
		info["author"] = str(data.get("author", ""))
		if str(data.get("thumbnail", "")) != "":
			info["thumbnail"] = str(data["thumbnail"])
	if info["title"] == "":
		info["title"] = "YouTube video " + vid
	video_changed.emit(info)
	if not WebBridge.is_web():
		_fetch_thumb(vid, str(info["thumbnail"]))
	_build_plan(vid)


func _fetch_thumb(vid: String, url: String) -> void:
	var bytes := await _http.fetch_bytes(url)
	if bytes.is_empty() or info.get("id", "") != vid:
		return
	var img := Image.new()
	if img.load_jpg_from_buffer(bytes) != OK and img.load_png_from_buffer(bytes) != OK and img.load_webp_from_buffer(bytes) != OK:
		return
	_thumb = ImageTexture.create_from_image(img)
	video_changed.emit(info)


func _build_plan(vid: String) -> void:
	var got := {}
	if api_base != "":
		var req := HTTPRequest.new()
		req.timeout = 60.0
		add_child(req)
		var body := JSON.stringify({"id": vid, "title": info.get("title", ""), "author": info.get("author", "")})
		if req.request(api_base + "/api/react", PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_POST, body) == OK:
			var res: Array = await req.request_completed
			if res[0] == HTTPRequest.RESULT_SUCCESS and res[1] == 200:
				var data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
				if data is Dictionary and data.has("beats"):
					got = data
		req.queue_free()
	if info.get("id", "") != vid:
		return
	if got.is_empty():
		got = local_plan(str(info.get("title", "")), str(info.get("author", "")))
	plan = got
	_next_beat = 0
	plan_ready.emit(plan)


## Keyword-based reaction plan, mirrors server/app.py programmatic_plan.
static func local_plan(title: String, author: String = "") -> Dictionary:
	var text := (title + " " + author).to_lower()
	var words := {
		"hungry": ["food", "fruit", "banana", "apple", "sugar", "cake", "cook", "recipe", "eat", "juice", "wine", "beer", "honey", "mango", "pizza", "sweet", "dessert", "kitchen", "meal", "snack", "candy", "chocolate"],
		"scared": ["spider", "swat", "predator", "horror", "scary", "trap", "kill", "poison", "insecticide", "frog", "bird", "wasp", "danger", "scream", "storm", "thunder", "fire", "explosion", "attack"],
		"groovy": ["music", "song", "dance", "beat", "remix", "dj", "concert", "bass", "guitar", "piano", "drum", "rap", "edm", "techno", "jazz", "sing", "karaoke", "lofi"],
		"sleepy": ["sleep", "asmr", "rain", "calm", "relax", "meditat", "ambient", "slow", "night", "bedtime", "lullaby", "quiet", "nap", "cozy"],
		"excited": ["fast", "race", "crazy", "insane", "epic", "win", "goal", "highlight", "funny", "prank", "lol", "wow", "amazing", "compilation", "cat", "dog", "puppy", "kitten"],
	}
	var best := 0
	var mood := "curious"
	for m in words:
		var n := 0
		for w in words[m]:
			if text.contains(w):
				n += 1
		if n > best:
			best = n
			mood = m
	var beats := {
		"curious": [[2, "look", "The fly turns to face the screen and studies it."], [12, "antenna", "Its antennae twitch, sampling the air for clues."], [25, "walk", "It takes a few steps closer, curious."], [45, "think", "Something familiar lights up its memory centre."], [70, "look", "It settles down and keeps watching."]],
		"hungry": [[2, "look", "The fly notices the food and locks on."], [8, "feed", "Its proboscis extends, tasting the air."], [20, "walk", "It hurries toward the screen."], [35, "feed", "More tasting; the taste centre is buzzing."], [60, "groove", "A happy wiggle: this looks delicious."], [80, "feed", "One more taste before it calms down."]],
		"scared": [[2, "look", "The fly freezes and stares."], [6, "startle", "It jumps! Something on screen looks dangerous."], [12, "fly", "Escape flight: wings beating hard."], [30, "walk", "It creeps back to look again."], [50, "startle", "Another scare sends it backwards."], [75, "rest", "Finally it settles, still alert."]],
		"groovy": [[2, "look", "The fly turns toward the music."], [6, "groove", "Head bobbing to the beat."], [20, "fly", "It lifts off for a spin."], [35, "groove", "Back down and grooving again."], [60, "walk", "A little dance-walk in circles."], [85, "groove", "Still moving to the rhythm."]],
		"sleepy": [[2, "look", "The fly watches quietly."], [15, "rest", "Its movements slow down."], [40, "antenna", "A lazy antenna twitch."], [70, "rest", "Almost dozing off."]],
		"excited": [[2, "look", "The fly snaps to attention."], [6, "startle", "It hops with excitement."], [15, "walk", "Quick steps toward the action."], [30, "fly", "It takes off in a burst."], [50, "groove", "Buzzing happily."], [75, "walk", "Still pacing, wide awake."]],
	}
	var summaries := {
		"curious": "This looks interesting. The fly will watch closely and use its memory and smell centres to figure it out.",
		"hungry": "This looks like food! Expect the fly's taste and smell centres to light up as it tries to reach the screen.",
		"scared": "Something here looks dangerous to a fly. Expect startles and a quick escape flight.",
		"groovy": "Music! The fly will bob its head and buzz along with the beat.",
		"sleepy": "A calm one. The fly will slow down and relax while it watches.",
		"excited": "Lots of action here. The fly will hop, pace and buzz around.",
	}
	var out := []
	for b in beats[mood]:
		out.append({"at_s": float(b[0]), "action": b[1], "note": b[2]})
	return {"mood": mood, "summary": summaries[mood], "beats": out, "ai": false}


## JS -> Godot: YouTube player state (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued)
func _on_player_state(args: Array) -> void:
	var state := int(args[0]) if args.size() > 0 else -1
	_set_playing(state == 1)
	if state == 0:
		elapsed = 0.0
		_next_beat = 0


## Desktop has no embedded player: the "Play reaction" button drives this.
func simulate_play(on: bool) -> void:
	_set_playing(on)
	if on and elapsed > 95.0:
		elapsed = 0.0
		_next_beat = 0


func _set_playing(on: bool) -> void:
	if on == playing:
		return
	playing = on
	playing_changed.emit(on)


func _process(delta: float) -> void:
	if not playing or plan.is_empty():
		return
	elapsed += delta
	var beats: Array = plan.get("beats", [])
	while _next_beat < beats.size() and elapsed >= float(beats[_next_beat].get("at_s", 0.0)):
		var b: Dictionary = beats[_next_beat]
		_next_beat += 1
		beat.emit(str(b.get("action", "look")), str(b.get("note", "")))
	if _next_beat >= beats.size() and elapsed > 120.0:
		elapsed = 0.0  # loop the plan for long videos
		_next_beat = 0
