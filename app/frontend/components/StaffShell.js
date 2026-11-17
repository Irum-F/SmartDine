'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api.js';
import { FLOOR, KITCHEN, MANAGERS } from '../lib/kitchen.js';

const LINKS = [
  { href: '/staff/floor', label: 'Floor', roles: FLOOR },
  { href: '/staff/kitchen', label: 'Kitchen', roles: KITCHEN },
  { href: '/staff/qr', label: 'QR codes', roles: MANAGERS },
  { href: '/staff/admin/menu', label: 'Admin', roles: MANAGERS, section: '/staff/admin' },
];
const STATUS_TEXT = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };

export default function StaffShell({ me, title, status, actions, children }) {
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    try {
      await api('/staff/logout', { method: 'POST' });
    } catch {
      // signed out locally either way
    }
    router.replace('/staff/login');
  }

  return (
    <div className="staff">
      <header className="staff-top">
        <div>
          <p className="eyebrow">{me.restaurant.name}</p>
          <h1>{title}</h1>
        </div>
        <nav className="staff-nav">
          {LINKS.filter((l) => l.roles.includes(me.role)).map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href || (l.section && pathname.startsWith(l.section)) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="staff-meta">
          {status && <span className={`pill ${status}`}>{STATUS_TEXT[status]}</span>}
          {actions}
          <span className="muted">
            {me.name} · {me.role}
          </span>
          <button className="btn small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="staff-main">{children}</main>
    </div>
  );
}