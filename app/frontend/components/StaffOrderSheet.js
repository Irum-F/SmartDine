'use client';

import { useMemo, useRef, useState } from 'react';
import ItemSheet from './ItemSheet.js';
import Sheet from './Sheet.js';
import { ApiError } from '../lib/api.js';
import { addLine, priceCart, setQty } from '../lib/cart.js';
import { formatMoney } from '../lib/money.js';

export default function StaffOrderSheet({ session, tableNumber, menu, restaurant, call, onClose, onPlaced }) {
  const [cart, setCart] = useState([]);
  const [item, setItem] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const keyRef = useRef(null); // same idempotency rule as the guest app

  const money = (minor) => formatMoney(minor, restaurant.currency, restaurant.locale);
  const priced = useMemo(() => priceCart(cart, menu), [cart, menu]);
  const categories = useMemo(() => {
    const groups = new Map();
    for (const i of menu) {
      const c = i.category || 'Menu';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(i);
    }
    return [...groups];
  }, [menu]);

  async function place(expectedTotalMinor = priced.totalMinor, fresh = false) {
    if (!keyRef.current || fresh) keyRef.current = crypto.randomUUID();
    setPlacing(true);
    setError(null);
    try {
      const order = await call(`/ops/sessions/${session.id}/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keyRef.current },
        body: {
          items: cart.map(({ menuItemId, variantName, modifiers, qty, notes }) => ({
            menuItemId, variantName, modifiers, qty, notes: notes || undefined,
          })),
          expectedTotalMinor,
        },
      });
      keyRef.current = null;
      onPlaced(order);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) {
        setError("Connection problem. Tap Place order again. It won't be sent twice.");
        return; // keep the key
      }
      keyRef.current = null;
      if (err.code === 'PRICE_CHANGED') setPriceChange(err.details.totalMinor);
      else setError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <>
      <Sheet
        title={`Order for table ${tableNumber}`}
        onClose={onClose}
        footer={
          <>
            {error && <p className="banner error">{error}</p>}
            {priceChange !== null ? (
              <div className="confirm">
                <span>Prices changed. The new total is {money(priceChange)}.</span>
                <button className="btn primary" disabled={placing} onClick={() => place(priceChange, true)}>
                  Place for {money(priceChange)}
                </button>
              </div>
            ) : (
              <button className="btn primary block" disabled={!cart.length || !priced.allOk || placing} onClick={() => place()}>
                {placing ? 'Sending…' : `Place order · ${money(priced.totalMinor)}`}
              </button>
            )}
          </>
        }
      >
        {priced.lines.map((l) => (
          <div key={l.key} className="cart-line">
            <div>
              <strong>{l.name}</strong>
              <div className="muted">{[l.variantName, ...l.modifiers.map((m) => m.option), l.notes].filter(Boolean).join(' · ')}</div>
              {!l.ok && <div className="tag">No longer available. Please remove it.</div>}
            </div>
            <div className="qty">
              <button onClick={() => setCart((c) => setQty(c, l.key, l.qty - 1))} aria-label="One less">−</button>
              <span>{l.qty}</span>
              <button onClick={() => setCart((c) => setQty(c, l.key, l.qty + 1))} aria-label="One more" disabled={!l.ok}>+</button>
            </div>
          </div>
        ))}

        {categories.map(([category, items]) => (
          <div key={category}>
            <h2>{category}</h2>
            <div className="choices">
              {items.map((i) => (
                <button key={i.id} className="choice" disabled={!i.available} onClick={() => setItem(i)}>
                  <span>{i.name}</span>
                  <span>{i.available ? money(i.variants.length ? Math.min(...i.variants.map((v) => v.priceMinor)) : i.priceMinor) : 'Sold out'}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Sheet>

      {item && (
        <ItemSheet
          item={menu.find((m) => m.id === item.id) ?? item}
          money={money}
          onClose={() => setItem(null)}
          onAdd={(line) => {
            setCart((c) => addLine(c, line));
            setPriceChange(null);
            setItem(null);
          }}
        />
      )}
    </>
  );
}