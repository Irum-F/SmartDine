'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminFrame from '../../../../components/admin/AdminFrame.js';
import Sheet from '../../../../components/Sheet.js';
import { MANAGERS } from '../../../../lib/kitchen.js';
import { errorText, useStaff, useStaffApi } from '../../../../lib/staff.js';

const ALL_ROLES = ['owner', 'manager', 'waiter', 'kitchen'];

export default function AdminStaffPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ name: '', username: '', role: 'waiter' });
  const [issued, setIssued] = useState(null); // { name, username, pin }, shown once
  const [confirm, setConfirm] = useState(null); // "<id>:<action>"
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setStaff(await call('/admin/staff'));
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

  // Must match MANAGEABLE in the API: owners manage everyone, managers only waiters and kitchen
  const assignable = me.role === 'owner' ? ALL_ROLES : ['waiter', 'kitchen'];
  const canChange = (s) => String(s.id) !== String(me.id) && assignable.includes(s.role);

  async function create(e) {
    e.preventDefault();
    try {
      const s = await call('/admin/staff', { method: 'POST', body: form });
      setIssued({ name: s.name, username: s.username, pin: s.temporaryPin });
      setForm((f) => ({ ...f, name: '', username: '' }));
      load();
    } catch (err) {
      setNotice(errorText(err));
    }
  }

  async function update(s, body, message) {
    try {
      await call(`/admin/staff/${s.id}`, { method: 'PATCH', body });
      setNotice(message);
      load();
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setConfirm(null);
    }
  }

  async function resetPin(s) {
    try {
      const r = await call(`/admin/staff/${s.id}/reset-pin`, { method: 'POST' });
      setIssued({ name: r.name, username: r.username, pin: r.temporaryPin });
      load();
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setConfirm(null);
    }
  }

  const ask = (s, action) => {
    setConfirm(`${s.id}:${action}`);
    setTimeout(() => setConfirm((c) => (c === `${s.id}:${action}` ? null : c)), 4000);
  };
  const asking = (s, action) => confirm === `${s.id}:${action}`;
  const statusText = (s) => (!s.active ? 'Deactivated' : s.locked ? 'Locked (too many wrong PINs)' : s.mustChangePin ? 'Has a temporary PIN' : 'Active');

  return (
    <AdminFrame me={me} notice={notice} onDismiss={() => setNotice(null)}>
      <form className="box form-max" onSubmit={create}>
        <h3>Add a staff member</h3>
        <div className="row">
          <input className="input" placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={60} />
          <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required autoCapitalize="none" maxLength={30} />
          <select className="input narrow" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {assignable.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button className="btn primary">Add</button>
        </div>
      </form>

      <div className="table-scroll" style={{ marginTop: 20 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}{String(s.id) === String(me.id) && ' (you)'}</td>
                <td>{s.username}</td>
                <td>
                  {canChange(s) ? (
                    <select
                      className="input"
                      value={s.role}
                      onChange={(e) => update(s, { role: e.target.value }, `${s.name} is now ${e.target.value}. They've been signed out so the new permissions apply.`)}
                    >
                      {assignable.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    s.role
                  )}
                </td>
                <td>{statusText(s)}</td>
                <td>
                  {canChange(s) && (
                    <div className="row" style={{ marginTop: 0 }}>
                      {asking(s, 'pin') ? (
                        <button className="btn small danger" onClick={() => resetPin(s)}>Confirm reset</button>
                      ) : (
                        <button className="btn small" onClick={() => ask(s, 'pin')}>Reset PIN</button>
                      )}
                      {s.active ? (
                        asking(s, 'off') ? (
                          <button className="btn small danger" onClick={() => update(s, { active: false }, `${s.name} was deactivated and signed out everywhere.`)}>
                            Confirm deactivate
                          </button>
                        ) : (
                          <button className="btn small" onClick={() => ask(s, 'off')}>Deactivate</button>
                        )
                      ) : (
                        <button className="btn small" onClick={() => update(s, { active: true }, `${s.name} can sign in again.`)}>Reactivate</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issued && (
        <Sheet title="Temporary PIN" onClose={() => setIssued(null)} footer={<button className="btn primary block" onClick={() => setIssued(null)}>Done, I've passed it on</button>}>
          <p>
            Give this PIN to <strong>{issued.name}</strong> (username <strong>{issued.username}</strong>) in person.
          </p>
          <p className="pin">{issued.pin}</p>
          <p className="muted">It's shown only once. They'll choose their own PIN the first time they sign in.</p>
        </Sheet>
      )}
    </AdminFrame>
  );
}