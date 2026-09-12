// Renderer, camera, lights, floor, orbit controls, brain picture-in-picture pass.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

export const LAYER_BODY = 0;
export const LAYER_BRAIN = 1;

export class SceneRig {
  constructor(canvas, cssEl, { shadows = true } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 400);
    this.camera.layers.enable(LAYER_BRAIN);
    this.camera.position.set(-4.5, 2.8, 4.0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 0.9, 0);

    this.css = new CSS3DRenderer({ element: cssEl });

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2420, 0.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 10, 4);
    sun.castShadow = shadows;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40;
    const s = 8; sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0xb0c4ff, 0.6);
    fill.position.set(-5, 3, -6);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x1e222b, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.scene.add(floor);
    const grid = new THREE.GridHelper(80, 80, 0x3a4050, 0x272c38);
    grid.position.y = 0.002;
    grid.material.transparent = true; grid.material.opacity = 0.6;
    this.scene.add(grid);
    this.scene.fog = new THREE.Fog(0x0e1016, 30, 70);

    this.pipCamera = new THREE.PerspectiveCamera(40, 1.4, 0.005, 50);
    this.pipCamera.layers.set(LAYER_BRAIN);
    this.pipTarget = null;
    this.pipRadius = 0.45;
    this._pipAngle = 0;

    this.follow = null;          // Object3D to follow
    this.followOffset = new THREE.Vector3(0.6, 0.9, 0);
    this._lastFollowPos = new THREE.Vector3();
    this._followInit = false;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.css.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Frame `center` with `radius` visible; portrait screens back off more. */
  focusOn(center, radius) {
    const portrait = Math.max(1, window.innerHeight / Math.max(1, window.innerWidth));
    const dist = THREE.MathUtils.clamp(radius * 2.6 * portrait, this.controls.minDistance, this.controls.maxDistance);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(-0.7, 0.45, 0.55).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this._followInit = false;
  }

  /** Look from behind the fly toward a point (used for the video screen). */
  lookOverShoulder(flyPos, towards) {
    const dir = new THREE.Vector3().subVectors(towards, flyPos); dir.y = 0; dir.normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const portrait = Math.max(1, window.innerHeight / Math.max(1, window.innerWidth));
    this.controls.target.copy(flyPos).addScaledVector(dir, 3.0).add(new THREE.Vector3(0, 1.4, 0));
    this.camera.position.copy(flyPos).addScaledVector(dir, -5.5 * portrait).addScaledVector(right, 2.6).add(new THREE.Vector3(0, 3.2 * portrait, 0));
    this._followInit = false;
  }

  update(dt) {
    if (this.follow) {
      const p = new THREE.Vector3();
      this.follow.getWorldPosition(p);
      p.add(this.followOffset);
      if (!this._followInit) { this._lastFollowPos.copy(p); this._followInit = true; }
      const delta = new THREE.Vector3().subVectors(p, this._lastFollowPos);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this._lastFollowPos.copy(p);
    }
    this.controls.update();
    this._pipAngle += dt * 0.35;
  }

  render(pipRect) {
    const r = this.renderer;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);

    if (pipRect && this.pipTarget && pipRect.w > 8 && pipRect.h > 8) {
      // camera orbits the brain in the head's horizontal plane
      const c = new THREE.Vector3(); this.pipTarget.getWorldPosition(c);
      const m = new THREE.Matrix4().extractRotation(this.pipTarget.matrixWorld);
      const dir = new THREE.Vector3(Math.cos(this._pipAngle) * 0.95, Math.sin(this._pipAngle) * 0.95, 0.31).applyMatrix4(m).normalize();
      const up = new THREE.Vector3(0, 0, 1).applyMatrix4(m).normalize();
      this.pipCamera.position.copy(c).addScaledVector(dir, this.pipRadius * 2.4);
      this.pipCamera.up.copy(up);
      this.pipCamera.lookAt(c);
      this.pipCamera.aspect = pipRect.w / pipRect.h;
      this.pipCamera.updateProjectionMatrix();
      const y = h - pipRect.y - pipRect.h;   // pipRect is in CSS pixels; three scales by the pixel ratio
      r.setScissorTest(true);
      r.setViewport(pipRect.x, y, pipRect.w, pipRect.h);
      r.setScissor(pipRect.x, y, pipRect.w, pipRect.h);
      r.setClearColor(0x0b0d12, 1);
      r.clear(true, true, true);
      r.render(this.scene, this.pipCamera);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
    }
    this.css.render(this.scene, this.camera);
  }
}
