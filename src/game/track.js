import * as THREE from 'three';

// ---------------------------------------------------------------------------
// TrackPath — procedurally generated, Sonic-2-style race path.
// The path is a piecewise curve: straights, left/right curves (with banking)
// and up/down hills (grades). Samples are integrated every STEP meters of arc
// length and stored in arrays; old samples behind the player get pruned.
// Everything else in the game places objects in track-local coordinates:
//   s = distance along the path, x = lateral offset, y = height above surface.
// ---------------------------------------------------------------------------

export const STEP = 1; // meters between path samples

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TrackPath {
  constructor() {
    this.posArr = []; // Vector3 surface positions
    this.tanArr = []; // unit tangents
    this.upArr = [];  // surface up-vectors (pitched by grade, rolled by banking)
    this.baseIndex = 0; // absolute index of posArr[0]

    this.pos = new THREE.Vector3(); // current integration cursor
    this.sCursor = 0;               // arc length of last generated sample
    this.theta = Math.PI;           // heading angle (π ⇒ running toward -Z)
    this.kappa = 0;                 // curvature of the active segment (rad/m)
    this.grade = 0;                 // slope of the active segment (dy per horizontal m)
    this.lenLeft = 140;             // first segment: long straight flat runway

    this.forced = [];       // forced straight+flat zones reserved for cliff builds
    this.lastCurveSign = 0; // to encourage S-curves instead of endless circles

    this.addSample(); // sample #0 at the origin
  }

  get maxGeneratedS() { return this.sCursor; }

  // Reserve a straight, flat stretch so cliffs (boxes) can sit on it.
  addForcedStraight(startS, endS) {
    this.forced.push({ startS, endS });
    this.forced.sort((a, b) => a.startS - b.startS);
  }

  ensure(sMax) {
    while (this.sCursor + STEP <= sMax) this.extend();
  }

  // --- internal ------------------------------------------------------------

  extend() {
    if (this.lenLeft < STEP) this.pickSegment();
    const g = this.grade;
    const ch = 1 / Math.hypot(1, g); // horizontal shrink per arc meter
    this.theta += this.kappa * STEP;
    this.pos.x += Math.sin(this.theta) * STEP * ch;
    this.pos.y += g * STEP * ch;
    this.pos.z += Math.cos(this.theta) * STEP * ch;
    this.sCursor += STEP;
    this.lenLeft -= STEP;
    this.addSample();
  }

  pickSegment() {
    // A cliff needs a flat straight: honor reserved zones before random rolls.
    const f = this.forced[0];
    if (f && f.startS <= this.sCursor + STEP * 1.5) {
      this.forced.shift();
      this.kappa = 0;
      this.grade = 0;
      this.lenLeft = Math.max(6, f.endS - this.sCursor);
      return;
    }

    const r = Math.random();
    if (r < 0.34) {
      // straight
      this.kappa = 0;
      this.grade = 0;
      this.lenLeft = rand(28, 65);
    } else if (r < 0.67) {
      // curve: turn through 25°..60° with radius ~20-55 m
      let sign = Math.random() < 0.5 ? -1 : 1;
      if (sign === this.lastCurveSign && Math.random() < 0.6) sign = -sign; // S-curves!
      this.lastCurveSign = sign;
      const k = rand(0.02, 0.05);
      this.kappa = sign * k;
      this.grade = 0;
      this.lenLeft = rand(0.45, 1.05) / k;
    } else if (r < 0.9) {
      // bank up / bank down hill
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.grade = dir * rand(0.14, 0.26);
      this.kappa = Math.random() < 0.3 ? rand(-0.012, 0.012) : 0;
      this.lenLeft = rand(22, 50);
    } else {
      // sweeping curve + hill combo
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.kappa = sign * rand(0.014, 0.03);
      this.grade = (Math.random() < 0.5 ? 1 : -1) * rand(0.1, 0.2);
      this.lenLeft = rand(25, 45);
    }

    // Never let a random segment run into a reserved cliff zone: end early so
    // the next pick consumes the forced straight.
    const f2 = this.forced[0];
    if (f2 && this.sCursor + this.lenLeft > f2.startS) {
      this.lenLeft = Math.max(STEP, f2.startS - this.sCursor);
    }
  }

  addSample() {
    const g = this.grade;
    const T = new THREE.Vector3(Math.sin(this.theta), g, Math.cos(this.theta)).normalize();
    // horizontal right of heading
    const r = new THREE.Vector3(-Math.cos(this.theta), 0, Math.sin(this.theta));
    // surface normal: perpendicular to tangent, in the vertical plane containing r
    const N = new THREE.Vector3().crossVectors(r, T).normalize();
    // bank into curves: roll the up vector around the tangent
    const psi = clamp(this.kappa * 10, -0.3, 0.3) * -1;
    if (psi !== 0) N.applyAxisAngle(T, psi);

    this.posArr.push(this.pos.clone());
    this.tanArr.push(T);
    this.upArr.push(N);
  }

  // Interpolated sample at arc length s. All args are THREE.Vector3 outputs.
  // Generates path data on demand — callers may sample ahead of the last
  // ensure() call (chunk rows extend past it), and clamping instead would
  // bake collapsed geometry into cached chunks → holes in the ground.
  sampleTo(s, p, t, u) {
    this.ensure(Math.max(s, 0) + STEP);
    let idx = s / STEP - this.baseIndex;
    const maxI = this.posArr.length - 2;
    if (idx < 0) idx = 0;
    if (idx > maxI) idx = maxI;
    const i = Math.floor(idx);
    const f = idx - i;
    p.lerpVectors(this.posArr[i], this.posArr[i + 1], f);
    t.copy(this.tanArr[i]).lerp(this.tanArr[i + 1], f).normalize();
    u.copy(this.upArr[i]).lerp(this.upArr[i + 1], f).normalize();
  }

  // Drop samples far behind the player to keep memory flat.
  prune(minS) {
    let drop = Math.floor((minS - this.baseIndex * STEP) / STEP);
    if (drop <= 300) return;
    drop = Math.min(drop, this.posArr.length - 64);
    if (drop <= 0) return;
    this.posArr.splice(0, drop);
    this.tanArr.splice(0, drop);
    this.upArr.splice(0, drop);
    this.baseIndex += drop;
  }
}
