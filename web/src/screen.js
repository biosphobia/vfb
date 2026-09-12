// The screen standing in front of the fly. Two display modes:
//  * texture  – a VideoTexture / CanvasTexture on a WebGL plane (screen share,
//               camera, file, synthetic stimulus). The SAME frames feed the
//               model's photoreceptors, so what you see is what the fly sees.
//  * youtube  – a CSS3D iframe seen through a hole in the canvas. Browsers do
//               not let a page read iframe pixels, so the fly cannot see it;
//               use "Share this tab" (PC) to make it visible to the fly.
import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

export const SCREEN_W = 6.4, SCREEN_H = 3.6;
const CSS_W = 640, CSS_H = 360;
const NOEMBED = 'https://noembed.com/embed?url=https://www.youtube.com/watch?v=';

let ytReady = null;
function loadYouTubeApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => resolve(null); document.head.appendChild(s);
    setTimeout(() => resolve(window.YT || null), 15000);
  });
  return ytReady;
}
export function extractId(text) {
  const t = (text || '').trim(); if (!t) return '';
  const m = t.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{6,20})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{6,20}$/.test(t) ? t : '';
}

export class Screen {
  constructor(scene, camera, apiBase) {
    this.camera = camera; this.apiBase = (apiBase || '').replace(/\/$/, '');
    this.group = new THREE.Group(); this.group.name = 'Screen';
    this.group.position.set(7.5, 2.6, 0); this.group.rotation.y = -Math.PI / 2; this.group.rotation.x = -0.12;
    scene.add(this.group);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.35, SCREEN_H + 0.35, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5, metalness: 0.3 }));
    bezel.position.z = -0.07; bezel.castShadow = true; this.group.add(bezel);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 12), poleMat); pole.position.set(0, -SCREEN_H / 2 - 1.3, -0.07); this.group.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.08, 24), poleMat); foot.position.set(0, -SCREEN_H / 2 - 2.6, -0.07); this.group.add(foot);
    this.offMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.25, metalness: 0.4, emissive: 0x0b1420, emissiveIntensity: 0.6 });
    this.texMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.offMat); this.group.add(this.panel);
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending, side: THREE.DoubleSide }));
    this.hole.visible = false; this.hole.renderOrder = -10; this.group.add(this.hole);
    this.frame = document.createElement('div'); this.frame.className = 'screen-frame';
    this.playerDiv = document.createElement('div'); this.frame.appendChild(this.playerDiv);
    this.cssObj = new CSS3DObject(this.frame); this.cssObj.scale.setScalar(SCREEN_W / CSS_W); this.cssObj.visible = false; this.group.add(this.cssObj);
    this.mode = 'off'; this.yt = null; this.player = null; this.playing = false; this.muted = true;
    this.onChange = null; this.onPlaying = null;
  }
  worldPosition() { return this.group.getWorldPosition(new THREE.Vector3()); }
  /** Show a live texture (visible to the fly). */
  showTexture(texture) {
    this._killYouTube(); this.mode = 'texture';
    this.texMat.map = texture; this.texMat.needsUpdate = true; this.panel.material = this.texMat; this.panel.visible = true; this.hole.visible = false; this.cssObj.visible = false;
    this.onChange && this.onChange(this.mode);
  }
  off() { this._killYouTube(); this.mode = 'off'; this.panel.material = this.offMat; this.panel.visible = true; this.hole.visible = false; this.cssObj.visible = false; this.yt = null; this.onChange && this.onChange(this.mode); }
  /** Projected rectangle of the screen in normalised viewport coordinates (for tab-capture sampling). */
  projectedRegion() {
    const hw = SCREEN_W / 2, hh = SCREEN_H / 2; const pts = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
    let minX = 1, maxX = -1, minY = 1, maxY = -1; const v = new THREE.Vector3();
    for (const [x, y] of pts) { v.set(x, y, 0); this.panel.localToWorld(v); v.project(this.camera); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    const x0 = (minX + 1) / 2, x1 = (maxX + 1) / 2, y0 = (1 - maxY) / 2, y1 = (1 - minY) / 2;
    const cx0 = Math.max(0, x0), cx1 = Math.min(1, x1), cy0 = Math.max(0, y0), cy1 = Math.min(1, y1);
    if (cx1 - cx0 < 0.03 || cy1 - cy0 < 0.03) return null;
    return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
  }
  // ---------- YouTube (display only; the fly cannot read these pixels)
  async loadYouTube(text) {
    const vid = extractId(text); if (!vid) return false;
    this._killYouTube(); this.mode = 'youtube'; this.yt = { id: vid, title: '', author: '' };
    this.panel.visible = false; this.hole.visible = true; this.cssObj.visible = true; this.onChange && this.onChange(this.mode);
    this._fetchMeta(vid);
    const YT = await loadYouTubeApi(); if (!YT || this.yt?.id !== vid) return true;
    for (let i = 0; i < 100 && !this.playerDiv.isConnected; i++) await new Promise((r) => setTimeout(r, 50));
    const div = document.createElement('div'); this.frame.replaceChildren(div); this.playerDiv = div;
    this.player = new YT.Player(div, { videoId: vid, width: CSS_W, height: CSS_H, playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, mute: 1, autoplay: 1, enablejsapi: 1, origin: location.origin },
      events: { onReady: () => { try { this.player.mute(); this.player.playVideo(); } catch {} this.muted = true; }, onStateChange: (e) => { this.playing = e.data === 1; this.onPlaying && this.onPlaying(this.playing); } } });
    return true;
  }
  _killYouTube() { try { this.player && this.player.destroy(); } catch {} this.player = null; const div = document.createElement('div'); this.frame.replaceChildren(div); this.playerDiv = div; this.playing = false; }
  togglePlay() { if (!this.player) return; try { this.playing ? this.player.pauseVideo() : this.player.playVideo(); } catch {} }
  toggleMute() { if (!this.player) return this.muted; try { if (this.muted) { this.player.unMute(); this.player.setVolume(100); } else this.player.mute(); this.muted = !this.muted; } catch {} return this.muted; }
  async _fetchMeta(vid) {
    let data = null;
    if (this.apiBase) { try { data = await (await fetch(`${this.apiBase}/api/youtube?id=${vid}`)).json(); } catch {} }
    if (!data || !data.title) { try { const nb = await (await fetch(NOEMBED + vid)).json(); if (nb && nb.title) data = { title: nb.title, author: nb.author_name || '' }; } catch {} }
    if (!this.yt || this.yt.id !== vid) return;
    this.yt.title = data?.title || ('YouTube video ' + vid); this.yt.author = data?.author || '';
    this.onChange && this.onChange(this.mode);
  }
}
