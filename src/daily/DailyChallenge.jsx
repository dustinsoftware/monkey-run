import { useSyncExternalStore } from 'react';
import { dailyStore } from './store.js';

// ---------------------------------------------------------------------------
// Daily challenge copy. One goal per day — travel N metres in a single run —
// shown on the menu card and as the game-over result block. No overlay, no
// phase: it never blocks play. See docs/daily-challenge.md.
// ---------------------------------------------------------------------------

const subscribe = (fn) => dailyStore.subscribe(fn);
const getSnapshot = () => dailyStore.getState();

/** Shared store subscription for App (HUD chip) and these components. */
export function useDaily() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** `📅 Daily: travel 450 m today · best 320 m` (+ streak when there is one). */
function dailyText(s, { withReward = false } = {}) {
  const done = `📅 Daily done: ${s.target} m${withReward ? ` · +${s.reward} 🍌` : ''}`;
  const line = s.completed
    ? done
    : `📅 Daily: travel ${s.target} m today · best ${s.best} m`;
  return s.streak > 1 ? `${line} · 🔥 ${s.streak}-day streak` : line;
}

export function DailyMenuLine() {
  const s = useDaily();
  return (
    <p id="menu-daily" className={`daily-line${s.completed ? ' done' : ''}`}>
      {dailyText(s, { withReward: true })}
    </p>
  );
}

/**
 * Game-over result block. `justPaid` is the reward from the run that just ended,
 * so "+N 🍌 banked!" appears exactly once — on the death that paid, and never
 * doubled into the goal line above it.
 */
export function DailyResult({ justPaid = 0 }) {
  const s = useDaily();
  return (
    <div id="over-daily" className={`daily-result${s.completed ? ' done' : ''}`}>
      <span className="daily-goal">{dailyText(s)}</span>
      {justPaid > 0 && (
        <span id="daily-reward" className="daily-reward">+{justPaid} 🍌 banked!</span>
      )}
    </div>
  );
}
