// A screen in the 3D world that the fly faces, showing a YouTube video
// (CSS3D iframe seen through a "hole" in the WebGL canvas so the fly can
// stand in front of it), plus the fly's-eye full-screen view and the
// reaction plan (mood + timed beats).
import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

export const SCREEN_W = 6.4, SCREEN_H = 3.6;   // world units (mm) – a big screen for a 3 mm fly
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

const MOOD_WORDS = {
  hungry: ['food', 'fruit', 'banana', 'apple', 'sugar', 'cake', 'cook', 'recipe', 'eat', 'juice', 'wine', 'beer', 'honey', 'mango', 'pizza', 'sweet', 'dessert', 'kitchen', 'meal', 'snack', 'candy', 'chocolate'],
  scared: ['spider', 'swat', 'predator', 'horror', 'scary', 'trap', 'kill', 'poison', 'insecticide', 'frog', 'bird', 'wasp', 'danger', 'scream', 'storm', 'thunder', 'fire', 'explosion', 'attack'],
  disgusted: ['rotten', 'mold', 'mould', 'garbage', 'trash', 'sewage', 'poop', 'stink', 'vinegar', 'bitter', 'gross', 'disgusting', 'spoiled'],
  groovy: ['music', 'song', 'dance', 'beat', 'remix', 'dj', 'concert', 'bass', 'guitar', 'piano', 'drum', 'rap', 'edm', 'techno', 'jazz', 'sing', 'karaoke', 'lofi'],
  sleepy: ['sleep', 'asmr', 'rain', 'calm', 'relax', 'meditat', 'ambient', 'slow', 'night', 'bedtime', 'lullaby', 'quiet', 'nap', 'cozy'],
  excited: ['fast', 'race', 'crazy', 'insane', 'epic', 'win', 'goal', 'highlight', 'funny', 'prank', 'lol', 'wow', 'amazing', 'compilation', 'cat', 'dog', 'puppy', 'kitten'],
};
const BEATS = {
  curious: [[2, 'look', 'The fly turns to face the screen and studies it.'], [12, 'antenna', 'Its antennae twitch, sampling the air for clues.'], [25, 'walk', 'It takes a few steps closer, curious.'], [45, 'think', 'Something familiar lights up its memory centre.'], [70, 'look', 'It settles down and keeps watching.']],
  hungry: [[2, 'look', 'The fly notices the food and locks on.'], [8, 'feed', 'Its proboscis extends, tasting the air.'], [20, 'walk', 'It hurries toward the screen.'], [35, 'feed', 'More tasting; the taste centre is buzzing.'], [60, 'groove', 'A happy wiggle: this looks delicious.'], [80, 'feed', 'One more taste before it calms down.']],
  scared: [[2, 'look', 'The fly freezes and stares.'], [6, 'startle', 'It jumps! Something on screen looks dangerous.'], [12, 'fly', 'Escape flight: wings beating hard.'], [30, 'walk', 'It creeps back to look again.'], [50, 'startle', 'Another scare sends it backwards.'], [75, 'rest', 'Finally it settles, still alert.']],
  disgusted: [[2, 'look', 'The fly looks, then recoils.'], [6, 'antenna', 'Antennae flick: that smells wrong.'], [14, 'walk', 'It backs away from the screen.'], [35, 'antenna', 'Another sniff, another grimace.'], [60, 'rest', 'It keeps its distance.']],
  groovy: [[2, 'look', 'The fly turns toward the music.'], [6, 'groove', 'Head bobbing to the beat.'], [20, 'fly', 'It lifts off for a spin.'], [35, 'groove', 'Back down and grooving again.'], [60, 'walk', 'A little dance-walk in circles.'], [85, 'groove', 'Still moving to the rhythm.']],
  sleepy: [[2, 'look', 'The fly watches quietly.'], [15, 'rest', 'Its movements slow down.'], [40, 'antenna', 'A lazy antenna twitch.'], [70, 'rest', 'Almost dozing off.']],
  excited: [[2, 'look', 'The fly snaps to attention.'], [6, 'startle', 'It hops with excitement.'], [15, 'walk', 'Quick steps toward the action.'], [30, 'fly', 'It takes off in a burst.'], [50, 'groove', 'Buzzing happily.'], [75, 'walk', 'Still pacing, wide awake.']],
};
const SUMMARIES = {
  curious: 'This looks interesting. The fly will watch closely and use its memory and smell centres to figure it out.',
  hungry: 'This looks like food! Expect the taste and smell centres to light up as it tries to reach the screen.',
  scared: 'Something here looks dangerous to a fly. Expect startles and a quick escape flight.',
  disgusted: 'Something here smells wrong to a fly. Expect it to sniff, grimace and keep its distance.',
  groovy: 'Music! The fly will bob its head and buzz along with the beat.',
  sleepy: 'A calm one. The fly will slow down and relax while it watches.',
  excited: 'Lots of action here. The fly will hop, pace and buzz around.',
};
export function localPlan(title, author = '') {
  const text = `${title} ${author}`.toLowerCase(); let mood = 'curious', best = 0;
  for (const m in MOOD_WORDS) { const n = MOOD_WORDS[m].filter((w) => text.includes(w)).length; if (n > best) { best = n; mood = m; } }
  return { mood, summary: SUMMARIES[mood], beats: BEATS[mood].map(([t, a, n]) => ({ at_s: t, action: a, note: n })), ai: false };
}

