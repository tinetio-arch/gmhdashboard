'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PublicUser, UserRole } from '@/lib/auth';
import { withBasePath } from '@/lib/basePath';

type Props = {
  initialUsers: PublicUser[];
  currentUserId: string;
};

type CreateState = {
  email: string;
  displayName: string;
  role: UserRole;
  password: string;
  isProvider: boolean;
  canSign: boolean;
};

type AlertState = { type: 'idle' } | { type: 'success'; message: string } | { type: 'error'; message: string };

type UserDraft = {
  email: string;
  displayName: string;
  isProvider: boolean;
  canSign: boolean;
};

function buildDraftMap(list: PublicUser[]): Record<string, UserDraft> {
  return list.reduce((acc, user) => {
    acc[user.user_id] = {
      email: user.email,
      displayName: user.display_name ?? '',
      isProvider: user.is_provider,
      canSign: user.can_sign
    };
    return acc;
  }, {} as Record<string, UserDraft>);
}

export default function UsersAdminPanel({ initialUsers, currentUserId }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>(() => buildDraftMap(initialUsers));
  const [creating, setCreating] = useState<CreateState>({
    email: '',
    displayName: '',
    role: 'write',
    password: '',
    isProvider: false,
    canSign: false
  });
  const [alert, setAlert] = useState<AlertState>({ type: 'idle' });
  const [busy, setBusy] = useState(false);

  const adminCount = useMemo(() => users.filter((user) => user.role === 'admin' && user.is_active).length, [users]);

  async function refreshUsers() {
    const response = await fetch(withBasePath('/api/admin/users'));
    if (!response.ok) {
      throw new Error('Unable to refresh users.');
    }
    const data = await response.json();
    setUsers(data.users);
    setDrafts(buildDraftMap(data.users));
  }

  function updateDraft(userId: string, field: keyof UserDraft, value: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      const base = users.find((user) => user.user_id === userId);
      const current =
        next[userId] ??
        {
          email: base?.email ?? '',
          displayName: base?.display_name ?? '',
          isProvider: base?.is_provider ?? false,
          canSign: base?.can_sign ?? false
        };
      next[userId] = {
        ...current,
        [field]: value
      };
      return next;
    });
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAlert({ type: 'idle' });
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: creating.email.trim(),
          displayName: creating.displayName.trim() || null,
          role: creating.role,
          password: creating.password,
          isProvider: creating.isProvider,
          canSign: creating.canSign
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to create user.');
      }
      setAlert({ type: 'success', message: `User ${payload.user.email} created.` });
      setCreating({ email: '', displayName: '', role: 'write', password: '', isProvider: false, canSign: false });
      await refreshUsers();
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(userId: string, role: UserRole) {
    setAlert({ type: 'idle' });
    setBusy(true);
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Role update failed.');
      }
      await refreshUsers();
      setAlert({ type: 'success', message: 'Role updated.' });
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(userId: string, isActive: boolean) {
    setAlert({ type: 'idle' });
    setBusy(true);
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isActive })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Activation update failed.');
      }
      await refreshUsers();
      setAlert({ type: 'success', message: `User ${isActive ? 'activated' : 'deactivated'}.` });
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveIdentity(userId: string) {
    const draft = drafts[userId];
    const email = (draft?.email ?? '').trim().toLowerCase();
    const displayName = (draft?.displayName ?? '').trim();
    if (!email) {
      setAlert({ type: 'error', message: 'Email is required.' });
      return;
    }

    setAlert({ type: 'idle' });
    setBusy(true);
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email,
          displayName: displayName || null
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to update user details.');
      }
      setAlert({ type: 'success', message: 'User profile updated.' });
      await refreshUsers();
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string) {
    const password = window.prompt('Enter a temporary password (minimum 12 characters):');
    if (!password) {
      return;
    }
    if (password.length < 12) {
      setAlert({ type: 'error', message: 'Password must be at least 12 characters.' });
      return;
    }
    setBusy(true);
    setAlert({ type: 'idle' });
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to reset password.');
      }
      setAlert({ type: 'success', message: 'Password updated. Provide the temporary password to the user securely.' });
      await refreshUsers();
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(userId: string) {
    if (!window.confirm('Permanently remove this user? Their active sessions will be revoked.')) {
      return;
    }
    setBusy(true);
    setAlert({ type: 'idle' });
    try {
      const response = await fetch(withBasePath(`/api/admin/users?userId=${encodeURIComponent(userId)}`), {
        method: 'DELETE'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Deletion failed.');
      }
      setAlert({ type: 'success', message: 'User deleted.' });
      await refreshUsers();
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function updateFlags(userId: string, changes: Partial<Pick<UserDraft, 'isProvider' | 'canSign'>>) {
    setAlert({ type: 'idle' });
    setBusy(true);
    try {
      const response = await fetch(withBasePath('/api/admin/users'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...changes })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Update failed.');
      }
      await refreshUsers();
      setAlert({ type: 'success', message: 'Access updated.' });
    } catch (error) {
      setAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '2rem' }}>
      <form
        onSubmit={handleCreate}
        style={{
          display: 'grid',
          gap: '1rem',
          padding: '1.5rem',
          borderRadius: '0.85rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
          backgroundColor: '#ffffff'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#0f172a' }}>Create User</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <label style={labelStyle}>
            Email *
            <input
              type="email"
              value={creating.email}
              onChange={(event) => setCreating((prev) => ({ ...prev, email: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            Display Name
            <input
              type="text"
              value={creating.displayName}
              onChange={(event) => setCreating((prev) => ({ ...prev, displayName: event.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Role *
            <select
              value={creating.role}
              onChange={(event) => {
                const value = event.target.value as UserRole;
                setCreating((prev) => ({
                  ...prev,
                  role: value,
                  isProvider: value === 'admin' ? true : prev.isProvider,
                  canSign: value === 'admin' ? true : prev.canSign
                }));
              }}
              style={inputStyle}
            >
              <option value="admin">Administrator</option>
              <option value="write">Write</option>
              <option value="read">Read</option>
            </select>
          </label>
          <label style={labelStyle}>
            Initial Password *
            <input
              type="password"
              value={creating.password}
              minLength={12}
              onChange={(event) => setCreating((prev) => ({ ...prev, password: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '200px' }}>
            <label style={booleanInputStyle(busy)}>
              <input
                type="checkbox"
                checked={creating.isProvider}
                onChange={(event) =>
                  setCreating((prev) => ({ ...prev, isProvider: event.target.checked, canSign: event.target.checked || prev.canSign }))
                }
              />
              Provider
            </label>
            <label style={booleanInputStyle(busy)}>
              <input
                type="checkbox"
                checked={creating.canSign}
                onChange={(event) => setCreating((prev) => ({ ...prev, canSign: event.target.checked }))}
              />
              Can Sign
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: '0.65rem 1.6rem',
              borderRadius: '0.6rem',
              border: 'none',
              backgroundColor: busy ? 'rgba(14, 165, 233, 0.35)' : '#0ea5e9',
              color: '#0f172a',
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer'
            }}
          >
            {busy ? 'Creating…' : 'Create User'}
          </button>
        </div>
        {alert.type !== 'idle' && (
          <p
            style={{
              margin: 0,
              color: alert.type === 'error' ? '#b91c1c' : '#047857',
              fontWeight: 600
            }}
          >
            {alert.message}
          </p>
        )}
      </form>

      <div
        style={{
          borderRadius: '0.85rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
          overflowX: 'auto'
        }}
      >
        <table style={{ minWidth: 960, width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {['Email', 'Display Name', 'Role', 'Provider', 'Can Sign', 'Status', 'Created', 'Updated', 'Actions'].map((header) => (
                <th key={header} style={tableHeaderStyle}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const draft = drafts[user.user_id] ?? {
                email: user.email,
                displayName: user.display_name ?? '',
                isProvider: user.is_provider,
                canSign: user.can_sign
              };
              const normalizedEmail = draft.email.trim().toLowerCase();
              const identityDirty =
                normalizedEmail !== user.email ||
                draft.displayName.trim() !== (user.display_name ?? '');

              return (
                <tr key={user.user_id}>
                  <td style={tableCellStyle}>
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) => updateDraft(user.user_id, 'email', event.target.value)}
                      style={inputStyle}
                      disabled={busy}
                    />
                  </td>
                  <td style={tableCellStyle}>
                    <input
                      type="text"
                      value={draft.displayName}
                      onChange={(event) => updateDraft(user.user_id, 'displayName', event.target.value)}
                      style={inputStyle}
                      disabled={busy}
                      placeholder="Display name"
                    />
                  </td>
                  <td style={tableCellStyle}>
                    <select
                      value={user.role}
                      onChange={(event) => updateRole(user.user_id, event.target.value as UserRole)}
                      style={selectStyle}
                      disabled={busy || user.user_id === currentUserId}
                    >
                      <option value="admin">Administrator</option>
                      <option value="write">Write</option>
                      <option value="read">Read</option>
                    </select>
                  </td>
                  <td style={tableCellStyle}>
                    <label style={booleanInputStyle(busy)}>
                      <input
                        type="checkbox"
                        checked={user.is_provider}
                        disabled={busy}
                        onChange={(event) => updateFlags(user.user_id, { isProvider: event.target.checked })}
                      />
                      Provider
                    </label>
                  </td>
                  <td style={tableCellStyle}>
                    <label style={booleanInputStyle(busy)}>
                      <input
                        type="checkbox"
                        checked={user.can_sign}
                        disabled={busy}
                        onChange={(event) => updateFlags(user.user_id, { canSign: event.target.checked })}
                      />
                      Can Sign
                    </label>
                  </td>
                  <td style={tableCellStyle}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: user.is_active ? '#047857' : '#b91c1c' }}>
                      <input
                        type="checkbox"
                        checked={user.is_active}
                        onChange={(event) => toggleActive(user.user_id, event.target.checked)}
                        disabled={busy || (user.role === 'admin' && adminCount <= 1)}
                      />
                      {user.is_active ? 'Active' : 'Inactive'}
                    </label>
                  </td>
                  <td style={tableCellStyle}>{new Date(user.created_at).toLocaleString()}</td>
                  <td style={tableCellStyle}>{new Date(user.updated_at).toLocaleString()}</td>
                  <td style={tableCellStyle}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => saveIdentity(user.user_id)}
                        disabled={busy || !identityDirty}
                        style={{
                          ...primaryButtonStyle,
                          opacity: identityDirty ? 1 : 0.6,
                          cursor: busy || !identityDirty ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Save Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => resetPassword(user.user_id)}
                        disabled={busy}
                        style={secondaryButtonStyle}
                      >
                        Reset Password
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteUser(user.user_id)}
                        disabled={busy || user.user_id === currentUserId || (user.role === 'admin' && adminCount <= 1)}
                        style={dangerButtonStyle}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  color: '#475569',
  fontWeight: 600,
  flex: '1 1 220px'
};

const inputStyle: CSSProperties = {
  padding: '0.6rem 0.8rem',
  borderRadius: '0.6rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  fontSize: '0.95rem',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
};

const tableHeaderStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  backgroundColor: '#f1f5f9',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  color: '#475569',
  textTransform: 'uppercase',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  position: 'sticky',
  top: 0
};

const tableCellStyle: CSSProperties = {
  padding: '0.7rem 1rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
  color: '#0f172a',
  backgroundColor: '#ffffff'
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  padding: '0.45rem 0.6rem'
};

const primaryButtonStyle: CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(34, 197, 94, 0.35)',
  background: 'rgba(34, 197, 94, 0.18)',
  color: '#047857',
  fontWeight: 600,
  cursor: 'pointer'
};

const secondaryButtonStyle: CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(14, 165, 233, 0.3)',
  background: 'rgba(14, 165, 233, 0.15)',
  color: '#0284c7',
  fontWeight: 600,
  cursor: 'pointer'
};

const dangerButtonStyle: CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(248, 113, 113, 0.5)',
  background: 'rgba(248, 113, 113, 0.15)',
  color: '#b91c1c',
  fontWeight: 600,
  cursor: 'pointer'
};

function booleanInputStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: disabled ? '#94a3b8' : '#0f172a'
  };
}

