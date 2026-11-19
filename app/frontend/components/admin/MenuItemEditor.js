'use client';

import { useState } from 'react';
import Sheet from '../Sheet.js';
import { fromMinor, toMinor } from '../../lib/money.js';
import { errorText } from '../../lib/staff.js';
import { ApiError } from '../../lib/api.js';
import { prepareImage } from '../../lib/image.js';

const DIETARY = [
  ['veg', 'Vegetarian'],
  ['non-veg', 'Non-vegetarian'],
  ['egg', 'Contains egg'],
  ['vegan', 'Vegan'],
  ['spicy', 'Spicy'],
  ['contains-nuts', 'Contains nuts'],
  ['gluten-free', 'Gluten-free'],
];

const newGroup = () => ({ name: '', minSelect: 0, maxSelect: 1, options: [{ name: '', price: '' }] });

function toForm(item) {
  export default function MenuItemEditor({ item, categories, call, onSave, onDelete, onClose, onPhotoChange }) {
  return {
    name: item.name ?? '',
    description: item.description ?? '',
    category: item.category ?? '',
    price: item.priceMinor !== undefined ? fromMinor(item.priceMinor) : '',
    dietary: item.dietary ?? [],
    variants: (item.variants ?? []).map((v) => ({ name: v.name, price: fromMinor(v.priceMinor) })),
    modifierGroups: (item.modifierGroups ?? []).map((g) => ({
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({ name: o.name, price: o.priceDeltaMinor ? fromMinor(o.priceDeltaMinor) : '' })),
    })),
    available: item.available ?? true,
    sortOrder: item.sortOrder ?? 0,
  };
}

function toBody(f) {
  const price = (what, text) => {
    const minor = toMinor(text);
    if (minor === null) throw new Error(`${what}: enter an amount like 349 or 349.50`);
    return minor;
  };
  const variants = f.variants.map((v, i) => ({ name: v.name.trim(), priceMinor: price(`Size "${v.name || i + 1}"`, v.price) }));
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    category: f.category.trim(),
    priceMinor: variants.length ? Math.min(...variants.map((v) => v.priceMinor)) : price('Price', f.price),
    dietary: f.dietary,
    variants,
    modifierGroups: f.modifierGroups.map((g) => ({
      name: g.name.trim(),
      minSelect: Number(g.minSelect),
      maxSelect: Number(g.maxSelect),
      options: g.options.map((o) => ({
        name: o.name.trim(),
        priceDeltaMinor: o.price.trim() === '' ? 0 : price(`"${g.name || 'Add-on'}" → "${o.name || 'option'}"`, o.price),
      })),
    })),
    available: f.available,
    sortOrder: Number(f.sortOrder) || 0,
  };
}

