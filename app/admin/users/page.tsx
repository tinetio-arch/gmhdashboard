import { requireUser } from '@/lib/auth';
import { listUsers } from '@/lib/auth';
import UsersAdminPanel from './UsersAdminPanel';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const admin = await requireUser('admin');
  const users = await listUsers();

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>User & Access Management</h2>
      <p style={{ color: '#64748b', marginBottom: '2rem', maxWidth: '60rem' }}>
        Create, deactivate, and assign roles to dashboard users. Passwords are hashed using bcrypt and sessions rotate on role
        changes. Remember to rotate credentials regularly and deactivate accounts that are no longer in use.
      </p>
      <UsersAdminPanel initialUsers={users} currentUserId={admin.user_id} />
    </section>
  );
}




