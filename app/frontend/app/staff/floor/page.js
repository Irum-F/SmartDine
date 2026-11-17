'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BusyToggle from '../../../components/BusyToggle.js';
import Sheet from '../../../components/Sheet.js';
import StaffOrderSheet from '../../../components/StaffOrderSheet.js';
import StaffShell from '../../../components/StaffShell.js';
import { ApiError } from '../../../lib/api.js';
import { FLOOR, STATUS_LABEL, applyUpdate, mergeSnapshot, minutesSince, requestDone } from '../../../lib/kitchen.js';
import { formatMoney } from '../../../lib/money.js';
import { chime, createAudio, errorText, useLiveSocket, useStaff, useStaffApi } from '../../../lib/staff.js';

const describe = (i) => [i.variantName, ...(i.modifiers ?? []).map((m) => m.option)].filter(Boolean).join(' · ');

export default function FloorPage() {
  const [me] = useStaff(FLOOR);
  const call = useStaffApi();
  const [tables, setTables] = useState([]);
  const [requests, setRequests] = useState(() => new Map());
  const [orders, setOrders] = useState(() => new Map());
  const [menu, setMenu] = useState([]);
  const [busyMode, setBusyMode] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [details, setDetails] = useState(null);
  const [ordering, setOrdering] = useState(false);
  const [confirmClose, setConfirmClose] = useState(null);
  const [notice, setNotice] = useState(null);
  const [alertsOn, setAlertsOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef(null);
  const seenRequests = useRef(new Set());
  const tablesRef = useRef([]);
  const selectedRef = useRef(null);
  selectedRef.current = selectedNumber;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (me) setBusyMode(me.restaurant.busyMode);
  }, [me]);

  const loadDetails = useCallback(
    async (number = selectedRef.current) => {
      const table = tablesRef.current.find((t) => t.number === number);
      if (!table?.session) return setDetails(null);
      try {
        setDetails(await call(`/ops/sessions/${table.session.id}/orders`));
      } catch {
        // retried on the next update
      }
    },
    [call]
  );

  const sync = useCallback(async () => {
    try {
      const [tableList, reqs, active, items] = await Promise.all([
        call('/ops/tables'),
        call('/ops/requests'),
        call('/ops/kitchen/orders'),
        call('/ops/menu'),
      ]);
      tablesRef.current = tableList;
      setTables(tableList);
      reqs.requests.forEach((r) => seenRequests.current.add(r.id));
      setRequests((prev) => mergeSnapshot(prev, reqs.requests, reqs.serverTime, requestDone));
      setOrders((prev) => mergeSnapshot(prev, active.orders, active.serverTime));
      setMenu(items);
      if (selectedRef.current !== null) loadDetails();
    } catch {
      // the next reconnect or poll tries again
    }
  }, [call, loadDetails]);

  const status = useLiveSocket({
    enabled: Boolean(me),
    onSync: sync,
    handlers: {
      'order:update': (o) => {
        setOrders((prev) => applyUpdate(prev, o));
        if (o.tableNumber === selectedRef.current) loadDetails();
      },
      'request:update': (r) => {
        if (r.status === 'open' && !seenRequests.current.has(r.id)) {
          seenRequests.current.add(r.id);
          chime(audio.current);
        }
        setRequests((prev) => applyUpdate(prev, r, requestDone));
      },
      'session:update': (s) => {
        if (s.status === 'closed' && s.tableNumber === selectedRef.current) {
          setSelectedNumber(null);
          setNotice(`Table ${s.tableNumber} was closed${s.reason === 'idle' ? ' automatically after being idle' : ' by another member of staff'}.`);
        }
        sync();
      },
      'menu:availability': ({ id, available }) => setMenu((m) => m.map((i) => (i.id === id ? { ...i, available } : i))),
      'restaurant:busy': ({ busyMode: on }) => setBusyMode(on),
      'config:changed': () => setTimeout(sync, Math.random() * 2000),
    },
  });

  // Load the table's orders whenever a different table is opened in the sheet
  useEffect(() => {
    setConfirmClose(null);
    if (selectedNumber === null) setDetails(null);
    else loadDetails(selectedNumber);
  }, [selectedNumber, loadDetails]);

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const money = (minor) => formatMoney(minor, me.restaurant.currency, me.restaurant.locale);
  const selected = tables.find((t) => t.number === selectedNumber) ?? null;
  const requestList = [...requests.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const orderList = [...orders.values()];

  async function openTable(table) {
    try {
      await call(`/ops/tables/${table.id}/open`, { method: 'POST' });
      await sync();
    } catch (err) {
      setNotice(errorText(err));
      sync();
    }
  }

  async function closeTable(force = false) {
    if (!selected?.session) return;
    try {
      await call(`/ops/sessions/${selected.session.id}/close`, { method: 'POST', body: { force } });
      setSelectedNumber(null);
      sync();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HAS_UNFINISHED_ORDERS') setConfirmClose(err.details.unfinished);
      else setNotice(errorText(err));
    }
  }

  async function resolve(request) {
    try {
      const res = await call(`/ops/requests/${request.id}/resolve`, { method: 'POST' });
      setRequests((prev) => applyUpdate(prev, { ...request, status: res.status, updatedAt: new Date().toISOString() }, requestDone));
    } catch (err) {
      setNotice(errorText(err));
      sync();
    }
  }

  async function serve(order) {
    try {
      const updated = await call(`/ops/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'served' } });
      setOrders((prev) => applyUpdate(prev, updated));
      loadDetails();
    } catch (err) {
      setNotice(errorText(err));
      sync();
    }
  }

  const requestRow = (r, withTable = true) => (
    <div key={r.id} className="request">
      <span>
        {withTable && `Table ${r.tableNumber}: `}
        {r.type === 'bill' ? 'wants the bill' : 'needs help'} · {minutesSince(r.createdAt, now)} min
      </span>
      <button className="btn small" onClick={() => resolve(r)}>Done</button>
    </div>
  );

  return (
    <StaffShell
      me={me}
      title="Floor"
      status={status}
      actions={<BusyToggle me={me} busyMode={busyMode} onChange={setBusyMode} onError={setNotice} call={call} />}
    >
      <div className="toolbar">
        {alertsOn ? (
          <span className="pill live">Sound alerts on</span>
        ) : (
          <button
            className="btn primary"
            onClick={() => {
              audio.current = createAudio();
              chime(audio.current);
              setAlertsOn(true);
            }}
          >
            Turn on sound alerts
          </button>
        )}
      </div>

      {busyMode && <p className="banner warn">Busy mode is on: guests can't order by QR. Take their orders with "Take order".</p>}
      {notice && (
        <p className="banner warn" role="status" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      {requestList.length > 0 && <section className="requests" aria-label="Guest requests">{requestList.map((r) => requestRow(r))}</section>}

      <div className="tables">
        {tables.map((t) => {
          const tableOrders = orderList.filter((o) => o.tableNumber === t.number);
          const ready = tableOrders.filter((o) => o.status === 'ready').length;
          const asks = requestList.filter((r) => r.tableNumber === t.number).length;
          return (
            <button
              key={t.id}
              className={`table-card ${t.session ? 'open' : ''} ${ready || asks ? 'attention' : ''}`}
              onClick={() => setSelectedNumber(t.number)}
            >
              <span className="table-num">Table {t.number}</span>
              <span className="muted">{t.session ? `Open · ${minutesSince(t.session.openedAt, now)} min` : 'Free'}</span>
              <span className="badges">
                {tableOrders.length > 0 && <span className="pill">{tableOrders.length} in progress</span>}
                {ready > 0 && <span className="pill live">{ready} ready to serve</span>}
                {asks > 0 && <span className="pill warn">{asks === 1 ? '1 request' : `${asks} requests`}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <Sheet
          title={`Table ${selected.number}`}
          onClose={() => setSelectedNumber(null)}
          footer={
            selected.session ? (
              <div className="sheet-actions">
                <button className="btn primary" onClick={() => setOrdering(true)}>Take order</button>
                <button className="btn danger" onClick={() => closeTable(false)}>Close table</button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => openTable(selected)}>
                Open table {selected.number}
              </button>
            )
          }
        >
          {!selected.session && (
            <p className="muted">Opening the table lets guests order from its QR code until you close it. Open it only once they're seated.</p>
          )}
          {selected.session && (
            <>
              <p className="muted">Open for {minutesSince(selected.session.openedAt, now)} min</p>
              {requestList.filter((r) => r.tableNumber === selected.number).map((r) => requestRow(r, false))}
              {!details && <p className="muted">Loading orders…</p>}
              {details?.orders.length === 0 && <p className="muted">No orders yet.</p>}
              <div className="list">
                {details?.orders.map((o) => (
                  <div key={o.id} className="order">
                    <div className="order-head">
                      <strong>
                        {money(o.totalMinor)}
                        {o.placedBy === 'staff' ? ' · by staff' : ''}
                      </strong>
                      <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                    </div>
                    <ul className="order-lines">
                      {o.items.map((i, n) => (
                        <li key={n}>
                          {i.qty}× {i.name}
                          {describe(i) && ` (${describe(i)})`}
                          {i.notes && ` · "${i.notes}"`}
                        </li>
                      ))}
                    </ul>
                    {o.status === 'ready' && (
                      <button className="btn primary small" style={{ marginTop: 8 }} onClick={() => serve(o)}>
                        Mark served
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {details && (
                <div className="total">
                  <span>Bill so far</span>
                  <span>{money(details.billMinor)}</span>
                </div>
              )}
              {confirmClose && (
                <div className="confirm">
                  <span>
                    {confirmClose === 1 ? '1 order is' : `${confirmClose} orders are`} still being prepared. Closing the table cancels{' '}
                    {confirmClose === 1 ? 'it' : 'them'}.
                  </span>
                  <div className="sheet-actions">
                    <button className="btn" onClick={() => setConfirmClose(null)}>Keep table open</button>
                    <button className="btn danger" onClick={() => closeTable(true)}>Cancel and close</button>
                  </div>
                </div>
              )}
            </>
          )}
        </Sheet>
      )}

      {ordering && selected?.session && (
        <StaffOrderSheet
          session={selected.session}
          tableNumber={selected.number}
          menu={menu}
          restaurant={me.restaurant}
          call={call}
          onClose={() => setOrdering(false)}
          onPlaced={(order) => {
            setOrdering(false);
            setOrders((prev) => applyUpdate(prev, order));
            loadDetails();
          }}
        />
      )}
    </StaffShell>
  );
}