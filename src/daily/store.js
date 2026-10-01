// ---------------------------------------------------------------------------
// Daily challenge store — one shared goal per calendar day: travel N metres in
// a single run. The target is derived from the local date (never stored), so
// nobody can mint their own easier goal, and `completed`/`paid` are computed on
// read for the same reason. Reward goes to the shop wallet exactly once a day.
// See docs/daily-challenge.md.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'monkey-dash-daily';

/** Difficulty ladder in metres — one rung is picked per day by hashing the key. */
export const DAILY_TARGETS = [180, 240, 300, 360, 450, 600];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const intAtLeast0 = (v, fallback) =>
  Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
const pad = (n) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD` for a Date (defaults to now). */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar-safe shift on the date parts — never drifts over a DST boundary. */
export function addDays(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/** FNV-1a over the day key → one rung of the ladder. Pure: same answer anywhere. */
export function targetFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return DAILY_TARGETS[Math.abs(h) % DAILY_TARGETS.length];
}

/** Banana bucks for completing the day: harder days pay more. */
export function rewardFor(target) {
  return Math.max(1, Math.round(target / 10));
}

const DEFAULTS = () => ({ best: 0, paidOn: null, streak: 0, lastCompletedDay: null });

/** Streak history is the only thing that outlives its day. */
const historyOf = (raw) => {
  if (!raw || typeof raw !== 'object') return { streak: 0, lastCompletedDay: null };
  return {
    streak: intAtLeast0(raw.streak, 0),
    lastCompletedDay: DAY_RE.test(raw.lastCompletedDay ?? '') ? raw.lastCompletedDay : null,
  };
};

/** Validate a raw parsed blob into sane fields belonging to `day`. */
function sanitize(raw, day) {
  if (!raw || typeof raw !== 'object') return DEFAULTS();
  const best = intAtLeast0(raw.best, 0);
  // Only a payout today's own numbers support counts — nothing else can be smuggled in.
  const paidOn = raw.paidOn === day && best >= targetFor(day) ? day : null;
  return { ...historyOf(raw), best, paidOn };
}

function load(day) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS();
    const parsed = JSON.parse(raw);
    // A blob from another day rolls over: fresh best/payout, streak history stays.
    if (parsed?.day !== day) return { ...DEFAULTS(), ...historyOf(parsed) };
    return sanitize(parsed, day);
  } catch {
    return DEFAULTS(); // corrupt or unavailable storage never breaks the game
  }
}

// Test-only overrides (never persisted): pretend today is another day so targets
// are deterministic, and/or ask for a specific target so completion is reachable
// in seconds of play. The target override belongs to one concrete day only.
let overrideDay = null;
let targetOverride = { day: null, target: null };

const todayKey = () => overrideDay ?? dayKey();
const targetForDay = (day) =>
  targetOverride.day === day && targetOverride.target !== null
    ? targetOverride.target
    : targetFor(day);

/** Derived view of the stored fields for a given day. */
function snapshot(day, fields) {
  const target = targetForDay(day);
  return Object.freeze({
    ...fields,
    day,
    target,
    reward: rewardFor(target),
    completed: fields.best >= target,
    paid: fields.paidOn === day,
  });
}

let state = { day: todayKey(), fields: load(todayKey()) };
state.snapshot = snapshot(state.day, state.fields);
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, day: state.day, ...state.fields }));
  } catch {
    /* private mode / quota — the daily just won't survive a reload */
  }
}

function commit(day, fields) {
  state = { day, fields, snapshot: snapshot(day, fields) };
  persist();
  for (const fn of listeners) fn();
}

/** Roll to today if the calendar moved on. Returns true when it did. */
function rollToToday() {
  const today = todayKey();
  if (today === state.day) return false;
  commit(today, load(today));
  return true;
}

const sameSnapshot = (a, b) =>
  a && Object.keys(a).every((k) => a[k] === b?.[k]);

/** Re-derive the snapshot after an override changed today's target. */
function refresh() {
  rollToToday();
  if (!sameSnapshot(snapshot(state.day, state.fields), state.snapshot)) commit(state.day, state.fields);
  return state.snapshot;
}

export const dailyStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Rolls the day lazily, then hands back a stable frozen snapshot. */
  getSnapshot() {
    rollToToday();
    return state.snapshot;
  },
  getState() {
    return this.getSnapshot();
  },

  /**
   * Record one finished run (metres travelled). Raises today's best and pays the
   * daily reward on the transition to completed-and-unpaid — never twice a day.
   */
  recordRun(distance) {
    rollToToday();
    const day = state.day;
    const target = targetForDay(day);
    const fields = { ...state.fields };
    let changed = false;

    const run = intAtLeast0(distance, 0);
    if (run > fields.best) {
      fields.best = run;
      changed = true;
    }

    let reward = 0;
    if (fields.best >= target && fields.paidOn !== day) {
      // Continue yesterday's run of completions, otherwise start a fresh one.
      const streak = fields.lastCompletedDay === addDays(day, -1) ? fields.streak + 1 : 1;
      Object.assign(fields, { paidOn: day, streak, lastCompletedDay: day });
      reward = rewardFor(target);
    }

    if (reward > 0 || changed) commit(day, fields); // one atomic write per mutation
    return { best: fields.best, reward, completedNow: reward > 0 };
  },

  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    overrideDay = null;
    targetOverride = { day: null, target: null };
    commit(todayKey(), DEFAULTS());
  },

  // --- test hooks -----------------------------------------------------------
  /** Pretend "today" is `key` (state rolls accordingly); null follows the clock. */
  setDay(key) {
    overrideDay = key ?? null;
    if (overrideDay === null) targetOverride = { day: null, target: null };
    return refresh();
  },
  /** Override *today's* target. Test-only: never persisted, unreachable from gameplay. */
  setTarget(metres) {
    const day = todayKey();
    targetOverride = { day, target: metres === null ? null : intAtLeast0(metres, 0) };
    return refresh(); // the target moved even though the day did not
  },
};

// Test hook: seed/inspect the daily without clicking through the UI.
if (typeof window !== 'undefined') {
  window.__MONKEY_DAILY = dailyStore;
}
