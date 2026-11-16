'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/api.js';
import { ROLE_HOME } from '../../../lib/staff.js';

export default function ChangePinPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/staff/me').then(setMe).catch(() => router.replace('/staff/login'));
  }, [router]);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError("The new PINs don't match.");
    if (form.next === form.current) return setError('Choose a PIN different from the current one.');
    setBusy(true);
    setError(null);
    try {
      await api('/staff/change-pin', { method: 'POST', body: { currentPin: form.current, newPin: form.next } });
      // Changing the PIN signs out every device, this one included, so sign in again with the new PIN
      await api('/staff/login', { method: 'POST', body: { restaurantSlug: me.restaurant.slug, username: me.username, pin: form.next } });
      router.replace(ROLE_HOME[me.role]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach SmartDine. Check the internet connection.");
    } finally {
      setBusy(false);
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
    <main className="auth">
      <p className="eyebrow">{me.restaurant.name}</p>
      <h1>{me.mustChangePin ? 'Choose your own PIN' : 'Change PIN'}</h1>
      {me.mustChangePin && <p className="muted">You signed in with a temporary PIN. Choose a new one only you know.</p>}
      <form onSubmit={submit}>
        <label className="field">
          Current PIN
          <input type="password" inputMode="numeric" value={form.current} onChange={update('current')} autoComplete="current-password" required />
        </label>
        <label className="field">
          New PIN
          <input type="password" inputMode="numeric" value={form.next} onChange={update('next')} autoComplete="new-password" required />
        </label>
        <label className="field">
          New PIN again
          <input type="password" inputMode="numeric" value={form.confirm} onChange={update('confirm')} autoComplete="new-password" required />
        </label>
        {error && <p className="banner error">{error}</p>}
        <button className="btn primary block" style={{ marginTop: 20 }} disabled={busy}>
          {busy ? 'Saving…' : 'Save new PIN'}
        </button>
      </form>
    </main>
  );
}