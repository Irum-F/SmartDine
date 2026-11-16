'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import StaffShell from '../../../components/StaffShell.js';
import { MANAGERS } from '../../../lib/kitchen.js';
import { errorText, useStaff, useStaffApi } from '../../../lib/staff.js';

export default function QrPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [tables, setTables] = useState([]);
  const [images, setImages] = useState({});
  const [confirmId, setConfirmId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setTables(await call('/ops/tables/qr'));
    } catch (err) {
      setNotice(errorText(err));
    }
  }, [call]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  // Each code holds this site's address plus the table's token
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = {};
      for (const t of tables) {
        out[t.id] = await QRCode.toDataURL(`${window.location.origin}/t/${t.qrToken}`, { errorCorrectionLevel: 'M', margin: 1, width: 600 });
      }
      if (!cancelled) setImages(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [tables]);

  async function rotate(table) {
    try {
      const updated = await call(`/ops/tables/${table.id}/rotate-qr`, { method: 'POST' });
      setTables((list) => list.map((t) => (t.id === table.id ? { ...t, qrToken: updated.qrToken } : t)));
      setNotice(`Table ${table.number} has a new code. The old card no longer works. Print this one and replace it.`);
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setConfirmId(null);
    }
  }

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <StaffShell me={me} title="QR codes">
      <div className="toolbar no-print">
        <button className="btn primary" disabled={!tables.length} onClick={() => window.print()}>Print all</button>
        <span className="muted">Print from the live site, not localhost: each code contains this page's web address.</span>
      </div>
      {notice && <p className="banner warn no-print">{notice}</p>}
      <div className="qr-grid">
        {tables.map((t) => (
          <div key={t.id} className="qr-card">
            <div className="qr-name">{me.restaurant.name}</div>
            <div className="qr-table">Table {t.number}</div>
            {images[t.id] ? <img src={images[t.id]} alt={`QR code for table ${t.number}`} /> : <p className="qr-hint">Generating…</p>}
            <div className="qr-hint">Scan with your phone camera to see the menu and order</div>
            <div className="no-print" style={{ marginTop: 12 }}>
              {confirmId === t.id ? (
                <button className="btn small danger" onClick={() => rotate(t)}>Confirm: the old card stops working</button>
              ) : (
                <button className="btn small" onClick={() => setConfirmId(t.id)}>Replace this code</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </StaffShell>
  );
}