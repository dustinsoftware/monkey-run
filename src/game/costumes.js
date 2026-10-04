import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Costume catalogue + primitive-built outfits for the procedural monkey.
//
// Rules (see docs/costume-shop.md):
//  - Never recolour a shared monkey material; build new meshes with their own
//    materials instead.
//  - Offsets/sizes are authored in PRE-SCALE monkey-local units — the monkey
//    group is scaled 0.85 and that applies uniformly to descendants. Landmarks:
//      torso centre y=1.05 (capsule r .32 len .38), head origin y=1.72 (skull r .34),
//      shoulder pivots (±.36, 1.35), hip pivots (±.17, .72); -Z is forward.
//  - Nothing is parented to a limb pivot except rigid sleeves that share the
//    limb's own local offset: limb rotations are rewritten every frame, so held
//    props would flail. The rainsuit umbrella therefore lives on `body`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Abilities — every outfit changes how the monkey plays, and it is all data.
// The engine reads these numbers and nothing else decides what a costume does;
// the shop prints them, and the tests import the same table. See
// docs/abilities.md.
// ---------------------------------------------------------------------------
export const ABILITY_DEFAULTS = {
  speedMul: 1,      // multiplies the distance-ramped target speed
  jumpMul: 1,       // multiplies JUMP_VELOCITY on a ground jump
  extraJumps: 0,    // air jumps available after leaving the ground (1 = double jump)
  fallMul: 1,       // scales |gravity| while falling (vy < 0) — floatiness
  magnet: 0,        // metres ahead within which bananas drift to your lane
  valueBonus: 0,    // extra score per banana collected
  hitboxScale: 1,   // scales the boulder collision padding
  sizeScale: 1,     // visual scale of the monkey + how high his chest reaches
  revives: 0,       // crashes forgiven per run
};

/** The bare monkey: every stat at its default. */
export const BARE_ABILITY = Object.freeze({
  id: null, label: 'Bare Monkey', text: 'No outfit, no special tricks.', ...ABILITY_DEFAULTS,
});

export const COSTUMES = [
  {
    id: 'tuxedo', label: 'Tuxedo', icon: '🎩',
    ability: {
      id: 'dapper-sprint', label: 'Dapper Sprint',
      text: 'You look great going faster: more score per metre, less time to read the trail.',
      speedMul: 1.15,
    },
  },
  {
    id: 'clown', label: 'Clown', icon: '🤡',
    ability: {
      id: 'bouncy-nose', label: 'Bouncy Nose',
      text: 'The red nose is a trampoline — one extra jump in mid-air.',
      extraJumps: 1,
    },
  },
  {
    id: 'doctor', label: 'Doctor', icon: '🩺',
    ability: {
      id: 'second-opinion', label: 'Second Opinion',
      text: 'One crash per run is called off and treated on the spot.',
      revives: 1,
    },
  },
  {
    id: 'tophat', label: 'Top Hat', icon: '🎩',
    ability: {
      id: 'old-top-banana', label: 'Old Top Banana',
      text: 'Bananas are worth 15, but a bigger monkey is a bigger target.',
      valueBonus: 5, hitboxScale: 1.25, sizeScale: 1.1,
    },
  },
  {
    id: 'dog', label: 'Dog Outfit', icon: '🐶',
    ability: {
      id: 'good-nose', label: 'Good Nose',
      text: 'Bananas one lane over get sniffed out and steered to you.',
      magnet: 6.5,
    },
  },
  {
    id: 'bunny', label: 'Bunny Outfit', icon: '🐰',
    ability: {
      id: 'bunny-hop', label: 'Bunny Hop',
      text: 'Hind legs: a higher single jump, no second one.',
      jumpMul: 1.14,
    },
  },
  {
    id: 'cat', label: 'Cat Outfit', icon: '🐱',
    ability: {
      id: 'lands-on-feet', label: 'Lands on Feet',
      text: 'Threads boulders that would clip the bare monkey.',
      hitboxScale: 0.78,
    },
  },
  {
    id: 'butterfly', label: 'Butterfly Wings', icon: '🦋',
    ability: {
      id: 'wing-flap', label: 'Wing Flap',
      text: 'A flap at the top of the arc, then a slow float down.',
      extraJumps: 1, fallMul: 0.82,
    },
  },
  {
    id: 'rainsuit', label: 'Yellow Rainsuit + Umbrella', icon: '☔',
    ability: {
      id: 'umbrella-drag', label: 'Umbrella Drag',
      text: 'The umbrella catches the air: long hang time, no second jump.',
      fallMul: 0.62, jumpMul: 1.05,
    },
  },
];

const ABILITY_BY_ID = new Map(COSTUMES.map((c) => [c.ability.id, c]));

