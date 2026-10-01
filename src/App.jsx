import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { MonkeyGame } from './game/engine.js';
import { COSTUMES } from './game/costumes.js';
import CostumeShop from './shop/CostumeShop.jsx';
import VictoryModal from './shop/VictoryModal.jsx';
import { shopStore } from './shop/store.js';
import { dailyStore } from './daily/store.js';
import { useDaily, DailyMenuLine, DailyResult } from './daily/DailyChallenge.jsx';

const BEST_KEY = 'monkey-dash-best';

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState('menu'); // menu | playing | over | shop
  const [shopFrom, setShopFrom] = useState('menu'); // which overlay opened the shop
  const [hud, setHud] = useState({ score: 0, bananas: 0, distance: 0 });
  const [finalStats, setFinalStats] = useState(null);
  // Reward from the run that just ended — shown once on the game-over card.
  const [justPaid, setJustPaid] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY) || 0));
  const shop = useSyncExternalStore(shopStore.subscribe, shopStore.getSnapshot);

  useEffect(() => {
    const game = new MonkeyGame(canvasRef.current, {
      // The engine reports distance too, so the daily chip can count up live.
      onHud: (s) => setHud({ score: s.score, bananas: s.bananas, distance: s.distance }),
      onGameOver: (stats) => {
        // Banked exactly once per death: crash() fires this callback a single time.
        // Never bank from a render path or an effect keyed on phase/finalStats —
        // returning from the shop restores phase 'over' and would re-bank. The
        // daily challenge rides the same single-fire path: recordRun reports today's
        // best distance and pays its reward at most once, so it can never re-pay.
        const daily = dailyStore.recordRun(stats.distance);
        shopStore.addBananas(stats.bananas + daily.reward);
        setJustPaid(daily.reward);
        setFinalStats(stats);
        setPhase('over');
        setBest((b) => {
          const nb = Math.max(b, stats.score);
          localStorage.setItem(BEST_KEY, String(nb));
          return nb;
        });
      },
    });
    gameRef.current = game;
    window.__MONKEY_GAME = game; // debug/test hook
    game.setCostume(shopStore.getSnapshot().worn); // wear the saved outfit from boot
    return () => {
      delete window.__MONKEY_GAME;
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const dismissVictory = useCallback(() => shopStore.dismissVictory(), []);

  const startGame = useCallback(() => {
    setHud({ score: 0, bananas: 0, distance: 0 });
    setFinalStats(null);
    setJustPaid(0);
    setPhase('playing');
    gameRef.current?.start();
  }, []);

  const openShop = useCallback((from) => {
    if (!gameRef.current?.enterShop()) return; // never opens over a live run
    setShopFrom(from);
    setPhase('shop');
  }, []);

  const closeShop = useCallback(() => {
    const backTo = shopFrom;
    gameRef.current?.setCostume(shopStore.getSnapshot().worn); // drop unpaid preview
    gameRef.current?.exitShop({ toMenu: backTo === 'menu' });
    setPhase(backTo);
  }, [shopFrom]);

  // Buying or wearing applies the outfit immediately.
  useEffect(() => {
    const apply = () => gameRef.current?.setCostume(shopStore.getSnapshot().worn);
    return shopStore.subscribe(apply);
  }, []);

  // Enter starts / restarts from the overlays — but never while browsing costumes,
  // and never while the top-banana modal is waiting to be dismissed.
  useEffect(() => {
    const onKey = (e) => {
      if (shopStore.getState().victory && ['Enter', 'Space', 'Escape'].includes(e.code)) {
        e.preventDefault();
        shopStore.dismissVictory(); // swallows the key: no restart, no shop close
        return;
      }
      if (phase === 'shop') {
        if (e.code === 'Escape') closeShop();
        return;
      }
      if (phase !== 'playing' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startGame, closeShop]);

  const showHud = phase === 'playing' || phase === 'over';
  const daily = useDaily();
  // Today's best run, including the one in progress (the store only learns about
  // a run when it ends, but the chip should count up while you play).
  const liveDailyBest = Math.max(daily.best, hud.distance);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" />

      {/* HUD */}
      {showHud && (
        <div className="hud">
          <div className="hud-item hud-score">
            <span className="hud-label">SCORE</span>
            <span className="hud-value">{hud.score}</span>
          </div>
          <div className="hud-item hud-bananas">
            <span className="hud-label">BANANAS</span>
            <span className="hud-value">🍌 {hud.bananas}</span>
          </div>
          <div
            className={`hud-item hud-daily${daily.completed ? ' done' : ''}`}
            id="daily-chip"
          >
            <span className="hud-label">DAILY</span>
            <span className="hud-value">
              {daily.completed
                ? `✅ ${daily.target} m`
                : `${Math.min(liveDailyBest, daily.target)} / ${daily.target} m`}
            </span>
          </div>
        </div>
      )}

      {/* Start menu */}
      {phase === 'menu' && (
        <div className="overlay" id="menu-overlay">
          <div className="card">
            <h1 className="title">MONKEY DASH</h1>
            <p className="subtitle">
              Curvy track, giant cliffs. Dodge boulders — or jump ONTO the cliffs and ride the banana trail!
            </p>
            <div className="controls">
              <div className="control"><kbd>←</kbd><kbd>A</kbd><span>left lane</span></div>
              <div className="control"><kbd>→</kbd><kbd>D</kbd><span>right lane</span></div>
              <div className="control"><kbd>Space</kbd><kbd>↑</kbd><span>jump boulders</span></div>
            </div>
            <div className="menu-buttons">
              <button id="start-btn" className="btn" onClick={startGame} autoFocus>
                START RUNNING
              </button>
              <button id="menu-shop-btn" className="btn btn-alt" onClick={() => openShop('menu')}>
                🛍️ COSTUME SHOP
              </button>
            </div>
            {best > 0 && <p className="best">Best score: {best}</p>}
            <p className="wallet">
              🍌 {shop.wallet} banana bucks · {shop.owned.length}/{COSTUMES.length} costumes unlocked
            </p>
            <DailyMenuLine />
          </div>
        </div>
      )}

      {/* Game over */}
      {phase === 'over' && finalStats && (
        <div className="overlay" id="gameover-overlay">
          <div className="card card-over">
            <h1 className="title title-over">💥 OUCH!</h1>
            <p className="subtitle">You tripped over a boulder.</p>
            <div className="stats">
              <div><span className="stat-label">Score</span><span id="final-score" className="stat-value">{finalStats.score}</span></div>
              <div><span className="stat-label">Bananas</span><span className="stat-value">🍌 {finalStats.bananas}</span></div>
              <div><span className="stat-label">Best</span><span className="stat-value">{best}</span></div>
            </div>
            <p className="banked">🍌 +{finalStats.bananas} banked · wallet {shop.wallet}</p>
            <DailyResult justPaid={justPaid} />
            <div className="menu-buttons">
              <button id="go-shop-btn" className="btn btn-alt" onClick={() => openShop('over')}>
                🛍️ COSTUME SHOP
              </button>
              <button id="restart-btn" className="btn" onClick={startGame} autoFocus>
                RUN AGAIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Costume shop */}
      {phase === 'shop' && (
        <CostumeShop
          onBack={closeShop}
          onTryOn={(id) => gameRef.current?.setCostume(id)}
        />
      )}

      {/* Top banana — shown once the whole wardrobe is owned, until dismissed */}
      {shop.victory && <VictoryModal onDismiss={dismissVictory} />}
    </>
  );
}
