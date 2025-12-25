'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { HealthieProvider, ConversationList, Chat, Form } from '@healthie/sdk';
import { ClientOnly } from '@/app/components/healthie/ClientOnly';
import '@healthie/sdk/dist/styles/index.css';

const ApolloForHealthie = dynamic(
  () => import('@/app/components/healthie/ApolloForHealthie').then((mod) => mod.ApolloForHealthie),
  {
    ssr: false,
    loading: () => <div style={{ padding: '1rem' }}>Loading chat…</div>
  }
);

type ChatPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function HealthieChatPage({ searchParams }: ChatPageProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const healthieUserId = (searchParams?.userId as string) || process.env.NEXT_PUBLIC_HEALTHIE_USER_ID || '';
  const formId = (searchParams?.formId as string) || process.env.NEXT_PUBLIC_HEALTHIE_FORM_ID || '';
  const brandedUrl = process.env.NEXT_PUBLIC_HEALTHIE_BRANDED_URL;
  const brandedBackendUrl = process.env.NEXT_PUBLIC_HEALTHIE_BRANDED_BACKEND_URL;
  const healthieToken = process.env.NEXT_PUBLIC_HEALTHIE_TOKEN;

  const readyState = useMemo(() => {
    if (!healthieToken) return { ok: false, reason: 'Missing NEXT_PUBLIC_HEALTHIE_TOKEN' } as const;
    if (!healthieUserId) return { ok: false, reason: 'Provide a Healthie userId (query ?userId= or env NEXT_PUBLIC_HEALTHIE_USER_ID)' } as const;
    return { ok: true } as const;
  }, [healthieToken, healthieUserId]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>Healthie Chat & Forms</h1>
      <p style={{ marginBottom: '1.5rem', color: '#475569' }}>
        Conversations, chat, and form rendering powered by the Healthie SDK. Pass ?userId=&formId= in the URL or set
        NEXT_PUBLIC_HEALTHIE_USER_ID / NEXT_PUBLIC_HEALTHIE_FORM_ID.
      </p>

      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '0.75rem',
          padding: '0.9rem 1rem',
          marginBottom: '1rem',
          background: readyState.ok ? '#f8fafc' : '#fff7ed',
          color: readyState.ok ? '#0f172a' : '#c2410c'
        }}
      >
        {readyState.ok ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            Ready — using userId "{healthieUserId}"{brandedUrl ? ` · branded domain ${brandedUrl}` : ''}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
            {readyState.reason}
          </div>
        )}
      </div>

      <ClientOnly fallback={<div>Loading…</div>}>
        <ApolloForHealthie>
          <HealthieProvider
            userId={healthieUserId}
            brandedUrl={brandedUrl}
            brandedBackendUrl={brandedBackendUrl}
          >
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '320px 1fr' }}>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', overflow: 'hidden' }}>
                <ConversationList
                  onConversationClick={(id) => setActiveConversationId(id)}
                  activeId={activeConversationId}
                />
              </div>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', minHeight: '360px', opacity: readyState.ok ? 1 : 0.4 }}>
                  {readyState.ok ? (
                    <Chat conversationId={activeConversationId || undefined} />
                  ) : (
                    <div style={{ padding: '1rem', color: '#c2410c' }}>Set a valid Healthie token and userId to load chat.</div>
                  )}
                </div>
                {formId ? (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem', opacity: readyState.ok ? 1 : 0.4 }}>
                    {readyState.ok ? <Form id={formId} /> : <div style={{ color: '#c2410c' }}>Form requires a valid token/userId.</div>}
                  </div>
                ) : (
                  <div style={{ color: '#c2410c', fontSize: '0.95rem' }}>
                    Provide a Form ID via ?formId=… or NEXT_PUBLIC_HEALTHIE_FORM_ID to render a form.
                  </div>
                )}
              </div>
            </div>
          </HealthieProvider>
        </ApolloForHealthie>
      </ClientOnly>
    </div>
  );
}
