class_name ObjParser
## Minimal Wavefront OBJ reader (v / f records) used for VFB surface meshes
## downloaded at runtime. Coordinates are shifted by `offset` then multiplied
## by `scale` (VFB files are in micrometres; the app works in millimetres).


static func parse(bytes: PackedByteArray, scale: float = 1.0, offset: Vector3 = Vector3.ZERO) -> ArrayMesh:
	var text := bytes.get_string_from_utf8()
	var verts := PackedVector3Array()
	var indices := PackedInt32Array()
	for line in text.split("\n", false):
		if line.length() < 3:
			continue
		var c0 := line[0]
		if c0 == "v" and line[1] == " ":
			var p := line.split(" ", false)
			if p.size() >= 4:
				var v := Vector3(p[1].to_float(), p[2].to_float(), p[3].to_float())
				verts.append((v - offset) * scale)
		elif c0 == "f" and line[1] == " ":
			var p := line.split(" ", false)
			var idx := PackedInt32Array()
			for k in range(1, p.size()):
				var tok: String = p[k].get_slice("/", 0)
				if tok.is_empty():
					continue
				var i := tok.to_int()
				idx.append(i - 1 if i > 0 else verts.size() + i)
			for k in range(1, idx.size() - 1):
				indices.append(idx[0])
				indices.append(idx[k])
				indices.append(idx[k + 1])
	return MeshUtil.build(verts, indices)


static func vertex_count(bytes: PackedByteArray) -> int:
	return bytes.get_string_from_utf8().count("\nv ")
