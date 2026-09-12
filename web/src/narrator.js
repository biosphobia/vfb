// Live text derived from the circuit model. The programmatic lines quote the
// actual population rates; the optional AI line only rephrases the same
// snapshot (the server prompt forbids inventing anything not in it).
import { STATES } from './brainmodel.js';

export class Narrator {
  constructor(apiBase) {
    this.apiBase = (apiBase || '').replace(/\/$/, ''); this.aiAvailable = false; this.aiEnabled = true;
    this.doing = ''; this.feeling = ''; this.focus = ''; this._lastKey = ''; this._sinceLine = 999; this._sinceAi = 0; this._busy = false; this._snapshot = null;
    this.onUpdate = null; this.onLine = null; this.onAi = null;
    if (this.apiBase) fetch(this.apiBase + '/api/health').then((r) => r.json()).then((d) => { this.aiAvailable = !!d.ai; this.onAi && this.onAi(this.aiAvailable); }).catch(() => {});
  }
  setContext(model, ctx) {
    const lines = model.explain(); const st = model.state; const dom = model.dominantState();
    const o = model.out;
    let doing;
    if (o.escape) doing = 'Escape jump: the giant fiber fired.';
    else if (o.freeze) doing = 'Freezing: defensive arousal is high and a threat is in view.';
    else if (o.flight > 0.5) doing = 'Flying (giant fiber / takeoff pathway active).';
    else if (o.feed > 0.3) doing = 'Proboscis extension: tasting sugar.';
    else if (o.backward > 0.3) doing = 'Backing away (moonwalker descending neurons).';
    else if (Math.abs(o.forward) > 0.08) doing = `Walking${Math.abs(o.turn) > 0.15 ? (o.turn > 0 ? ', turning right' : ', turning left') : ''}: DNp09 drive ${Math.round(Math.abs(o.forward) * 100)}%.`;
    else if (Math.abs(o.turn) > 0.15) doing = `Turning ${o.turn > 0 ? 'right' : 'left'} in place (DNa02).`;
    else if (o.quiescence > 0.5) doing = 'Quiescent: sleep-promoting dFB neurons are active.';
    else if (o.groom > 0.3) doing = 'Grooming.';
    else doing = ctx.hasVision ? 'Standing still, watching.' : 'Standing still.';
    this.doing = doing;
    const S = STATES[dom]; const v = st[dom];
    this.feeling = `${S.label} is the strongest internal state (${Math.round(v * 100)}%). ${S.desc}`;
    this.focus = lines[0] || '';
    this._snapshot = { ...model.snapshot(), context: { seeing: ctx.hasVision, source: ctx.source, selected: ctx.selectedLabel || '' } };
    this.onUpdate && this.onUpdate(this.doing, this.feeling, lines);
    const key = doing + '|' + dom + '|' + (lines[0] || '');
    if (key !== this._lastKey) { this._lastKey = key; this._sinceLine = 999; }
  }
  update(dt) {
    this._sinceLine += dt; this._sinceAi += dt;
    if (this._sinceLine > 5 && this.doing) {
      this._sinceLine = 0; this.push(this.doing + ' ' + this.focus, false);
      if (this.aiEnabled && this.aiAvailable && !this._busy && this._sinceAi > 14) { this._sinceAi = 0; this._askAi(); }
    }
  }
  push(text, ai) { this.onLine && this.onLine(text, ai); }
  async _askAi() {
    if (!this._snapshot) return; this._busy = true;
    try { const r = await fetch(this.apiBase + '/api/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: this._snapshot }) }); if (r.ok) { const d = await r.json(); if (d.ai && d.text) this.push(d.text, true); } }
    catch {} finally { this._busy = false; }
  }
}
