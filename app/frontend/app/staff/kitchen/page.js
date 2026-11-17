'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BusyToggle from '../../../components/BusyToggle.js';
import Sheet from '../../../components/Sheet.js';
import StaffShell from '../../../components/StaffShell.js';
import { ApiError } from '../../../lib/api.js';
import { KITCHEN, ageClass, applyUpdate, canCancel, mergeSnapshot, minutesSince, nextAction } from '../../../lib/kitchen.js';
import { chime, createAudio, errorText, useLiveSocket, useStaff, useStaffApi, useWakeLock } from '../../../lib/staff.js';

const COLUMNS = [
  { status: 'placed', title: 'New' },
  { status: 'cooking', title: 'Cooking' },
  { status: 'ready', title: 'Ready for pickup' },
];

const describe = (i) => [i.variantName, ...(i.modifiers ?? []).map((m) => m.option)].filter(Boolean).join(' · ');

export default function KitchenPage() {
  const [me] = useStaff(KITCHEN);
  const call = useStaffApi();
  const [orders, setOrders] = useState(() => new Map());
  const [menu, setMenu] = useState([]);
  const [busyMode, setBusyMode] = useState(false);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [notice, setNotice] = useState(null);
  const [kitchenMode, setKitchenMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef(null);
  const seen = useRef(new Set()); // order ids already on screen, so only brand-new orders chime

  useWakeLock(kitchenMode);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (me) setBusyMode(me.restaurant.busyMode);
  }, [me]);

  const applyOrder = useCallback((o) => setOrders((prev) => applyUpdate(prev, o)), []);

  const sync = useCallback(async () => {
    try {
      const [snapshot, items] = await Promise.all([call('/ops/kitchen/orders'), call('/ops/menu')]);
      snapshot.orders.forEach((o) => seen.current.add(o.id));
      setOrders((prev) => mergeSnapshot(prev, snapshot.orders, snapshot.serverTime));
      setMenu(items);
    } catch {
      // the next reconnect or poll tries again
    }
  }, [call]);

  const status = useLiveSocket({
    enabled: Boolean(me),
    onSync: sync,
    handlers: {
      'order:update': (o) => {
        if (!seen.current.has(o.id)) {
          seen.current.add(o.id);
          if (o.status === 'placed') chime(audio.current);
        }
        applyOrder(o);
      },
      'menu:availability': ({ id, available }) => setMenu((m) => m.map((i) => (i.id === id ? { ...i, available } : i))),
      'restaurant:busy': ({ busyMode: on }) => setBusyMode(on),
      'config:changed': () => setTimeout(sync, Math.random() * 2000),
    },
  });

  const newCount = useMemo(() => [...orders.values()].filter((o) => o.status === 'placed').length, [orders]);
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Kitchen · SmartDine` : 'Kitchen · SmartDine';
  }, [newCount]);

  async function changeStatus(order, to) {
    setPendingIds((s) => new Set(s).add(order.id));
    try {
      applyOrder(await call(`/ops/orders/${order.id}/status`, { method: 'PATCH', body: { status: to } }));
    } catch (err) {
      // Usually another tablet tapped first; the message says what the order is now
      setNotice(err instanceof ApiError && err.code === 'INVALID_TRANSITION' ? `Table ${order.tableNumber}: ${err.message}` : errorText(err));
      sync();
    } finally {
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(order.id);
        return next;
      });
      setConfirmCancel(null);
    }
  }

  function askCancel(order) {
    setConfirmCancel(order.id);
    setTimeout(() => setConfirmCancel((c) => (c === order.id ? null : c)), 4000);
  }

  async function toggleItem(item) {
    try {
      const res = await call(`/ops/menu-items/${item.id}/availability`, { method: 'PATCH', body: { available: !item.available } });
      setMenu((m) => m.map((i) => (i.id === res.id ? { ...i, available: res.available } : i)));
    } catch (err) {
      setNotice(errorText(err));
    }
  }

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const inColumn = (s) =>
    [...orders.values()].filter((o) => o.status === s).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const soldOut = menu.filter((i) => !i.available).length;

  return (
    <StaffShell
      me={me}
      title="Kitchen"
      status={status}
      actions={<BusyToggle me={me} busyMode={busyMode} onChange={setBusyMode} onError={setNotice} call={call} />}
    >
      <div className="toolbar">
        {kitchenMode ? (
          <span className="pill live">Sound on · screen kept awake</span>
        ) : (
          <button
            className="btn primary"
            onClick={() => {
              audio.current = createAudio();
              chime(audio.current); // confirms the sound works
              setKitchenMode(true);
            }}
          >
            Start kitchen mode (sound on, screen stays awake)
          </button>
        )}
        <button className="btn" onClick={() => setMenuOpen(true)}>
          Sold-out items{soldOut ? ` (${soldOut})` : ''}
        </button>
      </div>

      {busyMode && <p className="banner warn">Busy mode is on: guests can't order by QR. Staff can still take orders.</p>}
      {notice && (
        <p className="banner error" role="status" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      <div className="columns">
        {COLUMNS.map((col) => {
          const list = inColumn(col.status);
          return (
            <section key={col.status} className="column">
              <h2>
                {col.title} <span className="pill">{list.length}</span>
              </h2>
              {list.length === 0 && <p className="empty">Nothing here</p>}
              {list.map((o) => {
                const mins = minutesSince(o.createdAt, now);
                const action = nextAction(me.role, o.status);
                return (
                  <article key={o.id} className={`ticket ${ageClass(mins)}`}>
                    <div className="ticket-head">
                      <span className="ticket-table">Table {o.tableNumber}</span>
                      <span className="ticket-age">{mins} min</span>
                    </div>
                    {o.placedBy === 'staff' && <span className="pill">Taken by staff</span>}
                    <ul>
                      {o.items.map((i, n) => (
                        <li key={n}>
                          <strong>{i.qty}×</strong> {i.name}
                          {describe(i) && <span className="ticket-mods">{describe(i)}</span>}
                          {i.notes && <span className="ticket-note">Note: {i.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="ticket-actions">
                      {action && (
                        <button className="btn primary" disabled={pendingIds.has(o.id)} onClick={() => changeStatus(o, action.to)}>
                          {action.label}
                        </button>
                      )}
                      {canCancel(me.role, o.status) &&
                        (confirmCancel === o.id ? (
                          <button className="btn danger" disabled={pendingIds.has(o.id)} onClick={() => changeStatus(o, 'cancelled')}>
                            Tap again to cancel
                          </button>
                        ) : (
                          <button className="btn" onClick={() => askCancel(o)}>Cancel</button>
                        ))}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {menuOpen && (
        <Sheet title="Sold-out items" onClose={() => setMenuOpen(false)}>
          <p className="muted">Tap an item to mark it sold out or back in stock. Guests see the change immediately.</p>
          <div className="choices">
            {menu.map((i) => (
              <button key={i.id} className="choice" aria-pressed={!i.available} onClick={() => toggleItem(i)}>
                <span>{i.name}</span>
                <span>{i.available ? 'In stock' : 'Sold out'}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </StaffShell>
  );
}