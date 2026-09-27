import * as THREE from 'three';
import { TrackPath, STEP } from './track.js';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
export const LANES = [-2.6, 0, 2.6];
const LANE_LERP = 12;          // lane switch responsiveness
const GRAVITY = -38;
const JUMP_VELOCITY = 13.5;    // apex ≈ 2.4 m — clears boulders and lands on cliffs
const BASE_SPEED = 14;         // m/s
const MAX_SPEED = 36;
const SPEED_RAMP = 0.04;       // per meter travelled
const LOOKAHEAD_S = 130;       // spawn distance ahead of the player (fog hides pop-in)
const GEN_AHEAD = 200;         // path/geometry generated this far ahead
const DESPAWN_BEHIND = 26;     // recycle objects this far behind the player
const CHUNK_LEN = 20;          // meters per road-ribbon chunk
const CLIFF_H = 1.9;           // height of cliff platforms (jumpable: apex 2.4)

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Ground ribbon cross-section: [lateral x, downward offset along surface normal]
const PROFILE = [
  [-60, 18], [-30, 7], [-14, 2.5], [-8, 0], [-5.6, 0], [-5, 0], [-2.5, 0], [0, 0],
  [2.5, 0], [5, 0], [5.6, 0], [8, 0], [14, 2.5], [30, 7], [60, 18],
];

// Piecewise-linear lookup of the profile drop for placing scenery on the slope.
const POS_PROFILE = PROFILE.filter(([x]) => x >= 0).sort((a, b) => a[0] - b[0]);
function dropAtX(x) {
  const abs = Math.abs(x);
  for (let i = 0; i < POS_PROFILE.length - 1; i++) {
    const [x0, d0] = POS_PROFILE[i];
    const [x1, d1] = POS_PROFILE[i + 1];
    if (abs <= x1) return lerp(d0, d1, (abs - x0) / ((x1 - x0) || 1));
  }
  return POS_PROFILE[POS_PROFILE.length - 1][1];
}

function makeSpeckleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    ctx.fillStyle = `rgba(90,80,60,${Math.random() * 0.25})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// The monkey — built entirely from primitives, animated procedurally
// ---------------------------------------------------------------------------
function buildMonkey() {
  const brown = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });
  const tan = new THREE.MeshStandardMaterial({ color: 0xdcb384, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f2e7, roughness: 0.4 });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // torso + belly
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.38, 4, 12), brown);
  torso.position.y = 1.05;
  body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), tan);
  belly.position.set(0, 1.0, -0.14);
  belly.scale.set(0.85, 1.0, 0.55);
  body.add(belly);

  // head assembly (faces -Z, the running direction)
  const head = new THREE.Group();
  head.position.y = 1.72;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), brown);
  head.add(skull);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 14), tan);
  face.position.set(0, -0.02, -0.17);
  face.scale.set(1, 0.92, 0.62);
  head.add(face);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), tan);
  muzzle.position.set(0, -0.13, -0.3);
  muzzle.scale.set(1.25, 0.8, 0.7);
  head.add(muzzle);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), tan);
    ear.position.set(s * 0.34, 0.05, 0);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), white);
    eye.position.set(s * 0.12, 0.09, -0.26);
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 8), dark);
    pupil.position.set(s * 0.12, 0.09, -0.33);
    head.add(pupil);
  }

  // limbs: pivot groups so they swing from shoulder/hip
  const mkLimb = (px, py, radius, len) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 3, 8), brown);
    mesh.position.y = -len / 2 - radius * 0.4;
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  };
  const armL = mkLimb(-0.36, 1.35, 0.09, 0.42);
  const armR = mkLimb(0.36, 1.35, 0.09, 0.42);
  const legL = mkLimb(-0.17, 0.72, 0.11, 0.4);
  const legR = mkLimb(0.17, 0.72, 0.11, 0.4);

  // tail — a tube along a curve, wiggles while running
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.68, 0.25),
    new THREE.Vector3(0, 0.55, 0.7),
    new THREE.Vector3(0.1, 0.9, 1.05),
    new THREE.Vector3(0.14, 1.35, 1.1),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.05, 6), brown);
  body.add(tail);

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  group.scale.setScalar(0.85);

  return { group, body, head, armL, armR, legL, legR, tail };
}

// ---------------------------------------------------------------------------
// Game engine — everything lives in TRACK-LOCAL coordinates:
//   s = distance along the generated path, x = lateral offset, y = height
// above the surface. World positions are sampled from TrackPath every frame,
// so curves, hills and banking come for free.
// ---------------------------------------------------------------------------
export class MonkeyGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks; // { onHud, onGameOver }
    this.state = 'menu';   // menu | playing | crashed | over
    this.raf = null;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onResize = this.onResize.bind(this);

    // scratch vectors (avoid per-frame allocation)
    this._P = new THREE.Vector3();
    this._T = new THREE.Vector3();
    this._U = new THREE.Vector3();
    this._Rv = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._basisQ = new THREE.Quaternion();
    this._mat4 = new THREE.Matrix4();

    this.init();
  }

  // -------------------------------------------------------------------------
  init() {
    const canvas = this.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const skyColor = new THREE.Color(0x8ec9ea);
    this.scene = new THREE.Scene();
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 45, 135);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 3.5, 9);

    // lights — the sun follows the player so shadows work anywhere on the path
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x7a6a3f, 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d4, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -16; this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 24; this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.camera.far = 110;
    this.scene.add(this.sun, this.sun.target);

    // shared materials / geometries
    this.groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: makeSpeckleTexture(), roughness: 0.95,
    });
    this.boulderGeo = new THREE.DodecahedronGeometry(1, 0);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x8f8577, roughness: 0.9, flatShading: true });
    this.cliffMat = new THREE.MeshStandardMaterial({ color: 0x6e6257, roughness: 1, flatShading: true });
    this.bananaGeo = new THREE.TorusGeometry(0.26, 0.1, 8, 14, Math.PI * 0.8);
    this.bananaMat = new THREE.MeshStandardMaterial({ color: 0xffd335, roughness: 0.5 });

    // deep valley floor: fills the sky below the ribbon so distant terrain
    // never looks like floating paper when viewed from atop a cliff
    const basePlane = new THREE.Mesh(
      new THREE.CircleGeometry(900, 48),
      new THREE.MeshStandardMaterial({ color: 0x3a7d33, roughness: 1 })
    );
    basePlane.rotation.x = -Math.PI / 2;
    basePlane.position.y = -60;
    this.scene.add(basePlane);
    this.basePlane = basePlane;

    // monkey
    this.monkey = buildMonkey();
    this.scene.add(this.monkey.group);

    // pools / collections
    this.chunks = new Map();      // chunk index -> ribbon mesh
    this.scenery = [];            // trees & rocks in local coords {obj, s, x}
    for (let i = 0; i < 34; i++) {
      const obj = Math.random() < 0.75 ? this.buildTree() : this.buildRock();
      this.scene.add(obj);
      const item = { obj, s: 0, x: 0 };
      this.placeScenery(item, true);
      this.scenery.push(item);
    }
    this.obstacles = [];
    this.bananas = [];
    this.cliffs = [];

    this.reset(true);

    // input
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    this.bindTouch(canvas);

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  placeScenery(item, initial = false) {
    const side = Math.random() < 0.5 ? -1 : 1;
    item.x = side * rand(7.5, 28);
    const from = initial ? 10 : this.s + rand(90, GEN_AHEAD - 30);
    item.s = initial ? rand(-40, GEN_AHEAD) : from;
  }

  buildTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1.4, 7),
      new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 })
    );
    trunk.position.y = 0.7;
    g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15 - i * 0.28, 1.1, 8), leafMat);
      cone.position.y = 1.6 + i * 0.75;
      g.add(cone);
    }
    const s = rand(0.7, 1.9);
    g.userData.sceneryScale = s;
    return g;
  }

  buildRock() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), this.rockMat);
    rock.position.y = 0.45;
    g.add(rock);
    g.userData.sceneryScale = rand(0.6, 1.6);
    return g;
  }

  // -------------------------------------------------------------------------
  reset(initial = false) {
    this.state = initial ? 'menu' : 'playing';
    this.path = new TrackPath(); // fresh curves every run

    this.s = 0;                  // distance along the path
    this.laneIndex = 1;
    this.x = 0;                  // lateral offset
    this.py = 0;                 // height above surface
    this.vy = 0;
    this.grounded = true;
    this.distance = 0;
    this.speed = BASE_SPEED;
    this.bananaCount = 0;
    this.lastScoreSent = -1;
    this.runPhase = 0;
    this.jumpBlend = 0;
    this.crashTimer = 0;
    this.spawnGap = 24;
    this.sinceSpawn = this.spawnGap * 0.55;
    this.nextCliffS = 300;       // first cliff around ~300 m in
    this.noWavesUntil = 0;

    for (const o of this.obstacles) { o.active = false; o.mesh.visible = false; }
    for (const b of this.bananas) { b.group.visible = false; b.active = false; }
    for (const c of this.cliffs) { this.scene.remove(c.group); disposeGroup(c.group); }
    this.cliffs.length = 0;

    const k = this.monkey;
    k.body.position.set(0, 0, 0);
    k.body.rotation.set(0, 0, 0);
    for (const part of [k.armL, k.armR, k.legL, k.legR]) part.rotation.set(0, 0, 0);
    const m = this.monkey.group;
    m.rotation.set(0, 0, 0);

    // rebuild ground chunks and scenery around the fresh path
    for (const [, mesh] of this.chunks) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.chunks.clear();
    for (const item of this.scenery) this.placeScenery(item, true);

    this.ensureChunks();
    this.syncWorldTransforms();
    // snap camera behind the start
    this.path.sampleTo(-9, this._P, this._T, this._U);
    this.camera.position.copy(this._P).addScaledVector(this._U, 3.5);
    this._camUp.copy(this._U);
    this.emitHud(true);
  }

  start() { this.reset(false); if (this.cb.onState) this.cb.onState('playing'); }
  crash() {
    if (this.state !== 'playing') return;
    this.state = 'crashed';
    this.crashTimer = 0;
    const stats = this.stats();
    if (this.cb.onGameOver) this.cb.onGameOver(stats);
  }

  // --- test/debug hooks -----------------------------------------------------
  testSpawnBananaAtPlayer() {
    const b = this.getFreeBanana();
    b.active = true;
    b.group.visible = true;
    b.s = this.s + 0.4;
    b.x = this.x;
    b.y = this.py + 0.8;
  }

  testSpawnBoulderAhead(d = 2.5) {
    const o = this.getFreeBoulder();
    const s = 1.0;
    Object.assign(o, { active: true, radius: s * 0.95, height: s * 1.7 });
    o.mesh.visible = true;
    o.s = this.s + d;
    o.x = this.x; // same lateral spot as the player right now → unavoidable
    return o;
  }

  testClearCliffs() {
    for (const c of this.cliffs) { this.scene.remove(c.group); disposeGroup(c.group); }
    this.cliffs.length = 0;
    this.nextCliffS = Infinity; // no random cliffs while testing
    // also remove boulder waves already rolling toward the player, so nothing
    // blocks the lane on the approach to the test cliff
    for (const o of this.obstacles) { o.active = false; o.mesh.visible = false; }
  }

  testSpawnCliffAhead() {
    // must be beyond generated samples so the flat-ground reservation applies
    const sStart = Math.max(this.path.maxGeneratedS + 70, this.s + LOOKAHEAD_S + 60);
    const c = this.makeCliff(sStart, rand(30, 40), [0, 1, 2]); // all lanes
    this.noWavesUntil = c.sEnd + 60;
    return { sStart: c.sStart, sEnd: c.sEnd };
  }

  stats() {
    return { score: this.score(), bananas: this.bananaCount, distance: Math.floor(this.distance) };
  }
  score() { return Math.floor(this.distance) + this.bananaCount * 10; }

  emitHud(force = false) {
    const s = this.score();
    if (force || s !== this.lastScoreSent) {
      this.lastScoreSent = s;
      if (this.cb.onHud) this.cb.onHud({ ...this.stats(), speed: this.speed });
    }
  }

  // -------------------------------------------------------------------------
  // Input
  bindTouch(el) {
    let sx = 0, sy = 0, st = 0;
    el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
    el.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (this.state !== 'playing') return;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        dx > 0 ? this.moveRight() : this.moveLeft();
      } else if (performance.now() - st < 300 && Math.hypot(dx, dy) < 12) {
        this.jump();
      }
    });
  }

  onKeyDown(e) {
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (this.state !== 'playing') return;
    switch (k) {
      case 'ArrowLeft': case 'KeyA': this.moveLeft(); break;
      case 'ArrowRight': case 'KeyD': this.moveRight(); break;
      case 'Space': case 'ArrowUp': case 'KeyW': this.jump(); break;
    }
  }

  moveLeft() { if (this.laneIndex > 0) this.laneIndex--; }
  moveRight() { if (this.laneIndex < LANES.length - 1) this.laneIndex++; }
  jump() {
    if (this.grounded) { this.vy = JUMP_VELOCITY; this.grounded = false; }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // -------------------------------------------------------------------------
  // Ground ribbon chunks along the path
  ensureChunks() {
    const c0 = Math.floor((this.s - CHUNK_LEN) / CHUNK_LEN);
    const cMax = Math.floor((this.s + GEN_AHEAD) / CHUNK_LEN);
    // cover the far edge of the last chunk (its rows extend a full CHUNK beyond)
    this.path.ensure((cMax + 1) * CHUNK_LEN + STEP);
    for (let i = c0; i <= cMax; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, this.buildChunk(i));
    }
    for (const [idx, mesh] of this.chunks) {
      if (idx < c0 - 1) { this.scene.remove(mesh); mesh.geometry.dispose(); this.chunks.delete(idx); }
    }
  }

  buildChunk(chunkIdx) {
    // lateral profile: road | curb | grass | sloped embankment shoulders so
    // the ribbon reads as a solid valley, not floating paper
    const rows = CHUNK_LEN / STEP + 1;
    const cols = PROFILE.length;

    const positions = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);

    const grassC = new THREE.Color(0x5da24a).convertSRGBToLinear();
    const grassEdgeC = new THREE.Color(0x4c8f3e).convertSRGBToLinear();
    const deepC = new THREE.Color(0x2f6b28).convertSRGBToLinear();
    const curbC = new THREE.Color(0x8d94a0).convertSRGBToLinear();
    const roadC = new THREE.Color(0xc9b17e).convertSRGBToLinear();

    let vi = 0;
    for (let r = 0; r < rows; r++) {
      const s = chunkIdx * CHUNK_LEN + r * STEP;
      this.path.sampleTo(s, this._P, this._T, this._U);
      this._Rv.crossVectors(this._T, this._U).normalize(); // tilted right vector
      for (let c = 0; c < cols; c++) {
        const [cx, drop] = PROFILE[c];
        const p = vi * 3;
        positions[p] = this._P.x + this._Rv.x * cx - this._U.x * drop;
        positions[p + 1] = this._P.y + this._Rv.y * cx - this._U.y * drop;
        positions[p + 2] = this._P.z + this._Rv.z * cx - this._U.z * drop;

        const abs = Math.abs(cx);
        let col;
        if (abs <= 5) col = roadC;
        else if (abs <= 5.6) col = curbC;
        else if (abs >= 30) col = deepC;
        else if (abs >= 14) col = grassEdgeC;
        else col = grassC;
        colors[p] = col.r; colors[p + 1] = col.g; colors[p + 2] = col.b;

        const uvI = vi * 2;
        uvs[uvI] = cx * 0.25;
        uvs[uvI + 1] = s * 0.2;
        vi++;
      }
    }

    const indices = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        indices.push(a, b, d, b, e, d); // upward winding
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.groundMat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // -------------------------------------------------------------------------
  // Pools & spawning (all in track-local coordinates)
  getFreeBoulder() {
    for (const o of this.obstacles) if (!o.active) return o;
    const mesh = new THREE.Mesh(this.boulderGeo, this.rockMat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const o = { mesh, active: false, s: 0, x: 0, radius: 1, height: 1, quat: new THREE.Quaternion() };
    this.obstacles.push(o);
    return o;
  }

  getFreeBanana() {
    for (const b of this.bananas) if (!b.active) return b;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.bananaGeo, this.bananaMat);
    mesh.castShadow = true;
    group.add(mesh);
    this.scene.add(group);
    const b = { group, mesh, active: false, s: 0, x: 0, y: 1, spin: Math.random() * 6 };
    this.bananas.push(b);
    return b;
  }

  spawnWave() {
    const spawnS = this.s + LOOKAHEAD_S;
    // keep wave obstacles out of cliff zones so cliffs read clearly
    for (const c of this.cliffs) {
      if (spawnS > c.sStart - 10 && spawnS < c.sEnd + 6) return;
    }

    const laneIdx = [0, 1, 2];
    for (let i = laneIdx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [laneIdx[i], laneIdx[j]] = [laneIdx[j], laneIdx[i]];
    }
    const blockCount = Math.random() < clamp(0.15 + this.distance / 900, 0.15, 0.5) ? 2 : 1;
    const blocked = laneIdx.slice(0, blockCount);

    for (const lane of blocked) {
      const o = this.getFreeBoulder();
      const s = rand(0.85, 1.25);
      Object.assign(o, { active: true, radius: s * 0.95, height: s * 1.7 });
      o.mesh.visible = true;
      o.s = spawnS + rand(0, 3);
      o.x = LANES[lane] + rand(-0.25, 0.25);
      const sc = new THREE.Vector3(s * rand(0.9, 1.1), s * rand(0.8, 0.95), s);
      o.mesh.scale.copy(sc);
      o.quat.setFromEuler(new THREE.Euler(rand(0, 1), rand(0, Math.PI), rand(0, 1)));

      // banana arc over the boulder — rewards jumping
      if (Math.random() < 0.6) {
        const n = 7;
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1)) * 2 - 1; // -1..1 across the arc
          const b = this.getFreeBanana();
          b.active = true;
          b.group.visible = true;
          b.s = o.s + t * 4.2;
          b.x = o.x;
          b.y = 0.9 + (2.05 - 0.9) * (1 - t * t);
        }
      }
    }

    // straight banana row down a free lane
    if (Math.random() < 0.7) {
      const free = [0, 1, 2].filter((l) => !blocked.includes(l));
      const lane = free[Math.floor(Math.random() * free.length)];
      for (let i = 0; i < 6; i++) {
        const b = this.getFreeBanana();
        b.active = true;
        b.group.visible = true;
        b.s = spawnS - i * 1.4;
        b.x = LANES[lane];
        b.y = 1.05;
      }
    }

    this.spawnGap = clamp(this.speed * 1.35, 20, 36);
  }

  // --- giant cliffs: jump ON them, ride the banana trail, fall off the end --
  scheduleCliffs() {
    if (this.path.maxGeneratedS < this.nextCliffS - 80) return;
    const sStart = Math.max(this.path.maxGeneratedS + 70, this.s + LOOKAHEAD_S + 60);
    const len = rand(30, 45);

    // coverage: whole road (forced jump) or 1–2 lanes (dodgeable)
    let cover;
    if (Math.random() < 0.4) {
      cover = [0, 1, 2];
    } else {
      const count = Math.random() < 0.5 ? 1 : 2;
      const startLane = Math.floor(Math.random() * (4 - count)); // keeps lanes contiguous
      cover = [];
      for (let i = 0; i < count; i++) cover.push(startLane + i);
    }
    this.makeCliff(sStart, len, cover);
    this.nextCliffS = sStart + rand(180, 320);
  }

  makeCliff(sStart, len, coveredLanes) {
    const lo = LANES[coveredLanes[0]], hi = LANES[coveredLanes[coveredLanes.length - 1]];
    const margin = 1.45;
    const x = (lo + hi) / 2;
    const halfW = (hi - lo) / 2 + margin;

    // reserve a flat straight under/over the cliff so it sits flush on the path
    this.path.addForcedStraight(sStart - 8, sStart + len + 8);

    const group = new THREE.Group();
    const H = CLIFF_H;
    const depth = len;
    const boxH = H + 7; // sinks below the road so it reads as a giant monolith
    const box = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, boxH, depth), this.cliffMat);
    box.position.y = H - boxH / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    // rocky trim: dodecahedra along the top edges and base corners
    const decoGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 8; i++) {
      const rock = new THREE.Mesh(decoGeo, this.rockMat);
      const along = rand(-depth / 2 + 1, depth / 2 - 1);
      const side = Math.random() < 0.5 ? -1 : 1;
      const onTop = i % 2 === 0;
      rock.position.set(
        side * (halfW + rand(0.2, 0.7)),
        onTop ? H - 0.35 : rand(-1.5, 0.4),
        along
      );
      const rs = rand(0.5, 1.1);
      rock.scale.set(rs * rand(0.8, 1.2), rs * rand(0.6, 1), rs);
      rock.rotation.set(rand(0, 1), rand(0, Math.PI), rand(0, 1));
      rock.castShadow = true;
      group.add(rock);
    }

    this.scene.add(group);
    const cliff = { group, sStart, sEnd: sStart + len, x, halfW, H };
    this.cliffs.push(cliff);

    // banana trail along the top of every covered lane (+ a lure at the face)
    const sEnd = sStart + len;
    for (const lane of coveredLanes) {
      const bx = LANES[lane];
      if (Math.abs(bx - x) <= halfW + 0.3) {
        const lead = this.getFreeBanana();
        lead.active = true;
        lead.group.visible = true;
        lead.s = sStart - 2.4;
        lead.x = bx;
        lead.y = H + 0.55; // jump here to land on the cliff
        for (let bs = sStart + 3.5; bs < sEnd - 1.5; bs += 3) {
          const b = this.getFreeBanana();
          b.active = true;
          b.group.visible = true;
          b.s = bs;
          b.x = bx;
          b.y = H + 1.05; // reachable while riding the top
        }
      }
    }
    return cliff;
  }

  groundHeightAt(s, x) {
    let h = 0;
    for (const c of this.cliffs) {
      if (s >= c.sStart && s <= c.sEnd && Math.abs(x - c.x) <= c.halfW + 0.35) {
        if (c.H > h) h = c.H;
      }
    }
    return h;
  }

  // -------------------------------------------------------------------------
  // Per-frame world transforms from track-local coords
  syncWorldTransforms() {
    for (const item of this.scenery) {
      const dist = item.s - this.s;
      if (dist < -50 || dist > GEN_AHEAD + 40) continue;
      this.path.sampleTo(item.s, this._P, this._T, this._U);
      this._Rv.crossVectors(this._T, this._U).normalize();
      item.obj.position.copy(this._P)
        .addScaledVector(this._Rv, item.x)
        .addScaledVector(this._U, -dropAtX(item.x));
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      item.obj.quaternion.setFromRotationMatrix(this._mat4);
      const sc = item.obj.userData.sceneryScale || 1;
      item.obj.scale.setScalar(sc);
    }

    for (const o of this.obstacles) {
      if (!o.active) continue;
      const dist = o.s - this.s;
      if (dist < -DESPAWN_BEHIND || dist > GEN_AHEAD + 20) continue;
      this.path.sampleTo(o.s, this._P, this._T, this._U);
      this._Rv.crossVectors(this._T, this._U).normalize();
      o.mesh.position.copy(this._P)
        .addScaledVector(this._Rv, o.x)
        .addScaledVector(this._U, o.radius * 0.85);
      o.mesh.quaternion.copy(o.quat);
    }

    for (const b of this.bananas) {
      if (!b.active) continue;
      const dist = b.s - this.s;
      if (dist < -DESPAWN_BEHIND || dist > GEN_AHEAD + 20) continue;
      this.path.sampleTo(b.s, this._P, this._T, this._U);
      this._Rv.crossVectors(this._T, this._U).normalize();
      b.group.position.copy(this._P)
        .addScaledVector(this._Rv, b.x)
        .addScaledVector(this._U, b.y);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      b.group.quaternion.setFromRotationMatrix(this._mat4);
    }

    for (const c of this.cliffs) {
      const sMid = (c.sStart + c.sEnd) / 2;
      const dist = sMid - this.s;
      if (dist < -GEN_AHEAD || dist > GEN_AHEAD * 2.5) continue;
      this.path.sampleTo(sMid, this._P, this._T, this._U);
      this._Rv.crossVectors(this._T, this._U).normalize();
      c.group.position.copy(this._P);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      c.group.quaternion.setFromRotationMatrix(this._mat4);
    }
  }

  // -------------------------------------------------------------------------
  // Update loop
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const playing = this.state === 'playing';
    const crashed = this.state === 'crashed';

    let worldSpeed;
    if (playing) {
      this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.distance * SPEED_RAMP);
      worldSpeed = this.speed;
    } else if (crashed) {
      this.crashTimer += dt;
      this.speed = Math.max(0, this.speed - 30 * dt); // skid to a stop
      worldSpeed = 0;
      if (this.crashTimer > 1.4) this.state = 'over';
    } else if (this.state === 'menu') {
      worldSpeed = 2.5; // menu: gentle auto-run past the scenery
    } else {
      worldSpeed = 0;   // over: frozen at the crash site
    }

    const prevS = this.s;
    this.s += worldSpeed * dt;
    if (playing) this.distance += worldSpeed * dt;

    this.path.ensure(this.s + GEN_AHEAD);
    this.path.prune(this.s - 80);
    this.ensureChunks();

    // sun follows the player so shadows track anywhere along the path
    this.path.sampleTo(this.s, this._P, this._T, this._U);
    this.sun.position.copy(this._P).add(this._tmp.set(-14, 26, 8));
    this.sun.target.position.copy(this._P);
    // valley floor follows the player (stays below the local surface)
    this.basePlane.position.set(this._P.x, this._P.y - 60, this._P.z);

    const m = this.monkey.group;
    const k = this.monkey;

    if (playing) {
      // lane movement
      const targetX = LANES[this.laneIndex];
      const prevX = this.x;
      this.x = lerp(this.x, targetX, clamp(LANE_LERP * dt, 0, 1));
      const xVel = (this.x - prevX) / Math.max(dt, 1e-4);

      // jump physics vs. surface/cliff height
      const gh = this.groundHeightAt(this.s, this.x);
      if (!this.grounded) {
        this.vy += GRAVITY * dt;
        this.py += this.vy * dt;
        // Land whenever at/below the surface height — no vy<=0 requirement,
        // otherwise a rising jump ghosts through the slab and snaps out late.
        if (this.py <= gh) { this.py = gh; this.vy = 0; this.grounded = true; }
      } else {
        if (gh - this.py > 0.45) {
          this.crash(); // walked/lane-changed into the side of a cliff
        } else if (Math.abs(gh - this.py) < 0.45) {
          this.py = gh; // stick to surface / step up onto a cliff edge
        } else {
          this.grounded = false; // ran off the end of a cliff → fall!
          this.vy = 0;
        }
      }

      // giant cliffs appear ahead on the path
      this.scheduleCliffs();

      // spawn waves by distance travelled
      this.sinceSpawn += worldSpeed * dt;
      if (this.sinceSpawn >= this.spawnGap && this.s > this.noWavesUntil) {
        this.sinceSpawn = 0;
        this.spawnWave();
      }

      // cliff face crash: entered a cliff from the front while too low
      for (const c of this.cliffs) {
        if (prevS < c.sStart && this.s >= c.sStart &&
            Math.abs(this.x - c.x) <= c.halfW + 0.35 && this.py < c.H - 0.35) {
          this.crash();
        }
      }

      // boulder collisions (track-local!)
      for (const o of this.obstacles) {
        if (!o.active) continue;
        if (o.s < this.s - DESPAWN_BEHIND) { o.active = false; o.mesh.visible = false; continue; }
        const dx = Math.abs(o.x - this.x);
        const ds = Math.abs(o.s - this.s);
        if (dx < o.radius + 0.42 && ds < o.radius + 0.35 && this.py < o.height - 0.4) {
          this.crash();
        }
      }

      // banana collection
      for (const b of this.bananas) {
        if (!b.active) continue;
        if (b.s < this.s - DESPAWN_BEHIND) { b.active = false; b.group.visible = false; continue; }
        const dx = Math.abs(b.x - this.x);
        const ds = Math.abs(b.s - this.s);
        const dy = Math.abs(b.y - (this.py + 0.8));
        if (dx < 0.95 && ds < 0.95 && dy < 1.2) {
          b.active = false;
          b.group.visible = false;
          this.bananaCount++;
        }
      }

      // monkey animation — procedural run cycle, oriented to the path frame
      this.runPhase += dt * (6 + this.speed * 0.55);
      const blendTarget = this.grounded ? 0 : 1;
      this.jumpBlend = lerp(this.jumpBlend, blendTarget, clamp(dt * 12, 0, 1));

      const swing = Math.sin(this.runPhase) * 0.95;
      const runPose = { legL: swing, legR: -swing, armL: -swing, armR: swing };
      const jumpPose = { legL: -1.25, legR: -1.05, armL: -2.3, armR: -2.3 };
      for (const part of ['legL', 'legR', 'armL', 'armR']) {
        k[part].rotation.x = lerp(runPose[part], jumpPose[part], this.jumpBlend);
      }
      const bob = this.grounded ? Math.abs(Math.sin(this.runPhase)) * 0.07 : 0;
      k.head.rotation.x = this.grounded ? Math.sin(this.runPhase * 2) * 0.06 : -0.25;
      k.tail.rotation.y = Math.sin(this.runPhase * 0.5) * 0.25;

      // place the monkey on the path surface with lean into lane changes
      this._Rv.crossVectors(this._T, this._U).normalize();
      m.position.copy(this._P)
        .addScaledVector(this._Rv, this.x)
        .addScaledVector(this._U, this.py + bob);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      m.quaternion.setFromRotationMatrix(this._mat4);
      const lean = clamp(xVel * 0.12, -0.35, 0.35);
      m.rotateZ(lean);

      this.emitHud();
    } else if (crashed) {
      // tumble! rotate the body inside its path-aligned frame
      k.body.rotation.x -= dt * 6;
      k.body.position.y = Math.max(0.02, this.py + Math.sin(this.crashTimer * 9) * 0.5 * Math.max(0, 1 - this.crashTimer));
    } else if (this.state === 'menu') {
      // menu idle: happy little hop with arms up
      this.runPhase += dt * 4;
      const bobM = Math.abs(Math.sin(this.runPhase)) * 0.25;
      this._Rv.crossVectors(this._T, this._U).normalize();
      m.position.copy(this._P)
        .addScaledVector(this._Rv, this.x)
        .addScaledVector(this._U, bobM);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      m.quaternion.setFromRotationMatrix(this._mat4);
      k.armL.rotation.z = Math.sin(this.runPhase * 3) * 0.6 - 0.4;
      k.armR.rotation.z = -Math.sin(this.runPhase * 3) * 0.6 + 0.4;
      k.armL.rotation.x = lerp(k.armL.rotation.x, -2.4, dt * 8);
      k.armR.rotation.x = lerp(k.armR.rotation.x, -2.4, dt * 8);
      k.legL.rotation.x = Math.sin(this.runPhase * 6) * 0.3;
      k.legR.rotation.x = -Math.sin(this.runPhase * 6) * 0.3;
    } else {
      // over: unwind the tumble to the nearest full rotation so he lands upright
      k.body.position.y = lerp(k.body.position.y, 0, clamp(dt * 5, 0, 1));
      const twoPi = Math.PI * 2;
      k.body.rotation.x = lerp(
        k.body.rotation.x, Math.round(k.body.rotation.x / twoPi) * twoPi, clamp(dt * 6, 0, 1)
      );
      this.py = Math.max(0, lerp(this.py, this.groundHeightAt(this.s, this.x), clamp(dt * 5, 0, 1)));
      // keep him glued to the path frame while settling
      this._Rv.crossVectors(this._T, this._U).normalize();
      m.position.copy(this._P)
        .addScaledVector(this._Rv, this.x)
        .addScaledVector(this._U, this.py);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      m.quaternion.setFromRotationMatrix(this._mat4);
    }

    // banana spin + world transforms for everything on the path
    for (const b of this.bananas) if (b.active) b.mesh.rotation.y = (b.spin += dt * 3);
    this.syncWorldTransforms();

    // recycle scenery that fell behind
    for (const item of this.scenery) {
      if (item.s < this.s - 50 || item.s > this.s + GEN_AHEAD + 40) this.placeScenery(item);
    }

    // camera: rides the path frame so banking/curves tilt the view, Sonic-style
    const camS = this.s - 9;
    this.path.sampleTo(camS, this._P, this._T, this._U);
    this._Rv.crossVectors(this._T, this._U).normalize();
    this._tmp.copy(this._P)
      .addScaledVector(this._Rv, this.x * 0.4)
      .addScaledVector(this._U, 3.5);
    const shake = crashed ? Math.max(0, 1 - this.crashTimer) * 0.2 : 0;
    if (shake > 0) this._tmp.y += rand(-shake, shake);
    this.camera.position.lerp(this._tmp, clamp(dt * 6, 0, 1));

    this.path.sampleTo(this.s, this._P, this._T, this._U);
    this._camUp.lerp(this._U, clamp(dt * 4, 0, 1)).normalize();
    this.camera.up.copy(this._camUp);
    this.path.sampleTo(this.s + 8, this._P, this._T, this._U);
    this._Rv.crossVectors(this._T, this._U).normalize();
    this._tmp.copy(this._P)
      .addScaledVector(this._Rv, this.x * 0.15)
      .addScaledVector(this._U, 1.4);
    this.camera.lookAt(this._tmp);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    for (const [, mesh] of this.chunks) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.renderer.dispose();
  }
}

function disposeGroup(group) {
  group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
}
