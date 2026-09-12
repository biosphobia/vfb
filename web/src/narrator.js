// Live description of what the fly is doing / feeling / attending to; optional AI lines.
export class Narrator {
  constructor(apiBase) {
    this.apiBase = (apiBase || '').replace(/\/$/, ''); this.aiAvailable = false; this.aiEnabled = true;
    this.lines = []; this.doing = ''; this.feeling = ''; this.focus = '';
    this._ctx = {}; this._lastKey = ''; this._sinceLine = 999; this._sinceAi = 0; this._busy = false;
    this.onUpdate = null; this.onLine = null;
    if (this.apiBase) fetch(this.apiBase + '/api/health').then((r) => r.json()).then((d) => { this.aiAvailable = !!d.ai; this.onAi && this.onAi(this.aiAvailable); }).catch(() => {});
  }
  setContext(ctx) { this._ctx = ctx; this._compose(); }
  _compose() {
    const c = this._ctx; const beh = c.behaviour || 'idle'; const r = c.reaction || ''; const mood = c.mood || '';
    const iv = c.idleVariant || 0; const fp = c.feelingPhrase || 'calm'; const dom = c.dominantFeeling || 'calm';
    if (r === 'startle') this.doing = 'Startled! Jumping back with a burst of wing beats.';
    else if (r === 'feed') this.doing = 'Extending its proboscis to taste.';
    else if (r === 'groove') this.doing = 'Bobbing its head and flicking its wings to the beat.';
    else if (r === 'antenna') this.doing = 'Twitching its antennae to sample the air.';
    else if (r === 'think') this.doing = 'Pausing to process something familiar.';
    else if (beh === 'fly') this.doing = 'Hovering, wings beating around 200 times a second.';
    else if (beh === 'walk' || c.moving) this.doing = 'Walking with a tripod gait: three legs down, three legs swinging.';
    else if (c.watching) this.doing = 'Standing still, facing the screen, eyes locked on the motion.';
    else this.doing = ['Resting and grooming, antennae gently scanning.', 'Standing still, taking in the surroundings.', 'Idling, abdomen pulsing as it breathes.'][iv % 3];
    let f = `Feeling ${fp}.`;
    const why = { pain: 'That poke hurt; its alarm circuits are firing.', fear: 'Something looked dangerous; escape reflexes are primed.', hunger: 'It has not eaten in a while.', pleasure: 'That was rewarding.', curiosity: 'Something new is worth investigating.', excitement: 'Lots going on; it is keyed up.', fatigue: 'Flying and walking add up; it wants to rest.', disgust: 'That smelled or tasted wrong.', calm: 'Nothing threatening around.' }[dom];
    if (why) f += ' ' + why;
    if (c.topSystemLabel) f += ` Busiest brain system: ${c.topSystemLabel.toLowerCase()}.`;
    this.feeling = f;
    if (c.watching && c.videoTitle) this.focus = `Watching “${c.videoTitle}” on the screen${c.videoPlaying ? '' : ' (paused)'}.`;
    else if (c.selectedLabel) this.focus = `Looking at the ${c.selectedLabel} you selected.`;
    else if (c.poked) this.focus = 'Reacting to being poked.';
    else this.focus = 'Nothing in particular. Try selecting a brain part or showing it a video.';
    this.onUpdate && this.onUpdate(this.doing, this.feeling, this.focus);
    const key = this.doing + '|' + this.focus + '|' + mood + '|' + dom;
    if (key !== this._lastKey) { this._lastKey = key; this._sinceLine = 999; }
  }
  update(dt) {
    this._sinceLine += dt; this._sinceAi += dt;
    if (this._sinceLine > 6 && this.doing) {
      this._sinceLine = 0; const text = this.doing + ' ' + this.feeling;
      if (this.lines.length && this.lines[this.lines.length - 1].text === text) return;
      this.push(text, false);
      if (this.aiEnabled && this.aiAvailable && !this._busy && this._sinceAi > 14) { this._sinceAi = 0; this._askAi(); }
    }
  }
  push(text, ai) { this.lines.push({ text, ai }); if (this.lines.length > 14) this.lines.shift(); this.onLine && this.onLine(text, ai); }
  async _askAi() {
    this._busy = true;
    try {
      const r = await fetch(this.apiBase + '/api/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: this._ctx }) });
      if (r.ok) { const d = await r.json(); if (d.ai && d.text) this.push(d.text, true); }
    } catch (e) { /* offline: keep the programmatic story */ } finally { this._busy = false; }
  }
}
