// Fly body loading + procedural animation (port of the Godot FlyRig).
// Segment-local frames follow MuJoCo: x = anterior, y = left, z = up.
// DOF rotations are intrinsic: q = rest * Rx(yaw) * Ry(pitch) * Rz(roll).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYER_BODY } from './scene.js';

const TRIPOD_A = ['lf', 'rm', 'lh'];
const D2R = Math.PI / 180;
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

export async function loadFlyModel(url, onProgress) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(url, res, onProgress, rej));
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      // smooth shading: merge duplicated vertices, then recompute normals
      try { const g = BufferGeometryUtils.mergeVertices(o.geometry, 1e-5); g.computeVertexNormals(); o.geometry = g; } catch {}
      o.castShadow = true; o.receiveShadow = false; o.layers.set(LAYER_BODY);
      if (o.material) { o.material.side = THREE.FrontSide; if (o.material.transparent) o.material.depthWrite = false; }
    }
  });
  return root;
}

/** Boxy stand-in when the NeuroMechFly GLB has not been generated. */
export function placeholderFly(rig) {
  const root = new THREE.Group(); root.name = rig.root_node || 'FlyBody';
  root.quaternion.setFromAxisAngle(AX, -Math.PI / 2);
  const nodes = {}; const pending = [...rig.nodes]; let guard = 0;
  const colors = { body: 0x96631f, abdomen: 0x85571c, leg: 0x9e6b29, antenna: 0x996624, eye: 0xab3520, wing: 0xccccee, arista: 0x42332a, haltere: 0x966e3d };
  while (pending.length && guard++ < 10000) {
    const n = pending.shift();
    const parent = n.parent == null ? root : nodes[n.parent];
    if (!parent) { pending.push(n); continue; }
    const g = new THREE.Group(); g.name = n.name;
    const p = n.local_pos_mm || [0, 0, 0], q = n.local_quat_wxyz || [1, 0, 0, 0];
    g.position.set(p[0], p[1], p[2]); g.quaternion.set(q[1], q[2], q[3], q[0]);
    const mn = n.aabb_min_mm || [-0.05, -0.05, -0.05], mx = n.aabb_max_mm || [0.05, 0.05, 0.05];
    const size = [Math.max(0.02, mx[0] - mn[0]), Math.max(0.02, mx[1] - mn[1]), Math.max(0.02, mx[2] - mn[2])];
    const mat = new THREE.MeshStandardMaterial({ color: colors[n.category] ?? 0x8b5a2b, roughness: 0.7, transparent: n.category === 'wing', opacity: n.category === 'wing' ? 0.35 : 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set((mx[0] + mn[0]) / 2, (mx[1] + mn[1]) / 2, (mx[2] + mn[2]) / 2);
    mesh.castShadow = true; mesh.layers.set(LAYER_BODY);
    g.add(mesh); parent.add(g); nodes[n.name] = g;
  }
  return root;
}

export class FlyRig {
  constructor(modelRoot, rig) {
    this.joints = new Map();
    for (const n of rig.nodes || []) {
      const node = modelRoot.getObjectByName(n.name);
      if (node) this.joints.set(n.name, { node, rest: node.quaternion.clone() });
    }
    this.legs = rig.legs || {}; this.wings = rig.wings || {};
    this.behaviour = 'idle';
    this.stepHz = 2.5; this.strideDeg = 20; this.liftDeg = 24; this.flapHz = 9; this.flapDeg = 40; this.idleAmount = 1;
    this.forwardSpeed = 0; this.turnRate = 0; this.hover = 0;
    this.lookYawDeg = 0; this.lookPitchDeg = 0;
    this._t = 0; this._walk = 0; this._fly = 0; this._phase = 0; this._flap = 0;
    this._drive = 0; this._turn = 0; this._hold = 0; this._flightDrive = 0; this._groom = 0; this._freeze = false;
    this._startle = 0; this._rWalk = 0; this._rAnt = 0; this._rThink = 0; this._rFeed = 0; this._rGroove = 0; this._rest = 0;
    this._lookYaw = 0; this._lookPitch = 0;
    const lf = this.legs.lf || {}; const probes = lf.probes || {}; const sd = lf.sweep_dof || 'coxa.roll';
    this.strideMm = probes[sd] ? Math.max(0.2, Math.abs(probes[sd][0]) / 10 * this.strideDeg * 2) : 0.7;
    this.onBehaviour = null;
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
  }
  get jointCount() { return this.joints.size; }
  /** Drive the body from the brain model's descending-neuron readout. */
  applyMotor(out) {
    this._drive = THREE.MathUtils.clamp(out.forward, -1, 1);
    this._turn = THREE.MathUtils.clamp(out.turn, -1, 1);
    this._hold = Math.abs(this._drive) > 0.04 || Math.abs(this._turn) > 0.04 ? 0.35 : this._hold;
    if (out.escape) this._startle = 1.4;
    this._flightDrive = out.flight;
    this._rFeed = out.feed > 0.25 ? Math.max(this._rFeed, 0.6) : this._rFeed;
    this._rest = out.quiescence;
    this._groom = out.groom;
    this._freeze = !!out.freeze;
    this.behaviour = out.escape || this._startle > 0.6 || out.flight > 0.5 ? 'fly' : (this._hold > 0 ? 'walk' : 'idle');
  }
  startle() { this._startle = 1.4; }
  react(kind, sec = 4) {
    switch (kind) {
      case 'fly': this._startle = sec; break;
      case 'walk': this._rWalk = sec; break;
      case 'antenna': this._rAnt = sec; break;
      case 'think': this._rThink = sec; break;
      case 'feed': this._rFeed = sec; break;
      case 'groove': this._rGroove = sec; break;
      case 'rest': this._rest = 1; break;
      case 'startle': this._startle = Math.min(sec, 1.6); break;
      default: break;
    }
  }
  reacting() {
    if (this._startle > 0) return 'startle'; if (this._rFeed > 0) return 'feed'; if (this._rGroove > 0) return 'groove';
    if (this._rAnt > 0) return 'antenna'; if (this._rThink > 0) return 'think'; return '';
  }
  update(dt) {
    if (!this.joints.size) return;
    this._t += dt;
    const dec = (v) => Math.max(0, v - dt);
    this._hold = dec(this._hold); this._startle = dec(this._startle); this._rWalk = dec(this._rWalk); this._rAnt = dec(this._rAnt);
    this._rThink = dec(this._rThink); this._rFeed = dec(this._rFeed); this._rGroove = dec(this._rGroove);
    this._rest = Math.max(0, this._rest - dt * 0.08);
    this._lookYaw += (this.lookYawDeg - this._lookYaw) * Math.min(1, dt * 3);
    this._lookPitch += (this.lookPitchDeg - this._lookPitch) * Math.min(1, dt * 3);

    const moving = this._hold > 0 && !this._freeze;
    const wantWalk = moving || this._rWalk > 0;
    const wantFly = this._flightDrive > 0.5 || this._startle > 0;
    const to = (v, goal, rate) => v + THREE.MathUtils.clamp(goal - v, -rate * dt, rate * dt);
    this._walk = to(this._walk, wantWalk && !wantFly ? 1 : 0, 3);
    this._fly = to(this._fly, wantFly ? 1 : 0, 2.5);
    const gait = moving ? this.stepHz * (1 + 0.6 * Math.abs(this._drive)) : this.stepHz;
    this._phase = (this._phase + Math.PI * 2 * gait * dt * this._walk) % (Math.PI * 2);
    this._flap = (this._flap + Math.PI * 2 * this.flapHz * dt * this._fly) % (Math.PI * 2);
    const dir = moving ? this._drive : (this._rWalk > 0 ? 1 : 0);
    this.forwardSpeed = this.strideMm * gait * dir * this._walk + 6 * this._drive * this._fly;
    this.turnRate = this._turn * 1.6 * Math.max(this._walk, this._fly);
    this.hover = 1.2 * this._fly + 0.12 * Math.sin(this._flap) * this._fly;

    const pose = new Map();
    const acc = (node, dof, deg) => { let a = pose.get(node); if (!a) { a = [0, 0, 0]; pose.set(node, a); } a[dof === 'yaw' ? 0 : dof === 'pitch' ? 1 : 2] += deg; };
    const accDof = (leg, spec, deg) => { const [seg, ax] = spec.split('.'); acc(`${leg}_${seg}`, ax, deg); };
    // ---- idle
    const k = this.idleAmount * (1 + 3 * Math.min(1, this._rAnt)) * (1 - 0.7 * this._rest) * (this._freeze ? 0.15 : 1);
    acc('c_head', 'roll', this._lookYaw); acc('c_head', 'pitch', this._lookPitch);
    if (this._rThink > 0) { acc('c_head', 'pitch', Math.sin(this._t * 6) * 5); acc('c_rostrum', 'pitch', 12 * Math.min(1, this._rThink)); acc('c_haustellum', 'pitch', 10 * Math.min(1, this._rThink)); }
    if (this._rFeed > 0) { const e = Math.min(1, this._rFeed); acc('c_rostrum', 'pitch', 35 * e + Math.sin(this._t * 4) * 6 * e); acc('c_haustellum', 'pitch', 30 * e); acc('c_head', 'pitch', 10 * e); }
    if (this._rGroove > 0) {
      const g = Math.min(1, this._rGroove), bpm = this._t * 2 * Math.PI * 2;
      acc('c_head', 'pitch', Math.sin(bpm) * 9 * g); acc('c_head', 'roll', Math.sin(bpm * 0.5) * 8 * g); acc('c_abdomen12', 'pitch', Math.sin(bpm) * 5 * g);
      for (const w in this.wings) { const m = this.wings[w]; acc(w, m.flap_dof || 'yaw', Math.max(0, Math.sin(bpm * 2)) * 18 * g * (m.flap_sign_up || 1)); }
    }
    if (this._groom > 0.05) {
      // front-leg grooming: legs rub over the head, head dips (Seeds et al. 2014)
      const g = this._groom, ph = this._t * 9;
      for (const leg of ['lf', 'rf']) { const m = this.legs[leg]; if (!m) continue; accDof(leg, m.lift_dof || 'trochanterfemur.pitch', (22 + Math.sin(ph + (leg === 'lf' ? 0 : Math.PI)) * 10) * g * (m.lift_sign_up || 1)); accDof(leg, m.flex_dof || 'tibia.pitch', 25 * g * (m.flex_sign_up || 1)); }
      acc('c_head', 'pitch', 12 * g);
    }
    if (this._freeze) { /* freezing: no gait, minimal idle motion */ }
    const breath = Math.sin(this._t * 2.2) * 2 * k;
    acc('c_abdomen12', 'pitch', breath); acc('c_abdomen3', 'pitch', breath * 0.5);
    const tw = Math.sin(this._t * 3.1) * 4 * k + Math.sin(this._t * 7.3) * 1.5 * k;
    acc('l_pedicel', 'pitch', tw); acc('r_pedicel', 'pitch', -tw * 0.8);
    acc('l_funiculus', 'roll', Math.sin(this._t * 5) * 3 * k); acc('r_funiculus', 'roll', -Math.sin(this._t * 5 + 1) * 3 * k);
    acc('c_head', 'roll', Math.sin(this._t * 0.7) * 6 * k * (1 - this._walk)); acc('c_head', 'pitch', Math.sin(this._t * 1.1) * 2 * k);
    acc('l_haltere', 'pitch', Math.sin(this._t * 1.5) * 2); acc('r_haltere', 'pitch', Math.sin(this._t * 1.5) * 2);
    // ---- walk
    if (this._walk > 0.001) {
      const amp = this._walk;
      for (const leg in this.legs) {
        const m = this.legs[leg]; const ph = this._phase + (TRIPOD_A.includes(leg) ? 0 : Math.PI);
        const sweep = Math.cos(ph) * this.strideDeg * amp * Math.sign(dir || 1);
        const lift = Math.max(0, -Math.sin(ph)) * this.liftDeg * amp;
        accDof(leg, m.sweep_dof || 'coxa.roll', sweep * (m.sweep_sign_forward || 1));
        accDof(leg, m.lift_dof || 'trochanterfemur.pitch', lift * (m.lift_sign_up || 1));
        accDof(leg, m.flex_dof || 'tibia.pitch', lift * 0.7 * (m.flex_sign_up || 1));
        for (let i = 1; i <= 5; i++) acc(`${leg}_tarsus${i}`, 'pitch', -lift * 0.08);
      }
      acc('c_head', 'pitch', -Math.sin(this._phase * 2) * 1.5 * amp); acc('c_abdomen12', 'pitch', Math.sin(this._phase * 2) * 1.5 * amp);
    }
    // ---- fly
    if (this._fly > 0.001) {
      const amp = this._fly; const flap = Math.sin(this._flap) * this.flapDeg * amp;
      for (const w in this.wings) { const m = this.wings[w]; acc(w, m.flap_dof || 'yaw', flap * (m.flap_sign_up || 1)); acc(w, 'pitch', Math.cos(this._flap) * 8 * amp); }
      const h = Math.sin(this._flap + Math.PI) * 25 * amp; acc('l_haltere', 'yaw', h); acc('r_haltere', 'yaw', -h);
      for (const leg in this.legs) { const m = this.legs[leg]; accDof(leg, m.lift_dof || 'trochanterfemur.pitch', 28 * amp * (m.lift_sign_up || 1)); accDof(leg, m.flex_dof || 'tibia.pitch', 30 * amp * (m.flex_sign_up || 1)); }
      acc('c_abdomen12', 'pitch', -8 * amp); acc('c_abdomen3', 'pitch', -6 * amp);
    }
    // ---- apply
    for (const [name, j] of this.joints) {
      const a = pose.get(name);
      if (!a) { j.node.quaternion.copy(j.rest); continue; }
      const q = j.node.quaternion.copy(j.rest);
      if (a[0]) q.multiply(this._q.setFromAxisAngle(AX, a[0] * D2R));
      if (a[1]) q.multiply(this._q.setFromAxisAngle(AY, a[1] * D2R));
      if (a[2]) q.multiply(this._q.setFromAxisAngle(AZ, a[2] * D2R));
    }
  }
}
