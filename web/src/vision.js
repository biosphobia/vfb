// Visual input for the model: a pixel source the page is allowed to read
// (screen share, camera, local video file, or a synthetic stimulus canvas),
// sampled into the model's photoreceptor grid every frame.
import * as THREE from 'three';
import { GRID_W, GRID_H } from './brainmodel.js';

export class VisualInput {
  constructor() {
    this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
    this.canvas = document.createElement('canvas'); this.canvas.width = GRID_W; this.canvas.height = GRID_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.lum = new Float32Array(GRID_W * GRID_H);
    this.rgb = [0, 0, 0];
    this.source = 'none';      // none | display | camera | file | stimulus
    this.stream = null; this.texture = null; this.stimulus = null; this.region = null;   // region: {x,y,w,h} in source pixels
    this.onChange = null;
  }
  get active() { return this.source !== 'none'; }
  _setSource(kind) { this.source = kind; this.onChange && this.onChange(kind); }

  async shareScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not available in this browser (use a PC browser, or your camera / a video file).');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: false, selfBrowserSurface: 'include' });
    this._attach(stream, 'display');
    const track = stream.getVideoTracks()[0]; const s = track.getSettings ? track.getSettings() : {};
    this.displaySurface = s.displaySurface || '';
    track.addEventListener('ended', () => this.stop());
  }
  async useCamera(facing = 'environment') {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 } }, audio: false });
    this._attach(stream, 'camera');
  }
  useFile(file) {
    const url = URL.createObjectURL(file);
    this.stopStream(); this.video.srcObject = null; this.video.src = url; this.video.loop = true; this.video.play().catch(() => {});
    this.texture = new THREE.VideoTexture(this.video); this.texture.colorSpace = THREE.SRGBColorSpace;
    this._setSource('file');
  }
  useStimulus(stim) { this.stopStream(); this.stimulus = stim; this.texture = stim.texture; this._setSource('stimulus'); }
  _attach(stream, kind) {
    this.stopStream(); this.stimulus = null; this.stream = stream; this.video.src = ''; this.video.srcObject = stream; this.video.play().catch(() => {});
    this.texture = new THREE.VideoTexture(this.video); this.texture.colorSpace = THREE.SRGBColorSpace;
    this._setSource(kind);
  }
  stopStream() { if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; } if (this.texture && this.source !== 'stimulus') { this.texture.dispose(); } this.texture = null; }
  stop() { this.stopStream(); this.stimulus = null; this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src'); this.region = null; this._setSource('none'); }

  /** Sample the current frame into the luminance grid. Returns false if no frame. */
  sample() {
    let src = null, sw = 0, sh = 0;
    if (this.source === 'stimulus' && this.stimulus) { src = this.stimulus.canvas; sw = src.width; sh = src.height; }
    else if (this.active && this.video.readyState >= 2 && this.video.videoWidth > 0) { src = this.video; sw = this.video.videoWidth; sh = this.video.videoHeight; }
    if (!src) return false;
    const reg = this.region && this.source === 'display' ? this.region : null;
    try {
      if (reg) this.ctx.drawImage(src, reg.x * sw, reg.y * sh, reg.w * sw, reg.h * sh, 0, 0, GRID_W, GRID_H);
      else this.ctx.drawImage(src, 0, 0, GRID_W, GRID_H);
    } catch { return false; }
    const d = this.ctx.getImageData(0, 0, GRID_W, GRID_H).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0, j = 0; i < this.lum.length; i++, j += 4) { const R = d[j], G = d[j + 1], B = d[j + 2]; r += R; g += G; b += B; this.lum[i] = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255; }
    const n = this.lum.length; this.rgb = [r / n / 255, g / n / 255, b / n / 255];
    return true;
  }
}

/** Synthetic visual stimuli drawn on a canvas (the classic lab stimuli). */
export class StimulusCanvas {
  constructor(w = 640, h = 360) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.kind = 'none'; this.t = 0; this.params = {};
  }
  start(kind, params = {}) { this.kind = kind; this.t = 0; this.params = params; }
  update(dt) {
    const { ctx, canvas } = this; const w = canvas.width, h = canvas.height; this.t += dt;
    ctx.fillStyle = '#9aa3b2'; ctx.fillRect(0, 0, w, h);
    if (this.kind === 'loom') {
      // dark disc expanding on collision course: r(t) = l/v regime → r grows ~ 1/(T - t)
      // l/|v| looming: angular size grows as 1/(T - t); starts ~4° and fills the screen at collision
      const T = this.params.T ?? 1.6, minR = 24, maxR = Math.hypot(w, h);
      const tt = this.t % (T + 2.0);
      let r = tt < T ? Math.min(maxR, minR / Math.max(0.03, 1 - tt / T)) : 0;
      if (tt >= T && tt < T + 0.4) r = maxR;
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    } else if (this.kind === 'grating') {
      const speed = this.params.speed ?? 120, period = this.params.period ?? 80, dir = this.params.dir ?? 1;
      const off = (this.t * speed * dir) % period;
      ctx.fillStyle = '#111';
      for (let x = -period + off; x < w + period; x += period) ctx.fillRect(x, 0, period / 2, h);
    } else if (this.kind === 'object') {
      const x = (w / 2) + Math.sin(this.t * 1.2) * w * 0.4, y = h / 2 + Math.cos(this.t * 0.7) * h * 0.2;
      ctx.fillStyle = '#111'; ctx.fillRect(x - 10, y - 30, 20, 60);
    } else if (this.kind === 'flicker') {
      ctx.fillStyle = Math.sin(this.t * 2 * Math.PI * (this.params.hz ?? 3)) > 0 ? '#e8e8e8' : '#222'; ctx.fillRect(0, 0, w, h);
    }
    this.texture.needsUpdate = true;
  }
}
