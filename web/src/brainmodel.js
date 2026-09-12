// A mechanistic, rate-based model of the fly circuits that turn sensory input
// into behaviour. Every population is a real, named neuron class that exists in
// Virtual Fly Brain; every behaviour is a descending-neuron readout; every
// "internal state" is one with an identified circuit in the literature.
// Rates are dimensionless 0..1 (normalised firing). Time in seconds.
//
// This is a simplification (no spikes, no full connectome), but the wiring
// follows the published pathways listed in CIRCUITS below, and nothing here is
// inferred from labels, titles or text: only from the pixel array, touch,
// taste and optogenetic inputs, and from the model's own history.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const relu = (v) => (v > 0 ? v : 0);
const sig = (x, k = 8) => 1 / (1 + Math.exp(-k * x));

export const GRID_W = 48, GRID_H = 27;      // ~1300 sampled "ommatidia" (a fly has ~750 per eye)

/** Populations shown in the monitor, mapped onto VFB anatomy for the glow. */
export const POPULATIONS = {
  R16:    { label: 'Photoreceptors R1-6', short: 'R1-6',  neuropils: ['lamina'], neurons: ['photoreceptor'], color: '#c8d0dc', group: 'vision' },
  L1L2:   { label: 'Lamina L1 / L2 (ON / OFF)', short: 'L1/L2', neuropils: ['lamina', 'medulla'], neurons: ['lamina monopolar', 'l1 ', 'l2 '], color: '#9ec5ff', group: 'vision' },
  T4T5:   { label: 'T4 / T5 motion detectors', short: 'T4/T5', neuropils: ['medulla', 'lobula'], neurons: ['t4 ', 't5 ', 't4/t5', 't4 neuron', 't5 neuron'], color: '#59bfff', group: 'vision' },
  HSVS:   { label: 'HS / VS optic-flow cells', short: 'HS/VS', neuropils: ['lobula plate'], neurons: ['horizontal system', 'vertical system', 'hs cell', 'vs cell', 'lobula plate tangential'], color: '#4fd1c5', group: 'vision' },
  LPLC2:  { label: 'LPLC2 / LC4 looming detectors', short: 'LPLC2', neuropils: ['lobula', 'lobula plate', 'posterior ventrolateral protocerebrum'], neurons: ['lplc2', 'lc4', 'lobula columnar'], color: '#ff8c4d', group: 'vision' },
  LC11:   { label: 'LC11 small-object detectors', short: 'LC11', neuropils: ['lobula', 'posterior ventrolateral protocerebrum'], neurons: ['lc11', 'lc10', 'lc12'], color: '#ffd959', group: 'vision' },
  MBONa3: { label: 'MBON-α\'3 novelty', short: 'MBON-α\'3', neuropils: ['alpha\'-lobe', "alpha'-lobe", 'calyx'], neurons: ['mbon', 'alpha\'3', 'output neuron'], color: '#f266f2', group: 'memory' },
  KC:     { label: 'Kenyon cells (MB)', short: 'KC', neuropils: ['mushroom body', 'calyx', 'pedunculus'], neurons: ['kenyon'], color: '#d98cff', group: 'memory' },
  PAM:    { label: 'PAM dopamine (reward)', short: 'PAM', neuropils: ['gamma-lobe', 'beta-lobe', "beta'-lobe", 'medial lobe'], neurons: ['pam', 'dopaminergic'], color: '#ff7ad9', group: 'valence' },
  PPL1:   { label: 'PPL1 dopamine (punishment)', short: 'PPL1', neuropils: ['alpha-lobe', 'pedunculus', 'vertical lobe'], neurons: ['ppl1', 'dopaminergic'], color: '#7fbf5a', group: 'valence' },
  GR5A:   { label: 'Gr5a sugar neurons', short: 'Gr5a', neuropils: ['gnathal ganglion', 'prow', 'saddle'], neurons: ['sugar', 'gr5a', 'gustatory'], color: '#ffb333', group: 'taste' },
  GR66A:  { label: 'Gr66a bitter neurons', short: 'Gr66a', neuropils: ['gnathal ganglion', 'prow'], neurons: ['bitter', 'gr66a', 'gustatory'], color: '#a3c957', group: 'taste' },
  NPF:    { label: 'NPF / AKH hunger signalling', short: 'NPF', neuropils: ['superior medial protocerebrum', 'gnathal ganglion'], neurons: ['npf', 'akh', 'neuropeptide f'], color: '#ffa64d', group: 'state' },
  DFB:    { label: 'dFB / R5 sleep-promoting', short: 'dFB', neuropils: ['fan-shaped body', 'ellipsoid body', 'bulb'], neurons: ['dorsal fan-shaped', 'r5', 'ring neuron', 'ellipsoid body'], color: '#a0a8b8', group: 'state' },
  OCT:    { label: 'Octopamine arousal', short: 'OA', neuropils: ['superior lateral protocerebrum', 'superior intermediate protocerebrum'], neurons: ['octopamin', 'tyramin'], color: '#ffe680', group: 'state' },
  MECH:   { label: 'Bristle / JO mechanosensory', short: 'Mech', neuropils: ['antennal mechanosensory', 'wedge', 'saddle', 'vest'], neurons: ['mechanosensory', 'bristle', 'johnston'], color: '#ffd27a', group: 'touch' },
  NOCI:   { label: 'Nociceptive (harsh touch)', short: 'Noci', neuropils: ['gnathal ganglion', 'antennal mechanosensory', 'vest'], neurons: ['nocicept', 'ppk'], color: '#ff3b3b', group: 'touch' },
  GF:     { label: 'Giant fiber (escape)', short: 'GF', neuropils: ['posterior ventrolateral protocerebrum', 'gnathal ganglion', 'inferior posterior slope'], neurons: ['giant fiber', 'giant fibre'], color: '#ff5966', group: 'motor' },
  DNA02:  { label: 'DNa02 descending (turn)', short: 'DNa02', neuropils: ['lateral accessory lobe', 'inferior posterior slope', 'posterior slope'], neurons: ['dna02', 'descending'], color: '#ff9f66', group: 'motor' },
  DNP09:  { label: 'DNp09 descending (forward)', short: 'DNp09', neuropils: ['posterior slope', 'superior posterior slope', 'inferior posterior slope'], neurons: ['dnp09', 'descending'], color: '#66d9a3', group: 'motor' },
  MDN:    { label: 'Moonwalker DN (backward)', short: 'MDN', neuropils: ['posterior slope', 'gnathal ganglion'], neurons: ['moonwalker', 'mdn'], color: '#c9a3ff', group: 'motor' },
  PER:    { label: 'Proboscis extension motor', short: 'PER', neuropils: ['gnathal ganglion', 'prow', 'saddle'], neurons: ['proboscis', 'motor neuron 9', 'mn9'], color: '#ffc266', group: 'motor' },
};

