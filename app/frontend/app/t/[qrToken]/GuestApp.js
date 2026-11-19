'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import Sheet from '../../../components/Sheet.js';
import { api, ApiError } from '../../../lib/api.js';
import { addLine, priceCart, setQty } from '../../../lib/cart.js';
import { formatMoney } from '../../../lib/money.js';
import { load, save } from '../../../lib/storage.js';
import ItemSheet from '../../../components/ItemSheet.js';

const STATUS_LABEL = {
  placed: 'Sent to the kitchen',
  cooking: 'Being prepared',
  ready: 'Ready, on its way',
  served: 'Served',
  cancelled: 'Cancelled',
};

const isNewer = (current, incoming) => !current || new Date(incoming.updatedAt) >= new Date(current.updatedAt);
const describeLine = (l) =>
  [l.variantName, ...(l.modifiers ?? []).map((m) => m.option), l.notes && `"${l.notes}"`].filter(Boolean).join(' · ');

// Matches the dietary tags "veg" and "non-veg". Change these two strings if your seed uses other words.
function DietMark({ dietary }) {
  if (dietary?.includes('veg')) return <span className="diet veg" role="img" aria-label="Vegetarian" />;
  if (dietary?.includes('non-veg')) return <span className="diet nonveg" role="img" aria-label="Non-vegetarian" />;
  return null;
}

