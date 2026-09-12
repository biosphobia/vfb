// VFB Fly Explorer – browser app entry point. World units are millimetres.
import * as THREE from 'three';
import { SceneRig, LAYER_BODY, LAYER_BRAIN } from './scene.js';
import { loadFlyModel, placeholderFly, FlyRig } from './fly.js';
import { Brain } from './brain.js';
import { BrainActivity, SYSTEMS } from './activity.js';
import { Feelings, FEELINGS } from './feelings.js';
import { Narrator } from './narrator.js';
import * as vfb from './vfb.js';
import { VideoScreen } from './video.js';
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
  let rigData = await loadJson(DATA + 'fly/fly_rig.json');
  if (!rigData) rigData = await loadJson('data-default/fly_rig_default.json');
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

  const activity = new BrainActivity(brain);
  const feelings = new Feelings();
  const narrator = new Narrator(CFG.apiBase);
  narrator.onUpdate = (d, f, fo) => ui.setStory(d, f, fo);
  narrator.onLine = (t, ai) => ui.addStoryLine(t, ai);
  narrator.onAi = (on) => ui.setAiAvailable(on);
  const video = new VideoScreen(scene, CFG.apiBase);

  // ---------------- state
  const bodyMeshes = []; model.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });
  const xrayMat = new THREE.MeshStandardMaterial({ color: 0xbf9a66, transparent: true, opacity: 0.16, depthWrite: true, roughness: 0.7 });
  let xray = false; let flyYaw = 0; let faceScreen = false; let poked = 0; let selectedLabel = ''; let idleVariant = 0, idleTimer = 0, ctxTimer = 0;
  const raycaster = new THREE.Raycaster();

  function setXray(on) { xray = on; ui.el.optXray.checked = on; for (const m of bodyMeshes) { if (!m.userData.origMat) m.userData.origMat = m.material; m.material = on ? xrayMat : m.userData.origMat; } }
  function focus(what) {
    if (what === 'brain') { rigScene.follow = null; ui.el.optFollow.checked = false; const b = brain.box(); if (b) { const c = new THREE.Vector3(); b.getCenter(c); const r = b.getSize(new THREE.Vector3()).length() * 0.5; rigScene.focusOn(c, Math.max(0.3, r)); } else rigScene.focusOn(brain.worldCenter(), 0.6); }
    else if (what === 'screen') { rigScene.follow = null; ui.el.optFollow.checked = false; rigScene.lookOverShoulder(fly.position.clone(), video.worldPosition()); }
    else { rigScene.follow = fly; ui.el.optFollow.checked = true; rigScene.focusOn(fly.position.clone().add(rigScene.followOffset), 3.2); }
  }
  function colorFor(id, kind) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const hue = (h % 1000) / 1000; return new THREE.Color().setHSL(hue, kind === 'neuropil' ? 0.45 : 0.85, kind === 'neuropil' ? 0.6 : 0.55); }
  function reactTo(label) {
    const l = (label || '').toLowerCase(); feelings.event('select');
    if (/wing|flight|haltere/.test(l)) rig.react('fly', 2.4);
    else if (/leg|motor|descending|walk/.test(l)) rig.react('walk', 4);
    else if (/antenna|olfactory|odor|johnston|lateral horn/.test(l)) rig.react('antenna', 4);
    else if (/gnathal|gustatory|prow|saddle/.test(l)) { rig.react('feed', 3.2); feelings.event('feed', 0.5); }
    else if (/mushroom|kenyon|central complex|ellipsoid|fan-shaped|calyx/.test(l)) rig.react('think', 4);
  }

  // ---------------- bundled anatomy
  if (manifest) {
    ui.setLoading('Loading the brain map…');
    const n = await brain.loadBundled(manifest, DATA + 'vfb/', (i, total, o) => { ui.setLoading(`Loading the brain map… ${i} of ${total}`); ui.addLoaded(o.id, o.label || o.id, o.kind || 'neuron', cssColor(o.color)); });
    const b = brain.box(); if (b) rigScene.pipRadius = Math.max(0.2, b.getSize(new THREE.Vector3()).length() * 0.5);
    ui.setStatus(`Ready. ${n} brain regions and neurons are in place.`);
  } else ui.setStatus('Ready. Search Virtual Fly Brain to add anatomy.');
  ui.setLoading(null);
  console.log(`VFB Fly Explorer (web): ${placeholder ? 'placeholder body' : 'NeuroMechFly body, ' + rig.jointCount + ' joints'} | ${manifest ? (manifest.objects || []).length + ' bundled VFB objects' : 'no bundled VFB set'}`);
  function cssColor(c) { if (!c) return '#ccc'; return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; }

  // ---------------- selection / terms
  const termCache = new Map();
  async function term(id) { if (termCache.has(id)) return termCache.get(id); const info = await vfb.termInfo(id).catch(() => null); if (info) termCache.set(id, info); return info; }
  function selectObject(id, from3d) {
    const sel = brain.select(id); ui.highlightLoaded(sel); selectedLabel = '';
    if (!sel) return; const o = brain.objects.get(sel); selectedLabel = o.label;
    if (from3d) reactTo(o.label);
    showTerm(sel);
  }
  async function showTerm(id) {
    ui.setStatus(`Reading about ${id}…`);
    const info = await term(id);
    if (!info) { ui.setStatus('Could not reach Virtual Fly Brain right now.'); return; }
    const s = vfb.summaryOf(info); const images = vfb.imagesOf(info); const examples = vfb.examplesOf(info); const domains = vfb.domainsOf(info);
    let extra = '';
    if (domains.length) { extra += `<p><b>${domains.length} regions</b> are listed under Explore – pick one, then “Show it inside the fly”.</p>`; ui.setResults(domains.map((d) => ({ id: d.id, label: d.label, facets: ['Individual'] }))); }
    else if (examples.length) { extra += `<p><b>${examples.length} example neurons</b> are listed under Explore – pick one, then “Show it inside the fly”.</p>`; ui.setResults(examples.map((e) => ({ id: e.id, label: e.label, facets: ['Individual'] }))); }
    ui.setTermInfo(s, images.length > 0, extra); ui.setStatus('');
    if (images[0]?.thumbnail) ui.setThumbnail(images[0].thumbnail);
  }
  async function loadRemote(id) {
    if (!id) return; if (brain.has(id)) { selectObject(id, false); return; }
    const info = await term(id); if (!info) { ui.setStatus('Could not reach Virtual Fly Brain right now.'); return; }
    const s = vfb.summaryOf(info); const images = vfb.imagesOf(info); if (!images.length) { ui.setStatus('This one has no 3D shape to show.'); return; }
    const templateId = manifest?.template?.id || 'VFB_00101567';
    const img = images.find((i) => i.template === templateId) || images[0];
    if (img.template && img.template !== templateId) ui.setStatus('This shape comes from a different brain template, so its position is approximate.');
    let kind = (s.types || []).some((t) => /neuropil|region/i.test(t)) ? 'neuropil' : 'neuron';
    const offset = brain.centerKnown ? brain.templateCenterUm : [0, 0, 0];
    let geom = null, fmt = '';
    for (const key of ['obj', 'objAlt']) {
      if (!img[key]) continue; ui.setStatus(`Downloading the 3D shape of ${s.label}…`);
      try { const r = await fetch(img[key]); if (!r.ok) continue; const text = await r.text(); ui.setStatus('Building the shape…'); geom = vfb.parseObj(text, brain.umToMm, offset); fmt = 'obj'; if (geom.attributes.position.count > 0) break; geom = null; } catch { geom = null; }
    }
    if (!geom && img.swc) { ui.setStatus(`Downloading the skeleton of ${s.label}…`); try { const r = await fetch(img.swc); if (r.ok) { geom = vfb.parseSwc(await r.text(), brain.umToMm, offset); fmt = 'swc'; kind = 'neuron'; } } catch { geom = null; } }
    if (!geom || geom.attributes.position.count === 0) { ui.setStatus('Sorry, that shape could not be loaded.'); return; }
    const color = colorFor(id, kind);
    const meta = { format: fmt };
    if (!brain.centerKnown) { brain.learnCenterFromGeometry(geom); meta.position = new THREE.Vector3(-brain.templateCenterUm[0] * brain.umToMm, -brain.templateCenterUm[1] * brain.umToMm, -brain.templateCenterUm[2] * brain.umToMm); }
    brain.add(id, s.label || id, kind, geom, color, meta);
    ui.addLoaded(id, s.label || id, kind, '#' + color.getHexString());
    ui.setStatus(`${s.label} is now inside the fly.`); selectObject(id, false);
  }
  async function loadBundledAll() { if (!manifest) return; ui.setStatus('Adding the brain map…'); const n = await brain.loadBundled(manifest, DATA + 'vfb/', (i, total, o) => ui.addLoaded(o.id, o.label || o.id, o.kind || 'neuron', cssColor(o.color))); ui.setStatus(`Added ${n} regions and neurons.`); }
  async function doSearch(t) {
    t = (t || '').trim(); if (!t) return;
    if (vfb.looksLikeId(t)) { showTerm(t); return; }
    ui.setStatus(`Searching Virtual Fly Brain for “${t}”…`);
    try { const items = await vfb.search(t); ui.setResults(items); ui.setStatus(items.length ? `${items.length} results. Tap one to read about it.` : 'Nothing found. Try another word.'); }
    catch { ui.setStatus('Could not reach Virtual Fly Brain right now.'); }
  }

  // ---------------- video wiring
  function startVideo(text) {
    video.load(text).then((ok) => {
      if (!ok) { ui.setStatus("That doesn't look like a YouTube link."); return; }
      ui.el.linkInput.value = ''; ui.setStatus('Loading the video onto the screen…'); ui.showTab('watch');
      faceScreen = true; rig.lookPitchDeg = -10; feelings.event('video'); focus('screen');
    });
  }
  video.onChange = (info, note) => { ui.setVideo(info, note); if (!info) { faceScreen = false; rig.lookPitchDeg = 0; rig.lookYawDeg = 0; ui.setStatus('Video stopped.'); } ui.setMuted(video.muted); ui.setPlaying(video.playing); };
  video.onPlan = (plan) => { ui.setVideoPlan(plan); ui.setStatus(`The fly seems ${plan.mood} about this video.`); feelings.event('mood:' + plan.mood); };
  video.onPlaying = (on) => ui.setPlaying(on);
  video.onBeat = (action, note) => {
    switch (action) {
      case 'look': faceScreen = true; rig.react('antenna', 1.5); break;
      case 'startle': rig.startle(); poked = 1.2; feelings.event('startle'); break;
      case 'walk': rig.react('walk', 3); break;
      case 'fly': rig.react('fly', 2.5); feelings.event('startle', 0.4); break;
      case 'feed': rig.react('feed', 3.5); feelings.event('feed'); break;
      case 'groove': rig.react('groove', 4); feelings.event('groove'); break;
      case 'antenna': rig.react('antenna', 3); feelings.event('antenna'); break;
      case 'think': rig.react('think', 3); feelings.event('think'); break;
      case 'rest': rig.react('rest'); feelings.event('rest'); break;
      default: break;
    }
    if (note) { ui.addVideoNote(note); narrator.push(note, !!video.plan?.ai); }
  };
  ui.el.linkForm.addEventListener('submit', (e) => { e.preventDefault(); startVideo(ui.el.linkInput.value); });
  ui.el.linkPaste.addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); if (t) { ui.el.linkInput.value = t; startVideo(t); return; } } catch {} ui.el.linkInput.focus(); });
  ui.el.videoStop.addEventListener('click', () => video.stop());
  ui.el.videoPlay.addEventListener('click', () => { if (video.player) video.togglePlay(); else { video.simulatePlay(!video.playing); ui.setPlaying(video.playing); } });
  ui.el.videoMute.addEventListener('click', () => ui.setMuted(video.toggleMute()));
  ui.el.videoShare.addEventListener('click', async () => { const url = `${location.origin}${location.pathname}?v=${video.id}`; try { await navigator.clipboard.writeText(url); ui.setStatus('Link copied: ' + url); } catch { prompt('Copy this link', url); } });
  ui.el.videoEye.addEventListener('click', async () => { if (!video.hasVideo) return; ui.openEye(); await video.openEye(ui.el.eyePlayer); });
  ui.el.eyeClose.addEventListener('click', () => { video.closeEye(); ui.closeEye(); });

  // ---------------- other UI wiring
  ui.onResult = (id) => showTerm(id);
  ui.onSelectLoaded = (id) => selectObject(id, false);
  ui.el.partLoad.addEventListener('click', () => loadRemote(ui.currentTermId));
  ui.el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); doSearch(ui.el.searchInput.value); });
  ui.el.addAll.addEventListener('click', loadBundledAll);
  ui.el.clearAll.addEventListener('click', () => { brain.clear(); ui.clearLoaded(); });
  ui.el.objToggle.addEventListener('click', () => { const id = ui.selectedLoaded; if (!id) return; const hidden = ui.isLoadedHidden(id); brain.setVisible(id, hidden); ui.setLoadedVisible(id, hidden); });
  ui.el.objRemove.addEventListener('click', () => { const id = ui.selectedLoaded; if (!id) return; brain.remove(id); ui.removeLoaded(id); });
  for (const b of document.querySelectorAll('button.beh')) b.addEventListener('click', () => rig.setBehaviour(b.dataset.behaviour));
  const poke = () => { rig.startle(); poked = 2; feelings.event('poke'); ui.setStatus('You poked the fly!'); };
  ui.el.poke.addEventListener('click', poke); ui.el.pokeM.addEventListener('click', poke);
  ui.el.bbBrain.addEventListener('click', () => focus('brain')); ui.el.bbFly.addEventListener('click', () => focus('fly'));
  ui.el.focusBrain.addEventListener('click', () => focus('brain')); ui.el.focusFly.addEventListener('click', () => focus('fly')); ui.el.focusScreen.addEventListener('click', () => focus('screen'));
  ui.el.bbXray.addEventListener('click', () => setXray(!xray)); ui.el.optXray.addEventListener('change', () => setXray(ui.el.optXray.checked));
  ui.el.optBody.addEventListener('change', () => { model.visible = ui.el.optBody.checked; });
  ui.el.optBrain.addEventListener('change', () => brain.setAllVisible(ui.el.optBrain.checked));
  ui.el.optFollow.addEventListener('change', () => { rigScene.follow = ui.el.optFollow.checked ? fly : null; });
  ui.el.optHz.addEventListener('input', () => { rig.stepHz = +ui.el.optHz.value; });
  ui.el.optStride.addEventListener('input', () => { rig.strideDeg = +ui.el.optStride.value; });
  for (const el of [ui.el.calX, ui.el.calY, ui.el.calZ, ui.el.calS]) el.addEventListener('input', () => { brain.userOffset.set(+ui.el.calX.value || 0, +ui.el.calY.value || 0, +ui.el.calZ.value || 0); brain.userScale = +ui.el.calS.value || 1; brain.applyCalibration(); });
  ui.el.pip.addEventListener('click', () => { setXray(true); focus('brain'); });
  ui.el.aiCheck.addEventListener('change', () => { narrator.aiEnabled = ui.el.aiCheck.checked; });
  rig.onBehaviour = (b) => ui.setBehaviour(b); ui.setBehaviour('idle');
  focus('fly');

  // ---------------- picking (click without drag)
  const canvas = rigScene.canvas; let pressPos = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') pressPos = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => { if (!pressPos) return; const d = Math.hypot(e.clientX - pressPos.x, e.clientY - pressPos.y); pressPos = null; if (d < 8) pick(e.clientX, e.clientY); });
  function pick(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (brain.visible) { raycaster.layers.set(LAYER_BRAIN); const hits = raycaster.intersectObject(brain.group, true).filter((h) => h.object.visible); if (hits.length) { selectObject(hits[0].object.userData.vfbId, true); return; } }
    if (model.visible) { raycaster.layers.set(LAYER_BODY); const hits = raycaster.intersectObject(model, true); if (hits.length) { const seg = (hits[0].object.parent?.name || hits[0].object.name || 'body').replace(/^[lrc]_|^[lr][fmh]_/, '').replace(/_/g, ' '); ui.setStatus(`You poked the fly's ${seg}!`); rig.startle(); poked = 2; feelings.event('poke'); brain.select(''); ui.highlightLoaded(''); return; } }
    brain.select(''); ui.highlightLoaded('');
  }
  // keyboard
  const keys = new Set();
  window.addEventListener('keydown', (e) => { if (ui.isTyping()) return; keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); rig.setBehaviour(rig.behaviour === 'fly' ? 'idle' : 'fly'); } if (e.code === 'Digit1') rig.setBehaviour('idle'); if (e.code === 'Digit2') rig.setBehaviour('walk'); if (e.code === 'Digit3') rig.setBehaviour('fly'); if (e.code === 'KeyF') focus('brain'); if (e.code === 'Home') focus('fly'); if (e.code === 'KeyX') setXray(!xray); });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // deep link
  const v = new URLSearchParams(location.search).get('v'); if (v) setTimeout(() => startVideo(v), 400);

  // ---------------- main loop
  const clock = new THREE.Clock(); let flyPos = fly.position; const tmp = new THREE.Vector3();
  function context() {
    const top = activity.top(3);
    return { behaviour: rig.behaviour, moving: Math.abs(rig.forwardSpeed) > 0.05, poked: poked > 0, watching: video.hasVideo, videoPlaying: video.playing, videoTitle: video.title, mood: video.mood,
      reaction: rig.reacting(), selectedLabel, selectedSystem: selectedLabel ? activity.systemOf(selectedLabel) : '', idleVariant, topSystems: top, topSystemLabel: top.length ? activity.label(top[0][0]) : '',
      feelings: feelings.snapshot(), dominantFeeling: feelings.dominant(), feelingPhrase: feelings.phrase(), loadedObjects: brain.objects.size };
  }
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    let fwd = 0, turn = 0;
    if (!ui.isTyping()) { if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) turn += 1; if (keys.has('KeyD') || keys.has('ArrowRight')) turn -= 1; }
    const js = ui.joystick; if (Math.hypot(js.x, js.y) > 0.05) { fwd = js.y; turn = -js.x; }
    rig.drive(fwd, turn); poked = Math.max(0, poked - dt);
    if (faceScreen && Math.abs(fwd) < 0.01 && Math.abs(turn) < 0.01 && rig.behaviour !== 'walk') {
      const sp = video.worldPosition(); const want = Math.atan2(-(sp.z - flyPos.z), sp.x - flyPos.x);
      let d = want - flyYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); flyYaw += d * Math.min(1, dt * 1.5);
      const dist = Math.hypot(sp.x - flyPos.x, sp.z - flyPos.z); rig.lookPitchDeg = -THREE.MathUtils.clamp(Math.atan2(sp.y - 1.3, dist) * 180 / Math.PI * 0.6, 0, 25);
    }
    flyYaw += rig.turnRate * dt; fly.rotation.y = flyYaw;
    tmp.set(Math.cos(flyYaw), 0, -Math.sin(flyYaw)).multiplyScalar(rig.forwardSpeed * dt);
    flyPos.add(tmp);
    const rad = Math.hypot(flyPos.x, flyPos.z); if (rad > FLOOR_RADIUS - 2) { flyPos.x *= (FLOOR_RADIUS - 2) / rad; flyPos.z *= (FLOOR_RADIUS - 2) / rad; flyYaw += dt * 1.5; }
    flyPos.y = rig.hover;
    rig.update(dt); video.update(dt); activity.update(dt); narrator.update(dt);
    idleTimer += dt; if (idleTimer > 9) { idleTimer = 0; idleVariant++; }
    ctxTimer += dt;
    if (ctxTimer > 0.2) {
      ctxTimer = 0; const ctx = context(); feelings.update(0.2, ctx); activity.setContext(ctx, feelings.v); narrator.setContext(ctx);
      ui.setMeters(activity.levels, activity); ui.setFeelings(feelings, FEELINGS);
    }
    rigScene.update(dt);
    rigScene.render(ui.pipRect());
  }
  frame();
}

boot().catch((e) => { console.error(e); ui.setLoading('Something went wrong while loading: ' + (e?.message || e)); });