/** The costume entry that owns an ability id (or undefined). */
export function costumeForAbility(abilityId) { return ABILITY_BY_ID.get(abilityId); }

// Only real, finite stats from the table above survive: a typo or a half-written
// entry resolves to its default instead of becoming NaN arithmetic in the loop.
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([k, v]) => k in ABILITY_DEFAULTS && Number.isFinite(v))
  );

/**
 * Resolve the stat block for a worn outfit. `null` / '' is the bare baseline.
 * Unknown ids resolve to the baseline too, so a stale localStorage value can
 * never hand the engine stats it has no field for.
 */
export function abilityFor(costumeId) {
  if (!costumeId) return { ...BARE_ABILITY };
  const c = COSTUMES.find((x) => x.id === costumeId);
  if (!c) return { ...BARE_ABILITY };
  // Defaults first, always: a costume only lists what differs from the baseline,
  // and a missing stat would become `undefined` arithmetic in the engine loop.
  return {
    ...ABILITY_DEFAULTS,
    id: c.ability.id,
    label: c.ability.label,
    text: c.ability.text,
    ...clean(c.ability),
  };
}

const mat = (hex, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: hex, roughness: 0.65, ...opts });

function add(group, geo, material, pos, rot) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  group.add(m);
  return m;
}

const CAP = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 12);
const SPH = (r) => new THREE.SphereGeometry(r, 16, 12);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 14);

// Limb sleeves sit on the limb pivots using the same local offset as the limb
// mesh itself, so they follow it exactly instead of being held in world space.
const LIMB_Y = -0.246; // -(len/2) - radius*0.4 for both arm and leg pivots

/** Accumulates per-host groups so a costume can be toggled with one flag each. */
class Outfit {
  constructor(hosts) {
    this.hosts = hosts;
    this.parts = [];
    this.groups = {};
  }
  at(hostName) {
    let g = this.groups[hostName];
    if (!g) {
      g = new THREE.Group();
      g.name = 'costume';
      this.groups[hostName] = g;
      this.parts.push({ host: hostName, object: g });
    }
    return g;
  }
}

