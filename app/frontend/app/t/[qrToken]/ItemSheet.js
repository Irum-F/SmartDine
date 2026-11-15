'use client';

import { useState } from 'react';
import Sheet from '../../../components/Sheet.js';
import { choiceError, unitPrice } from '../../../lib/cart.js';

export default function ItemSheet({ item, money, onAdd, onClose }) {
  const [variantName, setVariantName] = useState(item.variants[0]?.name);
  const [modifiers, setModifiers] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const isChosen = (group, option) => modifiers.some((m) => m.group === group.name && m.option === option.name);

  function toggle(group, option) {
    setModifiers((prev) => {
      if (isChosen(group, option)) return prev.filter((m) => !(m.group === group.name && m.option === option.name));
      const pick = { group: group.name, option: option.name };
      // Single-choice groups swap the choice; multi-choice groups stop at the maximum
      if (group.maxSelect === 1) return [...prev.filter((m) => m.group !== group.name), pick];
      if (prev.filter((m) => m.group === group.name).length >= group.maxSelect) return prev;
      return [...prev, pick];
    });
  }

  const error = !item.available ? 'Sold out' : choiceError(item, variantName, modifiers);
  const unit = unitPrice(item, variantName, modifiers);

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <div className="sheet-actions">
          <div className="qty" aria-label="Quantity">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One less">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="One more">+</button>
          </div>
          <button
            className="btn primary"
            disabled={Boolean(error)}
            onClick={() => onAdd({ menuItemId: item.id, variantName, modifiers, qty, notes: notes.trim() })}
          >
            {error ?? `Add · ${money(unit * qty)}`}
          </button>
        </div>
      }
    >
      {item.description && <p className="muted">{item.description}</p>}

      {item.variants.length > 0 && (
        <div className="group">
          <div className="group-title">
            Size <span className="hint">Required</span>
          </div>
          <div className="choices">
            {item.variants.map((v) => (
              <button key={v.name} className="choice" aria-pressed={variantName === v.name} onClick={() => setVariantName(v.name)}>
                <span>{v.name}</span>
                <span>{money(v.priceMinor)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {item.modifierGroups.map((g) => (
        <div className="group" key={g.name}>
          <div className="group-title">
            {g.name}
            <span className="hint">
              {g.minSelect > 0 ? 'Required' : 'Optional'}
              {g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ''}
            </span>
          </div>
          <div className="choices">
            {g.options.map((o) => (
              <button key={o.name} className="choice" aria-pressed={isChosen(g, o)} onClick={() => toggle(g, o)}>
                <span>{o.name}</span>
                <span>{o.priceDeltaMinor ? `+ ${money(o.priceDeltaMinor)}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="group">
        <label className="group-title" htmlFor="notes">
          Note for the kitchen <span className="hint">Optional</span>
        </label>
        <textarea id="notes" rows={2} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no onions" />
      </div>
    </Sheet>
  );
}