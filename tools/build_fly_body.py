#!/usr/bin/env python3
"""Build the articulated fly body used by the Godot app from NeuroMechFly.

Source: NeuroMechFly v2 (flygym) body model, Apache-2.0,
https://github.com/NeLy-EPFL/flygym  (Wang-Chen et al., Nature Methods 2024).

Output (default: godot/assets/generated/fly/):
  fly_body.glb  - one node per body segment, parented like the MuJoCo model,
                  neutral standing pose baked in, converted Z-up -> Y-up (Godot),
                  units: millimetres.
  fly_rig.json  - joint metadata used by the GDScript gait controller:
                  per-joint DOF axes, neutral angles, and which local axis
                  moves each leg tip forward / up (measured by forward
                  kinematics here so the controller stays data-driven).

The script sparse-clones flygym if --flygym-dir is not given.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import trimesh
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
FLYGYM_URL = "https://github.com/NeLy-EPFL/flygym.git"
ASSET_SUBDIR = "src/flygym/assets/model/neuromechfly"
MESH_SUBDIR = "meshes/simplified_max2000faces"
MESH_UNIT_SCALE = 1000.0  # STL files are in metres; rig positions are in mm

LEGS = ["lf", "lm", "lh", "rf", "rm", "rh"]
LEG_CHAIN = ["coxa", "trochanterfemur", "tibia", "tarsus1", "tarsus2", "tarsus3", "tarsus4", "tarsus5"]

# Per-segment colours (r, g, b, a) loosely following flygym/visuals.yaml
COLORS = {
    "wing": (0.80, 0.80, 0.90, 0.35),
    "eye": (0.67, 0.21, 0.12, 1.0),
    "arista": (0.26, 0.20, 0.16, 1.0),
    "haltere": (0.59, 0.43, 0.24, 1.0),
    "body": (0.59, 0.39, 0.12, 1.0),
    "abdomen": (0.52, 0.34, 0.11, 1.0),
    "leg": (0.62, 0.42, 0.16, 1.0),
    "antenna": (0.60, 0.40, 0.14, 1.0),
}


# --------------------------------------------------------------------------- #
# Kinematic tree
# --------------------------------------------------------------------------- #
def parent_of(name: str) -> str | None:
    """Parent body for a NeuroMechFly segment name (mirrors the MJCF tree)."""
    if name == "c_thorax":
        return None
    if name == "c_head":
        return "c_thorax"
    if name == "c_rostrum":
        return "c_head"
    if name == "c_haustellum":
        return "c_rostrum"
    if name == "c_abdomen12":
        return "c_thorax"
    if name.startswith("c_abdomen"):
        n = int(name[len("c_abdomen"):])
        return "c_abdomen12" if n == 3 else f"c_abdomen{n - 1}"
    side, part = name.split("_", 1)
    if side in ("l", "r"):
        return {
            "eye": "c_head",
            "pedicel": "c_head",
            "funiculus": f"{side}_pedicel",
            "arista": f"{side}_funiculus",
            "wing": "c_thorax",
            "haltere": "c_thorax",
        }[part]
    # legs: lf/lm/lh/rf/rm/rh
    if part == "coxa":
        return "c_thorax"
    idx = LEG_CHAIN.index(part)
    return f"{side}_{LEG_CHAIN[idx - 1]}"


def category(name: str) -> str:
    for key in ("wing", "eye", "arista", "haltere"):
        if name.endswith(key):
            return key
    if name.startswith("c_abdomen"):
        return "abdomen"
    if name in ("c_head", "c_thorax"):
        return "body"
    if any(name.endswith(p) for p in ("pedicel", "funiculus", "rostrum", "haustellum")):
        return "antenna"
    return "leg"


def joint_dofs(name: str) -> list[str]:
    """Degrees of freedom exposed to the controller for each segment."""
    if name == "c_thorax":
        return []
    part = name.split("_", 1)[1]
    if part == "coxa":
        return ["yaw", "pitch", "roll"]
    if part == "trochanterfemur":
        return ["pitch", "roll"]
    if part.startswith("tarsus") or part == "tibia":
        return ["pitch"]
    if part in ("wing", "haltere"):
        return ["yaw", "pitch", "roll"]
    if name == "c_head":
        return ["yaw", "pitch", "roll"]
    if part in ("pedicel", "funiculus"):
        return ["pitch", "roll"]
    if name.startswith("c_abdomen"):
        return ["pitch"]
    if part in ("rostrum", "haustellum"):
        return ["pitch"]
    return []


# --------------------------------------------------------------------------- #
# Maths (MuJoCo conventions: quaternion w,x,y,z; Z-up; yaw=x, pitch=y, roll=z)
# --------------------------------------------------------------------------- #
def quat_to_mat(q) -> np.ndarray:
    w, x, y, z = [float(v) for v in q]
    n = math.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def rot_axis(axis: str, deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == "yaw":    # x axis
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "pitch":  # y axis
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    if axis == "roll":   # z axis
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    raise ValueError(axis)


def joint_rotation(angles: dict[str, float], order=("yaw", "pitch", "roll")) -> np.ndarray:
    """Intrinsic composition R = R_a1 * R_a2 * R_a3 (MuJoCo multi-hinge order)."""
    r = np.eye(3)
    for ax in order:
        r = r @ rot_axis(ax, angles.get(ax, 0.0))
    return r


def mat4(rot: np.ndarray, pos) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = rot
    m[:3, 3] = np.asarray(pos, dtype=np.float64)
    return m


Z_UP_TO_Y_UP = np.array([
    [1, 0, 0, 0],
    [0, 0, 1, 0],
    [0, -1, 0, 0],
    [0, 0, 0, 1],
], dtype=np.float64)


# --------------------------------------------------------------------------- #
# Assets
# --------------------------------------------------------------------------- #
def ensure_flygym(cache_dir: Path, ref: str) -> Path:
    asset_dir = cache_dir / "flygym" / ASSET_SUBDIR
    if (asset_dir / "rigging.yaml").exists():
        return asset_dir
    cache_dir.mkdir(parents=True, exist_ok=True)
    repo = cache_dir / "flygym"
    if not repo.exists():
        subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
                        "--branch", ref, FLYGYM_URL, str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "sparse-checkout", "set", ASSET_SUBDIR], check=True)
    if not (asset_dir / "rigging.yaml").exists():
        sys.exit(f"flygym assets not found under {asset_dir}")
    return asset_dir


def load_mesh(mesh_dir: Path, name: str) -> trimesh.Trimesh:
    """Load a segment mesh. Right-side parts are mirrored copies of the left."""
    path = mesh_dir / f"{name}.stl"
    mirrored = False
    if not path.exists():
        side, part = name.split("_", 1)
        alt = {"r": "l", "rf": "lf", "rm": "lm", "rh": "lh"}.get(side)
        if alt is None:
            raise FileNotFoundError(path)
        path = mesh_dir / f"{alt}_{part}.stl"
        mirrored = True
    mesh = trimesh.load(path, force="mesh")
    verts = np.asarray(mesh.vertices, dtype=np.float64) * MESH_UNIT_SCALE
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if mirrored:
        verts[:, 1] *= -1.0
        faces = faces[:, ::-1]  # keep outward winding after mirror
    out = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    return out


def neutral_pose(asset_dir: Path, pose_file: str) -> dict[str, dict[str, float]]:
    """Return {child_body: {axis: degrees}} for both sides (right side mirrored)."""
    data = yaml.safe_load((asset_dir / "pose" / "neutral" / pose_file).read_text())
    order = tuple(data.get("axis_order", ["yaw", "pitch", "roll"]))
    pose: dict[str, dict[str, float]] = {}
    for key, deg in data.get("joint_angles", {}).items():
        parent, child, axis = key.rsplit("-", 2)
        pose.setdefault(child, {})[axis] = float(deg)
    # Mirror to the right side: rotations about x (yaw) and z (roll) flip sign
    for child in list(pose.keys()):
        side, part = child.split("_", 1)
        mirror = {"l": "r", "lf": "rf", "lm": "rm", "lh": "rh"}.get(side)
        if mirror is None:
            continue
        rchild = f"{mirror}_{part}"
        if rchild in pose:
            continue
        pose[rchild] = {ax: (-v if ax in ("yaw", "roll") else v) for ax, v in pose[child].items()}
    return pose, order


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build(asset_dir: Path, out_dir: Path, pose_file: str, max_faces: int) -> None:
    rigging = yaml.safe_load((asset_dir / "rigging.yaml").read_text())
    mesh_dir = asset_dir / MESH_SUBDIR
    pose, order = neutral_pose(asset_dir, pose_file)

    names = list(rigging.keys())
    local: dict[str, np.ndarray] = {}      # local transforms incl. neutral pose
    world: dict[str, np.ndarray] = {}      # in MuJoCo frame (Z-up)
    rig_nodes = []

    for name in names:
        spec = rigging[name]
        base_rot = quat_to_mat(spec["quat"])
        angles = pose.get(name, {})
        rot = base_rot @ joint_rotation(angles, order)
        local[name] = mat4(rot, spec["pos"])

    def world_of(name: str) -> np.ndarray:
        if name in world:
            return world[name]
        p = parent_of(name)
        w = local[name] if p is None else world_of(p) @ local[name]
        world[name] = w
        return w

    for name in names:
        world_of(name)

    # Ground level: lowest tarsus tip (approx: lowest vertex of tarsus5 meshes)
    scene = trimesh.Scene()
    root_name = "FlyBody"
    scene.graph.update(frame_to=root_name, frame_from=scene.graph.base_frame, matrix=Z_UP_TO_Y_UP)

    meshes: dict[str, trimesh.Trimesh] = {}
    for name in names:
        mesh = load_mesh(mesh_dir, name)
        if max_faces > 0 and len(mesh.faces) > max_faces:
            try:
                mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
            except BaseException:  # noqa: BLE001
                pass
        rgba = COLORS[category(name)]
        mesh.visual = trimesh.visual.TextureVisuals(
            material=trimesh.visual.material.PBRMaterial(
                name=f"{category(name)}_mat", baseColorFactor=list(rgba),
                metallicFactor=0.0, roughnessFactor=0.65,
                alphaMode="BLEND" if rgba[3] < 0.999 else "OPAQUE"))
        meshes[name] = mesh

    for name in names:
        parent = parent_of(name) or root_name
        scene.add_geometry(meshes[name], node_name=name, geom_name=f"{name}_mesh",
                           parent_node_name=parent, transform=local[name])

    # Forward-kinematics probes so the controller knows which DOF does what.
    def tip_world(leg: str) -> np.ndarray:
        w = world[f"{leg}_tarsus5"]
        v = meshes[f"{leg}_tarsus5"].vertices
        pts = (w[:3, :3] @ v.T).T + w[:3, 3]
        return pts[np.argmin(pts[:, 2])]

    ground_z = min(float(tip_world(leg)[2]) for leg in LEGS)

    def probe(leg: str, seg: str, axis: str, deg: float = 10.0) -> np.ndarray:
        """Tip displacement (MuJoCo frame) when rotating one DOF by +deg."""
        node = f"{leg}_{seg}"
        saved = local[node].copy()
        local[node] = saved @ mat4(rot_axis(axis, deg), [0, 0, 0])
        world.clear()
        for n in names:
            world_of(n)
        moved = tip_world(leg)
        local[node] = saved
        world.clear()
        for n in names:
            world_of(n)
        return moved - tip_world(leg)

    legs_meta = {}
    # Probe the LEFT legs only and mirror the result to the right side so the
    # gait is symmetric. Mirroring flips the sign of yaw (x) and roll (z) DOFs.
    for leg in ("lf", "lm", "lh"):
        rest_tip = tip_world(leg)
        probes = {}
        for seg, axis in (("coxa", "yaw"), ("coxa", "pitch"), ("coxa", "roll"),
                          ("trochanterfemur", "pitch"), ("trochanterfemur", "roll"),
                          ("tibia", "pitch")):
            d = probe(leg, seg, axis)
            probes[f"{seg}.{axis}"] = [round(float(x), 4) for x in d]
        # Sweep DOF: mostly-horizontal motion along the body axis (x)
        candidates = {k: v for k, v in probes.items()
                      if k in ("coxa.roll", "coxa.yaw", "trochanterfemur.roll")
                      and abs(v[2]) < 0.5 * abs(v[0])}
        if not candidates:
            candidates = {k: v for k, v in probes.items() if k != "trochanterfemur.pitch"}
        sweep = max(candidates.items(), key=lambda kv: abs(kv[1][0]))
        lift = ("trochanterfemur.pitch", probes["trochanterfemur.pitch"])
        flex = ("tibia.pitch", probes["tibia.pitch"])
        meta = {
            "side": "left",
            "position": leg[1],  # f/m/h
            "rest_tip_mm": [round(float(x), 4) for x in rest_tip],
            "sweep_dof": sweep[0], "sweep_sign_forward": 1 if sweep[1][0] > 0 else -1,
            "lift_dof": lift[0], "lift_sign_up": 1 if lift[1][2] > 0 else -1,
            "flex_dof": flex[0], "flex_sign_up": 1 if flex[1][2] > 0 else -1,
            "probes": probes,
        }
        legs_meta[leg] = meta
        rleg = "r" + leg[1]
        rtip = tip_world(rleg)

        def mirrored_sign(dof: str, sign: int) -> int:
            return -sign if dof.endswith((".yaw", ".roll")) else sign

        legs_meta[rleg] = {
            "side": "right",
            "position": leg[1],
            "rest_tip_mm": [round(float(x), 4) for x in rtip],
            "sweep_dof": meta["sweep_dof"],
            "sweep_sign_forward": mirrored_sign(meta["sweep_dof"], meta["sweep_sign_forward"]),
            "lift_dof": meta["lift_dof"],
            "lift_sign_up": mirrored_sign(meta["lift_dof"], meta["lift_sign_up"]),
            "flex_dof": meta["flex_dof"],
            "flex_sign_up": mirrored_sign(meta["flex_dof"], meta["flex_sign_up"]),
            "mirrored_from": leg,
        }

    # Wing flap probe: which local axis lifts the wing tip
    wings_meta = {}
    for side in ("l", "r"):
        node = f"{side}_wing"
        v = meshes[node].vertices
        far = v[np.argmax(np.linalg.norm(v, axis=1))]
        best = None
        for axis in ("yaw", "pitch", "roll"):
            saved = local[node].copy()
            local[node] = saved @ mat4(rot_axis(axis, 10.0), [0, 0, 0])
            world.clear()
            for n in names:
                world_of(n)
            w = world[node]
            moved = w[:3, :3] @ far + w[:3, 3]
            local[node] = saved
            world.clear()
            for n in names:
                world_of(n)
            w = world[node]
            rest = w[:3, :3] @ far + w[:3, 3]
            dz = float((moved - rest)[2])
            if best is None or abs(dz) > abs(best[1]):
                best = (axis, dz)
        wings_meta[node] = {"flap_dof": best[0], "flap_sign_up": 1 if best[1] > 0 else -1}

    for name in names:
        q = trimesh.transformations.quaternion_from_matrix(local[name])  # (w, x, y, z)
        b = meshes[name].bounds
        rig_nodes.append({
            "name": name,
            "parent": parent_of(name),
            "category": category(name),
            "dofs": joint_dofs(name),
            "neutral_deg": pose.get(name, {}),
            "local_pos_mm": [round(float(x), 5) for x in local[name][:3, 3]],
            "local_quat_wxyz": [round(float(x), 6) for x in q],
            "aabb_min_mm": [round(float(x), 4) for x in b[0]],
            "aabb_max_mm": [round(float(x), 4) for x in b[1]],
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    glb_path = out_dir / "fly_body.glb"
    glb_path.write_bytes(scene.export(file_type="glb"))

    head_w = world["c_head"]
    head_mesh_world = (head_w[:3, :3] @ meshes["c_head"].vertices.T).T + head_w[:3, 3]
    head_center_local = np.linalg.inv(head_w) @ np.append(head_mesh_world.mean(axis=0), 1.0)

    rig = {
        "source": "NeuroMechFly v2 (flygym), Apache-2.0, https://github.com/NeLy-EPFL/flygym",
        "units": "mm",
        "up_axis_in_glb": "Y (converted from MuJoCo Z-up; segment-local frames keep MuJoCo axes: x=anterior, y=left, z=up)",
        "dof_axes": {"yaw": "x", "pitch": "y", "roll": "z"},
        "dof_order": list(order),
        "root_node": root_name,
        "ground_offset_mm": round(-ground_z, 4),
        "head_center_local_mm": [round(float(x), 4) for x in head_center_local[:3]],
        "nodes": rig_nodes,
        "legs": legs_meta,
        "wings": wings_meta,
    }
    (out_dir / "fly_rig.json").write_text(json.dumps(rig, indent=2))
    total_faces = sum(len(m.faces) for m in meshes.values())
    print(f"wrote {glb_path} ({glb_path.stat().st_size/1024:.0f} KB, {len(meshes)} segments, {total_faces} faces)")
    print(f"wrote {out_dir / 'fly_rig.json'}  ground offset {rig['ground_offset_mm']} mm")
    for leg, m in legs_meta.items():
        print(f"  {leg}: sweep={m['sweep_dof']}({m['sweep_sign_forward']:+d}) lift={m['lift_dof']}({m['lift_sign_up']:+d}) tip={m['rest_tip_mm']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--flygym-dir", type=Path, help="Path to a flygym checkout (skips cloning)")
    ap.add_argument("--flygym-ref", default="main", help="Git ref to clone (default: main)")
    ap.add_argument("--cache-dir", type=Path, default=REPO_ROOT / ".cache")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "godot" / "assets" / "generated" / "fly")
    ap.add_argument("--pose", default="yaw_pitch_roll.yaml", help="neutral pose file in pose/neutral/")
    ap.add_argument("--max-faces", type=int, default=0, help="decimate segment meshes above this face count (0 = keep)")
    args = ap.parse_args()

    if args.flygym_dir:
        asset_dir = args.flygym_dir / ASSET_SUBDIR if not (args.flygym_dir / "rigging.yaml").exists() else args.flygym_dir
    else:
        asset_dir = ensure_flygym(args.cache_dir, args.flygym_ref)
    build(asset_dir, args.out, args.pose, args.max_faces)


if __name__ == "__main__":
    main()
