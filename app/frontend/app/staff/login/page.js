'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/api.js';
import { ROLE_HOME } from '../../../lib/staff.js';
import { load, save } from '../../../lib/storage.js';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ restaurantSlug: '', username: '', pin: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // ?r=demo-bistro pre-fills the restaurant (read directly; useSearchParams would break the build)
    const fromUrl = new URLSearchParams(window.location.search).get('r');
    setForm((f) => ({ ...f, restaurantSlug: fromUrl || load('sd_staff_restaurant', '') }));
    // Already signed in? Skip the form.
    api('/staff/me')
      .then((me) => router.replace(me.mustChangePin ? '/staff/change-pin' : ROLE_HOME[me.role]))
      .catch(() => {});
  }, [router]);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const restaurantSlug = form.restaurantSlug.trim().toLowerCase();
    try {
      await api('/staff/login', { method: 'POST', body: { restaurantSlug, username: form.username.trim().toLowerCase(), pin: form.pin } });
      save('sd_staff_restaurant', restaurantSlug);
      const me = await api('/staff/me');
      router.replace(me.mustChangePin ? '/staff/change-pin' : ROLE_HOME[me.role]);
    } catch (err) {
      setForm((f) => ({ ...f, pin: '' }));
      if (!(err instanceof ApiError)) setError("Can't reach SmartDine. Check the internet connection.");
      else if (err.status === 429) setError('Too many attempts. Please wait 15 minutes and try again.');
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <p className="eyebrow">SmartDine</p>
      <h1>Staff sign in</h1>
      <form onSubmit={submit}>
        <label className="field">
          Restaurant
          <input value={form.restaurantSlug} onChange={update('restaurantSlug')} autoCapitalize="none" autoComplete="organization" required placeholder="demo-bistro" />
        </label>
        <label className="field">
          Username
          <input value={form.username} onChange={update('username')} autoCapitalize="none" autoComplete="username" required />
        </label>
        <label className="field">
          PIN
          <input type="password" inputMode="numeric" value={form.pin} onChange={update('pin')} autoComplete="current-password" required maxLength={12} />
        </label>
        {error && <p className="banner error">{error}</p>}
        <button className="btn primary block" style={{ marginTop: 20 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}