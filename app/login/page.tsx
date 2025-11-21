import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';
import { getCurrentUser } from '@/lib/auth';

export const metadata = {
  title: 'GMH Dashboard | Sign In'
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/ops');
  }

  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '2rem'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#ffffff',
          borderRadius: '1rem',
          padding: '2.25rem',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
          border: '1px solid rgba(148, 163, 184, 0.22)'
        }}
      >
        <header style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.9rem', margin: 0, color: '#0f172a', fontWeight: 700 }}>Sign in to GMH Ops</h1>
          <p style={{ margin: '0.75rem 0 0', color: '#64748b', fontSize: '0.95rem' }}>
            Manage patient operations, inventory, and DEA compliance securely.
          </p>
        </header>

        <LoginForm />
      </div>
    </section>
  );
}





