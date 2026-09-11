import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import meshconvert as mc  # noqa: E402

TOOLS = Path(__file__).resolve().parents[1]


def test_obj_roundtrip():
    text = mc.synthetic_obj(radius=2.0)
    mesh = mc.obj_to_trimesh(text)
    assert len(mesh.faces) > 100
    assert abs(mesh.bounds[1][0] - 2.0) < 0.05


def test_obj_polygon_and_slash_faces():
    text = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3 4/4/4\n"
    mesh = mc.obj_to_trimesh(text)
    assert len(mesh.faces) == 2


def test_swc_tube():
    swc = "# id type x y z r parent\n1 1 0 0 0 1.0 -1\n2 3 10 0 0 0.5 1\n3 3 10 10 0 0.5 2\n4 3 10 10 10 0.5 3\n"
    mesh = mc.swc_to_trimesh(swc, sides=6)
    assert len(mesh.faces) == 3 * 12
    assert mesh.bounds[1][2] >= 10.0


def test_nrrd_isosurface(tmp_path):
    nrrd = pytest.importorskip("nrrd")
    vol = np.zeros((20, 20, 20), dtype=np.uint8)
    vol[5:15, 5:15, 5:15] = 255
    header = {"space directions": np.diag([0.5, 0.5, 1.0]), "space": "left-posterior-superior"}
    path = tmp_path / "v.nrrd"
    nrrd.write(str(path), vol, header)
    mesh = mc.nrrd_to_trimesh(path, level=128, step=1)
    assert len(mesh.faces) > 0
    assert abs(mesh.bounds[1][2] - mesh.bounds[0][2] - 10.0) < 1.5  # 10 voxels * 1.0 spacing


def test_write_glb(tmp_path):
    from pygltflib import GLTF2
    mesh = mc.obj_to_trimesh(mc.synthetic_obj())
    out = mc.write_glb(mesh, tmp_path / "x.glb", node_name="VFB_test", rgba=[1, 0, 0, 0.5])
    g = GLTF2().load(str(out))
    assert any(n.name == "VFB_test" for n in g.nodes)
    assert g.materials[0].alphaMode == "BLEND"


def test_build_fly_body_smoke(tmp_path):
    """Build the fly body from a local flygym checkout if one is cached."""
    repo_root = TOOLS.parent
    candidates = [repo_root / ".cache" / "flygym", Path.home() / "flygym"]
    src = next((c for c in candidates if (c / "src/flygym/assets/model/neuromechfly/rigging.yaml").exists()), None)
    if src is None:
        pytest.skip("no local flygym checkout")
    out = tmp_path / "fly"
    subprocess.run([sys.executable, str(TOOLS / "build_fly_body.py"), "--flygym-dir", str(src), "--out", str(out)], check=True)
    rig = json.loads((out / "fly_rig.json").read_text())
    assert (out / "fly_body.glb").stat().st_size > 100_000
    assert set(rig["legs"]) == {"lf", "lm", "lh", "rf", "rm", "rh"}
    for leg in ("lf", "lm", "lh"):
        r = rig["legs"]["r" + leg[1]]
        assert r["sweep_dof"] == rig["legs"][leg]["sweep_dof"]


def test_fetch_vfb_help():
    subprocess.run([sys.executable, str(TOOLS / "fetch_vfb.py"), "--help"], check=True, capture_output=True)


def test_parse_center_shapes():
    import fetch_vfb as fv
    assert fv.parse_center('{"X":605,"Y":283,"Z":87}') == [605.0, 283.0, 87.0]
    assert fv.parse_center({"X": 1, "Y": 2, "Z": 3}) == [1.0, 2.0, 3.0]
    assert fv.parse_center([1, 2, 3]) == [1.0, 2.0, 3.0]
    assert fv.parse_center("garbage") is None
    assert fv.parse_center(None) is None
