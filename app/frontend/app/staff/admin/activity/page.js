'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminFrame from '../../../../components/admin/AdminFrame.js';
import { MANAGERS } from '../../../../lib/kitchen.js';
import { errorText, useStaff, useStaffApi } from '../../../../lib/staff.js';

const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminActivityPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(true);
  const [notice, setNotice] = useState(null);

  const loadPage = useCallback(
    async (before) => {
      try {
        const page = await call(`/admin/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`);
        setEntries((list) => (before ? [...list, ...page] : page));
        setMore(page.length === 50);
      } catch (err) {
        setNotice(errorText(err));
      }
    },
    [call]
  );
  useEffect(() => {
    if (me) loadPage();
  }, [me, loadPage]);

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <AdminFrame me={me} notice={notice} onDismiss={() => setNotice(null)}>
      {entries.length === 0 && <p className="empty">No changes recorded yet.</p>}
      {entries.length > 0 && (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when.format(new Date(e.at))}</td>
                  <td>{e.staffName}</td>
                  <td>{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && entries.length > 0 && (
        <button className="btn" style={{ marginTop: 16 }} onClick={() => loadPage(entries[entries.length - 1].at)}>Load older</button>
      )}
      <p className="muted" style={{ marginTop: 16 }}>Entries are kept for 1 year.</p>
    </AdminFrame>
  );
}