/** Internal states with identified circuits (the "feelings" a fly measurably has). */
export const STATES = {
  defensive:  { label: 'Defensive arousal', color: '#b48cff', desc: 'Fear-like state: looming threats (LPLC2/LC4 → giant fiber) raise a persistent defensive arousal that lowers the escape threshold and causes freezing or escape.', ref: 'Gibson et al. 2015, Curr Biol; von Reyn et al. 2014, Nat Neurosci; Klapoetke et al. 2017, Nature' },
  nociception:{ label: 'Nociception (pain-like)', color: '#ff3b3b', desc: 'Harsh mechanical stimulation drives nociceptive neurons and escape/avoidance; adults show sensitised nociception after injury.', ref: 'Tracey et al. 2003, Cell; Neely et al. 2010, Cell; Khuong et al. 2019, Sci Adv' },
  hunger:     { label: 'Hunger (NPF / AKH)', color: '#ffb333', desc: 'Starvation raises NPF/AKH signalling, increases locomotion and sugar sensitivity; sugar intake lowers it.', ref: 'Dus et al. 2011, PNAS; Wu et al. 2005, Neuron; Bräcker et al. 2013, Curr Biol' },
  reward:     { label: 'Reward (PAM dopamine)', color: '#ff7ad9', desc: 'Positive valence: sugar activates PAM dopaminergic neurons that write appetitive memory into the mushroom body.', ref: 'Burke et al. 2012, Nature; Liu et al. 2012, Nature; Aso et al. 2014, eLife' },
  aversion:   { label: 'Aversion (PPL1 dopamine)', color: '#7fbf5a', desc: 'Negative valence: bitter taste, harsh touch and threat activate PPL1 dopaminergic neurons (punishment signal).', ref: 'Claridge-Chang et al. 2009, Cell; Aso et al. 2012, PLoS Genet; Weiss et al. 2011, Nat Neurosci' },
  sleep:      { label: 'Sleep pressure (dFB / R5)', color: '#a0a8b8', desc: 'Homeostatic sleep drive accumulates with wake time and activity (R5 ring neurons) and is discharged by sleep-promoting dFB neurons.', ref: 'Donlea et al. 2011, Science; Liu et al. 2016, Cell; Donlea et al. 2018, Neuron' },
  arousal:    { label: 'Locomotor arousal (octopamine)', color: '#ffe680', desc: 'General activation: visual motion, flicker and touch raise octopaminergic/dopaminergic arousal and locomotor drive.', ref: 'Crocker & Sehgal 2008, J Neurosci; Lebestky et al. 2009, Neuron; van Swinderen & Andretic 2011, Proc R Soc B' },
  novelty:    { label: 'Novelty / attention', color: '#59bfff', desc: 'A new visual scene drives MBON-α\'3 strongly; the response decays as the scene becomes familiar. Flies show attention-like selection of salient objects.', ref: 'Hattori et al. 2017, Cell; van Swinderen 2007, Nat Rev Neurosci; Tang & Juusola 2010, Front Neurosci' },
};

