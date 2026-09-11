class_name SwcParser
## SWC neuron skeleton reader -> tube mesh (one open prism per edge).


static func parse(bytes: PackedByteArray, scale: float = 1.0, offset: Vector3 = Vector3.ZERO,
		radius_scale: float = 1.0, min_radius_um: float = 0.25, sides: int = 5) -> ArrayMesh:
	var text := bytes.get_string_from_utf8()
	var pos := {}     # id -> Vector3 (already scaled)
	var rad := {}     # id -> float (scaled)
	var parent := {}  # id -> int
	var order := []
	for line in text.split("\n", false):
		var s := line.strip_edges()
		if s.is_empty() or s[0] == "#":
			continue
		var p := s.split(" ", false)
		if p.size() < 7:
			p = s.split("\t", false)
			if p.size() < 7:
				continue
		var id := p[0].to_int()
		pos[id] = (Vector3(p[2].to_float(), p[3].to_float(), p[4].to_float()) - offset) * scale
		rad[id] = maxf(p[5].to_float() * radius_scale, min_radius_um) * scale
		parent[id] = p[6].to_int()
		order.append(id)

	var verts := PackedVector3Array()
	var indices := PackedInt32Array()
	for id in order:
		var pid: int = parent[id]
		if pid < 0 or not pos.has(pid):
			continue
		var a: Vector3 = pos[pid]
		var b: Vector3 = pos[id]
		var r: float = 0.5 * (rad[id] + rad[pid])
		_add_segment(verts, indices, a, b, r, sides)
	return MeshUtil.build(verts, indices)


static func _add_segment(verts: PackedVector3Array, indices: PackedInt32Array,
		a: Vector3, b: Vector3, radius: float, sides: int) -> void:
	var d := b - a
	var length := d.length()
	if length < 1e-7:
		return
	d /= length
	var helper := Vector3(1, 0, 0) if absf(d.x) < 0.9 else Vector3(0, 1, 0)
	var u := d.cross(helper).normalized()
	var v := d.cross(u)
	var base := verts.size()
	for i in range(sides):
		var ang := TAU * float(i) / float(sides)
		var ring := (u * cos(ang) + v * sin(ang)) * radius
		verts.append(a + ring)
	for i in range(sides):
		var ang := TAU * float(i) / float(sides)
		var ring := (u * cos(ang) + v * sin(ang)) * radius
		verts.append(b + ring)
	for i in range(sides):
		var j := (i + 1) % sides
		indices.append(base + i)
		indices.append(base + j)
		indices.append(base + sides + i)
		indices.append(base + j)
		indices.append(base + sides + j)
		indices.append(base + sides + i)
