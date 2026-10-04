import * as THREE from 'three';
import { TrackPath, STEP } from './track.js';
import { buildCostume, abilityFor, ABILITY_DEFAULTS } from './costumes.js';
import { makeBananaGeometry } from './banana.js';
import {
  LEVELS, LEVEL_SECONDS, MENU_LEVEL_INDEX, levelAt,
} from './levels.js';
import { soundKit } from './audio.js';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
export const LANES = [-2.6, 0, 2.6];
const LANE_LERP = 12;          // lane switch responsiveness
const GRAVITY = -38;
export const JUMP_VELOCITY = 13.5; // apex ≈ 2.4 m — clears boulders and lands on cliffs
const SECOND_JUMP_VELOCITY = 11.6; // the mid-air boost spent by an ability's extra jump
export const JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * Math.abs(GRAVITY));
const BASE_SPEED = 14;         // m/s
const MAX_SPEED = 36;
const SPEED_RAMP = 0.04;       // per meter travelled
const LOOKAHEAD_S = 130;       // spawn distance ahead of the player (fog hides pop-in)
const GEN_AHEAD = 200;         // path/geometry generated this far ahead
const DESPAWN_BEHIND = 26;     // recycle objects this far behind the player
const CHUNK_LEN = 20;          // meters per road-ribbon chunk
const CLIFF_H = 1.9;           // height of cliff platforms (jumpable: apex 2.4)
const WALL_H = 5.5;            // walls are more than double the jump apex: never jumpable
// Two obstacles must never ask for two different lanes half a second apart, and a wall's one
// open lane must not have a rock parked in it — that would be an all-three-lane wall in practice.
export const SLAB_CLEAR = 90;    // metres end-to-start between any two slabs (~2.5 s at MAX_SPEED)
export const SLAB_APPROACH = 45; // runway in front of a slab where no boulder may be placed
const CAM_BEHIND = 9;          // chase camera sits this far behind the player
const CAM_HEIGHT = 3.5;        // …and this far above the path surface
const SWIPE_PX = 40;           // travel along the dominant axis that makes it a swipe
const TAP_PX = 24;             // …and staying inside this box (no duration cap) makes it a tap
export const MONKEY_SCALE = 0.85;
export const CHEST_Y = 0.8;    // banana collection height above the surface (× sizeScale)
const SCENERY_COUNT = 34;      // pooled props, never more
// One lane gap is exactly |LANES[1] − LANES[0]| = 2.6 m; the extra hair lets a
// banana sitting *exactly* one lane over count as reachable (float equality would
// otherwise reject it on every frame the magnet is supposed to fire).
const MAG_LATERAL = LANES[1] - LANES[0] + 0.1;

// Banana reachability envelope: nothing may spawn where the monkey cannot get to it.
export const COLLECT_DX = 0.95;
export const COLLECT_DS = 0.95;
export const COLLECT_DY = 1.2;
const BANANA_MAX_Y = JUMP_APEX + CHEST_Y + COLLECT_DY; // highest a chest can reach
const BANANA_MIN_CLEAR = 0.55;  // …and how far clear of the rock under it it must be

// Score, revives and lap pacing
const BASE_BANANA_VALUE = 10;
const LEVEL_BONUS = 250;
const REVIVE_GRACE = 1.4;      // seconds of invulnerability after a doctor revive
const PACE_PER_LAP = 0.12;     // obstacle spacing tightens ~12% per full circuit
const PACE_MAX = 1.6;

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

/** Weighted pick from a theme's `[[kind, weight]]` scenery list. */
function weightedKind(theme) {
  const kinds = theme.scenery?.length ? theme.scenery : [['pine', 1]];
  let total = 0;
  for (const [, w] of kinds) total += w;
  let roll = Math.random() * total;
  for (const [kind, w] of kinds) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return kinds[kinds.length - 1][0];
}
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
// Scenery props. One pooled prop per kind, assembled from primitives with their
// OWN materials (only the monkey shares materials), coloured from the theme so a
// single builder serves several worlds: `tower` is a city block, a mall unit and a
// sci-fi spire; `rock` is granite, coral or moon dust.
// ---------------------------------------------------------------------------
const propMat = (hex, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, ...opts });

function addProp(group, geo, material, pos, scale) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = true;
  group.add(m);
  return m;
}

const PROP_BUILDERS = {
  pine(p) {
    const g = new THREE.Group();
    const trunk = propMat(p.trunk, { roughness: 1 });
    const leaf = propMat(p.leaf, { roughness: 0.95 });
    addProp(g, new THREE.CylinderGeometry(0.16, 0.24, 1.4, 7), trunk, [0, 0.7, 0]);
    for (let i = 0; i < 3; i++) {
      addProp(g, new THREE.ConeGeometry(1.15 - i * 0.28, 1.1, 8), leaf, [0, 1.6 + i * 0.75, 0]);
    }
    return g;
  },

  palm(p) {
    const g = new THREE.Group();
    const trunkMat = propMat(p.trunk, { roughness: 1 });
    const leaf = propMat(p.leaf, { roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const lean = i * 0.22;
      addProp(g, new THREE.CylinderGeometry(0.15, 0.2, 0.9, 6), trunkMat,
        [lean * 0.35, 0.5 + i * 0.8, 0], [1, 1, 1]);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addProp(g, new THREE.ConeGeometry(0.34, 1.9, 5), leaf,
        [Math.cos(a) * 0.75, 3.5, Math.sin(a) * 0.75], [1, 1, 0.35])
        .rotation.set(Math.PI / 2 - 0.55, -a, 0);
    }
    return g;
  },

  cactus(p) {
    const g = new THREE.Group();
    const skin = propMat(p.leaf, { roughness: 0.8 });
    addProp(g, new THREE.CapsuleGeometry(0.42, 1.6, 4, 10), skin, [0, 1.3, 0]);
    for (const s of [-1, 1]) {
      addProp(g, new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), skin, [s * 0.62, 1.5, 0]);
      addProp(g, new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), skin, [s * 0.9, 2.1, 0]);
    }
    return g;
  },

  rock(p, theme) {
    const g = new THREE.Group();
    const stone = propMat(theme.slab, { roughness: 1, flatShading: true });
    addProp(g, new THREE.DodecahedronGeometry(0.8, 0), stone, [0, 0.45, 0]);
    addProp(g, new THREE.DodecahedronGeometry(0.42, 0), stone, [0.7, 0.24, 0.3]);
    return g;
  },

  tower(p) {
    const g = new THREE.Group();
    const h = rand(4, 9);
    const shell = propMat(p.trunk, { roughness: 0.8 });
    addProp(g, new THREE.BoxGeometry(2.6, h, 2.6), shell, [0, h / 2, 0]);
    if (p.glow) {
      const win = propMat(p.glow, { emissive: p.glow, emissiveIntensity: 1.4, roughness: 0.4 });
      for (let i = 0; i < Math.floor(h / 1.6); i++) {
        addProp(g, new THREE.BoxGeometry(1.9, 0.35, 1.9), win, [0, 1.2 + i * 1.6, 0]);
      }
    }
    return g;
  },

  lamp(p) {
    const g = new THREE.Group();
    const pole = propMat(p.trunk, { roughness: 0.7 });
    addProp(g, new THREE.CylinderGeometry(0.09, 0.13, 3.4, 6), pole, [0, 1.7, 0]);
    if (p.glow) {
      const bulb = propMat(p.glow, { emissive: p.glow, emissiveIntensity: 2, roughness: 0.3 });
      addProp(g, new THREE.SphereGeometry(0.28, 10, 8), bulb, [0, 3.5, 0]);
    }
    return g;
  },

  crystal(p) {
    const g = new THREE.Group();
    const shard = propMat(p.glow || p.leaf, {
      emissive: p.glow || p.leaf, emissiveIntensity: 0.9, roughness: 0.25, flatShading: true,
    });
    for (let i = 0; i < 4; i++) {
      const hgt = rand(1.1, 2.6);
      addProp(g, new THREE.ConeGeometry(0.38, hgt, 5), shard,
        [rand(-0.7, 0.7), hgt / 2, rand(-0.7, 0.7)]);
    }
    return g;
  },

  kelp(p) {
    const g = new THREE.Group();
    const weed = propMat(p.leaf, { roughness: 1 });
    for (let i = 0; i < 6; i++) {
      addProp(g, new THREE.SphereGeometry(0.34 - i * 0.03, 8, 6), weed,
        [Math.sin(i * 0.7) * 0.35, 0.4 + i * 0.55, Math.cos(i * 0.5) * 0.3]);
    }
    return g;
  },

  cloud(p) {
    const g = new THREE.Group();
    const fluff = propMat(p.cloud || 0xffffff, { roughness: 1, flatShading: true });
    for (let i = 0; i < 4; i++) {
      addProp(g, new THREE.SphereGeometry(rand(0.7, 1.3), 8, 6), fluff,
        [rand(-1.2, 1.2), rand(2.2, 3.4), rand(-0.6, 0.6)]);
    }
    return g;
  },
};

