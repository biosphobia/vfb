"""Mesh conversion helpers shared by the data pipeline.

Everything is converted into a trimesh.Trimesh and then written as a binary
glTF (.glb) so the Godot project can import it directly.

Supported inputs:
  * Wavefront OBJ text (VFB neuropil / neuron surface meshes)
  * SWC skeletons (VFB neuron reconstructions) -> tube meshes
  * NRRD volumes (VFB image stacks) -> iso-surface via marching cubes
"""
from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import trimesh


# --------------------------------------------------------------------------- #
# OBJ
# --------------------------------------------------------------------------- #
def obj_to_trimesh(obj_text: str | bytes) -> trimesh.Trimesh:
    """Parse OBJ text. Handles 'v', 'f' (with optional /vt/vn), polygons > 3."""
    if isinstance(obj_text, bytes):
        obj_text = obj_text.decode("utf-8", errors="replace")
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    for line in obj_text.splitlines():
        if not line or line[0] == "#":
            continue
        parts = line.split()
        if not parts:
            continue
        tag = parts[0]
        if tag == "v" and len(parts) >= 4:
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif tag == "f" and len(parts) >= 4:
            idx = []
            for p in parts[1:]:
                tok = p.split("/")[0]
                if not tok:
                    continue
                i = int(tok)
                idx.append(i - 1 if i > 0 else len(verts) + i)
            for k in range(1, len(idx) - 1):  # fan triangulation
                faces.append([idx[0], idx[k], idx[k + 1]])
    if not verts or not faces:
        raise ValueError("OBJ contained no geometry")
    mesh = trimesh.Trimesh(vertices=np.asarray(verts, dtype=np.float64),
                           faces=np.asarray(faces, dtype=np.int64),
                           process=True)
    return mesh


# --------------------------------------------------------------------------- #
# SWC
# --------------------------------------------------------------------------- #
def parse_swc(swc_text: str | bytes) -> np.ndarray:
    """Return array of rows [id, type, x, y, z, radius, parent]."""
    if isinstance(swc_text, bytes):
        swc_text = swc_text.decode("utf-8", errors="replace")
    rows = []
    for line in swc_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        rows.append([float(p) for p in parts[:7]])
    if not rows:
        raise ValueError("SWC contained no nodes")
    return np.asarray(rows, dtype=np.float64)


