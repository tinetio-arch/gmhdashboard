'use client';

import React, { useState } from 'react';

export default function PaymentCheckerButton() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    setMessage(null);
    setError(null);
    setChecking(true);
    try {
      // Check both Jane and QuickBooks
      const [janeResponse, qbResponse] = await Promise.allSettled([
        fetch('/ops/api/admin/jane/check-payment-failures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch('/ops/api/admin/quickbooks/check-payment-failures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      const results: string[] = [];
      
      if (janeResponse.status === 'fulfilled' && janeResponse.value.ok) {
        const janeData = await janeResponse.value.json();
        const summary = janeData?.summary ?? {};
        results.push(`Jane: ${summary.issuesCreated ?? 0} new, ${summary.issuesResolved ?? 0} resolved`);
      }

      if (qbResponse.status === 'fulfilled' && qbResponse.value.ok) {
        const qbData = await qbResponse.value.json();
        const summary = qbData?.summary ?? {};
        results.push(`QuickBooks: ${summary.issuesCreated ?? 0} new, ${summary.issuesResolved ?? 0} resolved`);
      }

      if (results.length > 0) {
        setMessage(`Payment check complete. ${results.join('; ')}`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setError('Payment check completed but no results returned.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment check failed. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{
      padding: '1rem',
      borderRadius: '0.75rem',
      background: '#ffffff',
      border: '2px solid #dc2626',
      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.15)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
            💳 Payment Checker
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Check for payment failures across all systems
          </div>
        </div>
        <button
          onClick={handleCheck}
          disabled={checking}
          style={{
            padding: '0.6rem 1.25rem',
            borderRadius: '0.6rem',
            background: checking ? '#94a3b8' : '#dc2626',
            color: '#ffffff',
            fontWeight: 600,
            border: 'none',
            cursor: checking ? 'wait' : 'pointer',
            boxShadow: checking ? 'none' : '0 4px 12px rgba(220, 38, 38, 0.3)',
            fontSize: '0.85rem',
          }}
        >
          {checking ? 'Checking...' : 'Run Payment Check'}
        </button>
      </div>
      {message && (
        <div style={{
          padding: '0.5rem',
          borderRadius: '0.5rem',
          background: '#ecfdf5',
          border: '1px solid #10b981',
          color: '#047857',
          fontSize: '0.8rem',
          marginTop: '0.5rem',
        }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{
          padding: '0.5rem',
          borderRadius: '0.5rem',
          background: '#fef2f2',
          border: '1px solid #ef4444',
          color: '#b91c1c',
          fontSize: '0.8rem',
          marginTop: '0.5rem',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}




