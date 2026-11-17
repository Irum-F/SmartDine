'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminFrame from '../../../../components/admin/AdminFrame.js';
import { MANAGERS } from '../../../../lib/kitchen.js';
import { errorText, useStaff, useStaffApi } from '../../../../lib/staff.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminSettingsPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [form, setForm] = useState(null);
  const [inUse, setInUse] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await call('/admin/settings');
      setForm({ name: s.name, showVegSymbols: s.showVegSymbols, openingHours: s.openingHours, categories: s.categories });
      setInUse(s.categoriesInUse);
    } catch (err) {
      setNotice(errorText(err));
    }
  }, [call]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  if (!me || !form) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const setHours = (i, key, value) =>
    setForm((f) => ({ ...f, openingHours: f.openingHours.map((h, n) => (n === i ? { ...h, [key]: value } : h)) }));
  const moveCategory = (i, by) =>
    setForm((f) => {
      const list = [...f.categories];
      const j = i + by;
      if (j < 0 || j >= list.length) return f;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...f, categories: list };
    });
  const addCategory = (name) => {
    const c = name.trim();
    if (!c || form.categories.some((x) => x.toLowerCase() === c.toLowerCase())) return;
    setForm((f) => ({ ...f, categories: [...f.categories, c] }));
    setNewCategory('');
  };
  const unlisted = inUse.filter((c) => !form.categories.some((x) => x.toLowerCase() === c.toLowerCase()));

  async function save() {
    setSaving(true);
    try {
      const openingHours = [...form.openingHours].sort((a, b) => a.day - b.day || a.open.localeCompare(b.open));
      await call('/admin/settings', { method: 'PUT', body: { ...form, name: form.name.trim(), openingHours } });
      setNotice('Saved. Open menus update within a few seconds.');
      load();
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminFrame me={me} notice={notice} onDismiss={() => setNotice(null)}>
      <div className="form-max">
        <div className="box">
          <h3>Restaurant</h3>
          <label className="field">
            Name shown to guests
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.showVegSymbols} onChange={(e) => setForm((f) => ({ ...f, showVegSymbols: e.target.checked }))} />
            Show veg and non-veg symbols on the menu
          </label>
        </div>

        <div className="box">
          <h3>Opening hours</h3>
          <p className="hint">
            No rows means always open. A day can have more than one row (e.g. lunch and dinner). A closing time earlier than the opening time
            means past midnight: 18:00 to 02:00 is fine.
          </p>
          {form.openingHours.map((h, i) => (
            <div className="row" key={i}>
              <select className="input" value={h.day} onChange={(e) => setHours(i, 'day', Number(e.target.value))}>
                {DAYS.map((d, n) => (
                  <option key={d} value={n}>{d}</option>
                ))}
              </select>
              <input className="input narrow" type="time" value={h.open} onChange={(e) => setHours(i, 'open', e.target.value)} />
              <span className="hint">to</span>
              <input className="input narrow" type="time" value={h.close} onChange={(e) => setHours(i, 'close', e.target.value)} />
              <button className="btn small" onClick={() => setForm((f) => ({ ...f, openingHours: f.openingHours.filter((_, n) => n !== i) }))}>
                Remove
              </button>
            </div>
          ))}
          <div className="row">
            <button className="btn small" onClick={() => setForm((f) => ({ ...f, openingHours: [...f.openingHours, { day: 1, open: '11:00', close: '23:00' }] }))}>
              + Add hours
            </button>
            <button
              className="btn small"
              onClick={() => setForm((f) => ({ ...f, openingHours: DAYS.map((_, day) => ({ day, open: '11:00', close: '23:00' })) }))}
            >
              Fill every day 11:00 to 23:00
            </button>
          </div>
        </div>

        <div className="box">
          <h3>Category order</h3>
          <p className="hint">Guests see categories in this order. Categories not listed come after, alphabetically.</p>
          {form.categories.map((c, i) => (
            <div className="row" key={c}>
              <span style={{ flex: 1 }}>{c}</span>
              <button className="btn small" disabled={i === 0} onClick={() => moveCategory(i, -1)} aria-label={`Move ${c} up`}>↑</button>
              <button className="btn small" disabled={i === form.categories.length - 1} onClick={() => moveCategory(i, 1)} aria-label={`Move ${c} down`}>↓</button>
              <button className="btn small" onClick={() => setForm((f) => ({ ...f, categories: f.categories.filter((x) => x !== c) }))}>Remove</button>
            </div>
          ))}
          {unlisted.length > 0 && (
            <div className="chips">
              <span className="hint">Used on the menu but not listed:</span>
              {unlisted.map((c) => (
                <button key={c} className="choice" onClick={() => addCategory(c)}>+ {c}</button>
              ))}
            </div>
          )}
          <div className="row">
            <input className="input" placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={40} />
            <button className="btn small" onClick={() => addCategory(newCategory)}>Add</button>
          </div>
        </div>

        <button className="btn primary" style={{ marginTop: 20 }} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </AdminFrame>
  );
}