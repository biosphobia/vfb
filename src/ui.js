// DOM user interface: layout (desktop panels vs mobile sheet), tabs, lists,
// population meters, state gauges, live monitor, science tab, fly's-eye canvas.
import { POPULATIONS, STATES, CIRCUITS, GRID_W, GRID_H } from './brainmodel.js';
const $ = (id) => document.getElementById(id);
const MONITOR_KEYS = ['T4T5', 'LPLC2', 'LC11', 'MBONa3', 'GF', 'DNA02', 'DNP09', 'PAM', 'PPL1', 'DFB'];

export class UI {
  constructor() {
    const ids = ['status', 'feeling-chip', 'pip', 'left', 'panel', 'tabs', 'tabcontent', 'doing', 'feeling', 'pathways', 'monitor', 'monitor-legend', 'meters', 'story', 'ai-toggle', 'ai-check',
      'dominant', 'gauges', 'eye-status', 'src-share', 'src-camera', 'src-file', 'src-stop', 'link-form', 'link-input', 'link-paste', 'video-info', 'video-title', 'video-play', 'video-mute', 'video-share', 'video-stop', 'open-eye',
      'part-title', 'part-model', 'part-thumb', 'part-load', 'part-text', 'circuits', 'state-refs', 'search-form', 'search-input', 'results', 'loaded', 'add-all', 'clear-all', 'obj-toggle', 'obj-remove',
      'opt-body', 'opt-xray', 'opt-brain', 'opt-follow', 'opt-hz', 'opt-stride', 'focus-brain', 'focus-fly', 'focus-screen', 'show-tips', 'cal-x', 'cal-y', 'cal-z', 'cal-s',
      'poke', 'poke-harsh', 'sugar', 'bitter', 'bb-brain', 'bb-screen', 'bb-xray', 'mobilebar', 'joystick', 'actions', 'poke-m', 'sugar-m', 'loom-m',
      'welcome', 'welcome-blocker', 'welcome-start', 'sheet-close', 'flyeye', 'eye-canvas', 'eye-meters', 'eye-close', 'loading', 'loading-text'];
    this.el = {}; for (const id of ids) this.el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id);
    this.el.knob = document.querySelector('#joystick .knob');
    this.touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (this.touch) document.body.classList.add('touch');
    this.compact = false; this.activeTab = 'fly'; this.sheetOpen = false;
    this.joystick = { x: 0, y: 0 };
    this.loadedIds = []; this.selectedLoaded = ''; this.currentTermId = '';
    this._meterEls = {}; this._gaugeEls = {}; this._eyeMeterEls = {}; this._circuitEls = [];
    this.history = {}; for (const k of MONITOR_KEYS) this.history[k] = new Float32Array(600).fill(0); this._hIdx = 0;
    this.mq = window.matchMedia('(max-width: 979px), (max-height: 539px)');
    this.mq.addEventListener('change', () => this.relayout());
    this._wireTabs(); this._wireJoystick(); this._buildScience(); this._buildLegend();
    this.el.welcomeStart.addEventListener('click', () => this.showWelcome(false));
    this.el.showTips.addEventListener('click', () => this.showWelcome(true));
    this.el.sheetClose.addEventListener('click', () => this.setSheet(false));
    this.relayout();
  }
  // ---------- layout
  relayout() {
    this.compact = this.mq.matches;
    const explore = $('tab-explore');
    if (this.compact) { if (explore.parentElement !== this.el.tabcontent) this.el.tabcontent.appendChild(explore); }
    else { if (explore.parentElement !== this.el.left) this.el.left.appendChild(explore); if (this.activeTab === 'explore') this.activeTab = 'fly'; }
    for (const t of this.el.tabcontent.querySelectorAll('.tab')) t.classList.toggle('active', t.id === 'tab-' + this.activeTab);
    if (!this.compact) explore.classList.add('active');
    for (const b of document.querySelectorAll('#tabs button[data-tab], #mobilebar button[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.activeTab && (this.sheetOpen || !this.compact));
    document.body.classList.toggle('sheet-open', this.compact && this.sheetOpen);
  }
  _wireTabs() {
    for (const b of document.querySelectorAll('#tabs button[data-tab]')) b.addEventListener('click', () => this.showTab(b.dataset.tab));
    for (const b of document.querySelectorAll('#mobilebar button[data-tab]')) b.addEventListener('click', () => { if (this.sheetOpen && this.activeTab === b.dataset.tab) this.setSheet(false); else { this.activeTab = b.dataset.tab; this.setSheet(true); } });
  }
  showTab(name) { this.activeTab = name; if (this.compact) this.sheetOpen = true; this.relayout(); }
  setSheet(open) { this.sheetOpen = open; this.relayout(); }
  isTyping() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  pipRect() { if (this.el.pip.offsetParent === null || !this.el.flyeye.hidden) return null; const r = this.el.pip.getBoundingClientRect(); return { x: Math.round(r.left + 1), y: Math.round(r.top + 1), w: Math.round(r.width - 2), h: Math.round(r.height - 2) }; }
  showWelcome(on) { this.el.welcome.style.display = on ? '' : 'none'; this.el.welcomeBlocker.style.display = on ? '' : 'none'; }
  setLoading(text) { if (text == null) this.el.loading.hidden = true; else this.el.loadingText.textContent = text; }
  _wireJoystick() {
    const j = this.el.joystick, knob = this.el.knob; let active = null; const R = 60;
    const upd = (e) => { const r = j.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.joystick = { x: dx, y: -dy }; knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`; };
    j.addEventListener('pointerdown', (e) => { active = e.pointerId; j.setPointerCapture(e.pointerId); upd(e); e.preventDefault(); });
    j.addEventListener('pointermove', (e) => { if (e.pointerId === active) upd(e); });
    const end = (e) => { if (e.pointerId === active) { active = null; this.joystick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  }
  // ---------- science tab (static structure, live numbers)
  _buildScience() {
    const host = this.el.circuits; host.replaceChildren(); this._circuitEls = [];
    for (const c of CIRCUITS) {
      const div = document.createElement('div'); div.className = 'circuit';
      const chain = c.chain.map((k) => `<span class="node" data-pop="${k}">${POPULATIONS[k].short} <b>0%</b></span>`).join('<span class="arrow">→</span>') + `<span class="arrow">→</span><span class="node out">${c.out}</span>`;
      div.innerHTML = `<div class="strong">${c.name}</div><div class="chain">${chain}</div><div class="hint">${c.desc}</div><div class="ref">${c.ref}</div>`;
      host.appendChild(div); this._circuitEls.push(div);
    }
    const refs = this.el.stateRefs; refs.replaceChildren();
    for (const k in STATES) { const s = STATES[k]; const d = document.createElement('div'); d.className = 'stateref'; d.style.borderColor = s.color; d.innerHTML = `<div class="strong">${s.label}</div><div class="hint">${s.desc}</div><div class="ref">${s.ref}</div>`; refs.appendChild(d); }
  }
  _buildLegend() { this.el.monitorLegend.innerHTML = MONITOR_KEYS.map((k) => `<span><i style="background:${POPULATIONS[k].color}"></i>${POPULATIONS[k].short}</span>`).join(''); }
  updateScience(rates) {
    if (this.activeTab !== 'science') return;
    for (const div of this._circuitEls) for (const n of div.querySelectorAll('.node[data-pop]')) n.querySelector('b').textContent = Math.round((rates[n.dataset.pop] || 0) * 100) + '%';
  }
  // ---------- live monitor
  recordRates(rates) { for (const k of MONITOR_KEYS) this.history[k][this._hIdx] = rates[k] || 0; this._hIdx = (this._hIdx + 1) % 600; }
  drawMonitor() {
    const c = this.el.monitor; if (this.activeTab !== 'fly' || c.offsetParent === null) return;
    const ctx = c.getContext('2d'); const W = c.width, H = c.height; ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#232836'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
    for (const k of MONITOR_KEYS) {
      ctx.strokeStyle = POPULATIONS[k].color; ctx.lineWidth = k === 'GF' ? 2 : 1.2; ctx.beginPath();
      for (let i = 0; i < 600; i++) { const v = this.history[k][(this._hIdx + i) % 600]; const x = i / 599 * W, y = H - 4 - v * (H - 8); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  // ---------- setters
  setStatus(t) { this.el.status.textContent = t; }
  setStory(doing, feeling, lines) { this.el.doing.textContent = doing; this.el.feeling.textContent = feeling; this.el.pathways.innerHTML = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''); }
  addStoryLine(text, ai) { const p = document.createElement('p'); p.textContent = text; if (ai) p.classList.add('ai'); this.el.story.appendChild(p); while (this.el.story.children.length > 14) this.el.story.firstChild.remove(); this.el.story.scrollTop = this.el.story.scrollHeight; }
  setAiAvailable(on) { this.el.aiToggle.hidden = !on; }
  setMeters(rates) {
    for (const [container, cache, keys] of [[this.el.meters, this._meterEls, Object.keys(POPULATIONS)], [this.el.eyeMeters, this._eyeMeterEls, ['R16', 'L1L2', 'T4T5', 'HSVS', 'LPLC2', 'LC11', 'MBONa3', 'GF']]]) {
      if (container.offsetParent === null && container !== this.el.meters) continue;
      for (const k of keys) {
        const P = POPULATIONS[k];
        if (!cache[k]) { const row = document.createElement('div'); row.className = 'm'; row.title = P.label; row.innerHTML = `<span>${P.short}</span><div class="bar"><i style="background:${P.color}"></i></div><span class="v"></span>`; container.appendChild(row); cache[k] = { fill: row.querySelector('i'), v: row.querySelector('.v') }; }
        const v = rates[k] || 0; cache[k].fill.style.width = Math.round(v * 100) + '%'; cache[k].v.textContent = Math.round(v * 100) + '%';
      }
    }
  }
  setStates(state, dominant) {
    for (const k in STATES) {
      const S = STATES[k];
      if (!this._gaugeEls[k]) { const row = document.createElement('div'); row.className = 'g'; row.innerHTML = `<span>${S.label}</span><div class="bar"><i style="background:${S.color}"></i></div><span class="v"></span><div class="desc" hidden>${escapeHtml(S.desc)}<br><span class="ref">${escapeHtml(S.ref)}</span></div>`; row.addEventListener('click', () => { const d = row.querySelector('.desc'); d.hidden = !d.hidden; row.classList.toggle('open', !d.hidden); }); this.el.gauges.appendChild(row); this._gaugeEls[k] = { fill: row.querySelector('i'), v: row.querySelector('.v') }; }
      this._gaugeEls[k].fill.style.width = Math.round(state[k] * 100) + '%'; this._gaugeEls[k].v.textContent = Math.round(state[k] * 100) + '%';
    }
    const S = STATES[dominant]; this.el.dominant.textContent = `Strongest right now: ${S.label} (${Math.round(state[dominant] * 100)}%).`; this.el.dominant.style.borderColor = S.color;
    this.el.feelingChip.textContent = S.label.replace(/ \(.*\)/, '').toLowerCase(); this.el.feelingChip.style.borderColor = S.color;
  }
  setOpto(kind, on) { for (const b of document.querySelectorAll(`button.opto[data-opto="${kind}"]`)) b.setAttribute('aria-pressed', String(on)); }
  setEyeStatus(text) { this.el.eyeStatus.textContent = text; }
  // ---------- lists
  setResults(items) { this.el.results.replaceChildren(); for (const it of items) { const li = document.createElement('li'); const tag = it.facets?.includes('Individual') ? '3D' : it.facets?.includes('Class') ? 'group' : ''; li.innerHTML = `${escapeHtml(it.label || it.id)}${tag ? `<span class="tag">${tag}</span>` : ''}`; li.title = it.id; li.addEventListener('click', () => this.onResult && this.onResult(it.id)); this.el.results.appendChild(li); } }
  addLoaded(id, label, kind, colorCss) { if (this.loadedIds.includes(id)) return; const li = document.createElement('li'); li.dataset.id = id; li.innerHTML = `<span style="color:${colorCss}">${escapeHtml(label)}</span><span class="tag">${kind === 'neuropil' ? 'region' : 'neuron'}</span>`; li.addEventListener('click', () => { this.selectedLoaded = id; this.highlightLoaded(id); this.onSelectLoaded && this.onSelectLoaded(id); }); this.el.loaded.appendChild(li); this.loadedIds.push(id); }
  removeLoaded(id) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); if (li) li.remove(); this.loadedIds = this.loadedIds.filter((x) => x !== id); }
  clearLoaded() { this.el.loaded.replaceChildren(); this.loadedIds = []; }
  highlightLoaded(id) { for (const li of this.el.loaded.children) li.classList.toggle('active', li.dataset.id === id); if (id) this.selectedLoaded = id; }
  setLoadedVisible(id, on) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); if (li) li.classList.toggle('hidden-obj', !on); }
  isLoadedHidden(id) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); return li ? li.classList.contains('hidden-obj') : false; }
  // ---------- term info
  setTermInfo(s, loadable, extraHtml = '', modelPops = []) {
    this.currentTermId = s.id || ''; this.el.partTitle.textContent = s.label || s.id;
    this.el.partModel.textContent = modelPops.length ? `In the model: ${modelPops.join('; ')}.` : 'Not part of the current circuit model (shown for anatomy only).';
    const shown = (s.types || []).filter((t) => !['Entity', 'Class', 'Individual', 'Thing', 'Anatomy', 'Nervous_system', 'Cell'].includes(t)).map((t) => t.replace(/_/g, ' ').toLowerCase());
    let h = '';
    if (shown.length) h += `<p class="hint">${escapeHtml(shown.join(', '))}</p>`;
    if (s.description) h += `<p>${escapeHtml(s.description)}</p>`;
    if (s.comment) h += `<p><i>${escapeHtml(s.comment)}</i></p>`;
    if (s.parents?.length) h += `<p><b>It is a kind of:</b> ${escapeHtml(s.parents.join(', '))}</p>`;
    if (s.datasets?.length) h += `<p><b>Data from:</b> ${escapeHtml(s.datasets.join(', '))} (${escapeHtml((s.licenses || []).join(', '))})</p>`;
    h += extraHtml + `<p><a href="https://virtualflybrain.org/term/${encodeURIComponent(this.currentTermId)}" target="_blank" rel="noopener">Read more on Virtual Fly Brain</a></p>`;
    this.el.partText.innerHTML = h; this.el.partLoad.hidden = !loadable; this.el.partThumb.hidden = true; this.el.partThumb.removeAttribute('src');
    this.showTab('brain');
  }
  setThumbnail(url) { if (url) { this.el.partThumb.src = url; this.el.partThumb.hidden = false; } else this.el.partThumb.hidden = true; }
  setVideo(yt) { const has = !!yt; this.el.videoInfo.hidden = !has; if (has) this.el.videoTitle.textContent = (yt.title || 'Loading…') + (yt.author ? ' · ' + yt.author : ''); }
  setPlaying(on) { this.el.videoPlay.textContent = on ? 'Pause' : 'Play'; }
  setMuted(m) { this.el.videoMute.textContent = m ? 'Unmute' : 'Mute'; }
  // ---------- fly's eye canvas
  openEye() { this.el.flyeye.hidden = false; }
  closeEye() { this.el.flyeye.hidden = true; }
  drawEye(model, escapeFlash) {
    if (this.el.flyeye.hidden) return;
    const c = this.el.eyeCanvas; const W = c.clientWidth, H = c.clientHeight; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cw = W / GRID_W, ch = H / GRID_H; const r = Math.min(cw, ch) * 0.56;
    const lum = model.lum.length && model.hasVision ? model.adapt : null;
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x; const v = model.hasVision ? (model.contrast[i] * 0.5 + 0.5) * 0.6 + (model.lum[i] || 0) * 0.4 : 0.05;
      const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
      ctx.fillStyle = `rgb(${Math.round(g * 0.55)},${g},${Math.round(g * 0.75)})`;
      const px = x * cw + cw / 2 + (y % 2 ? cw / 4 : -cw / 4), py = y * ch + ch / 2;
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; const X = px + r * Math.cos(a), Y = py + r * Math.sin(a); if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); } ctx.closePath(); ctx.fill();
      if (model.hasVision && (Math.abs(model.mx[i]) + Math.abs(model.my[i])) > 0.04) { ctx.strokeStyle = '#59bfff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + model.mx[i] * cw * 12, py + model.my[i] * ch * 12); ctx.stroke(); }
    }
    if (!model.hasVision) { ctx.fillStyle = '#9aa4b8'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No visual input. Share your screen, use the camera, a video file, or a lab stimulus.', W / 2, H / 2); }
    if (escapeFlash > 0) { ctx.fillStyle = `rgba(255,40,40,${Math.min(0.6, escapeFlash)})`; ctx.fillRect(0, 0, W, H); }
    void lum;
  }
}
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