export class VideoScreen {
  constructor(scene, apiBase) {
    this.apiBase = (apiBase || '').replace(/\/$/, '');
    this.group = new THREE.Group(); this.group.name = 'Screen';
    this.group.position.set(7.5, 2.6, 0);
    this.group.rotation.y = -Math.PI / 2;      // face the origin (−x)
    this.group.rotation.x = -0.12;             // tilt slightly down toward the fly
    scene.add(this.group);

    // bezel + stand
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.35, SCREEN_H + 0.35, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5, metalness: 0.3 }));
    bezel.position.z = -0.07; bezel.castShadow = true; this.group.add(bezel);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 }));
    pole.position.set(0, -SCREEN_H / 2 - 1.3, -0.07); this.group.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.08, 24), pole.material.clone());
    foot.position.set(0, -SCREEN_H / 2 - 2.6, -0.07); this.group.add(foot);
    // "screen off" panel
    this.offPanel = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.25, metalness: 0.4, emissive: 0x0b1420, emissiveIntensity: 0.6 }));
    this.group.add(this.offPanel);
    // the hole: writes transparent pixels + depth so the iframe behind shows through with correct occlusion
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending, side: THREE.DoubleSide }));
    this.hole.visible = false; this.hole.renderOrder = -10; this.group.add(this.hole);
    // CSS3D element
    this.frame = document.createElement('div'); this.frame.className = 'screen-frame';
    this.playerDiv = document.createElement('div'); this.playerDiv.id = 'yt-player'; this.frame.appendChild(this.playerDiv);
    this.cssObj = new CSS3DObject(this.frame);
    this.cssObj.scale.setScalar(SCREEN_W / CSS_W);
    this.cssObj.visible = false;
    this.group.add(this.cssObj);

    this.info = null; this.plan = null; this.playing = false; this.muted = true; this.elapsed = 0; this._nextBeat = 0;
    this.player = null; this.eyePlayer = null; this.eyeOpen = false;
    this.onChange = null; this.onPlan = null; this.onBeat = null; this.onPlaying = null;
  }
  get hasVideo() { return !!this.info; }
  get id() { return this.info?.id || ''; }
  get title() { return this.info?.title || ''; }
  get mood() { return this.plan?.mood || ''; }
  worldPosition() { return this.group.getWorldPosition(new THREE.Vector3()); }

  async load(text) {
    const vid = extractId(text); if (!vid) return false;
    this._teardownPlayers();
    this.info = { id: vid, title: '', author: '', thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` };
    this.plan = null; this.elapsed = 0; this._nextBeat = 0; this.playing = false;
    this.cssObj.visible = true; this.hole.visible = true; this.offPanel.visible = false;
    this.onChange && this.onChange(this.info);
    this._fetchMeta(vid);
    const YT = await loadYouTubeApi();
    if (!YT || this.id !== vid) { if (!YT) this.onChange && this.onChange(this.info, 'YouTube could not be loaded (blocked or offline).'); return true; }
    // element must be attached by the CSS3D renderer before the API can replace it
    for (let i = 0; i < 100 && !this.playerDiv.isConnected; i++) await new Promise((r) => setTimeout(r, 50));
    const div = document.createElement('div'); div.id = 'yt-player'; this.frame.replaceChildren(div); this.playerDiv = div;
    this.player = new YT.Player(div, {
      videoId: vid, width: CSS_W, height: CSS_H,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, mute: 1, autoplay: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { try { this.player.mute(); this.player.playVideo(); } catch {} this.muted = true; },
        onStateChange: (e) => this._state(e.data),
      },
    });
    return true;
  }
  stop() {
    this._teardownPlayers(); this.info = null; this.plan = null; this._setPlaying(false);
    this.cssObj.visible = false; this.hole.visible = false; this.offPanel.visible = true;
    this.onChange && this.onChange(null);
  }
  _teardownPlayers() {
    try { this.player && this.player.destroy(); } catch {} this.player = null;
    try { this.eyePlayer && this.eyePlayer.destroy(); } catch {} this.eyePlayer = null;
    const div = document.createElement('div'); div.id = 'yt-player'; this.frame.replaceChildren(div); this.playerDiv = div;
  }
  togglePlay() { if (!this.player) return; try { this.playing ? this.player.pauseVideo() : this.player.playVideo(); } catch {} }
  toggleMute() { if (!this.player) return; try { if (this.muted) { this.player.unMute(); this.player.setVolume(100); } else this.player.mute(); this.muted = !this.muted; } catch {} return this.muted; }
  _state(state) {
    this._setPlaying(state === 1);
    if (state === 0) { this.elapsed = 0; this._nextBeat = 0; }
    if (this.eyePlayer && this.eyeOpen) { try { if (state === 1) { this.eyePlayer.seekTo(this.player.getCurrentTime(), true); this.eyePlayer.playVideo(); } else if (state === 2) this.eyePlayer.pauseVideo(); } catch {} }
  }
  _setPlaying(on) { if (on === this.playing) return; this.playing = on; this.onPlaying && this.onPlaying(on); }
  async openEye(container) {
    if (!this.info) return false; this.eyeOpen = true;
    const YT = await loadYouTubeApi(); if (!YT) return true;
    const div = document.createElement('div'); container.replaceChildren(div);
    const t = (() => { try { return this.player ? this.player.getCurrentTime() : 0; } catch { return 0; } })();
    this.eyePlayer = new YT.Player(div, { videoId: this.id, width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, mute: 1, autoplay: 1, start: Math.floor(t), enablejsapi: 1, origin: location.origin },
      events: { onReady: () => { try { this.eyePlayer.mute(); if (this.playing) this.eyePlayer.playVideo(); else this.eyePlayer.pauseVideo(); } catch {} } } });
    return true;
  }
  closeEye() { this.eyeOpen = false; try { this.eyePlayer && this.eyePlayer.destroy(); } catch {} this.eyePlayer = null; }
  async _fetchMeta(vid) {
    let data = null;
    if (this.apiBase) { try { data = await (await fetch(`${this.apiBase}/api/youtube?id=${vid}`)).json(); } catch {} }
    if (!data || !data.title) { try { const nb = await (await fetch(NOEMBED + vid)).json(); if (nb && nb.title) data = { title: nb.title, author: nb.author_name || '', thumbnail: nb.thumbnail_url || '' }; } catch {} }
    if (!this.info || this.info.id !== vid) return;
    if (data) { this.info.title = data.title || ''; this.info.author = data.author || ''; if (data.thumbnail) this.info.thumbnail = data.thumbnail; }
    if (!this.info.title) this.info.title = 'YouTube video ' + vid;
    this.onChange && this.onChange(this.info);
    this._buildPlan(vid);
  }
  async _buildPlan(vid) {
    let got = null;
    if (this.apiBase) {
      try { const r = await fetch(`${this.apiBase}/api/react`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: vid, title: this.info.title, author: this.info.author }) }); if (r.ok) { const d = await r.json(); if (d && d.beats) got = d; } } catch {}
    }
    if (!this.info || this.info.id !== vid) return;
    this.plan = got || localPlan(this.info.title, this.info.author); this._nextBeat = 0;
    this.onPlan && this.onPlan(this.plan);
  }
  /** Desktop/offline fallback when the player cannot report state. */
  simulatePlay(on) { this._setPlaying(on); if (on && this.elapsed > 95) { this.elapsed = 0; this._nextBeat = 0; } }
  update(dt) {
    if (!this.playing || !this.plan) return;
    this.elapsed += dt; const beats = this.plan.beats || [];
    while (this._nextBeat < beats.length && this.elapsed >= (beats[this._nextBeat].at_s || 0)) { const b = beats[this._nextBeat++]; this.onBeat && this.onBeat(b.action || 'look', b.note || ''); }
    if (this._nextBeat >= beats.length && this.elapsed > 120) { this.elapsed = 0; this._nextBeat = 0; }
  }
}
