'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api.js';
import { ROLE_HOME } from '../../lib/staff.js';

export default function StaffHome() {
  const router = useRouter();
  useEffect(() => {
    api('/staff/me')
      .then((me) => router.replace(me.mustChangePin ? '/staff/change-pin' : ROLE_HOME[me.role]))
      .catch(() => router.replace('/staff/login'));
  }, [router]);
  return (
    <main className="guest center">
      <p className="muted">Loading…</p>
    </main>
  );
}