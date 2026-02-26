'use client';
import { formatDateUTC } from '@/lib/dateUtils';

import { useEffect, useState, FormEvent } from 'react';
import type { PublicUser, UserRole } from '@/lib/auth';

type Status =
  | { type: 'idle'; message: string | null }
  | { type: 'loading'; message: string | null }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

type NewUserForm = {
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
  displayName: string;
  isProvider: boolean;
  canSign: boolean;
};

const initialForm: NewUserForm = {
  email: '',
  password: '',
  confirmPassword: '',
  role: 'write',
  displayName: '',
  isProvider: false,
  canSign: false
};

export default function UsersAdminClient() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ type: 'idle', message: null });
  const [form, setForm] = useState<NewUserForm>(initialForm);

  async function loadUsers() {
    setLoading(true);
    setStatus({ type: 'idle', message: null });
    try {
      const res = await fetch('/ops/api/admin/users');
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Failed to load users (${res.status})`);
      }

      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users';
      console.error('Error loading users:', err);
      setStatus({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function updateForm<K extends keyof NewUserForm>(key: K, value: NewUserForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ type: 'idle', message: null });

    if (!form.email.trim() || !form.password || !form.confirmPassword) {
      setStatus({ type: 'error', message: 'Email and password are required.' });
      return;
    }

    if (form.password !== form.confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Creating user…' });

    try {
      const res = await fetch('/ops/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          displayName: form.displayName.trim() || null,
          isProvider: form.isProvider,
          canSign: form.canSign
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Failed to create user (${res.status})`);
      }

      setStatus({ type: 'success', message: 'User created successfully.' });
      setForm(initialForm);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create user.';
      console.error('Error creating user:', err);
      setStatus({ type: 'error', message: msg });
    }
  }

  async function handleRemove(userId: string, email: string) {
    const confirmed = window.confirm(
      `Remove user "${email}"?\n\n` +
      `They will be deactivated and can no longer log in.`
    );
    if (!confirmed) {
      return;
    }

    setStatus({ type: 'loading', message: `Removing ${email}…` });

    try {
      const res = await fetch('/ops/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Failed to remove user (${res.status})`);
      }

      setStatus({
        type: 'success',
        message: data?.message || `User ${email} removed successfully.`
      });
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove user.';
      console.error('Error removing user:', err);
      setStatus({ type: 'error', message: msg });
    }
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        User Administration
      </h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
        Manage dashboard logins for your operations team. Only admins can access this page.
      </p>

      <section
        style={{
          marginBottom: '2rem',
          padding: '1.25rem',
          borderRadius: '0.75rem',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          background: '#ffffff',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)'
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#0f172a' }}>
          Add New User
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '2fr 1fr' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569' }}>
                Email *
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => updateForm('email', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569' }}>
                Display Name
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => updateForm('displayName', e.target.value)}
                placeholder="e.g. Ops Manager"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569' }}>
                Password *
              </label>
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => updateForm('password', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569' }}>
                Confirm Password *
              </label>
              <input
                type="password"
                required
                value={form.confirmPassword}
                onChange={(e) => updateForm('confirmPassword', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#475569' }}>
                Role *
              </label>
              <select
                value={form.role}
                onChange={(e) => updateForm('role', e.target.value as UserRole)}
                style={{
                  minWidth: '160px',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)'
                }}
              >
                <option value="read">Read only (view)</option>
                <option value="write">Write (Ops staff)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#475569' }}>
              <input
                type="checkbox"
                checked={form.isProvider}
                onChange={(e) => updateForm('isProvider', e.target.checked)}
              />
              Provider
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#475569' }}>
              <input
                type="checkbox"
                checked={form.canSign}
                onChange={(e) => updateForm('canSign', e.target.checked)}
              />
              Can sign DEA dispenses
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="submit"
              disabled={status.type === 'loading'}
              style={{
                padding: '0.6rem 1.4rem',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: status.type === 'loading' ? '#94a3b8' : '#0ea5e9',
                color: '#0f172a',
                fontWeight: 600,
                cursor: status.type === 'loading' ? 'wait' : 'pointer'
              }}
            >
              {status.type === 'loading' ? 'Creating…' : 'Create User'}
            </button>

            {status.type === 'error' && (
              <span style={{ color: '#b91c1c', fontSize: '0.9rem' }}>{status.message}</span>
            )}
            {status.type === 'success' && (
              <span style={{ color: '#16a34a', fontSize: '0.9rem' }}>{status.message}</span>
            )}
          </div>
        </form>
      </section>

      <section
        style={{
          padding: '1.25rem',
          borderRadius: '0.75rem',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          background: '#ffffff',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>Existing Users</h2>
          <button
            type="button"
            onClick={() => void loadUsers()}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '999px',
              border: '1px solid rgba(148, 163, 184, 0.6)',
              background: '#f8fafc',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loading && users.length === 0 ? (
          <div style={{ padding: '1.25rem', color: '#64748b' }}>Loading users…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '1.25rem', color: '#64748b' }}>No users found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Role</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Flags</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Created</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{user.email}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{user.display_name || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textTransform: 'capitalize' }}>{user.role}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {user.is_provider ? 'Provider' : ''}
                        {user.is_provider && user.can_sign ? ' · ' : ''}
                        {user.can_sign ? 'Can sign' : ''}
                        {!user.is_provider && !user.can_sign ? '—' : ''}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                      {user.created_at
                        ? formatDateUTC(user.created_at)
                        : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => void handleRemove(user.user_id, user.email)}
                        style={{
                          padding: '0.25rem 0.7rem',
                          borderRadius: '999px',
                          border: '1px solid rgba(248, 113, 113, 0.9)',
                          backgroundColor: '#fef2f2',
                          color: '#b91c1c',
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


