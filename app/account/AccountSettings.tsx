'use client';

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { withBasePath } from '@/lib/basePath';

type Props = {
  initialDisplayName: string | null;
  email: string;
};

type AlertState =
  | { type: 'idle' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

export default function AccountSettings({ initialDisplayName, email }: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [profileAlert, setProfileAlert] = useState<AlertState>({ type: 'idle' });
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordAlert, setPasswordAlert] = useState<AlertState>({ type: 'idle' });
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileAlert({ type: 'idle' });
    setProfileBusy(true);
    try {
      const response = await fetch(withBasePath('/api/account/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim() || null })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to update name.');
      }
      setProfileAlert({ type: 'success', message: 'Profile updated.' });
    } catch (error) {
      setProfileAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setProfileBusy(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordAlert({ type: 'idle' });
    if (newPassword !== confirmPassword) {
      setPasswordAlert({ type: 'error', message: 'Passwords do not match.' });
      return;
    }
    if (newPassword.length < 12) {
      setPasswordAlert({ type: 'error', message: 'Password must be at least 12 characters long.' });
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch(withBasePath('/api/account/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword || undefined,
          newPassword
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to change password.');
      }
      setPasswordAlert({
        type: 'success',
        message: 'Password updated. You may be asked to sign in again.'
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordAlert({ type: 'error', message: (error as Error).message });
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '2rem' }}>
      <section style={cardStyle}>
        <header>
          <h3 style={cardTitleStyle}>Profile</h3>
          <p style={cardSubtitleStyle}>Update your display name. Email address changes are handled by an administrator.</p>
        </header>
        <form onSubmit={handleProfileSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <label style={labelStyle}>
            Email
            <input type="email" value={email} readOnly style={{ ...inputStyle, backgroundColor: '#f1f5f9' }} />
          </label>
          <label style={labelStyle}>
            Display Name
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              style={inputStyle}
              placeholder="Your name"
              maxLength={120}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={profileBusy} style={primaryButton(profileBusy)}>
              {profileBusy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
          {profileAlert.type !== 'idle' && (
            <p style={alertStyle(profileAlert)}>{profileAlert.message}</p>
          )}
        </form>
      </section>

      <section style={cardStyle}>
        <header>
          <h3 style={cardTitleStyle}>Password</h3>
          <p style={cardSubtitleStyle}>Minimum 12 characters. Password updates will log out other active sessions.</p>
        </header>
        <form onSubmit={handlePasswordSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <label style={labelStyle}>
            Current Password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            New Password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              style={inputStyle}
              required
              minLength={12}
            />
          </label>
          <label style={labelStyle}>
            Confirm New Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              style={inputStyle}
              required
              minLength={12}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={passwordBusy} style={primaryButton(passwordBusy)}>
              {passwordBusy ? 'Updating…' : 'Change Password'}
            </button>
          </div>
          {passwordAlert.type !== 'idle' && (
            <p style={alertStyle(passwordAlert)}>{passwordAlert.message}</p>
          )}
        </form>
      </section>
    </div>
  );
}

const cardStyle: CSSProperties = {
  padding: '1.8rem',
  borderRadius: '0.9rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  backgroundColor: '#ffffff',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  display: 'grid',
  gap: '1.25rem'
};

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.4rem',
  color: '#0f172a'
};

const cardSubtitleStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  color: '#64748b'
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  color: '#475569',
  fontWeight: 600
};

const inputStyle: CSSProperties = {
  padding: '0.65rem 0.85rem',
  borderRadius: '0.65rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  fontSize: '0.95rem',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
};

function primaryButton(disabled: boolean): CSSProperties {
  return {
    padding: '0.65rem 1.4rem',
    borderRadius: '0.6rem',
    border: 'none',
    backgroundColor: disabled ? 'rgba(14, 165, 233, 0.35)' : '#0ea5e9',
    color: '#0f172a',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer'
  };
}

function alertStyle(alert: AlertState): CSSProperties {
  return {
    margin: 0,
    color: alert.type === 'error' ? '#b91c1c' : '#047857',
    fontWeight: 600
  };
}




