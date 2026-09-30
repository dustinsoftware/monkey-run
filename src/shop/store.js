import { COSTUMES } from '../game/costumes.js';

// ---------------------------------------------------------------------------
// Costume shop store — the single source of truth for banana bucks, unlocked
// outfits and which one is worn. Persisted to localStorage as one JSON blob.
// Every costume costs COSTUME_PRICE bananas, forever: nothing here may make a
// price depend on history. See docs/costume-shop.md.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'monkey-dash-shop';
export const COSTUME_PRICE = 100;

const IDS = new Set(COSTUMES.map((c) => c.id));
export const TOTAL_COSTUMES = IDS.size;

const DEFAULTS = () => ({ wallet: 0, owned: [], purchases: 0, worn: null, victory: false });

const intAtLeast0 = (v, fallback) =>
  Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;

/** Validate a raw parsed blob into a sane state object. */
function sanitize(raw) {
  const d = DEFAULTS();
  if (!raw || typeof raw !== 'object') return d;

  const owned = Array.isArray(raw.owned) ? [...new Set(raw.owned.filter((id) => IDS.has(id)))] : [];
  const worn = IDS.has(raw.worn) && owned.includes(raw.worn) ? raw.worn : null;

  return {
    wallet: intAtLeast0(raw.wallet, 0),
    owned,
    purchases: intAtLeast0(raw.purchases, 0),
    worn,
    // only a real `true` keeps the celebration pending across a reload
    victory: raw.victory === true && owned.length === TOTAL_COSTUMES,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS();
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULTS(); // corrupt or unavailable storage never breaks the game
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...state }));
  } catch {
    /* private mode / quota — the shop just won't survive a reload */
  }
}

let state = freeze(load());
const listeners = new Set();

// Snapshots handed to useSyncExternalStore must be stable references.
function freeze(next) {
  return Object.freeze({ ...next, owned: Object.freeze([...next.owned]), price: COSTUME_PRICE });
}

function commit(next) {
  state = freeze(next);
  persist();
  for (const fn of listeners) fn();
}

export const shopStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return state;
  },
  getState() {
    return state;
  },

  /** Bank the bananas from one finished run. */
  addBananas(n) {
    const amount = intAtLeast0(n, 0);
    if (amount === 0) return false;
    commit({ ...state, wallet: state.wallet + amount });
    return true;
  },

  /** Unlock forever for COSTUME_PRICE bananas. No-op unless real, unowned, affordable. */
  buy(id) {
    if (!IDS.has(id) || state.owned.includes(id) || state.wallet < COSTUME_PRICE) return false;
    const owned = [...state.owned, id];
    commit({
      wallet: state.wallet - COSTUME_PRICE,
      owned,
      purchases: state.purchases + 1,
      worn: id,
      // the purchase that completes the set queues the top-banana modal
      victory: owned.length === TOTAL_COSTUMES,
    });
    return true;
  },

  /** Free change of outfit — only for costumes already unlocked (or none). */
  wear(id) {
    if (id !== null && !IDS.has(id)) return false;
    if (id !== null && !state.owned.includes(id)) return false;
    if (state.worn === id) return false;
    commit({ ...state, worn: id });
    return true;
  },

  /** Clear the pending top-banana celebration once it has been shown. */
  dismissVictory() {
    if (!state.victory) return false;
    commit({ ...state, victory: false });
    return true;
  },

  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    commit(DEFAULTS());
  },
};

// Test hook: seed the wallet / inspect state without clicking through the UI.
if (typeof window !== 'undefined') {
  window.__MONKEY_SHOP = shopStore;
}
