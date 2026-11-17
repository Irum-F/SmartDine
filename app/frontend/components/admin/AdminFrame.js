'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StaffShell from '../StaffShell.js';

const TABS = [
  ['Menu', '/staff/admin/menu'],
  ['Staff', '/staff/admin/staff'],
  ['Tables', '/staff/admin/tables'],
  ['Settings', '/staff/admin/settings'],
  ['Activity', '/staff/admin/activity'],
];

export default function AdminFrame({ me, notice, onDismiss, children }) {
  const pathname = usePathname();
  return (
    <StaffShell me={me} title="Admin">
      <nav className="admin-nav">
        {TABS.map(([label, href]) => (
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {notice && (
        <p className="banner warn" role="status" onClick={onDismiss}>
          {notice}
        </p>
      )}
      {children}
    </StaffShell>
  );
}