def _tube_segment(a: np.ndarray, b: np.ndarray, radius: float, sides: int) -> tuple[np.ndarray, np.ndarray]:
    """Vertices/faces for an open prism between points a and b."""
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 1e-9:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    d /= length
    # Build an orthonormal frame around d
    helper = np.array([1.0, 0.0, 0.0]) if abs(d[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(d, helper)
    u /= np.linalg.norm(u)
    v = np.cross(d, u)
    ring = []
    for i in range(sides):
        ang = 2.0 * math.pi * i / sides
        ring.append(math.cos(ang) * u + math.sin(ang) * v)
    ring = np.asarray(ring) * radius
    verts = np.vstack([a + ring, b + ring])
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append([i, j, sides + i])
        faces.append([j, sides + j, sides + i])
    return verts, np.asarray(faces, dtype=np.int64)


def swc_to_trimesh(swc_text: str | bytes, radius_scale: float = 1.0,
                   min_radius: float = 0.15, sides: int = 6,
                   max_segments: int | None = None) -> trimesh.Trimesh:
    """Convert an SWC skeleton into a tube mesh (one prism per edge)."""
    rows = parse_swc(swc_text)
    ids = rows[:, 0].astype(np.int64)
    id_to_index = {int(i): k for k, i in enumerate(ids)}
    xyz = rows[:, 2:5]
    radii = np.maximum(rows[:, 5] * radius_scale, min_radius)
    parents = rows[:, 6].astype(np.int64)

    all_v = []
    all_f = []
    offset = 0
    count = 0
    for k in range(len(rows)):
        p = int(parents[k])
        if p < 0 or p not in id_to_index:
            continue
        pi = id_to_index[p]
        r = 0.5 * (radii[k] + radii[pi])
        v, f = _tube_segment(xyz[pi], xyz[k], r, sides)
        if len(v) == 0:
            continue
        all_v.append(v)
        all_f.append(f + offset)
        offset += len(v)
        count += 1
        if max_segments and count >= max_segments:
            break
    if not all_v:
        raise ValueError("SWC produced no segments")
    mesh = trimesh.Trimesh(vertices=np.vstack(all_v), faces=np.vstack(all_f), process=False)
    return mesh


# --------------------------------------------------------------------------- #
# NRRD
# --------------------------------------------------------------------------- #
def nrrd_to_trimesh(path: str | Path, level: float | None = None,
                    step: int = 2) -> trimesh.Trimesh:
    """Iso-surface a NRRD volume with marching cubes (in physical units)."""
    import nrrd  # pynrrd
    from skimage import measure

    data, header = nrrd.read(str(path))
    data = np.asarray(data)
    if data.ndim == 4:  # drop channel axis if present
        data = data[0]
    if level is None:
        nonzero = data[data > 0]
        level = float(np.percentile(nonzero, 50)) if nonzero.size else 0.5
    spacing = _nrrd_spacing(header)
    verts, faces, _normals, _vals = measure.marching_cubes(
        data, level=level, spacing=spacing, step_size=step)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    return mesh


def _nrrd_spacing(header: dict) -> tuple[float, float, float]:
    if "space directions" in header:
        dirs = header["space directions"]
        sp = []
        for row in dirs:
            if row is None or (hasattr(row, "__len__") and all(x is None for x in row)):
                continue
            arr = np.asarray(row, dtype=np.float64)
            sp.append(float(np.linalg.norm(arr)))
        if len(sp) == 3:
            return (sp[0], sp[1], sp[2])
    if "spacings" in header:
        sp = [float(s) for s in header["spacings"] if s is not None][:3]
        if len(sp) == 3:
            return (sp[0], sp[1], sp[2])
    return (1.0, 1.0, 1.0)


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def simplify(mesh: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    """Reduce face count if a decimation backend is available."""
    if max_faces <= 0 or len(mesh.faces) <= max_faces:
        return mesh
    try:
        out = mesh.simplify_quadric_decimation(face_count=max_faces)
        if len(out.faces) > 0:
            return out
    except BaseException:  # noqa: BLE001 - optional dependency (fast_simplification) missing
        pass
    return mesh


def apply_color(mesh: trimesh.Trimesh, rgba: Sequence[float], name: str = "material") -> None:
    rgba = list(rgba) + [1.0] * (4 - len(rgba))
    mesh.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name=name,
            baseColorFactor=[float(c) for c in rgba[:4]],
            metallicFactor=0.0,
            roughnessFactor=0.7,
            alphaMode="BLEND" if rgba[3] < 0.999 else "OPAQUE",
        )
    )


def write_glb(mesh: trimesh.Trimesh, path: str | Path, node_name: str,
              rgba: Sequence[float] | None = None) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if rgba is not None:
        apply_color(mesh, rgba, name=f"{node_name}_mat")
    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name=node_name, geom_name=node_name)
    path.write_bytes(scene.export(file_type="glb"))
    return path


def transform_points(points: np.ndarray, scale: float, offset: Iterable[float]) -> np.ndarray:
    return (np.asarray(points, dtype=np.float64) - np.asarray(list(offset), dtype=np.float64)) * scale


def synthetic_obj(radius: float = 1.0, n: int = 12) -> str:
    """Small UV sphere OBJ string used by tests and for smoke runs."""
    m = trimesh.creation.icosphere(subdivisions=2, radius=radius)
    buf = io.StringIO()
    for v in m.vertices:
        buf.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
    for f in m.faces:
        buf.write(f"f {f[0]+1} {f[1]+1} {f[2]+1}\n")
    return buf.getvalue()
