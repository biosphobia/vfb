// DOM user interface: layout (desktop panels vs mobile sheet), tabs, lists,
// meters, feeling gauges, story log, joystick. No framework.
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      status: $('status'), chip: $('feeling-chip'), pip: $('pip'), left: $('left'), panel: $('panel'), tabs: $('tabs'), tabcontent: $('tabcontent'),
      doing: $('doing'), feeling: $('feeling'), focus: $('focus'), meters: $('meters'), story: $('story'), aiToggle: $('ai-toggle'), aiCheck: $('ai-check'),
      dominant: $('dominant'), gauges: $('gauges'), feelingsNote: $('feelings-note'),
      partTitle: $('part-title'), partThumb: $('part-thumb'), partLoad: $('part-load'), partText: $('part-text'),
      linkForm: $('link-form'), linkInput: $('link-input'), linkPaste: $('link-paste'), videoInfo: $('video-info'), videoTitle: $('video-title'),
      videoPlay: $('video-play'), videoMute: $('video-mute'), videoEye: $('video-eye'), videoShare: $('video-share'), videoStop: $('video-stop'), videoSummary: $('video-summary'), videoNotes: $('video-notes'),
      searchForm: $('search-form'), searchInput: $('search-input'), results: $('results'), loaded: $('loaded'), addAll: $('add-all'), clearAll: $('clear-all'), objToggle: $('obj-toggle'), objRemove: $('obj-remove'),
      optBody: $('opt-body'), optXray: $('opt-xray'), optBrain: $('opt-brain'), optFollow: $('opt-follow'), optHz: $('opt-hz'), optStride: $('opt-stride'),
      focusBrain: $('focus-brain'), focusFly: $('focus-fly'), focusScreen: $('focus-screen'), showTips: $('show-tips'), calX: $('cal-x'), calY: $('cal-y'), calZ: $('cal-z'), calS: $('cal-s'),
      bottombar: $('bottombar'), poke: $('poke'), pokeM: $('poke-m'), bbBrain: $('bb-brain'), bbFly: $('bb-fly'), bbXray: $('bb-xray'), bbExplore: $('bb-explore'),
      mobilebar: $('mobilebar'), joystick: $('joystick'), knob: document.querySelector('#joystick .knob'), actions: $('actions'),
      welcome: $('welcome'), welcomeBlocker: $('welcome-blocker'), welcomeStart: $('welcome-start'), sheetClose: $('sheet-close'),
      flyeye: $('flyeye'), eyePlayer: $('eye-player'), eyeMeters: $('eye-meters'), eyeClose: $('eye-close'),
      loading: $('loading'), loadingText: $('loading-text'),
    };
    this.touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (this.touch) document.body.classList.add('touch');
    this.compact = false; this.activeTab = 'fly'; this.sheetOpen = false;
    this.joystick = { x: 0, y: 0 };
    this.resultIds = []; this.loadedIds = []; this.selectedLoaded = ''; this.currentTermId = '';
    this._meterEls = {}; this._gaugeEls = {}; this._eyeMeterEls = {};
    this.mq = window.matchMedia('(max-width: 979px), (max-height: 539px)');
    this.mq.addEventListener('change', () => this.relayout());
    this._wireTabs(); this._wireJoystick();
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
    else { if (explore.parentElement !== this.el.left) this.el.left.appendChild(explore); explore.classList.add('active'); if (this.activeTab === 'explore') this.activeTab = 'fly'; }
    for (const t of this.el.tabcontent.querySelectorAll('.tab')) t.classList.toggle('active', t.id === 'tab-' + this.activeTab);
    if (!this.compact) explore.classList.add('active');
    for (const b of document.querySelectorAll('#tabs button[data-tab], #mobilebar button[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.activeTab && (this.sheetOpen || !this.compact));
    document.body.classList.toggle('sheet-open', this.compact && this.sheetOpen);
  }
  _wireTabs() {
    for (const b of document.querySelectorAll('#tabs button[data-tab]')) b.addEventListener('click', () => this.showTab(b.dataset.tab));
    for (const b of document.querySelectorAll('#mobilebar button[data-tab]')) b.addEventListener('click', () => { if (this.sheetOpen && this.activeTab === b.dataset.tab) this.setSheet(false); else { this.activeTab = b.dataset.tab; this.setSheet(true); } });
    this.el.bbExplore.addEventListener('click', () => { this.showTab('fly'); this.el.left.scrollTop = 0; this.el.searchInput.focus(); });
  }
  showTab(name) { this.activeTab = name; if (this.compact) this.sheetOpen = true; this.relayout(); }
  setSheet(open) { this.sheetOpen = open; this.relayout(); }
  isTyping() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  pipRect() {
    if (this.el.pip.offsetParent === null || this.el.flyeye.hidden === false) return null;
    const r = this.el.pip.getBoundingClientRect();   // CSS pixels; the renderer applies the pixel ratio
    return { x: Math.round(r.left + 1), y: Math.round(r.top + 1), w: Math.round(r.width - 2), h: Math.round(r.height - 2) };
  }
  showWelcome(on) { this.el.welcome.style.display = on ? '' : 'none'; this.el.welcomeBlocker.style.display = on ? '' : 'none'; }
  setLoading(text) { if (text == null) this.el.loading.hidden = true; else this.el.loadingText.textContent = text; }
  // ---------- joystick
  _wireJoystick() {
    const j = this.el.joystick, knob = this.el.knob; let active = null; const R = 60;
    const upd = (e) => { const r = j.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.joystick = { x: dx, y: -dy }; knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`; };
    j.addEventListener('pointerdown', (e) => { active = e.pointerId; j.setPointerCapture(e.pointerId); upd(e); e.preventDefault(); });
    j.addEventListener('pointermove', (e) => { if (e.pointerId === active) upd(e); });
    const end = (e) => { if (e.pointerId === active) { active = null; this.joystick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  }
  // ---------- simple setters
  setStatus(t) { this.el.status.textContent = t; }
  setBehaviour(b) { for (const el of document.querySelectorAll('button.beh')) el.setAttribute('aria-pressed', String(el.dataset.behaviour === b)); }
  setStory(d, f, fo) { this.el.doing.textContent = d; this.el.feeling.textContent = f; this.el.focus.textContent = fo; }
  addStoryLine(text, ai) { const p = document.createElement('p'); p.textContent = text; if (ai) p.classList.add('ai'); this.el.story.appendChild(p); while (this.el.story.children.length > 14) this.el.story.firstChild.remove(); this.el.story.scrollTop = this.el.story.scrollHeight; }
  setAiAvailable(on) { this.el.aiToggle.hidden = !on; }
  setMeters(levels, activity) {
    for (const host of [[this.el.meters, this._meterEls], [this.el.eyeMeters, this._eyeMeterEls]]) {
      const [container, cache] = host;
      for (const s in levels) {
        if (!cache[s]) { const row = document.createElement('div'); row.className = 'm'; row.innerHTML = `<span>${activity.label(s)}</span><div class="bar"><i style="background:${activity.color(s)}"></i></div><span class="v"></span>`; container.appendChild(row); cache[s] = { fill: row.querySelector('i'), v: row.querySelector('.v') }; }
        cache[s].fill.style.width = Math.round(levels[s] * 100) + '%'; cache[s].v.textContent = Math.round(levels[s] * 100) + '%';
      }
    }
  }
  setFeelings(feelings, defs) {
    const v = feelings.v;
    for (const k in defs) {
      if (!this._gaugeEls[k]) { const row = document.createElement('div'); row.className = 'g'; row.title = defs[k].desc; row.innerHTML = `<span>${defs[k].label}</span><div class="bar"><i style="background:${defs[k].color}"></i></div><span class="v"></span>`; this.el.gauges.appendChild(row); this._gaugeEls[k] = { fill: row.querySelector('i'), v: row.querySelector('.v') }; }
      this._gaugeEls[k].fill.style.width = Math.round(v[k] * 100) + '%'; this._gaugeEls[k].v.textContent = Math.round(v[k] * 100) + '%';
    }
    const d = feelings.dominant(); const phrase = feelings.phrase();
    this.el.dominant.textContent = `Right now the fly feels ${phrase}.`;
    this.el.dominant.style.borderColor = defs[d].color; this.el.chip.textContent = phrase; this.el.chip.style.borderColor = defs[d].color;
  }
  // ---------- lists
  setResults(items) {
    this.el.results.replaceChildren(); this.resultIds = [];
    for (const it of items) { const li = document.createElement('li'); const tag = it.facets?.includes('Individual') ? '3D' : it.facets?.includes('Class') ? 'group' : ''; li.innerHTML = `${escapeHtml(it.label || it.id)}${tag ? `<span class="tag">${tag}</span>` : ''}`; li.title = it.id; li.addEventListener('click', () => this.onResult && this.onResult(it.id)); this.el.results.appendChild(li); this.resultIds.push(it.id); }
  }
  addLoaded(id, label, kind, colorCss) {
    if (this.loadedIds.includes(id)) return;
    const li = document.createElement('li'); li.dataset.id = id; li.innerHTML = `<span style="color:${colorCss}">${escapeHtml(label)}</span><span class="tag">${kind === 'neuropil' ? 'region' : 'neuron'}</span>`;
    li.addEventListener('click', () => { this.selectedLoaded = id; this.highlightLoaded(id); this.onSelectLoaded && this.onSelectLoaded(id); });
    this.el.loaded.appendChild(li); this.loadedIds.push(id);
  }
  removeLoaded(id) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); if (li) li.remove(); this.loadedIds = this.loadedIds.filter((x) => x !== id); }
  clearLoaded() { this.el.loaded.replaceChildren(); this.loadedIds = []; }
  highlightLoaded(id) { for (const li of this.el.loaded.children) li.classList.toggle('active', li.dataset.id === id); if (id) this.selectedLoaded = id; }
  setLoadedVisible(id, on) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); if (li) li.classList.toggle('hidden-obj', !on); }
  isLoadedHidden(id) { const li = this.el.loaded.querySelector(`li[data-id="${CSS.escape(id)}"]`); return li ? li.classList.contains('hidden-obj') : false; }
  // ---------- term info
  setTermInfo(s, loadable, extraHtml = '') {
    this.currentTermId = s.id || ''; this.el.partTitle.textContent = s.label || s.id;
    const shown = (s.types || []).filter((t) => !['Entity', 'Class', 'Individual', 'Thing', 'Anatomy', 'Nervous_system', 'Cell'].includes(t)).map((t) => t.replace(/_/g, ' ').toLowerCase());
    let h = '';
    if (shown.length) h += `<p class="hint">${escapeHtml(shown.join(', '))}</p>`;
    if (s.description) h += `<p>${escapeHtml(s.description)}</p>`;
    if (s.comment) h += `<p><i>${escapeHtml(s.comment)}</i></p>`;
    if (s.parents?.length) h += `<p><b>It is a kind of:</b> ${escapeHtml(s.parents.join(', '))}</p>`;
    if (s.datasets?.length) h += `<p><b>Data from:</b> ${escapeHtml(s.datasets.join(', '))} (${escapeHtml((s.licenses || []).join(', '))})</p>`;
    h += extraHtml;
    h += `<p><a href="https://virtualflybrain.org/term/${encodeURIComponent(this.currentTermId)}" target="_blank" rel="noopener">Read more on Virtual Fly Brain</a></p>`;
    this.el.partText.innerHTML = h; this.el.partLoad.hidden = !loadable; this.el.partThumb.hidden = true; this.el.partThumb.removeAttribute('src');
    this.showTab('brain');
  }
  setThumbnail(url) { if (url) { this.el.partThumb.src = url; this.el.partThumb.hidden = false; } else this.el.partThumb.hidden = true; }
  // ---------- video
  setVideo(info, note) {
    const has = !!info; this.el.videoInfo.hidden = !has;
    if (has) { this.el.videoTitle.textContent = (info.title || 'Loading…') + (info.author ? ' · ' + info.author : ''); if (note) this.el.videoSummary.textContent = note; }
    else { this.el.videoSummary.textContent = ''; this.el.videoNotes.replaceChildren(); }
  }
  setVideoPlan(plan) { this.el.videoSummary.textContent = `Mood: ${plan.mood}${plan.ai ? ' (AI)' : ''} — ${plan.summary || ''}`; this.el.videoNotes.replaceChildren(); }
  addVideoNote(t) { const p = document.createElement('p'); p.textContent = t; this.el.videoNotes.appendChild(p); this.el.videoNotes.scrollTop = this.el.videoNotes.scrollHeight; }
  setPlaying(on) { this.el.videoPlay.textContent = on ? 'Pause' : 'Play'; }
  setMuted(m) { this.el.videoMute.textContent = m ? 'Unmute' : 'Mute'; }
  openEye() { this.el.flyeye.hidden = false; }
  closeEye() { this.el.flyeye.hidden = true; }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
