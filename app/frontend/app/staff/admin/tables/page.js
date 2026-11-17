'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AdminFrame from '../../../../components/admin/AdminFrame.js';
import { MANAGERS } from '../../../../lib/kitchen.js';
import { errorText, useStaff, useStaffApi } from '../../../../lib/staff.js';

export default function AdminTablesPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [tables, setTables] = useState([]);
  const [number, setNumber] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await call('/admin/tables');
      setTables(list);
      setNumber(String(Math.max(0, ...list.map((t) => t.number)) + 1)); // suggest the next number
    } catch (err) {
      setNotice(errorText(err));
    }
  }, [call]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  async function add(e) {
    e.preventDefault();
    try {
      const t = await call('/admin/tables', { method: 'POST', body: { number: Number(number) } });
      setNotice(`Added table ${t.number}. Print its QR code from the QR codes page.`);
      load();
    } catch (err) {
      setNotice(errorText(err));
    }
  }

  async function setActive(t, active) {
    try {
      await call(`/admin/tables/${t.id}`, { method: 'PATCH', body: { active } });
      setNotice(active ? `Table ${t.number} is back.` : `Removed table ${t.number}. Its QR code stops working.`);
      load();
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setConfirmId(null);
    }
  }

  return (
    <AdminFrame me={me} notice={notice} onDismiss={() => setNotice(null)}>
      <form className="box form-max" onSubmit={add}>
        <h3>Add a table</h3>
        <div className="row">
          <input className="input narrow" type="number" min={1} max={999} value={number} onChange={(e) => setNumber(e.target.value)} required />
          <button className="btn primary">Add table</button>
          <Link href="/staff/qr" className="muted">Print QR codes →</Link>
        </div>
      </form>

      <div className="tables" style={{ marginTop: 20 }}>
        {tables.map((t) => (
          <div key={t.id} className={`table-card ${t.active ? '' : 'inactive'}`}>
            <span className="table-num">Table {t.number}</span>
            <span className="muted">{!t.active ? 'Removed' : t.open ? 'Guests seated' : 'Free'}</span>
            {t.active ? (
              confirmId === t.id ? (
                <button className="btn small danger" onClick={() => setActive(t, false)}>Confirm remove</button>
              ) : (
                <button className="btn small" disabled={t.open} title={t.open ? 'Close the table first' : undefined} onClick={() => setConfirmId(t.id)}>
                  Remove
                </button>
              )
            ) : (
              <button className="btn small" onClick={() => setActive(t, true)}>Bring back</button>
            )}
          </div>
        ))}
      </div>
    </AdminFrame>
  );
}