'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminFrame from '../../../../components/admin/AdminFrame.js';
import MenuItemEditor from '../../../../components/admin/MenuItemEditor.js';
import { MANAGERS } from '../../../../lib/kitchen.js';
import { formatMoney } from '../../../../lib/money.js';
import { errorText, useStaff, useStaffApi } from '../../../../lib/staff.js';

export default function AdminMenuPage() {
  const [me] = useStaff(MANAGERS);
  const call = useStaffApi();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // an item, or {} for a new one
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await call('/admin/menu'));
    } catch (err) {
      setNotice(errorText(err));
    }
  }, [call]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of data?.items ?? []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    }
    return [...map];
  }, [data]);

  if (!me) {
    return (
      <main className="guest center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const money = (minor) => formatMoney(minor, me.restaurant.currency, me.restaurant.locale);
  const categories = [...new Set([...(data?.categories ?? []), ...groups.map(([c]) => c)])];

  async function save(body) {
    const isNew = !editing.id;
    await call(isNew ? '/admin/menu' : `/admin/menu/${editing.id}`, { method: isNew ? 'POST' : 'PUT', body });
    setEditing(null);
    setNotice(`${isNew ? 'Added' : 'Saved'} "${body.name}". Open menus update within a few seconds.`);
    load();
  }

  async function remove() {
    await call(`/admin/menu/${editing.id}`, { method: 'DELETE' });
    setNotice(`Deleted "${editing.name}". Past orders keep their original names and prices.`);
    setEditing(null);
    load();
  }

  return (
    <AdminFrame me={me} notice={notice} onDismiss={() => setNotice(null)}>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing({})}>+ Add item</button>
        <span className="muted">The order of categories is set in Settings.</span>
      </div>
      {data && data.items.length === 0 && <p className="empty">No items yet.</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="form-max">
          <h2>{category}</h2>
          <ul className="list">
            {items.map((i) => (
              <li key={i.id}>
                <button className="item" onClick={() => setEditing(i)}>
                  <span>
                    <span className="item-name">{i.name}</span>
                    <span className="item-main">
                    {i.photo && <img className="thumb" src={i.photo.small} alt="" loading="lazy" width={56} height={56} />}
                    <span>
                      {/* existing item-name and item-desc spans, unchanged */}
                    </span>
                  </span>
                    <span className="item-desc">
                      {[i.variants.length && `${i.variants.length} sizes`, i.modifierGroups.length && `${i.modifierGroups.length} add-on groups`, i.dietary.join(', ')]
                        .filter(Boolean)
                        .join(' · ') || 'No options'}
                    </span>
                  </span>
                  <span className="price">
                    {i.available ? `${i.variants.length ? 'from ' : ''}${money(i.priceMinor)}` : <span className="tag">Sold out</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <MenuItemEditor
          key={editing.id ?? 'new'}
          item={editing}
          categories={categories}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditing(null)}
          call={call}
          onPhotoChange={load}
        />
      )}
    </AdminFrame>
  );
}