extends SceneTree
## Headless self-test:  godot --headless --path godot -s tests/test_parsers.gd

var failures := 0


func check(cond: bool, msg: String) -> void:
	if cond:
		print("  ok   " + msg)
	else:
		failures += 1
		printerr("  FAIL " + msg)


func _init() -> void:
	print("test: MeshUtil / ObjParser / SwcParser / FlyRig")
	var obj := "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3 4/4/4\n"
	var m := ObjParser.parse(obj.to_utf8_buffer(), 0.5, Vector3(1, 1, 0))
	check(m.get_surface_count() == 1, "obj -> one surface")
	var arrays := m.surface_get_arrays(0)
	check((arrays[Mesh.ARRAY_INDEX] as PackedInt32Array).size() == 6, "quad triangulated to 6 indices")
	var v0: Vector3 = (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array)[0]
	check(v0.is_equal_approx(Vector3(-0.5, -0.5, 0)), "offset+scale applied (%s)" % v0)
	var n0: Vector3 = (arrays[Mesh.ARRAY_NORMAL] as PackedVector3Array)[0]
	check(n0.dot(Vector3(0, 0, 1)) > 0.99, "ccw normal points +z (%s)" % n0)

	var swc := "# test\n1 1 0 0 0 1 -1\n2 3 10 0 0 0.5 1\n3 3 10 10 0 0.5 2\n"
	var sm := SwcParser.parse(swc.to_utf8_buffer(), 1.0, Vector3.ZERO, 1.0, 0.25, 5)
	check(sm.get_surface_count() == 1, "swc -> one surface")
	var sarr := sm.surface_get_arrays(0)
	check((sarr[Mesh.ARRAY_INDEX] as PackedInt32Array).size() == 2 * 5 * 6, "two tube segments, 5 sides")
	check(sm.get_aabb().size.x > 9.0, "tube spans x")

	var rig_path := "res://assets/fly_rig_default.json"
	var f := FileAccess.open(rig_path, FileAccess.READ)
	check(f != null, "default rig json present")
	if f != null:
		var rig: Dictionary = JSON.parse_string(f.get_as_text())
		var body := PlaceholderFly.build(rig)
		var r := FlyRig.new()
		root.add_child(body)
		root.add_child(r)
		r.setup(body, rig)
		check(r.joint_count() == rig["nodes"].size(), "rig bound %d joints" % r.joint_count())
		r.behaviour = FlyRig.Behaviour.WALK
		r._process(0.1)
		r._process(0.1)
		check(r.forward_speed_mm_s != 0.0, "walking produces forward speed (%.3f mm/s)" % r.forward_speed_mm_s)
		var coxa := body.find_child("lf_coxa", true, false) as Node3D
		check(coxa != null and coxa.transform.basis.is_finite(), "posed basis finite")

	var vc_info := {"term": {"core": {"short_form": "VFB_1", "label": "x", "types": ["Individual", "Neuron"]}},
		"channel_image": [{"image": {"image_folder": "https://example/data/VFB/i/0001/0002",
			"template_anatomy": {"short_form": "VFB_00101567", "label": "JRC2018Unisex"}}}]}
	var imgs := VfbClient.images_of(vc_info)
	check(imgs.size() == 1 and imgs[0]["obj"].ends_with("volume_man.obj"), "image folder -> obj url")
	check(VfbClient.summary_of(vc_info)["is_individual"], "summary types")

	print("failures: %d" % failures)
	quit(1 if failures > 0 else 0)
