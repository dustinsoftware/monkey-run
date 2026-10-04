import { useState, useSyncExternalStore } from 'react';
import { COSTUMES } from '../game/costumes.js';
import { shopStore } from './store.js';

/**
 * Costume shop: left-hand panel so the fitting camera can frame the monkey
 * beside it. Try-on is a free preview; buying unlocks forever for the flat
 * COSTUME_PRICE — prices never move, see docs/costume-shop.md.
 */
export default function CostumeShop({ onBack, onTryOn }) {
  const shop = useSyncExternalStore(shopStore.subscribe, shopStore.getSnapshot);
  const [preview, setPreview] = useState(null);

  const tryOn = (id) => {
    setPreview(id);
    onTryOn(id);
  };

  return (
    <div className="overlay overlay-shop" id="shop-overlay">
      <div className="card card-shop">
        <div className="shop-head">
          <h1 className="title title-shop">🛍️ COSTUME SHOP</h1>
          <div className="shop-balances">
            <div className="shop-balance">
              <span className="stat-label">Banana bucks</span>
              <span id="shop-wallet" className="stat-value">🍌 {shop.wallet}</span>
            </div>
            <div className="shop-balance">
              <span className="stat-label">Each costume</span>
              <span id="shop-price" className="stat-value">{shop.price}</span>
            </div>
          </div>
          {/* Deliberately not a .costume-card: the grid holds nine, never more. */}
          <button
            type="button"
            id="shop-bare-btn"
            className="btn btn-tiny bare-btn"
            disabled={!shop.worn}
            onClick={() => shopStore.wear(null)}
          >
            BARE MONKEY
          </button>
        </div>

        <div className="costume-grid">
          {COSTUMES.map((c) => {
            const owned = shop.owned.includes(c.id);
            const worn = shop.worn === c.id;
            const affordable = shop.wallet >= shop.price;
            return (
              <div
                key={c.id}
                className={`costume-card${owned ? ' owned' : ''}`}
                data-costume={c.id}
              >
                <span className="costume-icon" aria-hidden="true">{c.icon}</span>
                <span className="costume-name">{c.label}</span>
                <span className="costume-ability">{c.ability.label.toUpperCase()}</span>
                <p className="costume-text">{c.ability.text}</p>
                {owned && <span className="owned-badge">OWNED</span>}
                {worn && <span className="worn-badge">WORN</span>}
                {!owned && <span className="costume-price">🍌 {shop.price}</span>}

                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn-tiny try-btn"
                    onClick={() => tryOn(c.id)}
                  >
                    {preview === c.id ? 'TRYING' : 'TRY ON'}
                  </button>

                  {owned ? (
                    <button
                      type="button"
                      className="btn btn-tiny wear-btn"
                      disabled={worn}
                      onClick={() => shopStore.wear(c.id)}
                    >
                      {worn ? 'WORN' : 'WEAR'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-tiny buy-btn"
                      disabled={!affordable}
                      onClick={() => shopStore.buy(c.id)}
                    >
                      BUY &amp; WEAR
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="shop-foot">
          <p className="hint">Trying on is free — nothing changes until you buy.</p>
          <button id="shop-back-btn" className="btn" onClick={onBack}>BACK TO THE TRAIL</button>
        </div>
      </div>
    </div>
  );
}
