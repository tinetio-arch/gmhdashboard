import Link from 'next/link';

export const metadata = {
  title: 'Access Denied'
};

export default function UnauthorizedPage() {
  return (
    <section style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div
        style={{
          maxWidth: '520px',
          background: '#ffffff',
          padding: '2rem',
          borderRadius: '1rem',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)',
          textAlign: 'center'
        }}
      >
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#0f172a' }}>Access denied</h1>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
          You do not have permission to access this resource. If you believe this is a mistake, please contact an
          administrator.
        </p>
        <Link
          href="/ops"
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.6rem',
            background: '#0ea5e9',
            color: '#0f172a',
            fontWeight: 600
          }}
        >
          Return to dashboard
        </Link>
      </div>
    </section>
  );
}



