#!/usr/bin/env python3
"""Fetch a starter set of Virtual Fly Brain (VFB) anatomy and convert it for Godot.

Data source: https://virtualflybrain.org (per-dataset licences, mostly CC-BY;
the manifest records the dataset and licence of every object).

Uses VFB's public SOLR index (the same index the VFB web client uses) rather
than the vfb-connect package, because vfb-connect opens a Neo4j connection at
import time and cannot be used offline or behind a strict proxy.

Output (default: godot/assets/generated/vfb/):
  <id>.glb       - one file per neuropil / neuron, coordinates in mm,
                   re-centred on the template centre (see manifest)
  manifest.json  - list of objects with id, label, kind, colour, file,
                   source URLs, dataset/licence, plus the template centre

All network failures are tolerated: whatever could be fetched is written
and the exit code stays 0 unless --strict is given.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshconvert as mc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
SOLR = "https://solr.virtualflybrain.org/solr"
UM_TO_MM = 0.001
UA = {"User-Agent": "vfb-fly-explorer-pipeline/0.1 (+https://github.com/biosphobia/vfb)"}


class Fetcher:
    def __init__(self, timeout: float = 60.0, retries: int = 3, verbose: bool = True):
        self.s = requests.Session()
        self.s.headers.update(UA)
        self.timeout = timeout
        self.retries = retries
        self.verbose = verbose
        self.errors: list[str] = []

    def log(self, msg: str) -> None:
        if self.verbose:
            print(msg, flush=True)

    def get(self, url: str, **kw) -> requests.Response | None:
        delay = 1.0
        for attempt in range(self.retries):
            try:
                r = self.s.get(url, timeout=self.timeout, **kw)
                if r.status_code == 200:
                    return r
                if r.status_code == 404:
                    return None
                self.log(f"  HTTP {r.status_code} for {url}")
            except requests.RequestException as e:  # noqa: PERF203
                self.log(f"  {type(e).__name__} for {url}: {e}")
            time.sleep(delay)
            delay *= 2
        self.errors.append(url)
        return None

    # -- VFB SOLR ---------------------------------------------------------- #
    def term_info(self, short_form: str) -> dict[str, Any] | None:
        r = self.get(f"{SOLR}/vfb_json/select", params={"q": f"id:{short_form}", "fl": "term_info", "wt": "json"})
        if r is None:
            return None
        docs = r.json().get("response", {}).get("docs", [])
        if not docs or not docs[0].get("term_info"):
            return None
        raw = docs[0]["term_info"]
        raw = raw[0] if isinstance(raw, list) else raw
        try:
            return json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            return None

    def resolve_label(self, label: str) -> str | None:
        """Find the FBbt/VFB short form of a class by exact label (falls back to search)."""
        q = f'label:"{label}"'
        r = self.get(f"{SOLR}/ontology/select", params={"q": q, "fl": "short_form,label", "rows": 10, "wt": "json"})
        if r is None:
            return None
        docs = r.json().get("response", {}).get("docs", [])
        for d in docs:
            lab = d.get("label")
            lab = lab[0] if isinstance(lab, list) else lab
            if isinstance(lab, str) and lab.lower() == label.lower():
                sf = d.get("short_form")
                return sf[0] if isinstance(sf, list) else sf
        if docs:
            sf = docs[0].get("short_form")
            return sf[0] if isinstance(sf, list) else sf
        return None


# --------------------------------------------------------------------------- #
def image_urls(image: dict[str, Any]) -> dict[str, str]:
    """Normalise the image dict from term info into {obj, swc, nrrd, thumbnail}."""
    out = {}
    for key in ("image_obj", "image_swc", "image_nrrd", "image_thumbnail"):
        v = image.get(key)
        if isinstance(v, str) and v:
            out[key.replace("image_", "")] = v
    folder = image.get("image_folder") or image.get("folder")
    if folder and "obj" not in out:
        out["obj"] = folder.rstrip("/") + "/volume_man.obj"
        out["obj_alt"] = folder.rstrip("/") + "/volume.obj"
    if folder and "swc" not in out:
        out["swc"] = folder.rstrip("/") + "/volume.swc"
    if folder and "thumbnail" not in out:
        out["thumbnail"] = folder.rstrip("/") + "/thumbnail.png"
    return out


def pick_color(index: int, kind: str) -> list[float]:
    h = (index * 0.618033988749895) % 1.0
    if kind == "neuropil":
        r, g, b = colorsys.hsv_to_rgb(h, 0.35, 0.85)
        return [round(r, 3), round(g, 3), round(b, 3), 0.28]
    r, g, b = colorsys.hsv_to_rgb(h, 0.85, 1.0)
    return [round(r, 3), round(g, 3), round(b, 3), 1.0]


def load_mesh_for(f: Fetcher, urls: dict[str, str], prefer: list[str]):
    """Return (trimesh, source_url, format) or None."""
    for fmt in prefer:
        candidates = [urls.get(fmt)] + ([urls.get("obj_alt")] if fmt == "obj" else [])
        for url in [u for u in candidates if u]:
            r = f.get(url)
            if r is None:
                continue
            try:
                if fmt == "obj":
                    return mc.obj_to_trimesh(r.content), url, fmt
                if fmt == "swc":
                    return mc.swc_to_trimesh(r.content, radius_scale=1.0, min_radius=0.25), url, fmt
            except ValueError as e:
                f.log(f"  could not parse {url}: {e}")
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("vfb_content.json"))
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "godot" / "assets" / "generated" / "vfb")
    ap.add_argument("--strict", action="store_true", help="exit non-zero if anything failed")
    ap.add_argument("--limit", type=int, default=0, help="stop after N objects (smoke runs)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(args.config.read_text())
    prefer = cfg.get("prefer", ["obj", "swc"])
    max_faces = int(cfg.get("max_faces_per_object", 60000))
    f = Fetcher(verbose=not args.quiet)
    args.out.mkdir(parents=True, exist_ok=True)

    objects: list[dict[str, Any]] = []
    meshes = {}
    template_id = cfg.get("template_id", "VFB_00101567")

    # ---- neuropils from the template's painted domains ------------------- #
    f.log(f"template {template_id}: fetching term info")
    tinfo = f.term_info(template_id)
    template_label = cfg.get("template_label", template_id)
    if tinfo:
        template_label = tinfo.get("term", {}).get("core", {}).get("label", template_label)
        domains = tinfo.get("template_domains") or []
        f.log(f"  {len(domains)} template domains")
        max_dom = int(cfg.get("neuropils", {}).get("max", 60))
        for i, dom in enumerate(domains[:max_dom]):
            atype = dom.get("anatomical_type", {}) or {}
            aind = dom.get("anatomical_individual", {}) or {}
            label = atype.get("label") or aind.get("label") or f"domain {i}"
            oid = aind.get("short_form") or atype.get("short_form") or f"domain_{i}"
            urls = image_urls(dom.get("image") or dom)
            f.log(f"  neuropil {oid} {label}")
            got = load_mesh_for(f, urls, ["obj"])
            if not got:
                continue
            mesh, src, fmt = got
            meshes[oid] = mesh
            objects.append({
                "id": oid, "label": label, "kind": "neuropil", "type_id": atype.get("short_form"),
                "template": template_id, "source_url": src, "format": fmt,
                "thumbnail": urls.get("thumbnail"), "color": pick_color(i, "neuropil"),
                "center_um": [round(float(c), 2) for c in (dom.get("center") or [])] or None,
            })
            if args.limit and len(objects) >= args.limit:
                break
    else:
        f.log("  template term info unavailable; skipping neuropils")

    # ---- neurons: examples for each configured class --------------------- #
    neuron_specs: list[tuple[str, str | None, int]] = []
    for spec in cfg.get("neuron_classes", []):
        if args.limit and len(objects) >= args.limit:
            break
        label = spec["label"]
        cid = spec.get("id") or f.resolve_label(label)
        if not cid:
            f.log(f"class '{label}': could not resolve id")
            continue
        info = f.term_info(cid)
        if not info:
            f.log(f"class '{label}' ({cid}): no term info")
            continue
        examples = info.get("anatomy_channel_image") or []
        f.log(f"class '{label}' ({cid}): {len(examples)} example images")
        n = 0
        for ex in examples:
            ci = ex.get("channel_image", {}) or {}
            img = ci.get("image", {}) or {}
            tmpl = (img.get("template_anatomy") or {}).get("short_form")
            if tmpl and tmpl != template_id:
                continue
            anat = ex.get("anatomy", {}) or {}
            nid = anat.get("short_form")
            if not nid or nid in meshes:
                continue
            neuron_specs.append((nid, label, 0))
            n += 1
            if n >= int(spec.get("max_instances", 5)):
                break
    for nid in cfg.get("neuron_ids", []):
        neuron_specs.append((nid, None, 0))

    for k, (nid, class_label, _) in enumerate(neuron_specs):
        if args.limit and len(objects) >= args.limit:
            break
        info = f.term_info(nid)
        if not info:
            f.log(f"neuron {nid}: no term info")
            continue
        core = info.get("term", {}).get("core", {})
        label = core.get("label", nid)
        chans = info.get("channel_image") or []
        img = None
        for ch in chans:
            im = (ch.get("image") or {})
            t = (im.get("template_anatomy") or {}).get("short_form")
            if t == template_id or img is None:
                img = im
                if t == template_id:
                    break
        if img is None:
            f.log(f"neuron {nid} {label}: no images")
            continue
        urls = image_urls(img)
        f.log(f"  neuron {nid} {label}")
        got = load_mesh_for(f, urls, prefer)
        if not got:
            continue
        mesh, src, fmt = got
        meshes[nid] = mesh
        ds = (info.get("dataset_license") or [{}])[0] if info.get("dataset_license") else {}
        objects.append({
            "id": nid, "label": label, "kind": "neuron", "class_label": class_label,
            "template": template_id, "source_url": src, "format": fmt,
            "thumbnail": urls.get("thumbnail"), "color": pick_color(100 + k, "neuron"),
            "dataset": ((ds.get("dataset") or {}).get("core") or {}).get("label"),
            "license": ((ds.get("license") or {}).get("core") or {}).get("label"),
            "description": " ".join(info.get("term", {}).get("description", []) or [])[:600],
        })

    # ---- centre & write --------------------------------------------------- #
    if meshes:
        neuropil_ids = [o["id"] for o in objects if o["kind"] == "neuropil"] or list(meshes)
        allv = np.vstack([meshes[i].vertices for i in neuropil_ids])
        center = 0.5 * (allv.min(axis=0) + allv.max(axis=0))
    else:
        center = np.zeros(3)

    for o in objects:
        mesh = meshes[o["id"]]
        mesh = mc.simplify(mesh, max_faces)
        mesh.vertices = mc.transform_points(mesh.vertices, UM_TO_MM, center)
        fname = f"{o['id']}.glb"
        mc.write_glb(mesh, args.out / fname, node_name=o["id"], rgba=o["color"])
        o["file"] = fname
        o["faces"] = int(len(mesh.faces))

    manifest = {
        "generated_by": "tools/fetch_vfb.py",
        "template": {"id": template_id, "label": template_label},
        "units": "mm",
        "template_center_um": [round(float(c), 3) for c in center],
        "um_to_mm": UM_TO_MM,
        "objects": objects,
        "errors": f.errors,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    n_np = sum(1 for o in objects if o["kind"] == "neuropil")
    n_ne = len(objects) - n_np
    print(f"wrote {args.out / 'manifest.json'}: {n_np} neuropils, {n_ne} neurons, {len(f.errors)} failed requests")
    if args.strict and (f.errors or not objects):
        sys.exit(1)


if __name__ == "__main__":
    main()
