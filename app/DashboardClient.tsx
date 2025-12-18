"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  children: React.ReactNode;
};

export default function DashboardClient({ children }: Props) {
  const router = useRouter();
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Check if page is visible
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    setIsVisible(!document.hidden);

    // Auto-refresh every 30 seconds when page is visible
    const interval = setInterval(() => {
      if (isVisible) {
        // Use router.refresh() to re-fetch server components
        router.refresh();
        setLastUpdate(new Date());
      }
    }, 30000); // 30 seconds

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router, isVisible]);

  return (
    <>
      {children}
      <div style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        borderRadius: '0.5rem',
        fontSize: '0.75rem',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#10b981',
          animation: 'pulse 2s infinite'
        }} />
        <span>Auto-updating every 30s</span>
        <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>
          Last: {lastUpdate.toLocaleTimeString()}
        </span>
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}










