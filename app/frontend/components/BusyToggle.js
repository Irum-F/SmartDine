'use client';

import { useState } from 'react';
import { MANAGERS } from '../lib/kitchen.js';
import { errorText } from '../lib/staff.js';

// Managers can pause QR ordering; everyone else just sees that it's paused
export default function BusyToggle({ me, busyMode, onChange, onError, call }) {
  const [saving, setSaving] = useState(false);

  if (!MANAGERS.includes(me.role)) return busyMode ? <span className="pill warn">Busy mode on</span> : null;

  async function toggle() {
    setSaving(true);
    try {
      const res = await call('/ops/restaurant/busy-mode', { method: 'PATCH', body: { busyMode: !busyMode } });
      onChange(res.busyMode);
    } catch (err) {
      onError?.(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <button className={`btn small ${busyMode ? 'danger' : ''}`} disabled={saving} aria-pressed={busyMode} onClick={toggle}>
      {busyMode ? 'Busy mode ON · tap to resume QR orders' : 'Pause QR orders'}
    </button>
  );
}