/** The pathways implemented, in the order signals flow (shown live in the Science tab). */
export const CIRCUITS = [
  { name: 'Optomotor response', chain: ['R16', 'L1L2', 'T4T5', 'HSVS', 'DNA02'], out: 'turn', desc: 'Wide-field image motion → T4 (ON) / T5 (OFF) Reichardt detectors → HS/VS tangential cells → DNa02 → the fly turns with the motion.', ref: 'Hassenstein & Reichardt 1956; Maisak et al. 2013, Nature; Borst 2014, Nat Rev Neurosci; Rayshubskiy et al. 2020, bioRxiv' },
  { name: 'Looming escape', chain: ['R16', 'L1L2', 'T4T5', 'LPLC2', 'GF'], out: 'escape', desc: 'Radially expanding dark edges → LPLC2 / LC4 → giant fiber → jump and takeoff. Defensive arousal lowers the threshold.', ref: 'von Reyn et al. 2014; Klapoetke et al. 2017; Ache et al. 2019, Curr Biol' },
  { name: 'Object fixation', chain: ['R16', 'L1L2', 'LC11', 'DNA02'], out: 'turn', desc: 'A small high-contrast moving object → LC11/LC10 → orientation toward it.', ref: 'Keleş & Frye 2017, Curr Biol; Ribeiro et al. 2018, Cell' },
  { name: 'Novelty', chain: ['R16', 'KC', 'MBONa3'], out: 'novelty', desc: 'Kenyon cells sparse-code the scene; MBON-α\'3 fires to novel scenes and adapts to familiar ones.', ref: 'Hattori et al. 2017, Cell' },
  { name: 'Feeding reflex', chain: ['GR5A', 'PER'], out: 'feed', desc: 'Sugar on the tarsi/proboscis → Gr5a neurons → proboscis extension (PER), gated by hunger; reward via PAM.', ref: 'Dethier 1976; Gordon & Scott 2009, Neuron; Marella et al. 2006, Neuron' },
  { name: 'Bitter avoidance', chain: ['GR66A', 'PPL1', 'MDN'], out: 'backward', desc: 'Bitter → Gr66a → aversion (PPL1) and retreat (moonwalker DN).', ref: 'Weiss et al. 2011; Bidaye et al. 2014, Science' },
  { name: 'Touch escape', chain: ['MECH', 'NOCI', 'GF'], out: 'escape', desc: 'Harsh touch → bristle/nociceptive input → escape; light touch → grooming.', ref: 'Tracey et al. 2003; Seeds et al. 2014, eLife; Hampel et al. 2015, eLife' },
  { name: 'Sleep / wake', chain: ['DFB', 'DNP09'], out: 'quiescence', desc: 'Sleep pressure (R5) → dFB activity → locomotor drive shut down; wake stimuli reverse it.', ref: 'Donlea et al. 2011, 2018; Liu et al. 2016' },
  { name: 'Hunger-driven locomotion', chain: ['NPF', 'OCT', 'DNP09'], out: 'walk', desc: 'Starvation raises locomotor drive via NPF/AKH and octopamine; a satiated fly walks less.', ref: 'Yang et al. 2015, PNAS; Yu et al. 2016, Sci Rep' },
];

