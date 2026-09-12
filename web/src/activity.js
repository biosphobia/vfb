// Illustrative "which brain systems are busy" model, drives the glow of VFB regions.
import * as THREE from 'three';

export const SYSTEMS = {
  vision:     { label: 'Seeing',           words: ['medulla', 'lobula', 'optic', 'lamina', 'ocell'], color: '#59bfff' },
  smell:      { label: 'Smelling',         words: ['antennal lobe', 'lateral horn', 'olfact'], color: '#8cf273' },
  touch:      { label: 'Touch & hearing',  words: ['mechanosensory', 'wedge', 'vest', 'saddle', 'johnston', 'flange', 'cantle', 'epaulette', 'antler'], color: '#ffd959' },
  navigation: { label: 'Steering',         words: ['fan-shaped', 'ellipsoid', 'protocerebral bridge', 'nodul', 'bulb', 'lateral accessory', 'central complex', 'gall', 'round body'], color: '#ff8c4d' },
  memory:     { label: 'Memory & learning',words: ['mushroom body', 'calyx', 'pedunculus', 'kenyon', 'crepine'], color: '#f266f2' },
  motor:      { label: 'Moving',           words: ['gnathal', 'posterior slope', 'inferior bridge', 'prow', 'gorget', 'descending', 'motor', 'inferior clamp', 'superior clamp', 'rubus'], color: '#ff5966' },
  taste:      { label: 'Tasting',          words: ['gnathal', 'prow', 'saddle', 'gustatory', 'proboscis'], color: '#ffb333' },
  pain:       { label: 'Pain & alarm',     words: ['nociceptive', 'giant fiber', 'gnathal ganglion', 'posterior ventrolateral'], color: '#ff3b3b' },
  higher:     { label: 'Deciding',         words: ['superior medial', 'superior lateral', 'superior intermediate', 'anterior ventrolateral', 'posterior lateral protocerebrum', 'anterior optic tubercle', 'protocerebrum'], color: '#b3bfff' },
};

export class BrainActivity {
  constructor(brain) {
    this.brain = brain; this.levels = {}; this.targets = {}; this._assign = new Map(); this._t = 0; this._seed = Math.random() * 100;
    for (const s in SYSTEMS) { this.levels[s] = 0.1; this.targets[s] = 0.1; }
    this._colors = {}; for (const s in SYSTEMS) this._colors[s] = new THREE.Color(SYSTEMS[s].color);
  }
  systemOf(label) { const l = (label || '').toLowerCase(); for (const s in SYSTEMS) for (const w of SYSTEMS[s].words) if (l.includes(w)) return s; return 'higher'; }
  label(s) { return SYSTEMS[s]?.label ?? s; }
  color(s) { return SYSTEMS[s]?.color ?? '#fff'; }
  top(n = 3) { return Object.entries(this.levels).sort((a, b) => b[1] - a[1]).slice(0, n); }
  setContext(ctx, feelings) {
    const t = {}; for (const s in SYSTEMS) t[s] = 0.08;
    const beh = ctx.behaviour || 'idle';
    if (beh === 'walk' || ctx.moving) { t.motor = 0.85; t.navigation = 0.75; t.vision = 0.5; t.touch = 0.45; }
    else if (beh === 'fly') { t.motor = 1; t.vision = 0.9; t.navigation = 0.85; t.touch = 0.7; }
    else { t.vision = 0.3; t.smell = 0.25; t.higher = 0.2; }
    if (ctx.watching) { t.vision = Math.max(t.vision, ctx.videoPlaying ? 0.95 : 0.6); t.higher = Math.max(t.higher, 0.6); }
    const mood = ctx.mood || '';
    if (mood === 'hungry' || ctx.feeding) { t.taste = 0.95; t.smell = 0.9; }
    if (mood === 'scared') { t.motor = Math.max(t.motor, 0.7); t.higher = 0.7; t.pain = 0.5; }
    if (mood === 'groovy') t.touch = Math.max(t.touch, 0.8);
    if (mood === 'disgusted') { t.smell = 0.9; t.taste = 0.6; }
    if (ctx.poked) { t.touch = 1; t.motor = 1; t.pain = 1; }
    const r = ctx.reaction || '';
    if (r === 'antenna') { t.smell = 1; t.touch = 0.7; } else if (r === 'think') { t.memory = 1; t.higher = 0.9; } else if (r === 'feed') { t.taste = 1; }
    else if (r === 'startle') { t.pain = Math.max(t.pain, 0.8); }
    if (feelings) { t.pain = Math.max(t.pain, feelings.pain); t.taste = Math.max(t.taste, feelings.hunger * 0.5); t.memory = Math.max(t.memory, feelings.curiosity * 0.5); }
    if (ctx.selectedSystem && t[ctx.selectedSystem] !== undefined) t[ctx.selectedSystem] = Math.max(t[ctx.selectedSystem], 0.9);
    this.targets = t;
  }
  update(dt) {
    this._t += dt; const pulse = 0.5 + 0.5 * Math.sin(this._t * 5);
    const keys = Object.keys(SYSTEMS);
    keys.forEach((s, i) => {
      const noise = 0.06 * Math.sin(this._t * (1.3 + 0.37 * i) + this._seed);
      const goal = THREE.MathUtils.clamp((this.targets[s] ?? 0.1) + noise, 0, 1);
      this.levels[s] += (goal - this.levels[s]) * Math.min(1, dt * 2.5);
    });
    if (!this.brain) return;
    for (const [id, o] of this.brain.objects) {
      let s = this._assign.get(id); if (!s) { s = this.systemOf(o.label); this._assign.set(id, s); }
      if (this.brain.selectedId === id) continue;
      const lv = this.levels[s]; const glow = lv * (0.55 + 0.45 * pulse);
      o.material.emissive.copy(this._colors[s]);
      o.material.emissiveIntensity = glow * (o.kind === 'neuron' ? 1.4 : 0.8);
      if (o.kind === 'neuropil') o.material.opacity = 0.2 + 0.35 * lv;
    }
  }
}
