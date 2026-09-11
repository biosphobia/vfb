# VFB Fly Explorer

A Godot 4 app that puts [Virtual Fly Brain](https://virtualflybrain.org) (VFB)
anatomy inside a fully articulated fly body and lets you walk it around in 3D.

* **Body**: [NeuroMechFly v2](https://github.com/NeLy-EPFL/flygym) (EPFL),
  a micro-CT based *Drosophila* model with 69 jointed segments. A procedural
  controller drives a tripod walking gait, wing flapping, and idle behaviours.
* **Brain**: neuropils and neurons from VFB in JRC2018Unisex template space,
  placed inside the head. Click any structure to read its VFB term info.
  Search VFB and load more neurons live from virtualflybrain.org.
* **Reactions**: selecting leg / motor / descending neurons makes the fly walk,
  wing structures make it fly, antennal / olfactory structures twitch the
  antennae, mushroom body / central complex make it "think". Clicking the
  body startles it.

Builds for Windows, Linux, macOS and the web are produced automatically on
every push to `main` (see **Downloads**).

## Downloads

* Executables: the latest [GitHub Release](../../releases/latest)
  (`vfb-fly-explorer-windows.zip`, `-linux.tar.gz`, `-macos.zip`).
  The builds are unsigned: on Windows accept the SmartScreen prompt, on macOS
  right-click → Open the first time.
* Web: served by Render from the `web-dist` branch (see **Deploying the web
  build**). A zip of the web build is attached to every release too.

## Controls

| Input | Action |
| --- | --- |
| W / S, ↑ / ↓ | walk forward / backward |
| A / D, ← / → | turn |
| Space, 1 / 2 / 3 | toggle flight; idle / walk / fly |
| Left click | select neuron / neuropil (through the head), or poke the body |
| Right-drag / middle-drag / wheel | orbit / pan / zoom |
| F / Home / X | focus brain / focus fly / toggle x-ray body |

The bottom bar has behaviour buttons, gait sliders, display toggles, and
**Brain placement** spin boxes to fine-tune where the template brain sits in
the head (mm, head frame) and its scale.

## Repository layout

```
tools/                Python data pipeline (run before opening the Godot project)
  build_fly_body.py   NeuroMechFly meshes + rig  -> godot/assets/generated/fly/fly_body.glb + fly_rig.json
  fetch_vfb.py        VFB starter set (SOLR API) -> godot/assets/generated/vfb/*.glb + manifest.json
  meshconvert.py      OBJ / SWC / NRRD -> trimesh -> GLB
  vfb_content.json    what the starter set contains (edit me)
  tests/              pytest
godot/                Godot 4.4 project
  scenes/main.tscn    entry scene
  scripts/main.gd     orchestrator: world, input, picking, VFB loading
  scripts/fly_rig.gd  gait / flight / idle controller (data-driven from fly_rig.json)
  scripts/brain_anchor.gd   VFB objects inside the head, selection, calibration
  scripts/vfb_client.gd     async VFB SOLR / image client (desktop + web)
  scripts/obj_parser.gd, swc_parser.gd, mesh_util.gd   runtime mesh loading
  scripts/explorer_ui.gd    all UI (built in code)
  scripts/placeholder_fly.gd  boxy stand-in body when the pipeline has not run
  assets/fly_rig_default.json  rig metadata derived from NeuroMechFly (committed)
  export_presets.cfg  Linux / Windows / macOS / Web presets
  tests/test_parsers.gd  headless self-test
.github/workflows/build.yml   CI: pipeline -> exports -> release + web-dist branch
render.yaml           Render static site serving the web build
```

## Building locally

Requirements: Python 3.11+, Godot 4.4.1 (editor or headless), git.

```bash
python -m venv venv && . venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r tools/requirements.txt fast-simplification
python -m pytest tools/tests -q

python tools/build_fly_body.py    # sparse-clones flygym into .cache/, writes godot/assets/generated/fly/
python tools/fetch_vfb.py         # downloads the VFB starter set into godot/assets/generated/vfb/
```

Then open `godot/` in the Godot editor and press Play, or headless:

```bash
godot --headless --path godot --import
godot --headless --path godot -s tests/test_parsers.gd
godot --headless --path godot --export-release "Web" ../build/web/index.html
godot --headless --path godot --export-release "Linux" ../build/linux/vfb-fly-explorer.x86_64
```

Export templates for 4.4.1 must be installed (`Editor → Manage Export Templates`,
or see the workflow for the headless download). Without the pipeline the app
still runs with a boxy placeholder body and no bundled brain; searching VFB
then loads everything live.

### Choosing what gets bundled

`tools/vfb_content.json` lists the template (JRC2018Unisex), how many painted
neuropil domains to include, and neuron classes to sample example images from
(by label, resolved through VFB's search index at build time). Add explicit
`neuron_ids` (VFB short forms) for specific cells. Everything else can be loaded
at runtime from the search box.

## CI and releases

`.github/workflows/build.yml` runs on every push to `main`:

1. **assets** – pytest, `build_fly_body.py`, `fetch_vfb.py` (tolerant: whatever
   VFB serves gets bundled; the step summary reports the counts).
2. **export** – Godot 4.4.1 headless export for Linux, Windows, macOS, Web
   (Godot binary and templates are cached).
3. **release** – GitHub Release tagged `build-<run number>` with all archives.
4. **web-publish** – pushes `build/web` to the `web-dist` branch.

Pull requests run steps 1–2 only.

## Deploying the web build (Render)

`render.yaml` defines a static site that serves the `web-dist` branch with no
build step. After the first `main` build has created that branch:

1. Render dashboard → **New +** → **Blueprint**, pick this repository.
2. Render creates the `vfb-fly-explorer` static site; every later push to
   `main` redeploys automatically once CI updates `web-dist`.

The export is Godot's non-threaded web variant, so no COOP/COEP headers are
needed and cross-origin requests to virtualflybrain.org keep working. The same
branch also works with GitHub Pages if you prefer.

Web caveats: no shadows, first load is ~45 MB of wasm, and live VFB downloads
depend on the browser's CORS rules (the bundled starter set always works).

## Coordinate frames

* World units are **millimetres**; the fly is about 3 mm long.
* NeuroMechFly is Z-up; the GLB root rotates it to Godot's Y-up. Segment-local
  frames keep MuJoCo axes (x anterior, y left, z up); joints rotate
  `rest * Rx(yaw) * Ry(pitch) * Rz(roll)`, matching MuJoCo's hinge order.
* VFB meshes are in template micrometres. The pipeline re-centres them on the
  template centre and scales to mm. `BrainAnchor` maps template axes to the
  head frame (x_template → +y head, y_template → −z head, z_template → −x head)
  and sits at the head-mesh centroid from `fly_rig.json`. Use the calibration
  spin boxes to refine; the default is an approximation, not a registration.

## Licences

Code: MIT. Data: NeuroMechFly (Apache-2.0) and VFB datasets (per-dataset,
mostly CC-BY) – see `THIRD_PARTY_NOTICES.md`.