export default function MenuItemEditor({ item, categories, onSave, onDelete, onClose }) {
  const [f, setF] = useState(() => toForm(item));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !item.id;
  const [photo, setPhoto] = useState(item.photo ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function uploadPhoto(file) {
    setPhotoBusy(true);
    setError(null);
    try {
      const blob = await prepareImage(file);
      // 1. Permission to upload one file, straight to S3
      const ticket = await call(`/admin/menu/${item.id}/photo-upload`, { method: 'POST', body: { contentType: blob.type } });
      const form = new FormData();
      Object.entries(ticket.fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', blob); // S3 requires the file to be the last field
      const res = await fetch(ticket.url, { method: 'POST', body: form });
      if (!res.ok) throw new Error(res.status === 400 ? 'The photo is too large (max 5 MB).' : 'Upload failed. Please try again.');
      // 2. The API checks it, makes the sizes and attaches it to the item
      const updated = await call(`/admin/menu/${item.id}/photo`, { method: 'POST', body: { key: ticket.key } });
      setPhoto(updated.photo);
      onPhotoChange();
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err) : err.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await call(`/admin/menu/${item.id}/photo`, { method: 'DELETE' });
      setPhoto(null);
      onPhotoChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  const field = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setVariant = (i, key, value) => setF((s) => ({ ...s, variants: s.variants.map((v, n) => (n === i ? { ...v, [key]: value } : v)) }));
  const setGroup = (i, key, value) =>
    setF((s) => ({ ...s, modifierGroups: s.modifierGroups.map((g, n) => (n === i ? { ...g, [key]: value } : g)) }));
  const setOption = (gi, oi, key, value) =>
    setF((s) => ({
      ...s,
      modifierGroups: s.modifierGroups.map((g, n) =>
        n !== gi ? g : { ...g, options: g.options.map((o, m) => (m === oi ? { ...o, [key]: value } : o)) }
      ),
    }));

  // Vegetarian and non-vegetarian can't both be ticked
  const toggleDiet = (tag) =>
    setF((s) => {
      const on = !s.dietary.includes(tag);
      let next = on ? [...s.dietary, tag] : s.dietary.filter((t) => t !== tag);
      if (on && tag === 'veg') next = next.filter((t) => t !== 'non-veg');
      if (on && tag === 'non-veg') next = next.filter((t) => t !== 'veg' && t !== 'vegan');
      return { ...s, dietary: next };
    });

  async function save() {
    setError(null);
    let body;
    try {
      body = toBody(f);
    } catch (err) {
      return setError(err.message);
    }
    setSaving(true);
    try {
      await onSave(body);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await onDelete();
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={isNew ? 'New menu item' : `Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          {error && <p className="banner error">{error}</p>}
          <div className="sheet-actions">
            {!isNew &&
              (confirmDelete ? (
                <button className="btn danger" disabled={saving} onClick={remove}>Confirm delete</button>
              ) : (
                <button className="btn" onClick={() => setConfirmDelete(true)}>Delete</button>
              ))}
            <button className="btn primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      }
    >
      <label className="field">
        Name
        <input className="input" value={f.name} onChange={field('name')} maxLength={80} />
      </label>
      <label className="field">
        Category
        <input className="input" list="categories" value={f.category} onChange={field('category')} maxLength={40} placeholder="e.g. Starters" />
        <datalist id="categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        Description <span className="hint">Optional</span>
        <textarea className="input" rows={2} value={f.description} onChange={field('description')} maxLength={300} />
      </label>

      <div className="box">
        <h3>Sizes</h3>
      <div className="box">
        <h3>Photo</h3>
        {isNew ? (
          <p className="hint">Save the item first, then add a photo.</p>
        ) : (
          <>
            {photo && <img className="item-photo" src={photo.large} alt="" width={photo.width} height={photo.height} />}
            <div className="row">
              <label className={`btn small ${photoBusy ? 'disabled' : ''}`}>
                {photoBusy ? 'Working…' : photo ? 'Replace photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  hidden
                  disabled={photoBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ''; // lets the same file be picked again
                    if (file) uploadPhoto(file);
                  }}
                />
              </label>
              {photo && (
                <button className="btn small" disabled={photoBusy} onClick={removePhoto}>Remove photo</button>
              )}
            </div>
            <p className="hint">Large photos are shrunk on your device before uploading. Photos appear on guests' menus within seconds.</p>
          </>
        )}
      </div>
        {f.variants.length === 0 ? (
          <label className="field">
            Price (₹)
            <input className="input" inputMode="decimal" value={f.price} onChange={field('price')} placeholder="349" />
            <span className="hint">Add sizes below if this item comes in more than one size.</span>
          </label>
        ) : (
          <p className="hint">Guests must choose a size. The menu shows "from" the cheapest one.</p>
        )}
        {f.variants.map((v, i) => (
          <div className="row" key={i}>
            <input className="input" placeholder="Size name, e.g. Large" value={v.name} onChange={(e) => setVariant(i, 'name', e.target.value)} />
            <input className="input narrow" inputMode="decimal" placeholder="₹" value={v.price} onChange={(e) => setVariant(i, 'price', e.target.value)} />
            <button className="btn small" onClick={() => setF((s) => ({ ...s, variants: s.variants.filter((_, n) => n !== i) }))}>Remove</button>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => setF((s) => ({ ...s, variants: [...s.variants, { name: '', price: '' }] }))}>
          + Add size
        </button>
      </div>

      <div className="box">
        <h3>Add-on groups</h3>
        <p className="hint">e.g. "Spice level" (choose exactly 1) or "Extra toppings" (choose 0 to 3). Leave an option's price empty if it's free.</p>
        {f.modifierGroups.map((g, gi) => (
          <div className="box" key={gi}>
            <div className="row">
              <input className="input" placeholder="Group name" value={g.name} onChange={(e) => setGroup(gi, 'name', e.target.value)} />
              <button className="btn small" onClick={() => setF((s) => ({ ...s, modifierGroups: s.modifierGroups.filter((_, n) => n !== gi) }))}>
                Remove group
              </button>
            </div>
            <div className="row">
              <span className="hint">Guests choose at least</span>
              <input className="input narrow" type="number" min={0} max={20} value={g.minSelect} onChange={(e) => setGroup(gi, 'minSelect', e.target.value)} />
              <span className="hint">and at most</span>
              <input className="input narrow" type="number" min={1} max={20} value={g.maxSelect} onChange={(e) => setGroup(gi, 'maxSelect', e.target.value)} />
            </div>
            {g.options.map((o, oi) => (
              <div className="row" key={oi}>
                <input className="input" placeholder="Option, e.g. Extra cheese" value={o.name} onChange={(e) => setOption(gi, oi, 'name', e.target.value)} />
                <input className="input narrow" inputMode="decimal" placeholder="+ ₹" value={o.price} onChange={(e) => setOption(gi, oi, 'price', e.target.value)} />
                <button className="btn small" disabled={g.options.length === 1} onClick={() => setGroup(gi, 'options', g.options.filter((_, m) => m !== oi))}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => setGroup(gi, 'options', [...g.options, { name: '', price: '' }])}>
              + Add option
            </button>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => setF((s) => ({ ...s, modifierGroups: [...s.modifierGroups, newGroup()] }))}>
          + Add group
        </button>
      </div>

      <div className="box">
        <h3>Dietary</h3>
        <div className="chips">
          {DIETARY.map(([tag, text]) => (
            <button key={tag} className="choice" aria-pressed={f.dietary.includes(tag)} onClick={() => toggleDiet(tag)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={f.available} onChange={field('available')} /> In stock
      </label>
      <label className="field">
        Position in its category <span className="hint">Lower numbers appear first</span>
        <input className="input narrow" type="number" min={0} max={10000} value={f.sortOrder} onChange={field('sortOrder')} />
      </label>
    </Sheet>
  );
}