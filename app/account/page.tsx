import { requireUser } from '@/lib/auth';
import AccountSettings from './AccountSettings';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser('read');

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Account Preferences</h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '48rem' }}>
        Update your personal information and manage your password. Changes apply to this account only.
      </p>
      <AccountSettings initialDisplayName={user.display_name ?? null} email={user.email} />
    </section>
  );
}



