// Virtual Fly Brain client: SOLR search / term info, OBJ + SWC parsers.
import * as THREE from 'three';

export const SOLR = 'https://solr.virtualflybrain.org/solr';
const first = (v) => Array.isArray(v) ? (v.length ? String(v[0]) : '') : (v == null ? '' : String(v));

export function looksLikeId(t) { t = t.trim(); return /^(VFB_|FBbt_|VFBexp_|FBbi_)/.test(t); }

export async function getJson(url, opts) {
  const r = await fetch(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}

export async function search(term, rows = 30) {
  const q = term.trim().replace(/["():]/g, ' ').trim(); if (!q) return [];
  const query = `label:"${q}"^20 OR label:(${q}) OR synonym:(${q})`;
  const url = `${SOLR}/ontology/select?q=${encodeURIComponent(query)}&fl=short_form,label,facets_annotation&rows=${rows}&wt=json`;
  const d = await getJson(url);
  return (d.response?.docs || []).map((x) => ({ id: first(x.short_form), label: first(x.label), facets: Array.isArray(x.facets_annotation) ? x.facets_annotation : [x.facets_annotation].filter(Boolean) }));
}

export async function termInfo(id) {
  const url = `${SOLR}/vfb_json/select?q=id:${encodeURIComponent(id.trim())}&fl=term_info&wt=json`;
  const d = await getJson(url); const docs = d.response?.docs || []; if (!docs.length) return null;
  let raw = docs[0].term_info; if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return raw && typeof raw === 'object' ? raw : null;
}

function imageUrls(img) {
  if (!img || typeof img !== 'object') return null;
  const e = {}; const t = img.template_anatomy || {};
  e.template = first(t.short_form); e.templateLabel = first(t.label);
  for (const k of ['image_obj', 'image_swc', 'image_nrrd', 'image_thumbnail']) if (typeof img[k] === 'string' && img[k]) e[k.replace('image_', '')] = img[k];
  let folder = img.image_folder || img.folder;
  if (typeof folder === 'string' && folder) { folder = folder.replace(/\/$/, ''); e.obj ??= folder + '/volume_man.obj'; e.objAlt = folder + '/volume.obj'; e.swc ??= folder + '/volume.swc'; e.thumbnail ??= folder + '/thumbnail.png'; }
  return (e.obj || e.swc) ? e : null;
}
export function imagesOf(info) { return (info?.channel_image || []).map((c) => imageUrls(c?.image)).filter(Boolean); }
export function examplesOf(info) { return (info?.anatomy_channel_image || []).map((ex) => ({ id: first(ex?.anatomy?.short_form), label: first(ex?.anatomy?.label), image: imageUrls(ex?.channel_image?.image) })); }
export function domainsOf(info) { return (info?.template_domains || []).map((d) => ({ id: first(d?.anatomical_individual?.short_form || d?.anatomical_type?.short_form), label: first(d?.anatomical_type?.label || d?.anatomical_individual?.label), image: imageUrls(d?.image || d) })); }
export function summaryOf(info) {
  const core = info?.term?.core || {}; const term = info?.term || {};
  const join = (v) => Array.isArray(v) ? v.join(' ') : (v ? String(v) : '');
  const parents = (info?.parents || []).map((p) => first(p?.label)).filter(Boolean);
  const datasets = [], licenses = [];
  for (const dl of info?.dataset_license || []) { datasets.push(first(dl?.dataset?.core?.label)); licenses.push(first(dl?.license?.core?.label)); }
  const types = core.types || [];
  return { id: first(core.short_form), label: first(core.label), types, description: join(term.description), comment: join(term.comment), parents, datasets: datasets.filter(Boolean), licenses: licenses.filter(Boolean), isClass: types.includes('Class'), isIndividual: types.includes('Individual') };
}

/** OBJ text -> BufferGeometry (positions shifted by offset then scaled). */
export function parseObj(text, scale = 1, offset = [0, 0, 0]) {
  const v = []; const idx = [];
  for (const line of text.split('\n')) {
    if (line.length < 3) continue;
    if (line[0] === 'v' && line[1] === ' ') { const p = line.trim().split(/\s+/); if (p.length >= 4) v.push((+p[1] - offset[0]) * scale, (+p[2] - offset[1]) * scale, (+p[3] - offset[2]) * scale); }
    else if (line[0] === 'f' && line[1] === ' ') {
      const p = line.trim().split(/\s+/); const f = [];
      for (let k = 1; k < p.length; k++) { const tok = p[k].split('/')[0]; if (!tok) continue; const i = parseInt(tok, 10); f.push(i > 0 ? i - 1 : v.length / 3 + i); }
      for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}

/** SWC text -> tube BufferGeometry (one open prism per edge). */
export function parseSwc(text, scale = 1, offset = [0, 0, 0], radiusScale = 1, minRadius = 0.25, sides = 5) {
  const pos = new Map(), rad = new Map(), par = new Map(); const order = [];
  for (const raw of text.split('\n')) {
    const s = raw.trim(); if (!s || s[0] === '#') continue; const p = s.split(/\s+/); if (p.length < 7) continue;
    const id = parseInt(p[0], 10);
    pos.set(id, [(+p[2] - offset[0]) * scale, (+p[3] - offset[1]) * scale, (+p[4] - offset[2]) * scale]);
    rad.set(id, Math.max(+p[5] * radiusScale, minRadius) * scale); par.set(id, parseInt(p[6], 10)); order.push(id);
  }
  const v = [], idx = [];
  const tmp = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  for (const id of order) {
    const pid = par.get(id); if (pid < 0 || !pos.has(pid)) continue;
    const a = pos.get(pid), b = pos.get(id); const r = 0.5 * (rad.get(id) + rad.get(pid));
    const d = tmp.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = d.length(); if (len < 1e-7) continue; d.divideScalar(len);
    const helper = Math.abs(d.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    u.crossVectors(d, helper).normalize(); w.crossVectors(d, u);
    const base = v.length / 3;
    for (const p of [a, b]) for (let i = 0; i < sides; i++) { const ang = Math.PI * 2 * i / sides; v.push(p[0] + (u.x * Math.cos(ang) + w.x * Math.sin(ang)) * r, p[1] + (u.y * Math.cos(ang) + w.y * Math.sin(ang)) * r, p[2] + (u.z * Math.cos(ang) + w.z * Math.sin(ang)) * r); }
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; idx.push(base + i, base + j, base + sides + i, base + j, base + sides + j, base + sides + i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}
