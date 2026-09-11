class_name VfbClient
extends Node
## Thin async client for Virtual Fly Brain's public SOLR index and image files.
## Works on desktop and web builds (HTTPRequest -> fetch in the browser).

const SOLR := "https://solr.virtualflybrain.org/solr"

signal request_started(url: String)
signal request_finished(url: String, ok: bool)

var last_error := ""
var active_requests := 0


func _http(url: String) -> PackedByteArray:
	var req := HTTPRequest.new()
	req.timeout = 120.0
	req.use_threads = false
	add_child(req)
	active_requests += 1
	request_started.emit(url)
	var err := req.request(url)
	if err != OK:
		last_error = "request could not start: %s" % error_string(err)
		req.queue_free()
		active_requests -= 1
		request_finished.emit(url, false)
		return PackedByteArray()
	var res: Array = await req.request_completed
	req.queue_free()
	active_requests -= 1
	var result: int = res[0]
	var code: int = res[1]
	var body: PackedByteArray = res[3]
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		last_error = "HTTP %d (result %d) for %s" % [code, result, url]
		request_finished.emit(url, false)
		return PackedByteArray()
	request_finished.emit(url, true)
	return body


func fetch_bytes(url: String) -> PackedByteArray:
	return await _http(url)


func get_json(url: String) -> Variant:
	var body := await _http(url)
	if body.is_empty():
		return null
	var parsed = JSON.parse_string(body.get_string_from_utf8())
	if parsed == null:
		last_error = "invalid JSON from %s" % url
	return parsed


static func _first(v: Variant) -> String:
	if v is Array:
		return str(v[0]) if v.size() > 0 else ""
	return "" if v == null else str(v)


static func looks_like_id(text: String) -> bool:
	var t := text.strip_edges()
	return t.begins_with("VFB_") or t.begins_with("FBbt_") or t.begins_with("VFBexp_") or t.begins_with("FBbi_")


## Search VFB's ontology index by label / synonym. Returns [{id, label, facets}].
func search(term: String, rows: int = 30) -> Array:
	var q := term.strip_edges().replace('"', "").replace(":", " ").replace("(", " ").replace(")", " ")
	if q.is_empty():
		return []
	var query := 'label:"%s"^20 OR label:(%s) OR synonym:(%s)' % [q, q, q]
	var url := "%s/ontology/select?q=%s&fl=short_form,label,facets_annotation&rows=%d&wt=json" % [
		SOLR, query.uri_encode(), rows]
	var data = await get_json(url)
	if not (data is Dictionary):
		return []
	var docs: Array = data.get("response", {}).get("docs", [])
	var out := []
	for d in docs:
		var facets = d.get("facets_annotation", [])
		out.append({
			"id": _first(d.get("short_form")),
			"label": _first(d.get("label")),
			"facets": facets if facets is Array else [facets],
		})
	return out


## Full term-info document for a VFB / FBbt id, or {} on failure.
func term_info(id: String) -> Dictionary:
	var url := "%s/vfb_json/select?q=id:%s&fl=term_info&wt=json" % [SOLR, id.strip_edges().uri_encode()]
	var data = await get_json(url)
	if not (data is Dictionary):
		return {}
	var docs: Array = data.get("response", {}).get("docs", [])
	if docs.is_empty():
		return {}
	var raw = docs[0].get("term_info")
	if raw is Array:
		raw = raw[0] if raw.size() > 0 else null
	if raw is String:
		var parsed = JSON.parse_string(raw)
		return parsed if parsed is Dictionary else {}
	return raw if raw is Dictionary else {}


## Extract 3D image URLs from a term-info document: [{template, obj, swc, nrrd, thumbnail}].
static func images_of(info: Dictionary) -> Array:
	var out := []
	for ch in info.get("channel_image", []):
		var img: Dictionary = ch.get("image", {}) if ch is Dictionary else {}
		var entry := _image_urls(img)
		if not entry.is_empty():
			out.append(entry)
	return out


static func _image_urls(img: Dictionary) -> Dictionary:
	var e := {}
	var tmpl: Dictionary = img.get("template_anatomy", {}) if img.get("template_anatomy") is Dictionary else {}
	e["template"] = _first(tmpl.get("short_form"))
	e["template_label"] = _first(tmpl.get("label"))
	for key in ["image_obj", "image_swc", "image_nrrd", "image_thumbnail"]:
		var v = img.get(key)
		if v is String and not v.is_empty():
			e[key.trim_prefix("image_")] = v
	var folder = img.get("image_folder", img.get("folder"))
	if folder is String and not folder.is_empty():
		folder = folder.trim_suffix("/")
		if not e.has("obj"):
			e["obj"] = folder + "/volume_man.obj"
			e["obj_alt"] = folder + "/volume.obj"
		if not e.has("swc"):
			e["swc"] = folder + "/volume.swc"
		if not e.has("thumbnail"):
			e["thumbnail"] = folder + "/thumbnail.png"
	if e.has("obj") or e.has("swc"):
		return e
	return {}


## Example instances (with images) listed on a class term: [{id, label, image}].
static func examples_of(info: Dictionary) -> Array:
	var out := []
	for ex in info.get("anatomy_channel_image", []):
		if not (ex is Dictionary):
			continue
		var anat: Dictionary = ex.get("anatomy", {})
		var ci: Dictionary = ex.get("channel_image", {})
		var img: Dictionary = ci.get("image", {}) if ci.get("image") is Dictionary else {}
		out.append({
			"id": _first(anat.get("short_form")),
			"label": _first(anat.get("label")),
			"image": _image_urls(img),
		})
	return out


## Domains painted on a template term: [{id, label, image}].
static func domains_of(info: Dictionary) -> Array:
	var out := []
	for dom in info.get("template_domains", []):
		if not (dom is Dictionary):
			continue
		var atype: Dictionary = dom.get("anatomical_type", {}) if dom.get("anatomical_type") is Dictionary else {}
		var aind: Dictionary = dom.get("anatomical_individual", {}) if dom.get("anatomical_individual") is Dictionary else {}
		var img: Dictionary = dom.get("image", dom) if dom.get("image") is Dictionary else dom
		out.append({
			"id": _first(aind.get("short_form", atype.get("short_form"))),
			"label": _first(atype.get("label", aind.get("label"))),
			"image": _image_urls(img),
		})
	return out


static func summary_of(info: Dictionary) -> Dictionary:
	var term: Dictionary = info.get("term", {})
	var core: Dictionary = term.get("core", {})
	var desc = term.get("description", [])
	var comment = term.get("comment", [])
	var types: Array = core.get("types", [])
	var parents := []
	for p in info.get("parents", []):
		if p is Dictionary:
			parents.append(_first(p.get("label")))
	var datasets := []
	var licenses := []
	for dl in info.get("dataset_license", []):
		if dl is Dictionary:
			var ds: Dictionary = dl.get("dataset", {})
			var lic: Dictionary = dl.get("license", {})
			datasets.append(_first(ds.get("core", {}).get("label")))
			licenses.append(_first(lic.get("core", {}).get("label")))
	return {
		"id": _first(core.get("short_form")),
		"label": _first(core.get("label")),
		"types": types,
		"description": " ".join(desc) if desc is Array else str(desc),
		"comment": " ".join(comment) if comment is Array else str(comment),
		"parents": parents,
		"datasets": datasets,
		"licenses": licenses,
		"is_class": types.has("Class"),
		"is_individual": types.has("Individual"),
	}
