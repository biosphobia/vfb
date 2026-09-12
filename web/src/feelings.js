// A small affect model for the fly. Values are 0..1 and drift toward baselines;
// events push them. Illustrative: fruit flies do show nociception, reward
// seeking, hunger, fear-like escape, arousal and sleep drive.
export const FEELINGS = {
  pain:       { label: 'Pain',       color: '#ff3b3b', base: 0.00, tau: 6,  desc: 'Nociception: a poke, a hit, heat.' },
  pleasure:   { label: 'Pleasure',   color: '#ff7ad9', base: 0.20, tau: 12, desc: 'Reward: sugar, a good smell, music.' },
  hunger:     { label: 'Hunger',     color: '#ffb333', base: 0.35, tau: 200,desc: 'Rises slowly, drops when it feeds.' },
  fear:       { label: 'Fear',       color: '#b48cff', base: 0.00, tau: 8,  desc: 'Looming shadows, swats, predators.' },
  curiosity:  { label: 'Curiosity',  color: '#59bfff', base: 0.30, tau: 15, desc: 'New sights, smells and sounds.' },
  excitement: { label: 'Excitement', color: '#ffd959', base: 0.10, tau: 10, desc: 'Arousal: fast motion, chases, beats.' },
  calm:       { label: 'Calm',       color: '#8cf273', base: 0.60, tau: 10, desc: 'Nothing threatening; resting and grooming.' },
  fatigue:    { label: 'Tiredness',  color: '#a0a8b8', base: 0.15, tau: 60, desc: 'Flying is expensive; sleep restores.' },
  disgust:    { label: 'Disgust',    color: '#7fbf5a', base: 0.00, tau: 10, desc: 'Bitter tastes, rot, harsh chemicals.' },
};

export class Feelings {
  constructor() { this.v = {}; for (const k in FEELINGS) this.v[k] = FEELINGS[k].base; this._since = {}; }
  bump(k, amount) { this.v[k] = Math.min(1, Math.max(0, this.v[k] + amount)); }
  event(kind, strength = 1) {
    const s = strength;
    switch (kind) {
      case 'poke':     this.bump('pain', 0.55 * s); this.bump('fear', 0.3 * s); this.bump('calm', -0.4 * s); this.bump('excitement', 0.25 * s); break;
      case 'startle':  this.bump('fear', 0.45 * s); this.bump('excitement', 0.35 * s); this.bump('calm', -0.35 * s); break;
      case 'feed':     this.bump('pleasure', 0.45 * s); this.bump('hunger', -0.3 * s); this.bump('calm', 0.1 * s); break;
      case 'groove':   this.bump('pleasure', 0.3 * s); this.bump('excitement', 0.4 * s); break;
      case 'think':    this.bump('curiosity', 0.35 * s); break;
      case 'antenna':  this.bump('curiosity', 0.25 * s); break;
      case 'rest':     this.bump('calm', 0.4 * s); this.bump('fatigue', -0.15 * s); break;
      case 'select':   this.bump('curiosity', 0.2 * s); break;
      case 'video':    this.bump('curiosity', 0.5 * s); this.bump('excitement', 0.15 * s); break;
      case 'mood:hungry':    this.bump('hunger', 0.35 * s); this.bump('curiosity', 0.2 * s); break;
      case 'mood:scared':    this.bump('fear', 0.5 * s); this.bump('calm', -0.3 * s); break;
      case 'mood:groovy':    this.bump('pleasure', 0.3 * s); this.bump('excitement', 0.3 * s); break;
      case 'mood:sleepy':    this.bump('calm', 0.4 * s); this.bump('fatigue', 0.2 * s); break;
      case 'mood:excited':   this.bump('excitement', 0.5 * s); break;
      case 'mood:disgusted': this.bump('disgust', 0.6 * s); this.bump('pleasure', -0.2 * s); break;
      case 'mood:curious':   this.bump('curiosity', 0.3 * s); break;
      default: break;
    }
  }
  update(dt, ctx) {
    for (const k in FEELINGS) {
      const f = FEELINGS[k];
      this.v[k] += (f.base - this.v[k]) * Math.min(1, dt / f.tau);
    }
    if (ctx.behaviour === 'fly') { this.bump('fatigue', 0.02 * dt); this.bump('excitement', 0.02 * dt); this.bump('calm', -0.02 * dt); }
    else if (ctx.behaviour === 'walk' || ctx.moving) { this.bump('fatigue', 0.006 * dt); }
    else { this.bump('fatigue', -0.01 * dt); this.bump('calm', 0.01 * dt); }
    this.bump('hunger', 0.0006 * dt);
    if (ctx.videoPlaying) { this.bump('curiosity', 0.01 * dt); this.bump('calm', -0.005 * dt); }
    if (this.v.pain > 0.4) this.bump('calm', -0.05 * dt);
    // calm is squeezed out by strong negative states
    const tension = Math.max(this.v.pain, this.v.fear, this.v.disgust, this.v.excitement * 0.7);
    this.v.calm = Math.min(this.v.calm, 1 - tension * 0.8);
  }
  dominant() {
    let best = 'calm', bv = -1;
    for (const k in this.v) { const w = this.v[k] * (k === 'calm' ? 0.75 : k === 'hunger' ? 0.8 : 1); if (w > bv) { bv = w; best = k; } }
    return best;
  }
  phrase() {
    const d = this.dominant(); const v = this.v[d];
    const q = v > 0.75 ? 'very ' : v > 0.45 ? '' : 'a little ';
    const word = { pain: 'hurt', pleasure: 'pleased', hunger: 'hungry', fear: 'afraid', curiosity: 'curious', excitement: 'excited', calm: 'calm', fatigue: 'tired', disgust: 'disgusted' }[d];
    return `${q}${word}`;
  }
  snapshot() { const o = {}; for (const k in this.v) o[k] = Math.round(this.v[k] * 100) / 100; return o; }
}
