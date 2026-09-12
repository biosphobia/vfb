class_name WebBridge
## Thin wrapper around JavaScriptBridge for the web build. Every function is a
## safe no-op on desktop so callers never need to branch.

static var _callbacks := {}


static func is_web() -> bool:
	return OS.has_feature("web")


static func eval(js: String) -> Variant:
	if not is_web():
		return null
	return JavaScriptBridge.eval(js, true)


static func query_param(name: String) -> String:
	var v = eval("new URLSearchParams(window.location.search).get(%s)" % JSON.stringify(name))
	return str(v) if v != null else ""


static func api_base() -> String:
	if is_web():
		var v = eval("(window.VFB_CONFIG && window.VFB_CONFIG.apiBase) || ''")
		return str(v) if v != null else ""
	var env := OS.get_environment("VFB_API_BASE")
	return env


static func is_touch_device() -> bool:
	if is_web():
		var v = eval("(('ontouchstart' in window) || navigator.maxTouchPoints > 0) ? 1 : 0")
		return v != null and int(v) == 1
	return DisplayServer.is_touchscreen_available()


static func device_pixel_ratio() -> float:
	if is_web():
		var v = eval("window.devicePixelRatio || 1")
		return float(v) if v != null else 1.0
	return DisplayServer.screen_get_scale()


## Register a GDScript callable as window.vfbBridge[name](...)
static func expose(name: String, cb: Callable) -> void:
	if not is_web():
		return
	var js_cb := JavaScriptBridge.create_callback(cb)
	_callbacks[name] = js_cb
	JavaScriptBridge.eval("window.vfbBridge = window.vfbBridge || {};", true)
	var bridge = JavaScriptBridge.get_interface("vfbBridge")
	if bridge != null:
		bridge[name] = js_cb


static func load_video(video_id: String) -> void:
	eval("window.vfbLoadVideo && window.vfbLoadVideo(%s)" % JSON.stringify(video_id))


static func stop_video() -> void:
	eval("window.vfbStopVideo && window.vfbStopVideo()")


## Position the HTML video overlay. Coordinates are CSS pixels.
static func set_video_rect(rect: Rect2, visible: bool) -> void:
	eval("window.vfbSetVideoRect && window.vfbSetVideoRect(%d,%d,%d,%d,%s)" % [
		int(rect.position.x), int(rect.position.y), int(rect.size.x), int(rect.size.y), "true" if visible else "false"])


## Position the native link input (CSS pixels). Web only.
static func set_link_rect(rect: Rect2, visible: bool) -> void:
	eval("window.vfbSetLinkRect && window.vfbSetLinkRect(%d,%d,%d,%d,%s)" % [
		int(rect.position.x), int(rect.position.y), int(rect.size.x), int(rect.size.y), "true" if visible else "false"])


static func set_link_value(text: String) -> void:
	eval("window.vfbSetLinkValue && window.vfbSetLinkValue(%s)" % JSON.stringify(text))


static func copy_text(text: String) -> bool:
	if not is_web():
		DisplayServer.clipboard_set(text)
		return true
	eval("window.vfbCopy && window.vfbCopy(%s)" % JSON.stringify(text))
	return true


static func share_url(video_id: String) -> String:
	if is_web():
		var v = eval("window.location.origin + window.location.pathname")
		var base := str(v) if v != null else ""
		return base + ("?v=" + video_id if not video_id.is_empty() else "")
	return "https://vfb-fly-explorer.onrender.com/" + ("?v=" + video_id if not video_id.is_empty() else "")


static func open_url(url: String) -> void:
	OS.shell_open(url)
