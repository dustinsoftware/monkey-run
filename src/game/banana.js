import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The collectible banana — one shared geometry for the whole pool.
//
// It is a *banana*, not a macaroni ring: a lathe swept from a tapered radius
// profile (pinched tips, fat middle), sheared along its length into a crescent,
// then laid down so the long axis runs track-right with the curve in the
// camera-facing plane. Colour is baked into vertices: yellow body, brown tips.
// ---------------------------------------------------------------------------

const SEG_T = 16; // profile samples along the length
const SEG_R = 10; // radial segments around the length axis
const LEN = 0.92; // metres, tip to tip
const AMP = 0.17; // crescent sag at the middle
const RAD = 0.098; // widest radius

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Radius of the cross-section at length fraction t (0…1). */
function radiusAt(t) {
  const bulge = Math.pow(Math.sin(Math.PI * t), 0.42); // pinched at both tips
  const asym = 1 + 0.3 * (0.5 - t); // fatter toward the stem end
  return Math.max(0.014, RAD * bulge * asym);
}

/** How "brown tip" a length fraction is (0 = pure banana). */
function tipWeight(t) {
  const edge = Math.min(t, 1 - t);
  return clamp((0.1 - edge) / 0.055, 0, 1);
}

/**
 * @returns {THREE.BufferGeometry} vertex-coloured banana, long axis along +X
 */
export function makeBananaGeometry() {
  const profile = [];
  for (let i = 0; i <= SEG_T; i++) {
    const t = i / SEG_T;
    profile.push(new THREE.Vector2(radiusAt(t), (t - 0.5) * LEN));
  }

  const geo = new THREE.LatheGeometry(profile, SEG_R);

  // Bend: cross-sections stay circular but their centres follow the crescent.
  // LatheGeometry is indexed, so recomputing normals stays smooth (and correct).
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / LEN + 0.5;
    // + so the middle dips below its tips: a smile, not a frown (see rotateZ below)
    pos.setX(i, pos.getX(i) + AMP * Math.sin(Math.PI * t));
  }
  geo.computeVertexNormals();

  // Vertex colours are NOT colour-managed for us — work in linear space.
  const yellow = new THREE.Color(0xf3c72c).convertSRGBToLinear();
  const brown = new THREE.Color(0x5d3410).convertSRGBToLinear();
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / LEN + 0.5;
    c.copy(yellow).lerp(brown, tipWeight(t));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Length axis along X (track-right) and the crescent in the XY plane, which is
  // the screen plane for a banana riding the path frame.
  geo.rotateZ(-Math.PI / 2);
  return geo;
}
