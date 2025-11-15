'use client';

import { useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getBasePath, withBasePath } from '@/lib/basePath';

type FormState = {
  email: string;
  password: string;
};

export default function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<FormState>({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const basePath = getBasePath();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload = {
      email: state.email,
      password: state.password
    };

    startTransition(async () => {
      try {
        const response = await fetch(withBasePath('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data?.error ?? 'Unable to sign in.');
        }
        router.replace('/');
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', color: '#0f172a', fontWeight: 600 }}>
        Email
        <input
          type="email"
          required
          value={state.email}
          onChange={(event) => setState((prev) => ({ ...prev, email: event.target.value.trim() }))}
          style={inputStyle}
          placeholder="you@example.com"
          autoComplete="username"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', color: '#0f172a', fontWeight: 600 }}>
        Password
        <input
          type="password"
          required
          value={state.password}
          onChange={(event) => setState((prev) => ({ ...prev, password: event.target.value }))}
          style={inputStyle}
          placeholder="••••••••••"
          autoComplete="current-password"
        />
      </label>

      {error && (
        <p style={{ color: '#b91c1c', background: 'rgba(248, 113, 113, 0.15)', padding: '0.75rem', borderRadius: '0.6rem' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        style={{
          padding: '0.85rem 1rem',
          borderRadius: '0.65rem',
          border: 'none',
          background: isPending ? 'rgba(148, 163, 184, 0.6)' : '#0ea5e9',
          color: '#0f172a',
          fontWeight: 700,
          cursor: isPending ? 'wait' : 'pointer',
          transition: 'background 0.2s ease'
        }}
      >
        {isPending ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}

const inputStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: '0.6rem',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  backgroundColor: '#ffffff',
  fontSize: '1rem',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)'
};

