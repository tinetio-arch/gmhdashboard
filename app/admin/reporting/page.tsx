import { redirect } from 'next/navigation';
import { getCurrentUser, userHasRole } from '@/lib/auth';

export const metadata = {
  title: 'GMH | Executive Dashboard'
};

export default async function ExecutiveDashboardPage() {
  const user = await getCurrentUser();

  if (!user || !userHasRole(user, 'admin')) {
    redirect('/unauthorized');
  }

  return (
    <section
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem'
      }}
    >
      <div>
        <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>Executive Dashboard</h1>
        <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: 1.6 }}>
          Real-time ClinicSync, Jane, and marketing metrics surfaced through Looker Studio for executive review.
          This view stays private to GMH administrators and mirrors the live ROI report you shared.
        </p>
      </div>

      <div
        style={{
          width: '100%',
          aspectRatio: '9 / 16',
          minHeight: '1100px',
          borderRadius: '1rem',
          overflow: 'hidden',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)'
        }}
      >
        <iframe
          src="https://lookerstudio.google.com/embed/reporting/bc7759ba-4825-49a0-b51d-2e3687b02526/page/E8kIF"
          title="GMH Executive Dashboard"
          width="100%"
          height="100%"
          frameBorder="0"
          allowFullScreen
          sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </section>
  );
}



