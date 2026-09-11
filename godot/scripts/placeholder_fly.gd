class_name PlaceholderFly
## Builds a boxy stand-in fly from fly_rig_default.json when the real
## NeuroMechFly GLB has not been generated yet (see tools/build_fly_body.py).
## Node names and local frames match the real model so FlyRig drives both.


static func build(rig: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = str(rig.get("root_node", "FlyBody"))
	root.transform.basis = Basis(Vector3(1, 0, 0), -PI / 2.0)  # MuJoCo Z-up -> Godot Y-up
	var nodes := {}
	var by_name := {}
	for n in rig.get("nodes", []):
		by_name[str(n["name"])] = n
	var colors := {
		"body": Color(0.59, 0.39, 0.12), "abdomen": Color(0.52, 0.34, 0.11), "leg": Color(0.62, 0.42, 0.16),
		"antenna": Color(0.6, 0.4, 0.14), "eye": Color(0.67, 0.21, 0.12), "wing": Color(0.8, 0.8, 0.9, 0.35),
		"arista": Color(0.26, 0.2, 0.16), "haltere": Color(0.59, 0.43, 0.24),
	}
	var pending: Array = rig.get("nodes", []).duplicate()
	var guard := 0
	while not pending.is_empty() and guard < 10000:
		guard += 1
		var n: Dictionary = pending.pop_front()
		var parent_name = n.get("parent")
		var parent: Node3D = root if parent_name == null else nodes.get(str(parent_name))
		if parent == null:
			pending.append(n)
			continue
		var node := MeshInstance3D.new()
		node.name = str(n["name"])
		var p: Array = n.get("local_pos_mm", [0, 0, 0])
		var q: Array = n.get("local_quat_wxyz", [1, 0, 0, 0])
		var quat := Quaternion(float(q[1]), float(q[2]), float(q[3]), float(q[0]))
		node.transform = Transform3D(Basis(quat), Vector3(float(p[0]), float(p[1]), float(p[2])))
		var mn: Array = n.get("aabb_min_mm", [-0.05, -0.05, -0.05])
		var mx: Array = n.get("aabb_max_mm", [0.05, 0.05, 0.05])
		var box := BoxMesh.new()
		var size := Vector3(float(mx[0]) - float(mn[0]), float(mx[1]) - float(mn[1]), float(mx[2]) - float(mn[2]))
		box.size = size.max(Vector3.ONE * 0.02)
		node.mesh = box
		node.position += Vector3.ZERO
		var inner := MeshInstance3D.new()
		inner.name = "shape"
		inner.mesh = box
		inner.position = Vector3(float(mx[0]) + float(mn[0]), float(mx[1]) + float(mn[1]), float(mx[2]) + float(mn[2])) * 0.5
		var mat := StandardMaterial3D.new()
		var cat := str(n.get("category", "leg"))
		mat.albedo_color = colors.get(cat, Color.SADDLE_BROWN)
		if mat.albedo_color.a < 1.0:
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		inner.material_override = mat
		node.mesh = null
		node.add_child(inner)
		parent.add_child(node)
		nodes[node.name] = node
	return root
