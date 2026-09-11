class_name MeshUtil
## Helpers to build ArrayMesh instances from raw vertex/index data.
## Input triangles are expected in counter-clockwise order (OBJ / glTF
## convention); Godot front faces are clockwise, so indices are flipped here.


static func build(verts: PackedVector3Array, ccw_indices: PackedInt32Array) -> ArrayMesh:
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3.ZERO)
	var n := ccw_indices.size() - ccw_indices.size() % 3
	var out := PackedInt32Array()
	out.resize(n)
	var vcount := verts.size()
	var w := 0
	for i in range(0, n, 3):
		var a := ccw_indices[i]
		var b := ccw_indices[i + 1]
		var c := ccw_indices[i + 2]
		if a < 0 or b < 0 or c < 0 or a >= vcount or b >= vcount or c >= vcount:
			continue
		var fn := (verts[b] - verts[a]).cross(verts[c] - verts[a])
		normals[a] += fn
		normals[b] += fn
		normals[c] += fn
		out[w] = a
		out[w + 1] = c
		out[w + 2] = b
		w += 3
	out.resize(w)
	for i in range(normals.size()):
		var v := normals[i]
		normals[i] = v.normalized() if v.length_squared() > 0.0 else Vector3.UP
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = out
	var mesh := ArrayMesh.new()
	if verts.size() > 0 and out.size() >= 3:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func aabb_of(mesh: Mesh) -> AABB:
	if mesh == null:
		return AABB()
	return mesh.get_aabb()
