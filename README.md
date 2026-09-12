# VFB Fly Explorer

[Virtual Fly Brain](https://virtualflybrain.org) (VFB) anatomy inside a fully
articulated fly body that you can walk around, poke, and show videos to.

Two front ends share one data pipeline:

* **Web app** (`web/`): browser-first, built with Three.js and plain ES modules
  (no bundler, no Godot). Runs on phones, tablets and PCs. This is what Render
  serves.
* **Desktop app** (`godot/`): Godot 4 project exported to Windows, Linux and
  macOS executables.

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

* **Live brain view**: a picture-in-picture camera on the brain, with regions
  glowing by function (seeing, smelling, steering, memory, moving, pain…)
  according to what the fly is doing. Illustrative, not real recordings.
* **Feelings**: a modelled set of drives and affects (pain, pleasure, hunger,
  fear, curiosity, excitement, calm, tiredness, disgust) shown as gauges. They
  rise and fall with pokes, videos, movement and rest, and feed the story.
* **Show it a video** (web): paste a YouTube link (or open `?v=VIDEO_ID`).
  The video plays on a screen standing in the 3D world; the fly turns to face
  it and a reaction plan (mood plus timed beats) drives its behaviour.
  **Fly's eye view** fills your screen with the video seen through a
  compound-eye mosaic, with the brain's visual centres lit up.
* **Live story**: a running plain-language description of what the fly is
  doing, how it feels and what it is paying attention to. Programmatic by
  default; richer lines come from Claude when the API service has a key.

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

Phones and tablets: drag to orbit, pinch to zoom, two-finger drag to pan, tap a
brain part to read about it, on-screen joystick to walk, buttons for Fly / Walk /
Rest / Poke, and a tab bar (The fly · Brain part · Explore · Watch · More).

PC:

| Input | Action |
| --- | --- |
| W / S, ↑ / ↓ | walk forward / backward |
| A / D, ← / → | turn |
| Space, 1 / 2 / 3 | toggle flight; rest / walk / fly |
| Left click | select a brain part (through the head), or poke the body |
| Right-drag / middle-drag / wheel | orbit / pan / zoom |
| F / Home / X | look at brain / look at fly / see-through body |

"More" holds the view toggles, walking speed, and the **Advanced** brain
placement controls (offset in mm in the head frame, and scale).

## Repository layout

```
web/                  Browser-first web app (Three.js, ES modules, no build step)
  index.html, styles.css
  src/main.js         entry: loads assets, wires everything, animation loop
  src/scene.js        renderer, camera/orbit, lights, floor, brain PiP pass
  src/fly.js          GLB loading + procedural rig (gait, flight, reactions)
  src/brain.js        VFB anatomy inside the head, selection, picking
  src/activity.js     functional brain-activity model (glow + meters)
  src/feelings.js     affect model shown as gauges
  src/narrator.js     live doing / feeling / focus text, optional AI lines
  src/video.js        YouTube screen in 3D (CSS3D), fly's-eye view, reaction plans
  src/vfb.js          VFB SOLR client, OBJ/SWC parsers
  src/ui.js           DOM UI, layouts, joystick
  vendor/three/       vendored Three.js + addons
  data/               generated at build time (fly GLB, rig, VFB GLBs)
  test/smoke.py       CI browser smoke test
server/               Optional API service (FastAPI): YouTube metadata, Claude narration
  app.py              /api/health /api/youtube /api/narrate /api/react (all with fallbacks)
  tests/              pytest (no network, Claude client mocked)
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
  scripts/explorer_ui.gd    all UI (built in code; desktop + compact touch layouts)
  scripts/brain_activity.gd functional "activity" model that lights up regions
  scripts/brain_view.gd     picture-in-picture brain camera (visual layer 2)
  scripts/narrator.gd       live doing / feeling / focus text, optional AI lines
  scripts/youtube_watch.gd  YouTube link parsing, metadata, reaction plans & beats
  scripts/web_bridge.gd     JavaScriptBridge wrapper (video overlay, share links)
  scripts/virtual_joystick.gd on-screen joystick
  web/shell.html      custom HTML shell: loading screen, YouTube overlay, config
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

### Web app

```bash
cp -r godot/assets/generated/fly godot/assets/generated/vfb web/data/   # or symlink
python -m http.server 8080 -d web      # any static server works
# open http://localhost:8080/
```

Without the pipeline the app still runs with a boxy placeholder body and no
bundled brain; searching VFB then loads everything live.

### Desktop app

Open `godot/` in the Godot editor and press Play, or headless:

```bash
godot --headless --path godot --import
godot --headless --path godot -s tests/test_parsers.gd
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
2. **export** – Godot 4.4.1 headless export for Linux, Windows, macOS
   (Godot binary and templates are cached).
3. **web** – assembles `web/` plus the generated data into `build/web`,
   syntax-checks the modules and runs a headless-Chromium smoke test.
4. **release** – GitHub Release tagged `build-<run number>` with all archives.
5. **web-publish** – pushes `build/web` to the `web-dist` branch.

Pull requests run steps 1–2 only.

## Deploying the web build (Render)

`render.yaml` defines two services:

* `vfb-fly-explorer` – static site serving the `web-dist` branch (no build step).
* `vfb-fly-explorer-api` – small Python service from `main` (`server/`). It
  holds the **`ANTHROPIC_API_KEY`** secret (declared with `sync: false`, so
  Render asks you for the value when you create the Blueprint; leave it empty
  to run without AI). It also proxies YouTube metadata and builds reaction
  plans. `VFB_MODEL` defaults to `claude-opus-5`; set it to `claude-haiku-4-5`
  for a cheaper narrator.

After the first `main` build has created `web-dist`:

1. Render dashboard → **New +** → **Blueprint**, pick this repository, paste
   your Claude API key when prompted (optional).
2. Render creates both services; every later push to `main` redeploys the API
   and, once CI updates `web-dist`, the site.

The web app looks for the API at `https://vfb-fly-explorer-api.onrender.com`
(set in `web/index.html`). If Render gives your service a different
URL, change it there or open the site with `?api=https://your-service`.
Desktop builds read `VFB_API_BASE` from the environment. Without the API
everything still works: narration and video reactions fall back to the
built-in programmatic versions, and video titles come from noembed.com.

The export is Godot's non-threaded web variant, so no COOP/COEP headers are
needed and cross-origin requests to virtualflybrain.org keep working. The same
branch also works with GitHub Pages if you prefer.

Web caveats: live VFB downloads depend on the browser's CORS rules (the
bundled starter set always works). The YouTube screen is an iframe projected
into the 3D scene, so it starts muted (browsers require a tap to unmute) and
only exists in the web app; desktop builds show the thumbnail and a "Play
reaction" button.

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
