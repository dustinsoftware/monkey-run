// ---------------------------------------------------------------------------
// Themed levels — pure data. A level is a palette plus a weighted scenery list;
// nothing here touches physics, and nothing else may decide what a world looks
// like. Survive LEVEL_SECONDS on one theme and you step into the next; a fresh
// run always opens on a random theme. See docs/levels.md.
//
// Shape of an entry:
//   sky    background/fog colour        fog      [near, far] metres
//   sun    { color, intensity }         hemi     { sky, ground, intensity }
//   floor  valley-floor (basePlane) colour
//   bands  road | curb | grass | deep ribbon colours (edge = darkened grass)
//   slab   cliff/wall body colour for new slabs
//   scenery [[kind, weight]] from: pine palm cactus rock tower lamp crystal
//                                     kelp cloud
//   props  optional prop colours { leaf, trunk, glow } so one builder serves
//          several worlds (a `tower` is a city block, a mall unit or a spire)
//   rainbow true  → road band cycles hue along the trail
//   sink   false → scenery sits on the surface line, not sunk into the bank
// ---------------------------------------------------------------------------

/** Seconds alive on one theme before that level is beaten. */
export const LEVEL_SECONDS = 60;

/** The menu and the fitting room always sit here: stable screenshots. */
export const MENU_LEVEL_ID = 'forest';