export class BrainModel {
  constructor() {
    this.t = 0;
    this.rate = {}; for (const k in POPULATIONS) this.rate[k] = 0;
    this.state = { defensive: 0, nociception: 0, hunger: 0.35, reward: 0.05, aversion: 0, sleep: 0.1, arousal: 0.2, novelty: 0.2 };
    // motor readout
    this.out = { forward: 0, turn: 0, escape: false, backward: 0, feed: 0, groom: 0, quiescence: 0, flight: 0 };
    // vision buffers
    const n = GRID_W * GRID_H;
    this.lum = new Float32Array(n); this.adapt = new Float32Array(n).fill(0.4); this.contrast = new Float32Array(n);
    this.on = new Float32Array(n); this.off = new Float32Array(n); this.lpOn = new Float32Array(n); this.lpOff = new Float32Array(n);
    this.mx = new Float32Array(n); this.my = new Float32Array(n);   // local motion field (T4+T5), +x = rightward, +y = downward
    this.prevOff = new Float32Array(n); this.darkPrev = 0;
    this.fp = new Float32Array(32); this.mem = new Float32Array(32).fill(0.4); this.memInit = false;
    this.hasVision = false; this.visionAge = 999;
    // inputs (set by the app each frame)
    this.input = { poke: 0, harsh: 0, sugar: 0, bitter: 0, opto: {}, nudge: { fwd: 0, turn: 0 } };
    this._gfRefractory = 0; this._loomEvents = 0; this._lastNovel = 0; this._groomPhase = 0; this._motionEnergy = 0; this._flicker = 0;
    this.signals = { hs: 0, vs: 0, loom: 0, objAz: 0, objEnergy: 0, flicker: 0, motion: 0, novelty: 0, brightness: 0 };
  }