// ---------------------------------------------------------------------------
const BUILDERS = {
  // Black jacket + shirt front + bow tie, matching sleeves and trousers.
  tuxedo(o) {
    const black = mat(0x16161c, { roughness: 0.45 });
    const navy = mat(0x1d2233, { roughness: 0.5 });
    const whiteShirt = mat(0xf8f6ef, { roughness: 0.5 });

    const body = o.at('body');
    add(body, CAP(0.37, 0.4), black, [0, 1.05, 0]); // jacket shell
    // Bib and bow tie sit outside the jacket shell (radius .37) or they vanish inside it.
    const bib = add(body, SPH(0.34), whiteShirt, [0, 1.02, -0.26]);
    bib.scale.set(0.5, 1.15, 0.5);
    add(body, BOX(0.08, 0.05, 0.05), black, [0, 1.47, -0.4]); // bow tie knot
    const bowL = add(body, BOX(0.09, 0.07, 0.035), black, [-0.09, 1.47, -0.38]);
    const bowR = add(body, BOX(0.09, 0.07, 0.035), black, [0.09, 1.47, -0.38]);
    bowL.rotation.z = 0.4; bowR.rotation.z = -0.4;

    for (const host of ['armL', 'armR']) {
      add(o.at(host), CAP(0.13, 0.4), black, [0, LIMB_Y, 0]);
    }
    for (const host of ['legL', 'legR']) {
      add(o.at(host), CAP(0.155, 0.38), navy, [0, LIMB_Y, 0]);
    }
  },

  // Onesie with dots, ruffle collar, red nose, baggy shoes, party hat.
  clown(o) {
    const onesie = mat(0xff5cae, { roughness: 0.55 });
    const dotA = mat(0x3fd4ff, { roughness: 0.5 });
    const dotB = mat(0xffe135, { roughness: 0.5 });
    const ruffle = mat(0xd63ce8, { roughness: 0.6 });
    const red = mat(0xe8271f, { roughness: 0.4 });
    const shoe = mat(0x3ecf4a, { roughness: 0.6 });

    const body = o.at('body');
    add(body, CAP(0.38, 0.4), onesie, [0, 1.05, 0]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      add(body, SPH(0.06), i % 2 ? dotA : dotB, [
        Math.sin(a) * 0.3, 1.0 + Math.cos(a) * 0.34, -0.28,
      ]);
    }
    add(body, new THREE.TorusGeometry(0.27, 0.09, 8, 16), ruffle, [0, 1.52, 0], [Math.PI / 2, 0, 0]);

    const head = o.at('head');
    add(head, SPH(0.085), red, [0, -0.13, -0.4]); // honk nose
    add(head, CYL(0.02, 0.19, 0.36), dotA, [0, 0.47, 0]); // party hat (base inside the skull)

    for (const host of ['legL', 'legR']) {
      add(o.at(host), BOX(0.17, 0.1, 0.42), shoe, [0, -0.56, -0.13]);
    }
  },

  // White coat, sleeves, stethoscope, armband, head mirror.
  doctor(o) {
    const coat = mat(0xf4f4f2, { roughness: 0.6 });
    const teal = mat(0x2fa9a1, { roughness: 0.55 });
    const steel = mat(0xb9c1c7, { roughness: 0.3, metalness: 0.5 });
    const red = mat(0xd8382f, { roughness: 0.5 });

    const body = o.at('body');
    add(body, CAP(0.38, 0.42), coat, [0, 1.05, 0]);
    // Stethoscope parts sit outside the coat shell (radius .38) or they vanish in it.
    add(body, new THREE.TorusGeometry(0.25, 0.045, 8, 16), teal, [0, 1.42, -0.02], [Math.PI / 2.6, 0, 0]);
    add(body, CYL(0.035, 0.035, 0.5), teal, [0, 1.18, -0.4], [0.3, 0, 0]); // tube to chest
    add(body, CYL(0.1, 0.1, 0.035), steel, [0, 0.96, -0.42], [Math.PI / 2, 0, 0]);

    for (const host of ['armL', 'armR']) {
      add(o.at(host), CAP(0.135, 0.4), coat, [0, LIMB_Y, 0]);
    }
    add(o.at('armL'), BOX(0.29, 0.07, 0.29), red, [0, -0.16, 0]); // armband
    add(o.at('armL'), BOX(0.05, 0.03, 0.14), coat, [0, -0.16, -0.15]); // cross bar

    const head = o.at('head');
    add(head, CYL(0.19, 0.19, 0.05), coat, [0, 0.22, -0.24], [0.75, 0, 0]); // head mirror
    add(head, SPH(0.045), red, [0, 0.3, -0.31]); // mirror centre dot
  },

  // Crown, brim and band — the dapper one.
  tophat(o) {
    const black = mat(0x14141a, { roughness: 0.4 });
    const band = mat(0xb0342f, { roughness: 0.5 });
    const head = o.at('head');
    add(head, CYL(0.26, 0.28, 0.36), black, [0, 0.51, 0]); // crown
    add(head, CYL(0.4, 0.4, 0.03), black, [0, 0.34, 0]); // brim (sits on the skull)
    add(head, CYL(0.285, 0.285, 0.09), band, [0, 0.39, 0]); // band
  },

  // Floppy ears, darker snout, red collar with a tag.
  dog(o) {
    const fur = mat(0x6b4327, { roughness: 0.85 });
    const ear = mat(0x59341c, { roughness: 0.85 });
    const collar = mat(0xc33a2c, { roughness: 0.6 });
    const gold = mat(0xe7b53c, { roughness: 0.35, metalness: 0.6 });

    const head = o.at('head');
    for (const s of [-1, 1]) {
      add(head, CAP(0.1, 0.24), ear, [s * 0.37, -0.14, 0.01], [0, 0, s * 0.15]); // floppy ears
    }
    const snout = add(head, SPH(0.145), fur, [0, -0.13, -0.29]);
    snout.scale.set(1.2, 0.85, 0.8);

    const body = o.at('body');
    add(body, new THREE.TorusGeometry(0.21, 0.045, 8, 16), collar, [0, 1.47, 0], [Math.PI / 2, 0, 0]);
    add(body, SPH(0.05), gold, [0, 1.39, -0.24]); // tag
  },

  // Long ears with pink insides, buck tooth, cotton tail.
  bunny(o) {
    const fur = mat(0xf3efe6, { roughness: 0.8 });
    const inner = mat(0xf1a7bd, { roughness: 0.75 });
    const tooth = mat(0xffffff, { roughness: 0.4 });

    const head = o.at('head');
    for (const s of [-1, 1]) {
      add(head, CAP(0.085, 0.36), fur, [s * 0.14, 0.54, 0], [0, 0, s * -0.12]);
      add(head, CAP(0.045, 0.28), inner, [s * 0.14, 0.54, -0.05], [0, 0, s * -0.12]);
    }
    add(head, BOX(0.09, 0.09, 0.04), tooth, [0, -0.22, -0.38]);

    const body = o.at('body');
    add(body, SPH(0.14), fur, [0, 0.95, 0.52]); // cotton tail (back is +Z)
  },

  // Cone ears, whiskers, collar with a bell.
  cat(o) {
    const fur = mat(0x3b3b46, { roughness: 0.8 });
    const inner = mat(0xf1a7bd, { roughness: 0.75 });
    const whisker = mat(0xf5f2ea, { roughness: 0.5 });
    const collar = mat(0x3fa94a, { roughness: 0.6 });
    const gold = mat(0xe7b53c, { roughness: 0.35, metalness: 0.6 });

    const head = o.at('head');
    for (const s of [-1, 1]) {
      add(head, new THREE.ConeGeometry(0.12, 0.22, 10), fur, [s * 0.19, 0.4, 0], [0, 0, s * 0.18]);
      add(head, new THREE.ConeGeometry(0.06, 0.14, 8), inner, [s * 0.19, 0.4, -0.03], [0, 0, s * 0.18]);
      for (let i = 0; i < 2; i++) {
        add(head, CYL(0.006, 0.006, 0.3), whisker, [s * 0.24, -0.1 + i * 0.07, -0.28], [0, 0, s * (0.9 + i * 0.25)]);
      }
    }

    const body = o.at('body');
    add(body, new THREE.TorusGeometry(0.21, 0.04, 8, 16), collar, [0, 1.47, 0], [Math.PI / 2, 0, 0]);
    add(body, SPH(0.055), gold, [0, 1.39, -0.24]); // bell
  },

  // Four translucent wing panels on the back plus antennae.
  butterfly(o) {
    const wing = (hex) => mat(hex, {
      roughness: 0.4, transparent: true, opacity: 0.88, side: THREE.DoubleSide,
    });
    const body = o.at('body');
    for (const s of [-1, 1]) {
      // Wings lie roughly flat in the XZ plane and sweep back from the shoulders.
      // Wings stay near-vertical (normal facing forward): a flat horizontal wing is
      // an invisible sliver at chest-height camera.
      add(body, new THREE.CircleGeometry(0.62, 14), wing(0xff9d2e), [s * 0.62, 1.32, 0.28], [0.25, s * -0.75, s * 0.35]);
      add(body, new THREE.CircleGeometry(0.44, 12), wing(0x9a5bff), [s * 0.46, 0.98, 0.34], [0.25, s * -0.55, s * -0.4]);
    }

    const head = o.at('head');
    const stalk = mat(0x2c2c36, { roughness: 0.6 });
    for (const s of [-1, 1]) {
      const ant = new THREE.Group(); // base sits on the skull, tip curls forward
      ant.position.set(s * 0.12, 0.24, -0.06);
      ant.rotation.set(-0.3, 0, s * 0.5);
      add(ant, CYL(0.009, 0.009, 0.3), stalk, [0, 0.15, 0]);
      add(ant, SPH(0.032), wing(0xffd335), [0, 0.31, 0]);
      head.add(ant);
    }
  },

  // Yellow coat + hood + boots, with a closed umbrella slung over the shoulder.
  rainsuit(o) {
    const yellow = mat(0xf7d21b, { roughness: 0.45 });
    const deepYellow = mat(0xe0b90f, { roughness: 0.5 });
    const canopy = mat(0x2f8fd6, { roughness: 0.5 });

    const body = o.at('body');
    add(body, CAP(0.4, 0.44), yellow, [0, 1.05, 0]); // raincoat shell

    for (const host of ['armL', 'armR']) {
      add(o.at(host), CAP(0.14, 0.38), yellow, [0, LIMB_Y, 0]);
    }
    for (const host of ['legL', 'legR']) {
      add(o.at(host), CAP(0.165, 0.34), deepYellow, [0, LIMB_Y - 0.08, 0]); // wellies
    }

    const head = o.at('head');
    // Hood sits high and back so the monkey keeps his face.
    const hood = add(head, new THREE.SphereGeometry(0.42, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), yellow, [0, 0.13, 0.07]);
    hood.scale.set(1, 0.95, 1.08);
    add(head, BOX(0.42, 0.04, 0.16), deepYellow, [0, 0.2, -0.33]); // brim

    // Umbrella is carried on the body (never on a limb pivot) so it cannot flail.
    const umb = new THREE.Group();
    // High enough over the shoulder to read from the front, not just from behind.
    umb.position.set(0.46, 1.28, 0.1);
    umb.rotation.set(-0.12, 0, 0.2);
    add(umb, CYL(0.022, 0.022, 1.3), canopy, [0, 0.6, 0]); // shaft + tip
    add(umb, new THREE.ConeGeometry(0.19, 0.55, 12), canopy, [0, 0.78, 0]); // gathered canopy hangs below the tip
    body.add(umb);
  },
};

/**
 * Build one costume against the monkey rig hosts.
 * @returns {{host: string, object: THREE.Group}[]} parts to parent + toggle
 */
export function buildCostume(id, hosts) {
  const builder = BUILDERS[id];
  if (!builder) return [];
  const outfit = new Outfit(hosts);
  builder(outfit);
  for (const part of outfit.parts) {
    part.object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  return outfit.parts;
}
