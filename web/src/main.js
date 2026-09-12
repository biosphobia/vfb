// VFB Fly Explorer – entry point. World units are millimetres.
// Sensory input → BrainModel (named populations) → descending readout → FlyRig.
import * as THREE from 'three';
import { SceneRig, LAYER_BODY, LAYER_BRAIN } from './scene.js';
import { loadFlyModel, placeholderFly, FlyRig } from './fly.js';
import { Brain } from './brain.js';
import { AnatomyGlow } from './activity.js';
import { BrainModel, POPULATIONS } from './brainmodel.js';
import { VisualInput, StimulusCanvas } from './vision.js';
import { Narrator } from './narrator.js';
import * as vfb from './vfb.js';
import { Screen } from './screen.js';
import { UI } from './ui.js';

const CFG = window.VFB_CONFIG || {};
const DATA = CFG.dataBase || 'data/';
const FLOOR_RADIUS = 30;

const ui = new UI();
const rigScene = new SceneRig(document.getElementById('gl'), document.getElementById('css3d'), { shadows: !ui.touch });
const { scene, camera } = rigScene;

async function loadJson(url) { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } }

async function boot() {
  ui.setLoading('Loading the fly…');
  let rigData = await loadJson(DATA + 'fly/fly_rig.json'); if (!rigData) rigData = await loadJson('data-default/fly_rig_default.json');
  const manifest = await loadJson(DATA + 'vfb/manifest.json');

  const fly = new THREE.Group(); fly.name = 'Fly'; scene.add(fly);
  let model = null; let placeholder = false;
  try { model = await loadFlyModel(DATA + 'fly/fly_body.glb', (e) => { if (e.total) ui.setLoading(`Loading the fly… ${Math.round(100 * e.loaded / e.total)}%`); }); }
  catch { model = placeholderFly(rigData); placeholder = true; }
  model.position.y = rigData.ground_offset_mm || 0; fly.add(model);
  const rig = new FlyRig(model, rigData);
  const head = model.getObjectByName('c_head') || model;
  const brain = new Brain(head, rigData.head_center_local_mm || [0.2, 0, 0.02]);
  if (manifest) { brain.templateCenterUm = manifest.template_center_um || [0, 0, 0]; brain.umToMm = manifest.um_to_mm || 0.001; brain.centerKnown = true; }
  rigScene.pipTarget = brain.group;

  const bm = new BrainModel();
  const glow = new AnatomyGlow(brain);
  const vision = new VisualInput();
  const stim = new StimulusCanvas();
  const screen = new Screen(scene, camera, CFG.apiBase);
  const narrator = new Narrator(CFG.apiBase);
  narrator.onUpdate = (d, f, lines) => ui.setStory(d, f, lines);
  narrator.onLine = (t, ai) => ui.addStoryLine(t, ai);
  narrator.onAi = (on) => ui.setAiAvailable(on);

  // ---------------- state
  const bodyMeshes = []; model.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });
  const xrayMat = new THREE.MeshStandardMaterial({ color: 0xbf9a66, transparent: true, opacity: 0.16, depthWrite: true, roughness: 0.7 });
  let xray = false; let flyYaw = 0; let selectedLabel = ''; let ctxTimer = 0; let escapeFlash = 0;
  const timed = { poke: 0, harsh: 0, sugar: 0, bitter: 0 }; const opto = { walk: 0, gf: 0, dfb: 0 };
  const raycaster = new THREE.Raycaster();
  function setXray(on) { xray = on; ui.el.optXray.checked = on; for (const m of bodyMeshes) { if (!m.userData.origMat) m.userData.origMat = m.material; m.material = on ? xrayMat : m.userData.origMat; } }
  function focus(what) {
    if (what === 'brain') { rigScene.follow = null; ui.el.optFollow.checked = false; const b = brain.box(); if (b) { const c = new THREE.Vector3(); b.getCenter(c); rigScene.focusOn(c, Math.max(0.3, b.getSize(new THREE.Vector3()).length() * 0.5)); } else rigScene.focusOn(brain.worldCenter(), 0.6); }
    else if (what === 'screen') { rigScene.follow = null; ui.el.optFollow.checked = false; rigScene.lookOverShoulder(fly.position.clone(), screen.worldPosition()); }
    else { rigScene.follow = fly; ui.el.optFollow.checked = true; rigScene.focusOn(fly.position.clone().add(rigScene.followOffset), 3.2); }
  }
  function colorFor(id, kind) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return new THREE.Color().setHSL((h % 1000) / 1000, kind === 'neuropil' ? 0.45 : 0.85, kind === 'neuropil' ? 0.6 : 0.55); }
  const cssColor = (c) => c ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})` : '#ccc';

  // ---------------- bundled anatomy
  if (manifest) {
    ui.setLoading('Loading the brain map…');
    const n = await brain.loadBundled(manifest, DATA + 'vfb/', (i, total, o) => { ui.setLoading(`Loading the brain map… ${i} of ${total}`); ui.addLoaded(o.id, o.label || o.id, o.kind || 'neuron', cssColor(o.color)); });
    const b = brain.box(); if (b) rigScene.pipRadius = Math.max(0.2, b.getSize(new THREE.Vector3()).length() * 0.5);
    ui.setStatus(`Ready. ${n} brain regions and neurons are in place.`);
  } else ui.setStatus('Ready. Search Virtual Fly Brain to add anatomy.');
  ui.setLoading(null);
  console.log(`VFB Fly Explorer (web): ${placeholder ? 'placeholder body' : 'NeuroMechFly body, ' + rig.jointCount + ' joints'} | ${manifest ? (manifest.objects || []).length + ' bundled VFB objects' : 'no bundled VFB set'} | circuit model v1`);

  // ---------------- selection / terms
  const termCache = new Map();
  async function term(id) { if (termCache.has(id)) return termCache.get(id); const info = await vfb.termInfo(id).catch(() => null); if (info) termCache.set(id, info); return info; }
  function selectObject(id) {
    const sel = brain.select(id); ui.highlightLoaded(sel); selectedLabel = '';
    if (!sel) return; const o = brain.objects.get(sel); selectedLabel = o.label; showTerm(sel, o);
  }
  async function showTerm(id, obj) {
    ui.setStatus(`Reading about ${id}…`);
    const info = await term(id);
    if (!info) { ui.setStatus('Could not reach Virtual Fly Brain right now.'); return; }
    const s = vfb.summaryOf(info); const images = vfb.imagesOf(info); const examples = vfb.examplesOf(info); const domains = vfb.domainsOf(info);
    let extra = '';
    if (domains.length) { extra += `<p><b>${domains.length} regions</b> are listed under Explore – pick one, then “Show it inside the fly”.</p>`; ui.setResults(domains.map((d) => ({ id: d.id, label: d.label, facets: ['Individual'] }))); }
    else if (examples.length) { extra += `<p><b>${examples.length} example neurons</b> are listed under Explore – pick one, then “Show it inside the fly”.</p>`; ui.setResults(examples.map((e) => ({ id: e.id, label: e.label, facets: ['Individual'] }))); }
    const pops = glow.describe(s.label || obj?.label || '', obj?.kind || (s.types || []).some((t) => /neuropil|region/i.test(t)) ? 'neuropil' : 'neuron');
    ui.setTermInfo(s, images.length > 0, extra, pops); ui.setStatus('');
    if (images[0]?.thumbnail) ui.setThumbnail(images[0].thumbnail);
  }
  async function loadRemote(id) {
    if (!id) return; if (brain.has(id)) { selectObject(id); return; }
    const info = await term(id); if (!info) { ui.setStatus('Could not reach Virtual Fly Brain right now.'); return; }
    const s = vfb.summaryOf(info); const images = vfb.imagesOf(info); if (!images.length) { ui.setStatus('This one has no 3D shape to show.'); return; }
    const templateId = manifest?.template?.id || 'VFB_00101567'; const img = images.find((i) => i.template === templateId) || images[0];
    if (img.template && img.template !== templateId) ui.setStatus('This shape comes from a different brain template, so its position is approximate.');
    let kind = (s.types || []).some((t) => /neuropil|region/i.test(t)) ? 'neuropil' : 'neuron';
    const offset = brain.centerKnown ? brain.templateCenterUm : [0, 0, 0]; let geom = null, fmt = '';
    for (const key of ['obj', 'objAlt']) { if (!img[key]) continue; ui.setStatus(`Downloading the 3D shape of ${s.label}…`); try { const r = await fetch(img[key]); if (!r.ok) continue; geom = vfb.parseObj(await r.text(), brain.umToMm, offset); fmt = 'obj'; if (geom.attributes.position.count > 0) break; geom = null; } catch { geom = null; } }
    if (!geom && img.swc) { ui.setStatus(`Downloading the skeleton of ${s.label}…`); try { const r = await fetch(img.swc); if (r.ok) { geom = vfb.parseSwc(await r.text(), brain.umToMm, offset); fmt = 'swc'; kind = 'neuron'; } } catch { geom = null; } }
    if (!geom || geom.attributes.position.count === 0) { ui.setStatus('Sorry, that shape could not be loaded.'); return; }
    const color = colorFor(id, kind); const meta = { format: fmt };
    if (!brain.centerKnown) { brain.learnCenterFromGeometry(geom); meta.position = new THREE.Vector3(-brain.templateCenterUm[0] * brain.umToMm, -brain.templateCenterUm[1] * brain.umToMm, -brain.templateCenterUm[2] * brain.umToMm); }
    brain.add(id, s.label || id, kind, geom, color, meta); ui.addLoaded(id, s.label || id, kind, '#' + color.getHexString());
    ui.setStatus(`${s.label} is now inside the fly.`); selectObject(id);
  }
  async function doSearch(t) {
    t = (t || '').trim(); if (!t) return; if (vfb.looksLikeId(t)) { showTerm(t); return; }
    ui.setStatus(`Searching Virtual Fly Brain for “${t}”…`);
    try { const items = await vfb.search(t); ui.setResults(items); ui.setStatus(items.length ? `${items.length} results. Tap one to read about it.` : 'Nothing found. Try another word.'); } catch { ui.setStatus('Could not reach Virtual Fly Brain right now.'); }
  }

  // ---------------- visual input sources
  let thisTabCapture = false;
  function describeEyes() {
    const src = vision.source;
    if (src === 'display') return thisTabCapture ? 'Eyes: seeing this tab (the screen region is sampled).' : 'Eyes: seeing your shared screen / window.';
    if (src === 'camera') return 'Eyes: seeing through your camera.';
    if (src === 'file') return 'Eyes: watching your video file.';
    if (src === 'stimulus') return `Eyes: watching the ${stim.kind} stimulus.`;
    return screen.mode === 'youtube' ? 'Eyes: nothing readable. The YouTube player is on the screen but its pixels cannot be read; use Share screen / tab.' : 'Eyes: nothing in view.';
  }
  function refreshEyes() { ui.setEyeStatus(describeEyes()); }
  vision.onChange = () => { refreshEyes(); };
  ui.el.srcShare.addEventListener('click', async () => {
    try { await vision.shareScreen(); }
    catch (e) { ui.setStatus(e.message || 'Screen sharing was cancelled.'); return; }
    // Heuristic: sharing this very tab → sample the projected screen region instead of mirroring the capture.
    await new Promise((r) => setTimeout(r, 400));
    const vw = vision.video.videoWidth, vh = vision.video.videoHeight;
    thisTabCapture = vision.displaySurface === 'browser' && Math.abs(vw / vh - window.innerWidth / window.innerHeight) < 0.08;
    if (!thisTabCapture) screen.showTexture(vision.texture);
    ui.setStatus(thisTabCapture ? 'Sharing this tab: the fly now sees whatever is on its screen.' : 'The fly now sees your shared screen on its screen.');
    focus('screen'); refreshEyes();
  });
  ui.el.srcCamera.addEventListener('click', async () => { try { await vision.useCamera(); screen.showTexture(vision.texture); ui.setStatus('The fly now sees through your camera.'); focus('screen'); } catch (e) { ui.setStatus(e.message || 'Camera not available.'); } });
  ui.el.srcFile.addEventListener('change', () => { const f = ui.el.srcFile.files?.[0]; if (!f) return; vision.useFile(f); screen.showTexture(vision.texture); ui.setStatus(`The fly is watching ${f.name}.`); focus('screen'); });
  ui.el.srcStop.addEventListener('click', () => { vision.stop(); thisTabCapture = false; if (screen.mode !== 'youtube') screen.off(); ui.setStatus('Visual input stopped.'); refreshEyes(); });
  for (const b of document.querySelectorAll('button[data-stim]')) b.addEventListener('click', () => startStim(b.dataset.stim));
  function startStim(kind) {
    if (kind === 'blank') { vision.stop(); screen.off(); refreshEyes(); return; }
    const map = { loom: ['loom', {}], 'grating-l': ['grating', { dir: -1 }], 'grating-r': ['grating', { dir: 1 }], object: ['object', {}], flicker: ['flicker', {}] };
    const [k, params] = map[kind]; stim.start(k, params); vision.useStimulus(stim); screen.showTexture(stim.texture); thisTabCapture = false;
    ui.setStatus({ loom: 'Looming disc: watch LPLC2 and the giant fiber.', grating: 'Drifting grating: watch T4/T5 → HS → DNa02 (optomotor turning).', object: 'Moving bar: watch LC11 and fixation.', flicker: 'Flicker: watch L1/L2 and arousal.' }[k]);
    focus('screen'); refreshEyes();
  }
  ui.el.loomM.addEventListener('click', () => startStim('loom'));
  // YouTube (display only)
  function startVideo(text) { screen.loadYouTube(text).then((ok) => { if (!ok) { ui.setStatus("That doesn't look like a YouTube link."); return; } ui.el.linkInput.value = ''; ui.setStatus('Video on the screen. Share this tab (PC) so the fly can see it.'); ui.showTab('eyes'); focus('screen'); }); }
  screen.onChange = () => { ui.setVideo(screen.mode === 'youtube' ? screen.yt : null); ui.setMuted(screen.muted); ui.setPlaying(screen.playing); refreshEyes(); };
  screen.onPlaying = (on) => ui.setPlaying(on);
  ui.el.linkForm.addEventListener('submit', (e) => { e.preventDefault(); startVideo(ui.el.linkInput.value); });
  ui.el.linkPaste.addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); if (t) { ui.el.linkInput.value = t; startVideo(t); return; } } catch {} ui.el.linkInput.focus(); });
  ui.el.videoStop.addEventListener('click', () => { screen.off(); refreshEyes(); });
  ui.el.videoPlay.addEventListener('click', () => screen.togglePlay());
  ui.el.videoMute.addEventListener('click', () => ui.setMuted(screen.toggleMute()));
  ui.el.videoShare.addEventListener('click', async () => { const url = `${location.origin}${location.pathname}?v=${screen.yt?.id || ''}`; try { await navigator.clipboard.writeText(url); ui.setStatus('Link copied: ' + url); } catch { prompt('Copy this link', url); } });
  ui.el.openEye.addEventListener('click', () => ui.openEye());
  ui.el.eyeClose.addEventListener('click', () => ui.closeEye());

  // ---------------- stimuli & optogenetics
  const stimulus = (k, sec) => { timed[k] = sec; ui.setStatus({ poke: 'Light touch: bristle mechanosensory neurons fire.', harsh: 'Harsh poke: nociceptors fire → escape and a PPL1 punishment signal.', sugar: 'Sugar on the tarsi: Gr5a neurons fire, gated by hunger.', bitter: 'Bitter: Gr66a neurons fire → aversion, backing away.' }[k]); };
  ui.el.poke.addEventListener('click', () => stimulus('poke', 0.4)); ui.el.pokeM.addEventListener('click', () => stimulus('poke', 0.4));
  ui.el.pokeHarsh.addEventListener('click', () => stimulus('harsh', 0.4));
  ui.el.sugar.addEventListener('click', () => stimulus('sugar', 2.0)); ui.el.sugarM.addEventListener('click', () => stimulus('sugar', 2.0));
  ui.el.bitter.addEventListener('click', () => stimulus('bitter', 2.0));
  for (const b of document.querySelectorAll('button.opto')) b.addEventListener('click', () => { const k = b.dataset.opto; opto[k] = opto[k] ? 0 : 1; ui.setOpto(k, !!opto[k]); ui.setStatus(opto[k] ? { walk: 'Optogenetic: DNp09 activated → walking.', gf: 'Optogenetic: giant fiber activated → takeoff.', dfb: 'Optogenetic: dFB activated → sleep.' }[k] : 'Optogenetic activation off.'); });

  // ---------------- other UI wiring
  ui.onResult = (id) => showTerm(id); ui.onSelectLoaded = (id) => selectObject(id);
  ui.el.partLoad.addEventListener('click', () => loadRemote(ui.currentTermId));
  ui.el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); doSearch(ui.el.searchInput.value); });
  ui.el.addAll.addEventListener('click', async () => { if (!manifest) return; const n = await brain.loadBundled(manifest, DATA + 'vfb/', (i, total, o) => ui.addLoaded(o.id, o.label || o.id, o.kind || 'neuron', cssColor(o.color))); ui.setStatus(`Added ${n} regions and neurons.`); });
  ui.el.clearAll.addEventListener('click', () => { brain.clear(); ui.clearLoaded(); });
  ui.el.objToggle.addEventListener('click', () => { const id = ui.selectedLoaded; if (!id) return; const hidden = ui.isLoadedHidden(id); brain.setVisible(id, hidden); ui.setLoadedVisible(id, hidden); });
  ui.el.objRemove.addEventListener('click', () => { const id = ui.selectedLoaded; if (!id) return; brain.remove(id); ui.removeLoaded(id); });
  ui.el.bbBrain.addEventListener('click', () => focus('brain')); ui.el.bbScreen.addEventListener('click', () => focus('screen'));
  ui.el.focusBrain.addEventListener('click', () => focus('brain')); ui.el.focusFly.addEventListener('click', () => focus('fly')); ui.el.focusScreen.addEventListener('click', () => focus('screen'));
  ui.el.bbXray.addEventListener('click', () => setXray(!xray)); ui.el.optXray.addEventListener('change', () => setXray(ui.el.optXray.checked));
  ui.el.optBody.addEventListener('change', () => { model.visible = ui.el.optBody.checked; });
  ui.el.optBrain.addEventListener('change', () => brain.setAllVisible(ui.el.optBrain.checked));
  ui.el.optFollow.addEventListener('change', () => { rigScene.follow = ui.el.optFollow.checked ? fly : null; });
  ui.el.optHz.addEventListener('input', () => { rig.stepHz = +ui.el.optHz.value; }); ui.el.optStride.addEventListener('input', () => { rig.strideDeg = +ui.el.optStride.value; });
  for (const el of [ui.el.calX, ui.el.calY, ui.el.calZ, ui.el.calS]) el.addEventListener('input', () => { brain.userOffset.set(+ui.el.calX.value || 0, +ui.el.calY.value || 0, +ui.el.calZ.value || 0); brain.userScale = +ui.el.calS.value || 1; brain.applyCalibration(); });
  ui.el.pip.addEventListener('click', () => { setXray(true); focus('brain'); });
  ui.el.aiCheck.addEventListener('change', () => { narrator.aiEnabled = ui.el.aiCheck.checked; });
  focus('fly'); refreshEyes();

  // ---------------- picking (click without drag)
  const canvas = rigScene.canvas; let pressPos = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') pressPos = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => { if (!pressPos) return; const d = Math.hypot(e.clientX - pressPos.x, e.clientY - pressPos.y); pressPos = null; if (d < 8) pick(e.clientX, e.clientY); });
  function pick(x, y) {
    raycaster.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
    if (brain.visible) { raycaster.layers.set(LAYER_BRAIN); const hits = raycaster.intersectObject(brain.group, true).filter((h) => h.object.visible); if (hits.length) { selectObject(hits[0].object.userData.vfbId); return; } }
    if (model.visible) { raycaster.layers.set(LAYER_BODY); const hits = raycaster.intersectObject(model, true); if (hits.length) { const seg = (hits[0].object.parent?.name || hits[0].object.name || 'body').replace(/^[lrc]_|^[lr][fmh]_/, '').replace(/_/g, ' '); ui.setStatus(`You touched the fly's ${seg}: bristle neurons fire.`); stimulus('poke', 0.4); brain.select(''); ui.highlightLoaded(''); return; } }
    brain.select(''); ui.highlightLoaded('');
  }
  const keys = new Set();
  window.addEventListener('keydown', (e) => { if (ui.isTyping()) return; keys.add(e.code); if (e.code === 'KeyF') focus('brain'); if (e.code === 'Home') focus('fly'); if (e.code === 'KeyX') setXray(!xray); });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const v = new URLSearchParams(location.search).get('v'); if (v) setTimeout(() => startVideo(v), 400);

  // ---------------- main loop
  const clock = new THREE.Clock(); const flyPos = fly.position; const tmp = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    // 1. sensory input
    if (vision.source === 'stimulus') stim.update(dt);
    if (vision.source === 'display' && thisTabCapture) vision.region = screen.projectedRegion(); else vision.region = null;
    if (vision.sample()) bm.see(vision.lum, dt); else bm.noVision();
    for (const k in timed) timed[k] = Math.max(0, timed[k] - dt);
    bm.input.poke = timed.poke > 0 || timed.harsh > 0 ? 1 : 0; bm.input.harsh = timed.harsh > 0 ? 1 : 0; bm.input.sugar = timed.sugar > 0 ? 1 : 0; bm.input.bitter = timed.bitter > 0 ? 1 : 0;
    let fwd = 0, turn = 0;
    if (!ui.isTyping()) { if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) turn -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) turn += 1; }
    const js = ui.joystick; if (Math.hypot(js.x, js.y) > 0.05) { fwd = js.y; turn = js.x; }
    bm.input.nudge = { fwd, turn }; bm.input.opto = opto;
    // 2. brain
    const out = bm.step(dt);
    if (out.escape) escapeFlash = 1; escapeFlash = Math.max(0, escapeFlash - dt * 2);
    // 3. body
    rig.applyMotor(out);
    // gaze / orientation toward a fixated object or the screen when it is the visual source
    if (bm.hasVision && vision.source !== 'none' && !thisTabCapture) { const sp = screen.worldPosition(); const dist = Math.hypot(sp.x - flyPos.x, sp.z - flyPos.z); rig.lookPitchDeg = -THREE.MathUtils.clamp(Math.atan2(sp.y - 1.3, dist) * 180 / Math.PI * 0.6, 0, 25); rig.lookYawDeg = -bm.signals.objAz * 25 * bm.rate.LC11; }
    else { rig.lookPitchDeg = 0; rig.lookYawDeg = 0; }
    flyYaw -= rig.turnRate * dt; fly.rotation.y = flyYaw;   // model: positive turn = clockwise (right)
    tmp.set(Math.cos(flyYaw), 0, -Math.sin(flyYaw)).multiplyScalar(rig.forwardSpeed * dt); flyPos.add(tmp);
    const rad = Math.hypot(flyPos.x, flyPos.z); if (rad > FLOOR_RADIUS - 2) { flyPos.x *= (FLOOR_RADIUS - 2) / rad; flyPos.z *= (FLOOR_RADIUS - 2) / rad; flyYaw += dt * 1.5; }
    // keep the fly from walking through the screen stand
    const sp = screen.worldPosition(); const dsx = flyPos.x - sp.x, dsz = flyPos.z - sp.z; const ds = Math.hypot(dsx, dsz); if (ds < 3.2) { flyPos.x = sp.x + dsx / ds * 3.2; flyPos.z = sp.z + dsz / ds * 3.2; }
    flyPos.y = rig.hover;
    rig.update(dt); glow.update(dt, bm.rate, out); narrator.update(dt);
    ui.recordRates(bm.rate); ui.drawMonitor(); ui.drawEye(bm, escapeFlash);
    ctxTimer += dt;
    if (ctxTimer > 0.2) {
      ctxTimer = 0;
      narrator.setContext(bm, { hasVision: bm.hasVision, source: vision.source, selectedLabel });
      ui.setMeters(bm.rate); ui.setStates(bm.state, bm.dominantState()); ui.updateScience(bm.rate);
    }
    rigScene.update(dt); rigScene.render(ui.pipRect());
  }
  window.__vfb = { bm, vision, stim, screen, rig };   // debug / test hook
  frame();
}
boot().catch((e) => { console.error(e); ui.setLoading('Something went wrong while loading: ' + (e?.message || e)); });