  /** Feed a luminance frame (GRID_W x GRID_H, values 0..1). Call at video rate. */
  see(lum, dt) {
    const n = lum.length; const W = GRID_W, H = GRID_H;
    this.hasVision = true; this.visionAge = 0;
    const ka = Math.min(1, dt / 0.6), kd = Math.min(1, dt / 0.06);
    let sumOn = 0, sumOff = 0, flick = 0, bright = 0;
    for (let i = 0; i < n; i++) {
      const L = lum[i]; bright += L;
      this.adapt[i] += (L - this.adapt[i]) * ka;                    // photoreceptor light adaptation
      const c = (L - this.adapt[i]) / (this.adapt[i] + 0.08);       // Weber contrast
      flick += Math.abs(c - this.contrast[i]); this.contrast[i] = c;
      const on = relu(c), off = relu(-c);
      this.lpOn[i] += (this.on[i] - this.lpOn[i]) * kd;             // delayed copies (the Reichardt delay line)
      this.lpOff[i] += (this.off[i] - this.lpOff[i]) * kd;
      this.on[i] = on; this.off[i] = off; sumOn += on; sumOff += off;
    }
    // Hassenstein–Reichardt correlators (T4 on ON, T5 on OFF), 4 directions
    let hs = 0, vs = 0, loom = 0, objE = 0, objAzNum = 0, energy = 0;
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    let t4 = 0, t5 = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const r = this.on[i] * this.lpOn[i - 1] - this.on[i - 1] * this.lpOn[i] + this.off[i] * this.lpOff[i - 1] - this.off[i - 1] * this.lpOff[i];
      const d = this.on[i] * this.lpOn[i - W] - this.on[i - W] * this.lpOn[i] + this.off[i] * this.lpOff[i - W] - this.off[i - W] * this.lpOff[i];
      this.mx[i] = r; this.my[i] = d;
      t4 += Math.abs(this.on[i] * this.lpOn[i - 1] - this.on[i - 1] * this.lpOn[i]); t5 += Math.abs(this.off[i] * this.lpOff[i - 1] - this.off[i - 1] * this.lpOff[i]);
      hs += r; vs += d; energy += Math.abs(r) + Math.abs(d);
      const dx = x - cx, dy = y - cy; const rr = Math.hypot(dx, dy) + 1e-3;
      loom += (r * dx + d * dy) / rr;                                  // radial (expanding) flow → LPLC2
    }
    const cells = (W - 2) * (H - 2);
    hs /= cells; vs /= cells; loom /= cells; energy /= cells;
    // LC4-like size cue: growth of dark area
    const dark = sumOff / n; const darkGrowth = relu(dark - this.darkPrev) / Math.max(dt, 1e-3); this.darkPrev = dark;
    // small-object energy: local motion not explained by the mean flow
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; const e = Math.abs(this.mx[i] - hs) + Math.abs(this.my[i] - vs);
      if (e > 0.02 + 2 * energy) { objE += e; objAzNum += e * (x - cx) / cx; }
    }
    const objAz = objE > 1e-6 ? objAzNum / objE : 0;
    // scene fingerprint for novelty (8x4 mean luminance)
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 8; bx++) {
      let s = 0, k = 0;
      for (let y = Math.floor(by * H / 4); y < Math.floor((by + 1) * H / 4); y++) for (let x = Math.floor(bx * W / 8); x < Math.floor((bx + 1) * W / 8); x++) { s += lum[y * W + x]; k++; }
      this.fp[by * 8 + bx] = s / Math.max(1, k);
    }
    if (!this.memInit) { this.mem.set(this.fp); this.memInit = true; }
    let num = 0, da = 0, db = 0, ma = 0, mb = 0; for (let i = 0; i < 32; i++) { ma += this.fp[i]; mb += this.mem[i]; } ma /= 32; mb /= 32;
    for (let i = 0; i < 32; i++) { const a = this.fp[i] - ma, b = this.mem[i] - mb; num += a * b; da += a * a; db += b * b; }
    const corr = num / (Math.sqrt(da * db) + 1e-6);
    const novelty = clamp01(1 - corr);
    const km = Math.min(1, dt / 20); for (let i = 0; i < 32; i++) this.mem[i] += (this.fp[i] - this.mem[i]) * km;   // familiarisation
    this.signals = { hs: clamp01(Math.abs(hs) * 25) * Math.sign(hs), vs: clamp01(Math.abs(vs) * 25) * Math.sign(vs), loom: clamp01(loom * 60 + darkGrowth * 2.5), objAz, objEnergy: clamp01(objE / cells * 40), flicker: clamp01(flick / n * 6), motion: clamp01(energy * 30), novelty, brightness: bright / n, t4: clamp01(t4 / cells * 40), t5: clamp01(t5 / cells * 40) };
  }

  noVision() { this.hasVision = false; }

  /** Advance the circuit by dt seconds using the current sensory signals and inputs. */
  step(dt) {
    this.t += dt; this.visionAge += dt;
    const S = this.signals, st = this.state, r = this.rate, inp = this.input, opto = inp.opto || {};
    const seeing = this.hasVision && this.visionAge < 0.5;
    const lp = (cur, goal, tau) => cur + (goal - cur) * Math.min(1, dt / tau);
    // ---- sensory populations
    r.R16 = lp(r.R16, seeing ? clamp01(0.2 + S.brightness) : 0.05, 0.05);
    r.L1L2 = lp(r.L1L2, seeing ? clamp01(S.flicker * 1.5 + S.motion) : 0.02, 0.05);
    r.T4T5 = lp(r.T4T5, seeing ? clamp01((S.t4 + S.t5) * 0.8 + S.motion * 0.5) : 0.02, 0.06);
    r.HSVS = lp(r.HSVS, seeing ? clamp01(Math.abs(S.hs) * 0.8 + Math.abs(S.vs) * 0.5) : 0.02, 0.08);
    r.LPLC2 = lp(r.LPLC2, seeing ? S.loom : 0, 0.05);
    r.LC11 = lp(r.LC11, seeing ? S.objEnergy : 0, 0.08);
    r.KC = lp(r.KC, seeing ? clamp01(0.1 + S.novelty * 0.3 + S.flicker * 0.2) : 0.05, 0.3);
    r.MBONa3 = lp(r.MBONa3, seeing ? clamp01(S.novelty * 1.2) : 0.03, 0.4);
    r.GR5A = lp(r.GR5A, clamp01(inp.sugar * (0.5 + 0.7 * st.hunger)), 0.1);
    r.GR66A = lp(r.GR66A, clamp01(inp.bitter), 0.1);
    r.MECH = lp(r.MECH, clamp01(inp.poke), 0.05);
    r.NOCI = lp(r.NOCI, clamp01(inp.harsh), 0.05);
    // ---- internal states (slow)
    if (r.LPLC2 > 0.5) this._loomEvents += dt * 2;
    st.defensive = clamp01(lp(st.defensive, 0, 60) + relu(r.LPLC2 - 0.4) * dt * 1.5 + r.NOCI * dt * 0.8);
    st.nociception = clamp01(lp(st.nociception, 0, 8) + r.NOCI * dt * 6);
    st.hunger = clamp01(st.hunger + 0.0006 * dt - r.GR5A * dt * 0.25);
    st.reward = clamp01(lp(st.reward, 0.05, 15) + r.GR5A * dt * 1.2);
    st.aversion = clamp01(lp(st.aversion, 0, 15) + r.GR66A * dt * 1.5 + r.NOCI * dt * 0.6 + relu(r.LPLC2 - 0.4) * dt * 0.5);
    const activity = Math.abs(this.out.forward) + Math.abs(this.out.turn) * 0.5 + this.out.flight;
    const wakeInput = seeing ? S.motion + S.flicker : 0;
    st.sleep = clamp01(st.sleep + dt * (0.0004 + 0.0008 * activity) - (this.out.quiescence > 0.5 ? dt * 0.004 : 0) - wakeInput * dt * 0.002);
    st.arousal = clamp01(lp(st.arousal, 0.15 + 0.4 * st.hunger, 10) + (wakeInput * 0.8 + r.MECH * 0.6 + r.NOCI + r.LPLC2) * dt * 1.2);
    st.novelty = clamp01(lp(st.novelty, 0.05, 8) + r.MBONa3 * dt * 1.5 + r.LC11 * dt * 0.8);
    // ---- modulatory populations
    r.NPF = lp(r.NPF, st.hunger, 0.5); r.OCT = lp(r.OCT, st.arousal, 0.5);
    r.PAM = lp(r.PAM, clamp01(r.GR5A * 0.9 + st.reward * 0.6), 0.2);
    r.PPL1 = lp(r.PPL1, clamp01(r.GR66A * 0.9 + r.NOCI * 0.8 + relu(r.LPLC2 - 0.4) + st.aversion * 0.5), 0.2);
    const sleepDrive = sig(st.sleep - 0.45 - st.arousal * 0.6, 6) * (1 - st.defensive * 0.8) + (opto.dfb || 0);
    r.DFB = lp(r.DFB, clamp01(sleepDrive), 0.8);
    // ---- descending / motor readout
    this._gfRefractory = Math.max(0, this._gfRefractory - dt);
    const gfDrive = r.LPLC2 * (1 + st.defensive * 0.8) + r.NOCI * 0.9 + (opto.gf || 0);
    const gfThreshold = 0.55 - st.defensive * 0.2;
    r.GF = lp(r.GF, clamp01(gfDrive), 0.03);
    const escape = this._gfRefractory <= 0 && gfDrive > gfThreshold;
    if (escape) this._gfRefractory = 1.8;
    const freeze = st.defensive > 0.35 && r.LPLC2 > 0.15 && !escape;
    const walkDrive = clamp01(0.15 * st.arousal + 0.45 * st.hunger * st.arousal + 0.5 * r.LC11 + (opto.walk || 0) + inp.nudge.fwd) * (1 - r.DFB) * (freeze ? 0.05 : 1);
    r.DNP09 = lp(r.DNP09, walkDrive, 0.15);
    const backDrive = clamp01(r.GR66A * 0.8 + (r.LPLC2 > 0.25 && !escape ? r.LPLC2 * 0.6 : 0) + (inp.nudge.fwd < 0 ? -inp.nudge.fwd : 0) + (opto.mdn || 0));
    r.MDN = lp(r.MDN, backDrive, 0.15);
    // turning: optomotor (follow wide-field motion) + fixation (toward small object) + optogenetics + nudge
    const turnDrive = (seeing ? S.hs * 1.2 + S.objAz * r.LC11 * 1.5 : 0) + (opto.turn || 0) + inp.nudge.turn;
    r.DNA02 = lp(r.DNA02, clamp01(Math.abs(turnDrive)), 0.12);
    r.PER = lp(r.PER, clamp01(r.GR5A * (0.6 + 0.6 * st.hunger) - r.GR66A), 0.2);
    // grooming: quiet + light touch or after mechanosensory input
    this._groomPhase += dt; const groomDrive = (r.MECH > 0.3 && r.NOCI < 0.3 ? 0.8 : 0) + (st.arousal < 0.25 && r.DNP09 < 0.1 && Math.sin(this._groomPhase * 0.25) > 0.9 ? 0.5 : 0);
    this.out = {
      forward: r.DNP09 - r.MDN,
      turn: Math.sign(turnDrive) * r.DNA02,
      escape,
      flight: clamp01((opto.gf || 0) + (this._gfRefractory > 0.6 ? 1 : 0) + (opto.fly || 0)),
      backward: r.MDN,
      feed: r.PER,
      groom: clamp01(groomDrive),
      quiescence: r.DFB,
      freeze,
    };
    return this.out;
  }

  /** Text explanation of the strongest active pathway right now (for the story). */
  explain() {
    const r = this.rate, S = this.signals, st = this.state, o = this.out; const lines = [];
    if (o.escape || this._gfRefractory > 1.5) lines.push(`Looming (LPLC2 ${pct(r.LPLC2)}) crossed the giant-fiber threshold → escape jump.`);
    else if (o.freeze) lines.push(`Defensive arousal is high (${pct(st.defensive)}) and a threat is visible → freezing.`);
    if (this.hasVision && Math.abs(S.hs) > 0.15) lines.push(`Wide-field motion ${S.hs > 0 ? 'rightward' : 'leftward'} (HS ${pct(Math.abs(S.hs))}) → DNa02 → turning ${S.hs > 0 ? 'right' : 'left'} (optomotor).`);
    if (this.hasVision && r.LC11 > 0.2) lines.push(`Small moving object detected (LC11 ${pct(r.LC11)}) ${S.objAz > 0 ? 'to the right' : 'to the left'} → fixation.`);
    if (r.MBONa3 > 0.35) lines.push(`New scene: MBON-α'3 novelty response ${pct(r.MBONa3)}.`);
    if (r.PER > 0.3) lines.push(`Sugar on Gr5a neurons (${pct(r.GR5A)}) × hunger (${pct(st.hunger)}) → proboscis extension.`);
    if (r.GR66A > 0.3) lines.push(`Bitter on Gr66a (${pct(r.GR66A)}) → PPL1 aversion → backing away.`);
    if (r.NOCI > 0.3) lines.push(`Harsh touch → nociceptors (${pct(r.NOCI)}) → escape and PPL1 punishment signal.`);
    if (r.DFB > 0.5) lines.push(`Sleep pressure (${pct(st.sleep)}) → dFB active (${pct(r.DFB)}) → quiescence.`);
    if (!lines.length) lines.push(this.hasVision ? `Quiet scene: T4/T5 ${pct(r.T4T5)}, novelty ${pct(r.MBONa3)}; locomotor drive DNp09 ${pct(r.DNP09)} set by arousal ${pct(st.arousal)} and hunger ${pct(st.hunger)}.` : `No visual input reaching the eyes. Locomotor drive DNp09 ${pct(r.DNP09)} from arousal ${pct(st.arousal)} and hunger ${pct(st.hunger)}.`);
    return lines;
  }
  dominantState() { let b = 'arousal', bv = -1; for (const k in this.state) { const w = this.state[k] * (k === 'hunger' ? 0.8 : k === 'sleep' ? 0.9 : 1); if (w > bv) { bv = w; b = k; } } return b; }
  snapshot() { const s = {}; for (const k in this.state) s[k] = +this.state[k].toFixed(2); const p = {}; for (const k in this.rate) p[k] = +this.rate[k].toFixed(2); return { states: s, populations: p, signals: { hs: +this.signals.hs.toFixed(2), loom: +this.signals.loom.toFixed(2), motion: +this.signals.motion.toFixed(2), novelty: +this.signals.novelty.toFixed(2), objEnergy: +this.signals.objEnergy.toFixed(2) }, out: { forward: +this.out.forward.toFixed(2), turn: +this.out.turn.toFixed(2), escape: this.out.escape, feed: +this.out.feed.toFixed(2), quiescence: +this.out.quiescence.toFixed(2), freeze: !!this.out.freeze }, hasVision: this.hasVision }; }
}
function pct(v) { return Math.round(v * 100) + '%'; }
