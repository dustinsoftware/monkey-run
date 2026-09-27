import { useEffect, useRef, useState, useCallback } from 'react';
import { MonkeyGame } from './game/engine.js';

const BEST_KEY = 'monkey-dash-best';

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState('menu'); // menu | playing | over
  const [hud, setHud] = useState({ score: 0, bananas: 0 });
  const [finalStats, setFinalStats] = useState(null);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY) || 0));

  useEffect(() => {
    const game = new MonkeyGame(canvasRef.current, {
      onHud: (s) => setHud({ score: s.score, bananas: s.bananas }),
      onGameOver: (stats) => {
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
    return () => {
      delete window.__MONKEY_GAME;
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const startGame = useCallback(() => {
    setHud({ score: 0, bananas: 0 });
    setFinalStats(null);
    setPhase('playing');
    gameRef.current?.start();
  }, []);

  // Enter starts / restarts from the overlays
  useEffect(() => {
    const onKey = (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && phase !== 'playing') {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startGame]);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" />

      {/* HUD */}
      {phase !== 'menu' && (
        <div className="hud">
          <div className="hud-item hud-score">
            <span className="hud-label">SCORE</span>
            <span className="hud-value">{hud.score}</span>
          </div>
          <div className="hud-item hud-bananas">
            <span className="hud-label">BANANAS</span>
            <span className="hud-value">🍌 {hud.bananas}</span>
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
            <button id="start-btn" className="btn" onClick={startGame} autoFocus>
              START RUNNING
            </button>
            {best > 0 && <p className="best">Best score: {best}</p>}
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
            <button id="restart-btn" className="btn" onClick={startGame} autoFocus>
              RUN AGAIN
            </button>
          </div>
        </div>
      )}
    </>
  );
}
