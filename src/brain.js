// VFB anatomy inside the head: loading, materials, selection, picking.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LAYER_BRAIN } from './scene.js';

export const NEUROPIL_ALPHA = 0.22;

export class Brain {
  constructor(headNode, headCenterMm) {
    this.group = new THREE.Group(); this.group.name = 'BrainAnchor';
    this.headOffset = new THREE.Vector3(...headCenterMm);
    this.userOffset = new THREE.Vector3(); this.userScale = 1;
    // template axes -> head axes: x_t -> +y, y_t -> -z, z_t -> -x
    this.templateBasis = new THREE.Matrix4().set(0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    this.objects = new Map(); this.selectedId = '';
    this.umToMm = 0.001; this.templateCenterUm = [0, 0, 0]; this.centerKnown = false;
    this.visible = true;
    headNode.add(this.group);
    this.applyCalibration();
  }
  applyCalibration() {
    const m = this.templateBasis.clone();
    m.scale(new THREE.Vector3(this.userScale, this.userScale, this.userScale));
    m.setPosition(this.headOffset.clone().add(this.userOffset));
    this.group.matrix.copy(m); this.group.matrixAutoUpdate = false; this.group.matrixWorldNeedsUpdate = true;
  }
  has(id) { return this.objects.has(id); }
  add(id, label, kind, geometry, color, meta = {}) {
    if (this.objects.has(id)) this.remove(id);
    if (!geometry || !geometry.attributes.position || geometry.attributes.position.count === 0) return null;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0, emissive: new THREE.Color(color), emissiveIntensity: 0 });
    if (kind === 'neuropil') { mat.transparent = true; mat.opacity = NEUROPIL_ALPHA; mat.depthWrite = false; mat.side = THREE.FrontSide; }
    else { mat.side = meta.format === 'swc' ? THREE.DoubleSide : THREE.FrontSide; }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = id; mesh.layers.set(LAYER_BRAIN); mesh.userData.vfbId = id; mesh.renderOrder = kind === 'neuropil' ? 2 : 1;
    if (meta.position) mesh.position.copy(meta.position);
    this.group.add(mesh);
    const o = { id, label, kind, mesh, material: mat, color: new THREE.Color(color), meta, visible: true };
    this.objects.set(id, o); return o;
  }
  remove(id) {
    const o = this.objects.get(id); if (!o) return;
    this.group.remove(o.mesh); o.mesh.geometry.dispose(); o.material.dispose(); this.objects.delete(id);
    if (this.selectedId === id) this.selectedId = '';
  }
  clear() { for (const id of [...this.objects.keys()]) this.remove(id); }
  setVisible(id, on) { const o = this.objects.get(id); if (o) { o.visible = on; o.mesh.visible = on; } }
  setAllVisible(on) { this.visible = on; this.group.visible = on; }
  select(id) {
    const prev = this.objects.get(this.selectedId); if (prev) this._style(prev, false);
    this.selectedId = this.objects.has(id) ? id : '';
    const cur = this.objects.get(this.selectedId); if (cur) this._style(cur, true);
    return this.selectedId;
  }
  _style(o, hi) {
    if (o.kind === 'neuropil') o.material.opacity = hi ? 0.6 : NEUROPIL_ALPHA;
    o.material.emissive.copy(o.color); o.material.emissiveIntensity = hi ? 1.2 : 0;
  }
  box() {
    const b = new THREE.Box3(); let any = false;
    for (const o of this.objects.values()) { if (!o.visible) continue; const bb = new THREE.Box3().setFromObject(o.mesh); if (!any) { b.copy(bb); any = true; } else b.union(bb); }
    return any ? b : null;
  }
  worldCenter() { const v = new THREE.Vector3(); this.group.getWorldPosition(v); return v; }
  learnCenterFromGeometry(geom) {
    if (this.centerKnown) return; geom.computeBoundingBox(); const c = new THREE.Vector3(); geom.boundingBox.getCenter(c);
    this.templateCenterUm = [c.x / this.umToMm, c.y / this.umToMm, c.z / this.umToMm]; this.centerKnown = true;
  }
  /** Load the bundled starter set described by manifest.json. */
  async loadBundled(manifest, base, onEach) {
    const loader = new GLTFLoader(); let n = 0; const objs = manifest.objects || [];
    for (const o of objs) {
      if (!o.id || !o.file || this.objects.has(o.id)) continue;
      try {
        const gltf = await new Promise((res, rej) => loader.load(base + o.file, res, undefined, rej));
        let geom = null; gltf.scene.traverse((m) => { if (!geom && m.isMesh) geom = m.geometry; });
        if (!geom) continue;
        const c = o.color || [0.8, 0.8, 0.8, 1];
        this.add(o.id, o.label || o.id, o.kind || 'neuron', geom, new THREE.Color(c[0], c[1], c[2]), { format: o.format || 'glb', bundled: true, classLabel: o.class_label || '', classId: o.class_id || '' });
        n++; onEach && onEach(n, objs.length, o);
      } catch (e) { console.warn('bundled object failed', o.id, e); }
    }
    return n;
  }
}
