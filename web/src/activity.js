// Maps the model's population rates onto the VFB anatomy loaded in the head:
// a neuropil glows with the strongest population that innervates it, a neuron
// mesh glows with the population it belongs to (matched by VFB label).
import * as THREE from 'three';
import { POPULATIONS } from './brainmodel.js';

export class AnatomyGlow {
  constructor(brain) { this.brain = brain; this._assign = new Map(); this._t = 0; this._colors = {}; for (const k in POPULATIONS) this._colors[k] = new THREE.Color(POPULATIONS[k].color); }
  populationsFor(label, kind) {
    const l = (label || '').toLowerCase(); const hits = [];
    for (const k in POPULATIONS) { const P = POPULATIONS[k]; const words = kind === 'neuron' ? P.neurons : P.neuropils; if (words.some((w) => l.includes(w))) hits.push(k); }
    return hits;
  }
  /** Which model population a region/neuron label belongs to (for the info panel). */
  describe(label, kind) { return this.populationsFor(label, kind).map((k) => POPULATIONS[k].label); }
  update(dt, rates, out) {
    this._t += dt; const pulse = 0.6 + 0.4 * Math.sin(this._t * 6);
    for (const [id, o] of this.brain.objects) {
      let pops = this._assign.get(id); if (!pops) { pops = this.populationsFor(o.label, o.kind); this._assign.set(id, pops); }
      if (this.brain.selectedId === id) continue;
      let best = 0, bestK = null; for (const k of pops) { const v = rates[k] || 0; if (v > best) { best = v; bestK = k; } }
      if (out && out.escape && pops.includes('GF')) best = 1;
      const glow = best * pulse;
      if (bestK) o.material.emissive.copy(this._colors[bestK]); else o.material.emissive.set(0x000000);
      o.material.emissiveIntensity = glow * (o.kind === 'neuron' ? 1.6 : 0.9);
      if (o.kind === 'neuropil') o.material.opacity = 0.16 + 0.4 * best;
    }
  }
}
