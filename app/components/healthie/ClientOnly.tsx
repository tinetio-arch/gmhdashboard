'use client';
import { ReactNode } from 'react';
import { useHydrated } from './useHydrated';

export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useHydrated() ? <>{children}</> : <>{fallback}</>;
}
