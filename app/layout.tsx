import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser, userHasRole } from '@/lib/auth';
import LogoutButton from '@/components/LogoutButton';

export const metadata: Metadata = {
  title: 'Granite Mountain Health Dashboard',
  description: 'Fast clinical operations dashboard backed by Postgres.'
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const showNav = Boolean(user);

  return (
    <html lang="en">
      <body>
        {showNav ? (
          <header
            style={{
              padding: '1.5rem 2rem',
              borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
              backgroundColor: '#ffffff',
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)'
            }}
          >
            <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <h1 style={{ fontSize: '1.5rem', margin: 0 }}>GMH Control Center</h1>
                <Link href="/">Dashboard</Link>
                <Link href="/patients">Patients</Link>
                <Link href="/professional">Professional</Link>
                <Link href="/dea">DEA Log</Link>
                <Link href="/inventory">Inventory</Link>
                {user && userHasRole(user, 'write') && <Link href="/transactions">Transactions</Link>}
                {user && userHasRole(user, 'write') && <Link href="/audit">Audit</Link>}
                {user && (user.can_sign || userHasRole(user, 'admin')) && <Link href="/provider/signatures">Provider Signatures</Link>}
                <Link href="/account">Account</Link>
                {user && userHasRole(user, 'admin') && <Link href="/admin/users">User Admin</Link>}
                {user && userHasRole(user, 'admin') && <Link href="/admin/quickbooks">QuickBooks</Link>}
                {user && userHasRole(user, 'admin') && <Link href="/admin/membership-audit">Membership Audit</Link>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#475569' }}>
                <span style={{ fontWeight: 600 }}>{user?.display_name ?? user?.email}</span>
                <span
                  style={{
                    padding: '0.25rem 0.6rem',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                    color: '#0369a1',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em'
                  }}
                >
                  {user?.role}
                </span>
                <LogoutButton />
              </div>
            </nav>
          </header>
        ) : null}
        <main>{children}</main>
      </body>
    </html>
  );
}
