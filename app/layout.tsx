import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser, userHasRole } from '@/lib/auth';
import LogoutButton from '@/components/LogoutButton';
import NavDropdown from '@/app/components/NavDropdown';

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

  const clinicalItems = [
    { label: 'Patients', href: '/patients' },
    { label: 'Labs', href: '/labs' },
    { label: 'Faxes', href: '/faxes' },
    { label: 'Supplies', href: '/supplies' },
    { label: 'Peptides', href: '/peptides' },
  ];

  const dispensingItems = user ? [
    userHasRole(user, 'write') ? { label: 'Transactions', href: '/transactions' } : null,
    { label: 'Vial Inventory', href: '/inventory' },
    { label: 'DEA Log', href: '/dea' },
    (user.can_sign || userHasRole(user, 'admin')) ? { label: 'Provider Signatures', href: '/provider/signatures' } : null,
  ].filter((item): item is { label: string; href: string } => item !== null) : [];

  const pharmacyItems = [
    { label: 'Strive (Tirzepatide)', href: '/pharmacy/strive' },
    { label: 'Farmakaio', href: '/pharmacy/farmakaio' },
    { label: 'Olympia', href: '/pharmacy/olympia' },
    { label: 'TopRX', href: '/pharmacy/toprx' },
    { label: 'Carrie Boyd', href: '/pharmacy/carrieboyd' },
  ];

  const adminItems = user ? [
    { label: 'User Admin', href: '/admin/users' },
    { label: 'App Control', href: '/admin/app-control' },
    (user.can_sign || userHasRole(user, 'admin')) ? { label: 'Provider Signatures', href: '/provider/signatures' } : null,
  ].filter((item): item is { label: string; href: string } => item !== null) : [];

  const helpItems = [
    { label: 'SOPs', href: '/menshealth' },
  ];

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

                {/* Dashboard (Admin Only) */}
                {user && userHasRole(user, 'admin') && (
                  <Link href="/analytics">Dashboard</Link>
                )}

                {/* Clinical Dropdown */}
                <NavDropdown label="Clinical" items={clinicalItems} />

                {/* DEA Controls Dropdown (Controlled Substances) */}
                <NavDropdown label="DEA Controls" items={dispensingItems} />

                {/* Pharmacy Tracking Dropdown */}
                <NavDropdown label="Pharmacy" items={pharmacyItems} />

                {/* Account Link */}
                <Link href="/account">Account</Link>

                {/* Help Dropdown */}
                <NavDropdown label="Help" items={helpItems} />

                {/* Admin Dropdown (Admin Only) */}
                {user && userHasRole(user, 'admin') && (
                  <NavDropdown label="Admin" items={adminItems} />
                )}
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
