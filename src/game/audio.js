// ---------------------------------------------------------------------------
// SoundKit — every sound in the game is synthesised with WebAudio, so there are
// no audio files to download and none to fail to load. One module-level
// singleton is shared by the engine (pickup / level clear / revive) and the
// React shell (the mute button). See docs/architecture.md → "Sound".
//
// Browsers refuse to start an AudioContext outside a user gesture, so nothing
// here constructs one until `unlock()` is called from a pointer/key handler.
// Every method is safe to call before that: notes are simply dropped when no
// context exists yet (or when WebAudio is missing entirely).
// ---------------------------------------------------------------------------

export const SOUND_STORAGE_KEY = 'monkey-dash-sound';

// Eight-step rising run built from a minor-pentatonic ladder (six pitch classes
// per octave, then the same degrees an octave up). Consecutive bananas therefore
// play a rising run instead of the same blip N times.
const PICKUP_LADDER = [0, 3, 5, 7, 10, 12, 15, 19];

// Level-clear arpeggio: root, third, fifth, octave.
const CLEAR_ARPEGGIO = [0, 4, 7, 12];

// Revive chime: low then high — a "second opinion".
const REVIVE_NOTES = [-7, 5];

const A4 = 440;
const hz = (semitonesFromA4) => A4 * Math.pow(2, semitonesFromA4 / 12);

function loadMuted() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === '1';
  } catch {
    return false; // private mode / no storage → sound on
  }
}

function saveMuted(muted) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* the mute flag just won't survive a reload */
  }
}

class SoundKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = loadMuted();
    /** Notes actually scheduled — the deterministic thing tests assert on. */
    this.played = 0;
    const Ctor = typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis.webkitAudioContext || null);
    this.Ctor = Ctor || null;
  }

  /** WebAudio exists in this browser at all. */
  get available() { return this.Ctor !== null; }

  /** Create/resume the context. Call from a user gesture; safe to repeat. */
  unlock() {
    if (this.muted || !this.available) return false;
    try {
      if (!this.ctx) {
        this.ctx = new this.Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.28; // keep the whole kit polite
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch {
      return false; // a context that refuses to exist never breaks the game
    }
  }

  /** True when a note may be scheduled right now. */
  get canPlay() { return !this.muted && this.available && this.ctx !== null; }

  // --- notes ---------------------------------------------------------------

  /** One oscillator blip: `type` freq, exponential decay, optional glide. */
  _tone({ freq, type = 'triangle', at = 0, dur = 0.16, gain = 1, to = null }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.02, 0.9 * gain), t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.played++;
  }

  /** The banana chomp: pitched up the ladder by `index`, so streaks rise. */
  pickup(index = 0) {
    if (!this.canPlay) return;
    const step = PICKUP_LADDER[Math.abs(Math.trunc(index)) % PICKUP_LADDER.length] - 5;
    const base = hz(step);
    this._tone({ freq: base, type: 'triangle', dur: 0.13, gain: 0.85 });
    // the "pop" on top of it — a sine that drops fast
    this._tone({ freq: base * 2, type: 'sine', at: 0.045, dur: 0.09, gain: 0.5, to: base });
  }

  /** Four-note arpeggio when a themed level is beaten. */
  levelClear() {
    if (!this.canPlay) return;
    CLEAR_ARPEGGIO.forEach((semi, i) => {
      this._tone({
        freq: hz(semi + 3), type: 'triangle', at: i * 0.11, dur: 0.26, gain: 0.8,
      });
    });
  }

  /** Two-note "second opinion" chime on a doctor revive. */
  revive() {
    if (!this.canPlay) return;
    REVIVE_NOTES.forEach((semi, i) => {
      this._tone({ freq: hz(semi), type: 'sawtooth', at: i * 0.16, dur: 0.3, gain: 0.5 });
    });
  }

  // --- mute ----------------------------------------------------------------

  setMuted(next) {
    this.muted = !!next;
    saveMuted(this.muted);
    if (this.muted && this.ctx) {
      // stop whatever is mid-flight so muting reads as instant
      try { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01); } catch { /* ignore */ }
    } else if (!this.muted) {
      this.unlock();
      if (this.master && this.ctx) {
        try { this.master.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.02); } catch { /* ignore */ }
      }
    }
    return this.muted;
  }
}

export const soundKit = new SoundKit();

// Test/debug hook: inspect the kit without playing anything.
if (typeof window !== 'undefined') {
  window.__MONKEY_SOUND = {
    kit: soundKit,
    get played() { return soundKit.played; },
    get muted() { return soundKit.muted; },
    get available() { return soundKit.available; },
    ctxState: () => (soundKit.ctx ? soundKit.ctx.state : 'none'),
  };
}
