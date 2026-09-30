import { COSTUMES } from '../game/costumes.js';

// ---------------------------------------------------------------------------
// Top banana — the message the game leaves on screen once every costume is
// owned. Rendered by App whenever the store's `victory` flag is pending, so it
// appears exactly once per completion (and keeps appearing until dismissed).
// See docs/costume-shop.md.
// ---------------------------------------------------------------------------

export const VICTORY_MESSAGE =
  "You beat the game! You're the top banana! Thanks for playing our game. -The Masters";

export default function VictoryModal({ onDismiss }) {
  return (
    <div className="overlay overlay-victory" id="victory-overlay">
      <div className="card card-victory">
        <h1 className="title title-victory">🏆 TOP BANANA!</h1>
        <p id="victory-message" className="victory-message">{VICTORY_MESSAGE}</p>
        <div className="victory-costumes" aria-hidden="true">
          {COSTUMES.map((c) => (
            <span key={c.id} className="victory-icon">{c.icon}</span>
          ))}
        </div>
        <button id="victory-ok-btn" className="btn" type="button" onClick={onDismiss} autoFocus>
          THANKS! 🍌
        </button>
      </div>
    </div>
  );
}