/** Build one scenery prop of `kind` for `theme`. Unknown kinds fall back to pine. */
function buildScenery(kind, theme) {
  const builder = PROP_BUILDERS[kind] || PROP_BUILDERS.pine;
  const p = { cloud: theme.hemi.sky, ...theme.props };
  const g = builder(p, theme);
  g.name = 'scenery';
  return propScale(g, ...propRange(kind));
}

function propScale(g, min, max) {
  g.userData.sceneryScale = rand(min, max);
  return g;
}

const PROP_RANGES = {
  pine: [0.7, 1.9], palm: [0.8, 1.5], cactus: [0.6, 1.3], rock: [0.6, 1.6],
  tower: [0.7, 1.4], lamp: [0.8, 1.2], crystal: [0.7, 1.6], kelp: [0.9, 1.8],
  cloud: [1.2, 2.4],
};
function propRange(kind) { return PROP_RANGES[kind] || [0.7, 1.6]; }

/** Free the geometry + materials of one retired prop (props never share them). */
function disposeProp(obj) {
  const mats = new Set();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    if (o.material) mats.add(o.material);
  });
  for (const m of mats) m.dispose();
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
  group.scale.setScalar(MONKEY_SCALE);

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
    this.state = 'menu';   // menu | playing | crashed | over | shop
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
    // the fitting-room camera needs its own scratch space: _P/_T/_U/_Rv/_tmp are
    // clobbered by the sun/valley block and the follow-camera earlier in loop()
    this._fitP = new THREE.Vector3();
    this._fitT = new THREE.Vector3();
    this._fitU = new THREE.Vector3();
    this._fitR = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._hue = new THREE.Color();   // scratch for rainbow road bands

    // costumes: id -> [{host, object}], built lazily and toggled by visibility
    this.costumeId = null;
    this.costumeParts = new Map();
    this.shopT = 0;

    // abilities: resolved from the worn outfit's data, never hard-coded here
    this.ability = { ...ABILITY_DEFAULTS, id: null, label: 'Bare Monkey', text: '' };
    this.airJumpsLeft = 0;
    this.revivesLeft = 0;
    this.invulnerableT = 0;

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

    const skyColor = new THREE.Color(levelAt(MENU_LEVEL_INDEX).sky);
    this.scene = new THREE.Scene();
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 45, 135);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 3.5, 9);

    // lights — the sun follows the player so shadows work anywhere on the path
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x7a6a3f, 1.1);
    this.scene.add(this.hemi);
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

    // Real bananas (tapered crescents with brown tips), coloured per vertex so
    // the whole pool can share one geometry + material.
    this.bananaGeo = makeBananaGeometry();
    this.bananaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });

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
    this.scenery = [];            // props in local coords {obj, kind, s, x}
    // The palette must exist before the first chunk is built (band colours are
    // baked into vertex colours at build time), so the menu theme is applied here.
    this.setThemeColors(MENU_LEVEL_INDEX);
    for (let i = 0; i < SCENERY_COUNT; i++) {
      const item = { obj: null, kind: null, s: 0, x: 0 };
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

  /**
   * Re-place one pooled prop: new side, new distance ahead, and (because themes
   * own different kinds) possibly a whole new prop. Themes with `sink: false`
   * have no embankment to bury a palm in, so their props hug the flat shoulder.
   */
  placeScenery(item, initial = false, spread = false) {
    const sunk = this.theme.sink !== false;
    const side = Math.random() < 0.5 ? -1 : 1;
    item.x = side * (sunk ? rand(7.5, 28) : rand(6.4, 9.4));
    if (initial) {
      item.s = rand(-40, GEN_AHEAD);            // the world is being built at s = 0
    } else if (spread) {
      item.s = this.s + rand(-40, GEN_AHEAD);   // level change: fill the whole window
    } else {
      item.s = this.s + rand(90, GEN_AHEAD - 30); // recycle: only ever ahead
    }
    this.ensurePropKind(item, weightedKind(this.theme));
  }

  /** Swap a pooled prop for one of `kind`, freeing the old prop's GPU memory. */
  ensurePropKind(item, kind) {
    if (item.obj && item.kind === kind) return;
    if (item.obj) {
      this.scene.remove(item.obj);
      disposeProp(item.obj);
      item.obj = null;
    }
    const obj = buildScenery(kind, this.theme);
    this.scene.add(obj);
    item.obj = obj;
    item.kind = kind;
  }

  /**
   * Re-seed the prop pool for a new theme: same count (34), same slots, entirely
   * different worlds. Positions are re-rolled too, so a level change reads as a
   * cut to a new place rather than trees repainted in front of your face.
   */
  reseedScenery() {
    for (const item of this.scenery) this.placeScenery(item, false, true);
  }

  // -------------------------------------------------------------------------
  /** Start (or restart) a run. `initial` means "park on the menu", not "run". */
  reset(initial = false) {
    this.state = initial ? 'menu' : 'playing';

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
    this.nextWallS = 480;        // …and the first unjumpable wall a bit later
    this.noWavesUntil = 0;

    this.resetLevelState(initial);   // menu world, or a random theme for a real run
    this.resetAbility();             // fresh jumps and revives from the worn outfit

    this.rebuildWorld();         // fresh curves + chunks + scenery at s = 0
    this.snapMonkeyUpright(); // also clears head/tail rotations (stale pose leak)
    this.monkey.group.rotation.set(0, 0, 0);
    this.snapCameraToStart();
    this.emitHud(true);
  }

  /**
   * Put the world back at the start of the trail: a brand-new path, regenerated
   * ground chunks, re-seeded scenery and every pooled object deactivated. The new
   * TrackPath is required — samples behind the player are pruned, so merely
   * setting `s = 0` would extrapolate past whatever survived instead of putting
   * him back on the trailhead he started from. Touches no run stats, which is what
   * lets `enterShop()` call it while a game-over card is open.
   */
  rebuildWorld() {
    this.path = new TrackPath(); // fresh curves every build

    this.s = 0;                  // distance along the path
    this.laneIndex = 1;
    this.x = 0;                  // lateral offset

    for (const o of this.obstacles) { o.active = false; o.mesh.visible = false; }
    for (const b of this.bananas) this.retireBanana(b);
    while (this.cliffs.length) this.removeSlab(this.cliffs[this.cliffs.length - 1]);

    // rebuild ground chunks and scenery around the fresh path
    for (const [, mesh] of this.chunks) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.chunks.clear();
    for (const item of this.scenery) this.placeScenery(item, true);

    this.ensureChunks();
    this.syncWorldTransforms();
  }

  // --- themed levels --------------------------------------------------------
  /**
   * Paint the scene with a theme. Colours only: gravity, jump velocity and lane
   * geometry are global constants no level may touch (see docs/levels.md).
   */
  setThemeColors(index) {
    const t = levelAt(index);
    this.levelIndex = index;
    this.theme = t;

    this.scene.background.setHex(t.sky);
    this.scene.fog.color.setHex(t.sky);
    this.scene.fog.near = t.fog[0];
    this.scene.fog.far = t.fog[1];
    this.sun.color.setHex(t.sun.color);
    this.sun.intensity = t.sun.intensity;
    this.hemi.color.setHex(t.hemi.sky);
    this.hemi.groundColor.setHex(t.hemi.ground);
    this.hemi.intensity = t.hemi.intensity;
    this.basePlane.material.color.setHex(t.floor);

    // Band colours are baked into chunk vertex colours, so they live on the engine.
    const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    const grass = C(t.bands.grass);
    this.palette = {
      road: C(t.bands.road),
      curb: C(t.bands.curb),
      grass,
      edge: grass.clone().multiplyScalar(0.84),
      deep: C(t.bands.deep),
      slab: t.slab,
      rainbow: !!t.rainbow,
    };
  }

  /**
   * Apply theme `index` to the live scene without moving the player. Safe while
   * playing, in the menu or in the shop: it reads no run stats.
   */
  applyLevel(index) {
    this.setThemeColors(clamp(Math.trunc(index), 0, LEVELS.length - 1));
    this.rebuildChunks();  // cached chunks still hold the old band colours
    this.reseedScenery();  // and the props belong to a different world now
    // The HUD chip names the current theme, so it must hear about the change on this
    // very tick — `emitHud` otherwise only fires when the score moves.
    this.emitHud(true);
  }

  /** Cached ground chunks are vertex-coloured at build time → rebuild them all. */
  rebuildChunks() {
    for (const [, mesh] of this.chunks) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.chunks.clear();
    this.ensureChunks();
  }

  /**
   * Menu: always the same world. Run: roll a random theme off the ladder.
   * Colours only — `reset()`'s own `rebuildWorld()` then builds chunks and props
   * for the new palette, so nothing is built twice.
   */
  resetLevelState(initial) {
    this.levelTimer = 0;
    this.levelsCleared = 0;
    this.lap = 0;
    if (initial) {
      this.setThemeColors(MENU_LEVEL_INDEX);
    } else {
      this.pickRandomLevel();
    }
  }

  pickRandomLevel() {
    this.setThemeColors(Math.floor(Math.random() * LEVELS.length));
  }

  /** Obstacle spacing tightens with every full circuit of the ladder. */
  pace() {
    return Math.min(1 + PACE_PER_LAP * this.lap, PACE_MAX);
  }

  levelInfo() {
    const t = this.theme;
    return {
      index: this.levelIndex,
      id: t.id,
      label: t.label,
      icon: t.icon,
      cleared: this.levelsCleared,
      lap: this.lap,
      timeLeft: Math.max(0, Math.ceil(LEVEL_SECONDS - this.levelTimer)),
    };
  }

  /** Beat the current level: next theme, banner, chime and a score bonus. */
  completeLevel() {
    const cleared = this.theme;
    const next = (this.levelIndex + 1) % LEVELS.length;
    if (next === 0) this.lap += 1;          // wrapped: a new circuit of the ladder
    this.levelsCleared += 1;
    this.applyLevel(next);
    soundKit.levelClear();
    this.cb.onLevel?.({ cleared, entering: this.theme, lap: this.lap, clearedCount: this.levelsCleared });
  }

  // --- abilities ------------------------------------------------------------
  /**
   * Adopt the stat block of a worn outfit (null = bare monkey). This is the only
   * place per-costume numbers enter the engine; see docs/abilities.md.
   */
  applyAbility(costumeId) {
    this.ability = abilityFor(costumeId);
    // The scale is an ability stat: nothing else may write group.scale.
    this.monkey.group.scale.setScalar(MONKEY_SCALE * this.ability.sizeScale);
    this.airJumpsLeft = this.ability.extraJumps;
    this.revivesLeft = this.ability.revives;
    this.invulnerableT = 0;
  }

  /** Fresh counters for a new run, from whatever outfit is worn. */
  resetAbility() {
    this.applyAbility(this.costumeId);
  }

  /** Park the camera where the chase view belongs at s = 0 (behind the start). */
  snapCameraToStart() {
    this.path.sampleTo(-CAM_BEHIND, this._P, this._T, this._U);
    this.camera.position.copy(this._P).addScaledVector(this._U, CAM_HEIGHT);
    this._camUp.copy(this._U);
  }

  start() { this.reset(false); if (this.cb.onState) this.cb.onState('playing'); }

  /**
   * Three ways out of a crash, in order: grace means it never happened, a spent
   * revive keeps you running, and otherwise the run ends. See docs/abilities.md.
   */
  crash() {
    if (this.state !== 'playing') return;
    if (this.invulnerableT > 0) return;      // a revive never dies twice in one frame
    if (this.revivesLeft > 0) { this.revive(); return; }
    this.state = 'crashed';
    this.crashTimer = 0;
    const stats = this.stats();
    if (this.cb.onGameOver) this.cb.onGameOver(stats);
  }

  /**
   * Spend one revive: clear the obstacle that got you, hold the lane for a beat,
   * and stay airborne-free. The slab is removed before he is snapped down, or the
   * snap would park him on top of the wall that killed him.
   */
  revive() {
    this.revivesLeft -= 1;
    this.invulnerableT = REVIVE_GRACE;

    for (const o of this.obstacles) {
      if (o.active && Math.abs(o.s - this.s) <= 12) { o.active = false; o.mesh.visible = false; }
    }
    for (let i = this.cliffs.length - 1; i >= 0; i--) {
      const c = this.cliffs[i];
      if (c.sStart < this.s - 2 || c.sStart > this.s + 12) continue;
      // removeSlab, never a hand-rolled splice: the slab *owns* its banana trail, and
      // a trail nobody retires floats over bare road until it falls behind the player.
      this.removeSlab(c);
    }

    this.py = this.groundHeightAt(this.s, this.x);
    this.vy = 0;
    this.grounded = true;
    soundKit.revive();
    this.cb.onRevive?.({ left: this.revivesLeft });
  }

  // --- costumes -------------------------------------------------------------
  /** The rig hosts a costume may attach to. */
  costumeHosts() {
    const k = this.monkey;
    return { body: k.body, head: k.head, armL: k.armL, armR: k.armR, legL: k.legL, legR: k.legR };
  }

  ensureCostume(id) {
    if (!id || !this.costumeParts.has(id)) return;
    const hosts = this.costumeHosts();
    for (const p of this.costumeParts.get(id)) {
      p.object.visible = false;
      hosts[p.host].add(p.object);
    }
  }

  /** Equip an outfit ('' / null = bare monkey). Builds it on first use. */
  setCostume(id) {
    const next = id || null;
    if (next && !this.costumeParts.has(next)) {
      const hosts = this.costumeHosts();
      const parts = buildCostume(next, hosts);
      for (const p of parts) hosts[p.host].add(p.object);
      this.costumeParts.set(next, parts);
    }
    for (const [cid, parts] of this.costumeParts) {
      const on = cid === next;
      for (const p of parts) p.object.visible = on;
    }
    this.costumeId = next;
    // Trying an outfit on is free — but it previews how the monkey *handles*, too.
    this.applyAbility(next);
  }

  getCostume() { return this.costumeId; }

  /** Upright, limbs at rest — used by reset(), the shop and the over state. */
  snapMonkeyUpright() {
    const k = this.monkey;
    k.body.position.set(0, 0, 0);
    k.body.rotation.set(0, 0, 0);
    k.head.rotation.set(0, 0, 0); // reset() never restored these → stale poses leaked
    k.tail.rotation.set(0, 0, 0);
    for (const part of [k.armL, k.armR, k.legL, k.legR]) part.rotation.set(0, 0, 0);
  }

  // --- fitting room ---------------------------------------------------------
  /** @returns false when refused (never freeze a live run from a hook) */
  enterShop() {
    if (this.state === 'playing') return false;
    // The fitting room is always at the trailhead, in the menu world: nobody
    // wants to try on a tuxedo while wedged in the crash site's boulders, and
    // screenshots of the shop must not depend on which theme killed you.
    this.setThemeColors(MENU_LEVEL_INDEX);
    this.rebuildWorld();
    this.snapMonkeyUpright();
    this.monkey.group.rotation.set(0, 0, 0);
    this.py = this.groundHeightAt(this.s, this.x);
    this.vy = 0;
    this.grounded = true;
    this.shopT = 0;
    this.state = 'shop';
    this.snapShopCamera(); // don't lerp the fitting view in from a crash site
    return true;
  }

  exitShop({ toMenu = false } = {}) {
    this.snapMonkeyUpright();
    this._camUp.set(0, 1, 0);
    if (toMenu) { this.reset(true); return; }
    this.state = 'over';
  }

  /**
   * Close-up three-quarter view of the monkey, biased so he sits above the shop
   * panel. The camera sits ahead and looks back along the path, so screen-right
   * is *negative* lateral: aim wide of him (and low) to park him right and clear
   * of the panel.
   */
  fitShopView() {
    this.path.sampleTo(this.s, this._fitP, this._fitT, this._fitU);
    this._fitR.crossVectors(this._fitT, this._fitU).normalize();
    // A phone held upright turns the shop into a bottom sheet (breakpoints live in
    // styles.css and must match `sheet` below), so there is no side panel to stand next
    // to: he is centred, pulled back, and aimed at from slightly above so he reads in
    // the band of scene left above the sheet. Everywhere else he keeps his old spot on
    // the right of a landscape screen.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sheet = h > w && w <= 700;
    const dist = sheet ? 6.8 : 3.0;      // in front of him (he faces along +tangent)
    const side = sheet ? 0 : 1.2;
    // Aiming ~30° down at the trail from 3.4 m up, with him centred laterally, lands his
    // head-to-feet span in the band of scene above the bottom sheet (which covers the
    // lower 62% of the screen) — tuned against screenshots, not trigonography.
    const camY = sheet ? 3.4 : 1.35;
    const lookY = sheet ? -0.6 : 1.35;   // aim low → he sits higher in the frame
    const camPos = this._camTarget.copy(this._fitP)
      .addScaledVector(this._fitT, dist)
      .addScaledVector(this._fitR, this.x + side)
      .addScaledVector(this._fitU, camY);
    const look = this._lookAt.copy(this._fitP)
      .addScaledVector(this._fitR, this.x + (side ? 0.95 : 0))
      .addScaledVector(this._fitU, lookY);
    return { camPos, look };
  }

  updateShopCamera(dt) {
    const { camPos, look } = this.fitShopView();
    this.camera.position.lerp(camPos, clamp(dt * 4, 0, 1));
    this._camUp.lerp(this._fitU, clamp(dt * 4, 0, 1)).normalize();
    this.camera.up.copy(this._camUp);
    this.camera.lookAt(look);
  }

  /** Jump straight to the fitting framing — no fly-through from a crash site. */
  snapShopCamera() {
    const { camPos, look } = this.fitShopView();
    this.camera.position.copy(camPos);
    this._camUp.copy(this._fitU);
    this.camera.up.copy(this._camUp);
    this.camera.lookAt(look);
  }

  // --- test/debug hooks -----------------------------------------------------
  /** Deterministic banana pickup: one appears at the monkey's chest. */
  testSpawnBananaAtPlayer() {
    const b = this.getFreeBanana();
    return this.placeBanana(b, this.s + 0.4, this.x, this.py + CHEST_Y * this.ability.sizeScale);
  }

  /**
   * Deterministic banana at a chosen spot ahead: `{ d, lane }`. Goes through
   * `placeBanana`, so it obeys the same reachability rules as anything the game
   * spawns. Returns the placed spot, or null when the rules refused it.
   */
  testSpawnBananaAhead({ d = 4, lane = this.laneIndex } = {}) {
    const b = this.getFreeBanana();
    if (!this.placeBanana(b, this.s + d, LANES[lane], 1.05)) return null;
    return { s: b.s, x: b.x, y: b.y };
  }

  testSpawnBoulderAhead(d = 2.5) {
    const o = this.getFreeBoulder();
    const s = 1.0;
    Object.assign(o, { active: true, radius: s * 0.95, height: s * 1.7 });
    o.mesh.visible = true;
    o.s = this.s + d;
    o.x = this.x; // same lateral spot as the player right now → unavoidable
    this.clearBananasUnder(o);
    return o;
  }

  /** Remove **all** slabs (cliffs *and* walls) plus every active boulder. */
  testClearCliffs() {
    for (const c of this.cliffs) this.removeSlab(c);
    this.cliffs.length = 0;
    this.nextCliffS = Infinity; // no random cliffs while testing
    this.nextWallS = Infinity;  // …or walls
    // also remove boulder waves already rolling toward the player, so nothing
    // blocks the lane on the approach to the test cliff
    for (const o of this.obstacles) { o.active = false; o.mesh.visible = false; }
  }

  testSpawnCliffAhead() {
    // must be beyond generated samples so the flat-ground reservation applies
    const sStart = Math.max(this.path.maxGeneratedS + 70, this.s + LOOKAHEAD_S + 60);
    const c = this.makeSlab(sStart, rand(30, 40), [0, 1, 2], 'cliff'); // all lanes
    this.noWavesUntil = c.sEnd + 60;
    return { sStart: c.sStart, sEnd: c.sEnd, H: c.H, rideable: c.rideable };
  }

  /**
   * Spawn an unjumpable wall ahead. Default coverage is the player's current lane
   * only — a wall that blocked all three lanes would be a death sentence rather
   * than a forced lane change.
   */
  testSpawnWallAhead(lanes = [this.laneIndex]) {
    const sStart = Math.max(this.path.maxGeneratedS + 70, this.s + LOOKAHEAD_S + 60);
    const c = this.makeSlab(sStart, rand(24, 34), [...lanes], 'wall');
    this.noWavesUntil = c.sEnd + 60;
    return { sStart: c.sStart, sEnd: c.sEnd, x: c.x, halfW: c.halfW, H: c.H };
  }

  /** Force one boulder wave right now (used by the banana audit). */
  testSpawnWaveNow() { this.spawnWave(); return this.obstacles.filter((o) => o.active).length; }

  /**
   * Re-run the reachability rules over every active banana. Every counter must be
   * zero: nothing buried in a slab, nothing above the reachable envelope, nothing
   * inside a boulder, and no banana still owned by a slab that has gone away (the
   * shape of any code path that drops a slab without going through `removeSlab`).
   * This is the regression test for "bananas float".
   */
  testBananaAudit() {
    let checked = 0, buried = 0, unreachable = 0, inObstacle = 0, orphan = 0;
    for (const b of this.bananas) {
      if (!b.active) continue;
      checked++;
      if (b.owner !== null && !this.cliffs.includes(b.owner)) orphan++;
      const g = this.groundHeightAt(b.s, b.x);
      if (b.y < g + BANANA_MIN_CLEAR - 1e-6) buried++;
      if (b.y > g + BANANA_MAX_Y + 1e-6) unreachable++;
      for (const o of this.obstacles) {
        if (!o.active) continue;
        if (Math.abs(o.s - b.s) <= o.radius + 0.5 && Math.abs(o.x - b.x) <= o.radius + 0.6 &&
            b.y < o.height + 0.45) { inObstacle++; break; }
      }
    }
    const walls = this.cliffs.filter((c) => !c.rideable).length;
    return {
      checked, buried, unreachable, inObstacle, orphan,
      slabs: this.cliffs.length, walls,
    };
  }

  /**
   * Scheduling invariants over the live world, for regression testing "the wall covered
   * everything": no unjumpable slab may span all three lanes, no two slabs may sit closer
   * than `SLAB_CLEAR` apart (−1 while fewer than two exist), and no boulder may be inside a
   * slab's runway. A wall that leaves one lane open is only fair if that lane is runnable.
   */
  testObstacleAudit() {
    const covers = (c, lane) => Math.abs(LANES[lane] - c.x) <= c.halfW + 0.35;
    let wallCoversAllLanes = 0, rocksInSlabZone = 0;
    for (const c of this.cliffs) {
      if (!c.rideable && [0, 1, 2].every((l) => covers(c, l))) wallCoversAllLanes++;
    }
    let minSlabGap = -1;
    const arr = this.cliffs;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const gap = Math.max(arr[i].sStart, arr[j].sStart) - Math.min(arr[i].sEnd, arr[j].sEnd);
        if (minSlabGap < 0 || gap < minSlabGap) minSlabGap = Math.round(gap * 10) / 10;
      }
    }
    for (const o of this.obstacles) {
      if (o.active && this.inSlabZone(o.s)) rocksInSlabZone++;
    }
    return {
      slabs: arr.length, walls: arr.filter((c) => !c.rideable).length,
      wallCoversAllLanes, minSlabGap, rocksInSlabZone,
    };
  }

  testJump() { this.jump(); }
  get testAirJumpsLeft() { return this.airJumpsLeft; }
  testSetRevives(n) { this.revivesLeft = Math.max(0, Math.trunc(n) || 0); return this.revivesLeft; }

  testGetLevel() { return this.levelInfo(); }
  testSetLevelIndex(i) { this.applyLevel(clamp(Math.trunc(i), 0, LEVELS.length - 1)); return this.levelInfo(); }
  testClearLevelNow() {
    this.completeLevel();
    return this.levelInfo();
  }

  stats() {
    return {
      score: this.score(),
      bananas: this.bananaCount,
      distance: Math.floor(this.distance),
      level: this.levelInfo(),
      levelsCleared: this.levelsCleared,
      lap: this.lap,
      ability: { id: this.ability.id, label: this.ability.label },
    };
  }

  /** Score: metres + bananas (worth more in some hats) + levels beaten. */
  score() {
    return Math.floor(this.distance)
      + this.bananaCount * (BASE_BANANA_VALUE + this.ability.valueBonus)
      + this.levelsCleared * LEVEL_BONUS;
  }

  emitHud(force = false) {
    const s = this.score();
    if (force || s !== this.lastScoreSent) {
      this.lastScoreSent = s;
      if (this.cb.onHud) this.cb.onHud({ ...this.stats(), speed: this.speed });
    }
  }

  // -------------------------------------------------------------------------
  // Input
  /**
   * Touch controls on the canvas. A swipe is decided by its dominant axis, so an
   * upward flick jumps and a diagonal flick left still changes lanes; anything
   * that stays inside TAP_PX of where it started is a tap (and also jumps). A
   * downward swipe does nothing — there is no duck to trigger. Exactly one finger
   * is tracked at a time: remembering the first pointerdown's `pointerId` stops a
   * second finger from overwriting the start point mid-swipe, which used to turn
   * two touches into phantom lane changes. Gestures decide nothing outside
   * `playing`, so swiping over the menu or a corpse never starts a run.
   */
  bindTouch(el) {
    let id = null;      // pointerId of the gesture we are tracking, if any
    let sx = 0, sy = 0; // where that finger landed

    const end = (e) => {
      if (id === null || e.pointerId !== id) return;
      id = null;
      if (this.state !== 'playing') return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx >= SWIPE_PX && adx >= ady) {
        dx > 0 ? this.moveRight() : this.moveLeft();
      } else if (ady >= SWIPE_PX && dy < 0) {
        this.jump(); // an upward flick always jumps
      } else if (Math.hypot(dx, dy) <= TAP_PX) {
        this.jump(); // a tap, however slow it was
      }
    };

    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;         // one gesture per finger: ignore extra fingers
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { if (e.pointerId === id) id = null; });
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

  /**
   * Jump. From the ground this is the outfit's own jump velocity; in mid-air it
   * spends one of the ability's extra jumps (a boost, not a re-launch).
   */
  jump() {
    if (this.grounded) {
      this.vy = JUMP_VELOCITY * this.ability.jumpMul;
      this.grounded = false;
      this.airJumpsLeft = this.ability.extraJumps;
    } else if (this.airJumpsLeft > 0) {
      this.airJumpsLeft -= 1;
      this.vy = SECOND_JUMP_VELOCITY;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Rotating a phone changes the framing rule, not just the aspect: re-snap so the
    // fitting room does not lerp across from a view that no longer exists.
    if (this.state === 'shop') this.snapShopCamera();
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

    // Band colours come from the current level theme; they are baked into vertex
    // colours here, which is why changing levels disposes every cached chunk.
    const { grass: grassC, edge: grassEdgeC, deep: deepC, curb: curbC, road: roadC } = this.palette;
    const rainbow = this.palette.rainbow;

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
        if (abs <= 5) {
          // Rainbow Sky: the road band cycles hue along the trail instead of
          // being one flat colour. setHSL works in the same space as the bands.
          col = rainbow ? this._hue.setHSL((s * 0.03) % 1, 0.72, 0.62) : roadC;
        } else if (abs <= 5.6) col = curbC;
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
    const b = { group, mesh, active: false, s: 0, x: 0, y: 1, spin: Math.random() * 6, owner: null };
    this.bananas.push(b);
    return b;
  }

  /**
   * The only way a banana enters the world. `y` is a suggestion: the helper
   * resolves the ground under the spot (the top of whatever solid occupies it) and
   * refuses or lowers the placement so nothing can float out of reach, hide inside
   * rock, or sit in a boulder you would die on first. Returns true when the banana
   * actually activated. See docs/architecture.md → "Banana reachability".
   */
  placeBanana(b, s, x, y, owner = null) {
    const g = this.groundHeightAt(s, x);
    // Buried in (or just under) the surface of a cliff top or wall body: invisible
    // and uncollectable, so don't place it at all.
    if (y < g + BANANA_MIN_CLEAR) return false;

    let yy = Math.min(y, g + BANANA_MAX_Y); // never above a max-height jump's chest

    for (const o of this.obstacles) {
      if (!o.active) continue;
      if (Math.abs(o.s - s) <= o.radius + 0.5 && Math.abs(o.x - x) <= o.radius + 0.6 &&
          yy < o.height + 0.45) return false; // you'd die on the rock before reaching it
    }

    b.active = true;
    b.group.visible = true;
    b.s = s;
    b.x = x;
    b.y = yy;
    b.owner = owner;   // whose bananas these are — see retireBanana()
    return true;
  }

  /** Retire a banana (and forget its owner) so nothing lingers behind. */
  retireBanana(b) {
    b.active = false;
    b.group.visible = false;
    b.owner = null;
  }

  /** Retire any banana sitting inside a boulder's volume — nothing outruns a rock. */
  clearBananasUnder(o) {
    for (const b of this.bananas) {
      if (!b.active) continue;
      if (Math.abs(b.s - o.s) > o.radius + 0.5) continue;
      if (Math.abs(b.x - o.x) > o.radius + 0.6) continue;
      if (b.y >= o.height + 0.45) continue;
      this.retireBanana(b);
    }
  }

  /**
   * True when no boulder may sit at this spot: the runway in front of a slab (plus the
   * slab itself) has to stay clear, or the lane that wall leaves open is plugged.
   */
  inSlabZone(s) {
    for (const c of this.cliffs) {
      if (s > c.sStart - SLAB_APPROACH && s < c.sEnd + 6) return true;
    }
    return false;
  }

  spawnWave() {
    const spawnS = this.s + LOOKAHEAD_S;

    const laneIdx = [0, 1, 2];
    for (let i = laneIdx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [laneIdx[i], laneIdx[j]] = [laneIdx[j], laneIdx[i]];
    }
    const blockCount = Math.random() < clamp(0.15 + this.distance / 900, 0.15, 0.5) ? 2 : 1;

    // Only lanes that actually got a rock count as blocked, so the banana row below still
    // picks a genuinely free lane and the slab zones below stay dodgeable.
    const blocked = [];
    for (const lane of laneIdx.slice(0, blockCount)) {
      const oS = spawnS + rand(0, 3);
      if (this.inSlabZone(oS)) continue; // never park a rock in front of a cliff or wall
      const o = this.getFreeBoulder();
      const s = rand(0.85, 1.25);
      Object.assign(o, { active: true, radius: s * 0.95, height: s * 1.7 });
      o.mesh.visible = true;
      o.s = oS;
      o.x = LANES[lane] + rand(-0.25, 0.25);
      const sc = new THREE.Vector3(s * rand(0.9, 1.1), s * rand(0.8, 0.95), s);
      o.mesh.scale.copy(sc);
      o.quat.setFromEuler(new THREE.Euler(rand(0, 1), rand(0, Math.PI), rand(0, 1)));
      // A boulder may land on bananas an earlier wave already laid down.
      this.clearBananasUnder(o);
      blocked.push(lane);

      // Banana arc over the boulder — rewards jumping. Authored *from* the rock's
      // own height so a big boulder can never swallow its own reward line.
      if (Math.random() < 0.6) {
        const n = 7;
        const low = Math.max(0.9, o.height + 0.5);
        const high = low + 1.15;
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1)) * 2 - 1; // -1..1 across the arc
          this.placeBanana(this.getFreeBanana(), o.s + t * 4.2, o.x, low + (high - low) * (1 - t * t));
        }
      }
    }

    // straight banana row down a free lane
    if (Math.random() < 0.7) {
      const free = [0, 1, 2].filter((l) => !blocked.includes(l));
      const lane = free[Math.floor(Math.random() * free.length)];
      for (let i = 0; i < 6; i++) {
        this.placeBanana(this.getFreeBanana(), spawnS - i * 1.4, LANES[lane], 1.05);
      }
    }

    this.spawnGap = clamp(this.speed * 1.35, 20, 36);
  }

  // --- slabs: rideable cliffs and unjumpable walls --------------------------
  /**
   * One scheduler for both kinds of monolith. Spacing is by distance and tightens
   * with every lap; a slab's start is pushed past any already-scheduled slab it
   * would overlap, so a wall never grows inside a cliff (or vice versa) where the
   * player would have nowhere to go.
   */
  scheduleSlabs() {
    const pace = this.pace();
    if (this.path.maxGeneratedS >= this.nextCliffS - 80) this.scheduleSlab('cliff', pace);
    if (this.path.maxGeneratedS >= this.nextWallS - 80) this.scheduleSlab('wall', pace);
  }

  scheduleSlab(kind, pace) {
    // must be beyond generated samples so the flat-ground reservation applies
    const sStart = Math.max(this.path.maxGeneratedS + 70, this.s + LOOKAHEAD_S + 60);
    const len = kind === 'cliff' ? rand(30, 45) : rand(24, 38);

    let cover;
    if (kind === 'cliff') {
      // cliffs may be a forced jump (whole road) or dodgeable (1–2 lanes)
      if (Math.random() < 0.4) {
        cover = [0, 1, 2];
      } else {
        const count = Math.random() < 0.5 ? 1 : 2;
        const startLane = Math.floor(Math.random() * (4 - count)); // contiguous lanes
        cover = [];
        for (let i = 0; i < count; i++) cover.push(startLane + i);
      }
    } else {
      // A wall is never jumpable, so it may never block all three lanes: that would
      // be a death sentence rather than a forced lane change.
      const count = Math.random() < 0.6 ? 1 : 2;
      const startLane = Math.floor(Math.random() * (4 - count));
      cover = [];
      for (let i = 0; i < count; i++) cover.push(startLane + i);
    }

    const slab = this.makeSlab(sStart, len, cover, kind); // may have been pushed back
    const gap = kind === 'cliff' ? rand(180, 320) : rand(260, 470);
    if (kind === 'cliff') this.nextCliffS = slab.sStart + gap / pace;
    else this.nextWallS = slab.sStart + gap / pace;
  }

  /**
   * Push a slab's start at least `SLAB_CLEAR` metres past every scheduled slab. The old
   * rule only cleared 12 m, which let a cliff covering lanes 0–1 sit half a second (at top
   * speed) in front of a wall covering lane 2: two disjoint lane changes with no time for
   * either. 90 m is one lane change per obstacle, always.
   */
  slabStartAfter(sStart, len) {
    let s = sStart;
    let moved = true;
    while (moved) {
      moved = false;
      for (const c of this.cliffs) {
        if (s < c.sEnd + SLAB_CLEAR && s + len + SLAB_CLEAR > c.sStart) {
          s = Math.max(s, c.sEnd + SLAB_CLEAR);
          moved = true;
        }
      }
    }
    return s;
  }

  /**
   * Build one monolith. Cliffs (`CLIFF_H`, rideable, banana trail + lure) you jump
   * ONTO; walls (`WALL_H`, never rideable, no bananas at all) exist to force a lane
   * change. Both are painted from the theme's slab colour — their materials are
   * per-slab, so existing slabs keep the colour of the world they were born in.
   */
  makeSlab(sStartIn, len, coveredLanes, kind = 'cliff') {
    // Every slab — scheduled or test-spawned — clears the same gap, so slabs never
    // grow inside each other (a wall inside a cliff would read as one impossible
    // object, and its bananas would audit as buried).
    const sStart = this.slabStartAfter(sStartIn, len);
    // A wall you cannot dodge is not an obstacle but a coin flip, so the builder itself
    // refuses more than two lanes for anything unjumpable — even when asked (tests do).
    const rideable = kind !== 'wall';
    const chosen = rideable ? [...coveredLanes] : [...coveredLanes].slice(0, 2);
    const lanes = chosen.sort((a, b) => a - b);
    const lo = LANES[lanes[0]], hi = LANES[lanes[lanes.length - 1]];
    const margin = 1.45;
    const x = (lo + hi) / 2;
    const halfW = (hi - lo) / 2 + margin;

    // reserve a flat straight under/over the slab so it sits flush on the path
    this.path.addForcedStraight(sStart - 8, sStart + len + 8);

    const group = new THREE.Group();
    const H = rideable ? CLIFF_H : WALL_H;
    const depth = len;
    const boxH = H + 7; // sinks below the road so it reads as a giant monolith
    const mat = new THREE.MeshStandardMaterial({
      color: this.palette.slab, roughness: 1, flatShading: true,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, boxH, depth), mat);
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
    const slab = { group, mat, sStart, sEnd: sStart + len, x, halfW, H, rideable };
    this.cliffs.push(slab);

    // Cliffs get a banana trail along the top of every covered lane plus a lure at
    // the face. Walls get none at all: they are not rideable, so a trail on top
    // would be exactly the floating bait the reachability rules exist to kill.
    if (rideable) {
      const sEnd = slab.sEnd;
      for (const lane of lanes) {
        const bx = LANES[lane];
        if (Math.abs(bx - x) > halfW + 0.3) continue;
        this.placeBanana(this.getFreeBanana(), sStart - 2.4, bx, H + 0.55, slab); // jump here
        for (let bs = sStart + 3.5; bs < sEnd - 1.5; bs += 3) {
          this.placeBanana(this.getFreeBanana(), bs, bx, H + 1.05, slab); // ride the trail
        }
      }
    }
    return slab;
  }

  /**
   * Drop one slab, freeing its geometry/material **and retiring every banana that
   * belonged to it**. A cliff trail left behind by a removed slab would otherwise
   * hang in mid-air over bare road for the rest of the run — precisely the floating
   * bait this whole system exists to prevent.
   */
  removeSlab(c) {
    for (const b of this.bananas) if (b.active && b.owner === c) this.retireBanana(b);
    const i = this.cliffs.indexOf(c);
    if (i !== -1) this.cliffs.splice(i, 1);
    this.scene.remove(c.group);
    disposeGroup(c.group);
    c.mat?.dispose();
  }

  /** Slabs behind the player are gone for good — nothing accumulates in a long run. */
  pruneSlabs() {
    for (let i = this.cliffs.length - 1; i >= 0; i--) {
      const c = this.cliffs[i];
      if (c.sEnd < this.s - DESPAWN_BEHIND) this.removeSlab(c);
    }
  }

  /**
   * Height of the solid surface under (s, x): the road is 0, and every slab that
   * covers the spot contributes its top. Walls are included precisely because they
   * are taller than any jump — a monkey who cannot get above one can only crash.
   */
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
      // The distance ramp is capped, then the outfit's speed multiplier is applied:
      // faster means more score per metre and less time to read the trail.
      const target = Math.min(MAX_SPEED, BASE_SPEED + this.distance * SPEED_RAMP);
      this.speed = target * this.ability.speedMul;
      worldSpeed = this.speed;
      if (this.invulnerableT > 0) this.invulnerableT = Math.max(0, this.invulnerableT - dt);
    } else if (crashed) {
      this.crashTimer += dt;
      this.speed = Math.max(0, this.speed - 30 * dt); // skid to a stop
      worldSpeed = 0;
      if (this.crashTimer > 1.4) this.state = 'over';
    } else if (this.state === 'menu') {
      worldSpeed = 2.5; // menu: gentle auto-run past the scenery
    } else if (this.state === 'shop') {
      worldSpeed = 0;   // shop: fitting room, no travel
    } else {
      worldSpeed = 0;   // over: frozen at the crash site
    }

    const prevS = this.s;
    this.s += worldSpeed * dt;
    if (playing) {
      this.distance += worldSpeed * dt;
      // Themed levels: survive LEVEL_SECONDS on a theme and you beat it. The timer
      // never advances in menu/shop/crashed/over — parking on the menu is not a win.
      this.levelTimer += dt;
      if (this.levelTimer >= LEVEL_SECONDS) {
        this.levelTimer -= LEVEL_SECONDS; // keep the remainder across the change
        this.completeLevel();
      }
    }

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

      // jump physics vs. surface/cliff height. `pyStart` is his height at the top of
      // the frame: collisions are decided against it, because the landing snap below
      // would otherwise move him onto the slab before anything can notice the hit.
      const pyStart = this.py;
      const gh = this.groundHeightAt(this.s, this.x);
      if (!this.grounded) {
        // fallMul only scales gravity while falling: the jump still feels snappy on
        // the way up but hangs on the way down (umbrellas and wings do this).
        this.vy += GRAVITY * (this.vy < 0 ? this.ability.fallMul : 1) * dt;
        this.py += this.vy * dt;
        // Land only on a surface he was already above when the frame began. Without
        // that test a late jump slips through the cliff face and snaps onto its top.
        if (this.py <= gh && pyStart >= gh) {
          this.py = gh; this.vy = 0; this.grounded = true;
          this.airJumpsLeft = this.ability.extraJumps; // landing refills air jumps
        } else if (pyStart < gh - 0.35) {
          this.crash(); // entered a taller surface from below or sideways
        }
      } else {
        if (gh - this.py > 0.45) {
          this.crash(); // walked/lane-changed into the side of a cliff or wall
        } else if (Math.abs(gh - this.py) < 0.45) {
          this.py = gh; // stick to surface / step up onto a cliff edge
        } else {
          this.grounded = false; // ran off the end of a cliff → fall!
          this.vy = 0;
          this.airJumpsLeft = this.ability.extraJumps;
        }
      }

      // cliffs and walls appear ahead on the path
      this.scheduleSlabs();
      this.pruneSlabs();

      // spawn waves by distance travelled
      this.sinceSpawn += worldSpeed * dt;
      if (this.sinceSpawn >= this.spawnGap && this.s > this.noWavesUntil) {
        this.sinceSpawn = 0;
        this.spawnWave();
      }

      // slab face crash: crossed a slab's front edge while below its lip
      for (const c of this.cliffs) {
        if (prevS < c.sStart && this.s >= c.sStart &&
            Math.abs(this.x - c.x) <= c.halfW + 0.35 && pyStart < c.H - 0.35) {
          this.crash();
        }
      }

      // boulder collisions (track-local!). The padding is the only ability-scaled
      // part of obstacle geometry — slab edges stay exact, so the cliff-clip
      // regression keeps its meaning.
      const hb = this.ability.hitboxScale;
      for (const o of this.obstacles) {
        if (!o.active) continue;
        if (o.s < this.s - DESPAWN_BEHIND) { o.active = false; o.mesh.visible = false; continue; }
        const dx = Math.abs(o.x - this.x);
        const ds = Math.abs(o.s - this.s);
        if (dx < o.radius + 0.42 * hb && ds < o.radius + 0.35 * hb && this.py < o.height - 0.4) {
          this.crash();
        }
      }

      // banana collection (+ a dog-shaped magnet, and a chomp per pickup)
      const size = this.ability.sizeScale;
      const chestY = CHEST_Y * size;
      const grow = 0.45 * (size - 1);            // bigger monkey, wider grab box
      const dLim = COLLECT_DX + grow;
      const sLim = COLLECT_DS + grow;
      const magnet = this.ability.magnet;
      for (const b of this.bananas) {
        if (!b.active) continue;
        if (b.s < this.s - DESPAWN_BEHIND) { this.retireBanana(b); continue; }
        // The magnet only ever pulls bananas that are *ahead* and at most one lane
        // over: never backwards, never across the whole road.
        if (magnet > 0 && b.s - this.s > 0 && b.s - this.s <= magnet &&
            Math.abs(b.x - this.x) <= MAG_LATERAL) {
          b.x = lerp(b.x, this.x, clamp(dt * 5, 0, 1));
        }
        const dx = Math.abs(b.x - this.x);
        const ds = Math.abs(b.s - this.s);
        const dy = Math.abs(b.y - (this.py + chestY));
        if (dx < dLim && ds < sLim && dy < COLLECT_DY) {
          this.retireBanana(b);
          this.bananaCount++;
          soundKit.pickup(this.bananaCount); // a streak plays a rising run
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
    } else if (this.state === 'shop') {
      // fitting room: happy idle pose, turning slowly so the outfit shows from all sides
      this.shopT += dt;
      const t = this.shopT;
      k.armL.rotation.z = 0.55 + Math.sin(t * 2) * 0.12;
      k.armR.rotation.z = -0.55 - Math.sin(t * 2) * 0.12;
      k.armL.rotation.x = lerp(k.armL.rotation.x, -0.35, clamp(dt * 6, 0, 1));
      k.armR.rotation.x = lerp(k.armR.rotation.x, -0.35, clamp(dt * 6, 0, 1));
      k.legL.rotation.z = 0.14;
      k.legR.rotation.z = -0.14;
      k.head.rotation.y = Math.sin(t * 0.7) * 0.2;
      k.tail.rotation.y = Math.sin(t * 1.2) * 0.3;

      const bobFit = Math.abs(Math.sin(t * 1.6)) * 0.05;
      this._Rv.crossVectors(this._T, this._U).normalize();
      m.position.copy(this._P)
        .addScaledVector(this._Rv, this.x)
        .addScaledVector(this._U, this.py + bobFit);
      this._mat4.makeBasis(this._Rv, this._U, this._tmp.copy(this._T).negate());
      m.quaternion.setFromRotationMatrix(this._mat4);
      // oscillate instead of spinning: always roughly facing the fitting camera
      k.body.rotation.y = Math.sin(t * 0.35) * 0.5;
    } else if (this.state === 'over') {
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
    // roll bananas about their long axis: the crescent keeps facing the camera
    for (const b of this.bananas) if (b.active) b.mesh.rotation.x = (b.spin += dt * 2.4);
    this.syncWorldTransforms();

    // recycle scenery that fell behind
    for (const item of this.scenery) {
      if (item.s < this.s - 50 || item.s > this.s + GEN_AHEAD + 40) this.placeScenery(item);
    }

    if (this.state === 'shop') {
      // the follow-camera below runs for every other state and would overwrite
      // the fitting framing within the same frame
      this.updateShopCamera(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // camera: rides the path frame so banking/curves tilt the view, Sonic-style
    const camS = this.s - CAM_BEHIND;
    this.path.sampleTo(camS, this._P, this._T, this._U);
    this._Rv.crossVectors(this._T, this._U).normalize();
    this._tmp.copy(this._P)
      .addScaledVector(this._Rv, this.x * 0.4)
      .addScaledVector(this._U, CAM_HEIGHT);
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
    for (const [, parts] of this.costumeParts) {
      for (const p of parts) {
        p.object.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry?.dispose();
          o.material?.dispose(); // costume materials are never shared with the monkey
        });
      }
    }
    this.costumeParts.clear();
    this.renderer.dispose();
  }
}

function disposeGroup(group) {
  group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
}