export default function GuestApp({ qrToken }) {
  const keys = useMemo(
    () => ({ cart: `sd_cart_${qrToken}`, mine: `sd_mine_${qrToken}`, pending: `sd_pending_${qrToken}` }),
    [qrToken]
  );

  const [data, setData] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [orders, setOrders] = useState(() => new Map());
  const [cart, setCart] = useState([]);
  const [mine, setMine] = useState([]); // ids of orders placed from this phone
  const [pending, setPending] = useState(null); // idempotency key of an order whose result we don't know
  const [restored, setRestored] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [cooldown, setCooldown] = useState({});

  // Restore the cart, my orders and any unfinished order after a refresh
  useEffect(() => {
    setCart(load(keys.cart, []));
    setMine(load(keys.mine, []));
    setPending(load(keys.pending, null));
    setRestored(true);
  }, [keys]);
  useEffect(() => { if (restored) save(keys.cart, cart); }, [restored, keys, cart]);
  useEffect(() => { if (restored) save(keys.mine, mine); }, [restored, keys, mine]);
  useEffect(() => { if (restored) save(keys.pending, pending); }, [restored, keys, pending]);

  const upsertOrder = useCallback(
    (o) =>
      setOrders((prev) => {
        if (!isNewer(prev.get(o.id), o)) return prev;
        const next = new Map(prev);
        next.set(o.id, o);
        return next;
      }),
    []
  );

  // Snapshot of the menu and this table's orders: on load, on every reconnect, and every 30s
  const refresh = useCallback(async () => {
    try {
      const [menu, list] = await Promise.all([api(`/t/${qrToken}`), api(`/t/${qrToken}/orders`)]);
      setData(menu);
      setLoadFailed(false);
      setOrders((prev) => {
        const next = new Map();
        for (const o of list) {
          const old = prev.get(o.id);
          next.set(o.id, isNewer(old, o) ? o : old);
        }
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setFatal('This QR code is not valid. Please ask a member of staff.');
      else setLoadFailed(true);
    }
  }, [qrToken]);

  // Live updates
  useEffect(() => {
    refresh();
    const url = process.env.NEXT_PUBLIC_SOCKET_URL; // only set locally
    const socket = io(url, { auth: { qrToken }, ...(url ? { transports: ['websocket'] } : {}) });
    let retry;
    // After a deploy the server ends connections on purpose, and Socket.IO only reconnects
    // by itself after network drops. Reconnect at a random moment so phones don't all arrive at once.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') retry = setTimeout(() => socket.connect(), 1000 + Math.random() * 2000);
    });
    // A manager changed the menu or settings: reload at a random moment in the next 2 seconds
    socket.on('config:changed', () => setTimeout(refresh, Math.random() * 2000));
    socket.on('connect', refresh); // catch up on anything missed while disconnected
    socket.on('order:update', upsertOrder);
    socket.on('menu:availability', ({ id, available }) =>
      setData((d) => d && { ...d, menu: d.menu.map((i) => (i.id === id ? { ...i, available } : i)) })
    );
    socket.on('restaurant:busy', ({ busyMode }) =>
      setData((d) => d && { ...d, restaurant: { ...d.restaurant, busyMode } })
    );
    socket.on('session:update', (s) => {
      if (s.status === 'open') return refresh();
      setData((d) => d && { ...d, sessionOpen: false });
      setOrders(new Map());
      setMine([]);
      setCart([]);
      setPending(null);
      setCartOpen(false);
      setNotice({ tone: 'ok', text: 'Thank you for dining with us! This table is now closed.' });
    });

    const poll = setInterval(refresh, 30_000); // safety net if a live event is ever missed
    return () => {
      clearInterval(poll);
      clearTimeout(retry);
      socket.disconnect();
    };
  }, [qrToken, refresh, upsertOrder]);

  const priced = useMemo(
    () => (data ? priceCart(cart, data.menu) : { lines: [], totalMinor: 0, allOk: true }),
    [cart, data]
  );
  const categories = useMemo(() => {
    const groups = new Map();
    for (const item of data?.menu ?? []) {
      const c = item.category || 'Menu';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(item);
    }
    return [...groups];
  }, [data]);
  const orderList = useMemo(
    () => [...orders.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    [orders]
  );

  if (fatal) {
    return (
      <main className="guest center">
        <p className="eyebrow">SmartDine</p>
        <p>{fatal}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="guest center">
        <p className="muted">{loadFailed ? "Can't reach the restaurant right now." : 'Loading the menu…'}</p>
        {loadFailed && <button className="btn" onClick={refresh}>Try again</button>}
      </main>
    );
  }

  const r = data.restaurant;
  const money = (minor) => formatMoney(minor, r.currency, r.locale);
  const itemCount = cart.reduce((n, l) => n + l.qty, 0);
  const blocker = !r.isOpen
    ? 'The restaurant is closed right now. You can still browse the menu.'
    : r.busyMode
      ? 'The kitchen is very busy right now. Please order with a member of staff.'
      : !data.sessionOpen
        ? "Your table isn't open yet. Ask a member of staff to open it, then you can order here."
        : null;

  async function placeOrder(expectedTotalMinor = priced.totalMinor, { fresh = false } = {}) {
    if (placing) return;
    // Reuse the key of an order whose result we never got, so a retry can't create a second one
    const key = !fresh && pending ? pending : crypto.randomUUID();
    setPending(key);
    setPlacing(true);
    setNotice(null);
    try {
      const order = await api(`/t/${qrToken}/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          items: cart.map(({ menuItemId, variantName, modifiers, qty, notes }) => ({
            menuItemId,
            variantName,
            modifiers,
            qty,
            notes: notes || undefined,
          })),
          expectedTotalMinor,
        },
      });
      setPending(null);
      setCart([]);
      setCartOpen(false);
      setPriceChange(null);
      setMine((m) => [...new Set([...m, order.id])]);
      upsertOrder(order);
      setNotice({ tone: 'ok', text: 'Your order is with the kitchen.' });
    } catch (err) {
      const outcomeUnknown = !(err instanceof ApiError) || (err.status >= 500 && err.code !== 'BUSY');
      if (outcomeUnknown) {
        setNotice({ tone: 'error', text: "Couldn't reach the restaurant. Your order is saved. Tap \"Retry sending order\"." });
        return; // keep the key
      }
      setPending(null); // the server clearly refused, so the next attempt is a new order
      if (err.code === 'PRICE_CHANGED') {
        setPriceChange(err.details.totalMinor);
        refresh();
      } else if (err.code === 'ITEM_UNAVAILABLE') {
        setNotice({ tone: 'error', text: 'Some items just sold out. Please remove them and try again.' });
        refresh();
      } else {
        setNotice({ tone: 'error', text: err.message });
      }
    } finally {
      setPlacing(false);
    }
  }

  async function callStaff(type) {
    try {
      await api(`/t/${qrToken}/requests`, { method: 'POST', body: { type } });
      setCooldown((c) => ({ ...c, [type]: true }));
      setTimeout(() => setCooldown((c) => ({ ...c, [type]: false })), 60_000);
      setNotice({ tone: 'ok', text: type === 'bill' ? 'Your bill is on its way.' : 'A member of staff is coming.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : "Couldn't reach the restaurant. Please try again." });
    }
  }

  async function cancel(id) {
    try {
      upsertOrder(await api(`/t/${qrToken}/orders/${id}/cancel`, { method: 'POST' }));
      setNotice({ tone: 'ok', text: 'Order cancelled.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : "Couldn't reach the restaurant. Please try again." });
    }
  }

  const canOrder = !blocker && cart.length > 0 && priced.allOk && !placing;

  return (
    <main className="guest">
      <header className="top">
        <p className="eyebrow">Table {data.table.number}</p>
        <h1>{r.name}</h1>
      </header>

      {blocker && <p className="banner warn">{blocker}</p>}
      {notice && (
        <p className={`banner ${notice.tone}`} role="status" onClick={() => setNotice(null)}>
          {notice.text}
        </p>
      )}

      {data.sessionOpen && (
        <div className="actions">
          <button className="btn" disabled={cooldown.help} onClick={() => callStaff('help')}>
            {cooldown.help ? 'Staff notified' : 'Call staff'}
          </button>
          <button className="btn" disabled={cooldown.bill} onClick={() => callStaff('bill')}>
            {cooldown.bill ? 'Bill requested' : 'Request bill'}
          </button>
        </div>
      )}

      {orderList.length > 0 && (
        <section>
          <h2>Your table's orders</h2>
          <ul className="list">
            {orderList.map((o) => (
              <li key={o.id} className="order">
                <div className="order-head">
                  <strong>{money(o.totalMinor)}</strong>
                  <span className={`status ${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                </div>
                <ul className="order-lines">
                  {o.items.map((i, n) => (
                    <li key={n}>
                      {i.qty}× {i.name}
                      {describeLine(i) && ` (${describeLine(i)})`}
                    </li>
                  ))}
                </ul>
                {o.status === 'placed' && mine.includes(o.id) && (
                  <button className="link" onClick={() => cancel(o.id)}>Cancel this order</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.map(([category, items]) => (
        <section key={category}>
          <h2>{category}</h2>
          <ul className="list">
            {items.map((item) => {
              const from = item.variants.length ? Math.min(...item.variants.map((v) => v.priceMinor)) : item.priceMinor;
              return (
                <li key={item.id}>
                  <button className="item" disabled={!item.available} onClick={() => setSheetItem(item)}>
                    <span className="item-main">
                      {item.photo && <img className="thumb" src={item.photo.small} alt="" loading="lazy" width={72} height={72} />}
                      <span>
                        <span className="item-name">
                          {r.showVegSymbols && <DietMark dietary={item.dietary} />}
                          {item.name}
                        </span>
                        {item.description && <span className="item-desc">{item.description}</span>}
                      </span>
                    </span>
                    <span className="price">
                      {item.available ? `${item.variants.length ? 'from ' : ''}${money(from)}` : <span className="tag">Sold out</span>}
                    </span>
                  </button>
               </li>
              );
            })}
          </ul>
        </section>
      ))}

      {itemCount > 0 && !cartOpen && (
        <button className="cart-bar" onClick={() => setCartOpen(true)}>
          <span>View order · {itemCount}</span>
          <span>{money(priced.totalMinor)}</span>
        </button>
      )}

      {cartOpen && (
        <Sheet
          title="Your order"
          onClose={() => setCartOpen(false)}
          footer={
            <>
              {blocker && <p className="muted">{blocker}</p>}
              <button className="btn primary block" disabled={!canOrder} onClick={() => placeOrder()}>
                {placing ? 'Sending…' : pending ? 'Retry sending order' : `Place order · ${money(priced.totalMinor)}`}
              </button>
            </>
          }
        >
          {priced.lines.length === 0 && <p className="muted">Your order is empty.</p>}
          {priced.lines.map((l) => (
            <div key={l.key} className="cart-line">
              <div>
                <strong>{l.name}</strong>
                {describeLine(l) && <div className="muted">{describeLine(l)}</div>}
                {!l.ok && <div className="tag">No longer available. Please remove it.</div>}
              </div>
              <div className="cart-right">
                <span className="price">{l.ok ? money(l.unitPriceMinor * l.qty) : ''}</span>
                <div className="qty">
                  <button onClick={() => setCart((c) => setQty(c, l.key, l.qty - 1))} aria-label="One less">−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => setCart((c) => setQty(c, l.key, l.qty + 1))} aria-label="One more" disabled={!l.ok}>+</button>
                </div>
              </div>
            </div>
          ))}
          <div className="total">
            <span>Total</span>
            <span>{money(priced.totalMinor)}</span>
          </div>
        </Sheet>
      )}

      {sheetItem && (
        <ItemSheet
          item={data.menu.find((i) => i.id === sheetItem.id) ?? sheetItem}
          money={money}
          onClose={() => setSheetItem(null)}
          onAdd={(line) => {
            setCart((c) => addLine(c, line));
            setSheetItem(null);
          }}
        />
      )}

      {priceChange !== null && (
        <Sheet
          title="Prices have changed"
          onClose={() => setPriceChange(null)}
          footer={
            <div className="sheet-actions">
              <button className="btn" onClick={() => { setPriceChange(null); setCartOpen(true); }}>Review order</button>
              <button className="btn primary" disabled={placing} onClick={() => placeOrder(priceChange, { fresh: true })}>
                Place for {money(priceChange)}
              </button>
            </div>
          }
        >
          <p>Some prices were updated while you were ordering. Your new total is <strong>{money(priceChange)}</strong>.</p>
        </Sheet>
      )}
    </main>
  );
}