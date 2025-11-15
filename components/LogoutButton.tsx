'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/basePath';

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSignOut = () => {
    startTransition(async () => {
      await fetch(withBasePath('/api/auth/logout'), { method: 'POST' });
      router.replace('/login');
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isPending}
      style={{
        padding: '0.45rem 0.9rem',
        borderRadius: '0.6rem',
        border: '1px solid rgba(148, 163, 184, 0.4)',
        backgroundColor: isPending ? 'rgba(148, 163, 184, 0.2)' : '#f1f5f9',
        color: '#0f172a',
        fontWeight: 600,
        cursor: isPending ? 'wait' : 'pointer'
      }}
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