export const LEVELS = [
  {
    id: 'forest', label: 'Forest Trail', icon: '🌲',
    sky: 0x8ec9ea, fog: [45, 135],
    sun: { color: 0xfff2d4, intensity: 2.2 },
    hemi: { sky: 0xbfe3ff, ground: 0x7a6a3f, intensity: 1.1 },
    floor: 0x3a7d33,
    bands: { road: 0xc9b17e, curb: 0x8d94a0, grass: 0x5da24a, deep: 0x2f6b28 },
    slab: 0x6e6257,
    scenery: [['pine', 5], ['rock', 2]],
    props: { leaf: 0x2f7d32, trunk: 0x7a5230, glow: 0x000000 },
  },
  {
    id: 'plains', label: 'Green Plains', icon: '🌾',
    sky: 0xa8dcf5, fog: [60, 190],
    sun: { color: 0xfff8e2, intensity: 2.6 },
    hemi: { sky: 0xdff0ff, ground: 0x9a8c4a, intensity: 1.3 },
    floor: 0x74a83f,
    bands: { road: 0xd9c58e, curb: 0xa9a07c, grass: 0x7cc24a, deep: 0x4d8b2c },
    slab: 0x8b8168,
    scenery: [['pine', 2], ['rock', 3], ['cloud', 1]],
    props: { leaf: 0x59a83a, trunk: 0x7d5a33, glow: 0x000000 },
  },
  {
    id: 'neighborhood', label: 'Neighborhood', icon: '🏡',
    sky: 0xb6d9ef, fog: [45, 140],
    sun: { color: 0xfff3dd, intensity: 2.2 },
    hemi: { sky: 0xd8e8f5, ground: 0x8a7f6a, intensity: 1.15 },
    floor: 0x6f9b4c,
    bands: { road: 0xcdbba6, curb: 0x9d9aa2, grass: 0x6fa351, deep: 0x3f6b34 },
    slab: 0xb9a88f,
    scenery: [['pine', 3], ['lamp', 3]],
    props: { leaf: 0x3f7f3c, trunk: 0x6d4b2c, glow: 0xffd98a },
  },
  {
    id: 'city', label: 'Downtown City', icon: '🏙️',
    sky: 0x9fb3c6, fog: [40, 150],
    sun: { color: 0xf3eee2, intensity: 1.9 },
    hemi: { sky: 0xc7d6e4, ground: 0x5b5f66, intensity: 1.0 },
    floor: 0x4a4f57,
    bands: { road: 0x8f9299, curb: 0xbcbfc6, grass: 0x6d7a5c, deep: 0x3b4149 },
    slab: 0x7d838c,
    scenery: [['tower', 5], ['lamp', 2]],
    props: { leaf: 0x6d7a5c, trunk: 0x50555c, glow: 0xffe089 },
  },
  {
    id: 'mall', label: 'Shopping Mall', icon: '🛍️',
    sky: 0xe4ecf2, fog: [35, 120],
    sun: { color: 0xffffff, intensity: 2.0 },
    hemi: { sky: 0xf2f6fa, ground: 0xb9b3ad, intensity: 1.4 },
    floor: 0xa8a29c,
    bands: { road: 0xdcd4c6, curb: 0xf2efe7, grass: 0xcac2b6, deep: 0x9e978f },
    slab: 0xe0d8cb,
    scenery: [['tower', 4], ['lamp', 3]],
    props: { leaf: 0xbfa9a1, trunk: 0x8f8b86, glow: 0xfff2c4 },
  },
  {
    id: 'desert', label: 'Hot Desert', icon: '🌵',
    sky: 0xf3d7a4, fog: [50, 165],
    sun: { color: 0xffe9b8, intensity: 3.0 },
    hemi: { sky: 0xffeccc, ground: 0xc79a5c, intensity: 1.4 },
    floor: 0xd2ac6d,
    bands: { road: 0xe6c88e, curb: 0xcfae74, grass: 0xe0bd7f, deep: 0xb98f53 },
    slab: 0xc19a63,
    scenery: [['cactus', 4], ['rock', 3]],
    props: { leaf: 0x3f8b41, trunk: 0x2f6b32, glow: 0x000000 },
  },
  {
    id: 'pyramid', label: 'Lost Pyramid', icon: '🔺',
    sky: 0xe9c887, fog: [40, 130],
    sun: { color: 0xffe2a6, intensity: 2.7 },
    hemi: { sky: 0xf5dcae, ground: 0xa8834f, intensity: 1.1 },
    floor: 0xb98f4f,
    bands: { road: 0xd6bd8e, curb: 0xbfa270, grass: 0xcbb07c, deep: 0x9a7b45 },
    slab: 0xa8895a,
    scenery: [['cactus', 2], ['rock', 4]],
    props: { leaf: 0x4d8f46, trunk: 0x35662f, glow: 0x000000 },
  },
  {
    id: 'cave', label: 'Crystal Cave', icon: '💎',
    sky: 0x141a24, fog: [22, 70],
    sun: { color: 0xa9d8ff, intensity: 1.1 },
    hemi: { sky: 0x4f6c8f, ground: 0x1b1e26, intensity: 0.9 },
    floor: 0x1a1f27,
    bands: { road: 0x5d5f77, curb: 0x7b7f9a, grass: 0x3c4257, deep: 0x1e2231 },
    slab: 0x4a4f68,
    scenery: [['crystal', 4], ['rock', 3]],
    props: { leaf: 0x7fd8ff, trunk: 0x2b3550, glow: 0x9fe8ff },
  },
  {
    id: 'beach', label: 'Sunny Beach', icon: '🏖️',
    sky: 0x9fd8ff, fog: [55, 175],
    sun: { color: 0xfff6dd, intensity: 2.6 },
    hemi: { sky: 0xdff2ff, ground: 0xbfa87a, intensity: 1.2 },
    floor: 0xe6cf9a,
    bands: { road: 0xead8ac, curb: 0xd8c493, grass: 0xf0e0b6, deep: 0xd7c191 },
    slab: 0xbfa87a,
    scenery: [['palm', 5], ['rock', 2]],
    props: { leaf: 0x2f9d4f, trunk: 0x9c6b34, glow: 0x000000 },
  },
  {
    id: 'underwater', label: 'Coral Depths', icon: '🐠',
    sky: 0x0d5f6e, fog: [26, 88], sink: false,
    sun: { color: 0xbdf3ff, intensity: 1.5 },
    hemi: { sky: 0x4fd7d0, ground: 0x0b4a52, intensity: 1.2 },
    floor: 0x0a4c56,
    bands: { road: 0xd8c98f, curb: 0x8fbfae, grass: 0x2f9d8f, deep: 0x0e6b6a },
    slab: 0x1c7f7a,
    scenery: [['kelp', 5], ['rock', 3]],
    props: { leaf: 0x2fbf7a, trunk: 0x1c6f58, glow: 0xff9ad1 },
  },
  {
    id: 'lava', label: 'Lava Tubes', icon: '🌋',
    sky: 0x2a0f0b, fog: [30, 105],
    sun: { color: 0xff9c4a, intensity: 1.8 },
    hemi: { sky: 0xff7a3c, ground: 0x3a0d06, intensity: 1.1 },
    floor: 0xff5a1f,
    bands: { road: 0x3b2c2a, curb: 0x6e3a24, grass: 0x241a1a, deep: 0x140c0c },
    slab: 0x50372f,
    scenery: [['rock', 4], ['crystal', 2]],
    props: { leaf: 0xff6a1f, trunk: 0x2a1a14, glow: 0xff7a1f },
  },
  {
    id: 'moon', label: 'The Moon', icon: '🌕', sink: false,
    sky: 0x05060a, fog: [40, 120],
    sun: { color: 0xdfe8ff, intensity: 1.3 },
    hemi: { sky: 0x9fb0d0, ground: 0x14151a, intensity: 0.7 },
    floor: 0x2b2c31,
    bands: { road: 0xa6a6ad, curb: 0xd3d3da, grass: 0x6f7078, deep: 0x35363c },
    slab: 0x84858d,
    scenery: [['crystal', 3], ['rock', 4]],
    props: { leaf: 0xdfe9ff, trunk: 0x4a4b52, glow: 0xcfe6ff },
  },
  {
    id: 'rainbow', label: 'Rainbow Sky', icon: '🌈', rainbow: true,
    sky: 0xbfe8ff, fog: [70, 210],
    sun: { color: 0xffffff, intensity: 2.4 },
    hemi: { sky: 0xe6f6ff, ground: 0xf5c9e8, intensity: 1.5 },
    floor: 0xd8ecff,
    bands: { road: 0xffd3ea, curb: 0xffffff, grass: 0xaee4ff, deep: 0x7fbfe6 },
    slab: 0xf2c9a8,
    scenery: [['cloud', 5], ['crystal', 1]],
    props: { leaf: 0xffffff, trunk: 0xdfeaff, glow: 0xfff3b0 },
  },
  {
    id: 'sci-fi', label: 'Neo Circuit', icon: '🛸',
    sky: 0x07091a, fog: [35, 120],
    sun: { color: 0xbcd4ff, intensity: 1.6 },
    hemi: { sky: 0x4f6bd8, ground: 0x0a0c1c, intensity: 1.0 },
    floor: 0x0b0e22,
    bands: { road: 0x1d2340, curb: 0x39f2ff, grass: 0x14183a, deep: 0x070a1c },
    slab: 0x2a3160,
    scenery: [['tower', 4], ['lamp', 3]],
    props: { leaf: 0x39f2ff, trunk: 0x1b2246, glow: 0xff4fd8 },
  },
];

export const LEVEL_COUNT = LEVELS.length;

const ID_INDEX = new Map(LEVELS.map((l, i) => [l.id, i]));

/** Index of a theme by id; -1 when unknown. */
export function levelIndexFor(id) { return ID_INDEX.get(id) ?? -1; }

/** Theme at `index` (wraps into negative/large indices). */
export function levelAt(index) {
  const n = LEVELS.length;
  return LEVELS[((Math.trunc(index) % n) + n) % n];
}

/** Theme by id, falling back to the menu theme. */
export function themeFor(id) {
  const i = ID_INDEX.get(id);
  return i === undefined ? levelAt(0) : LEVELS[i];
}

/** The stable world the menu and the fitting room live in. */
export const MENU_LEVEL_INDEX = Math.max(0, levelIndexFor(MENU_LEVEL_ID));
