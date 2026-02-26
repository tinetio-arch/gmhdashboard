import Link from 'next/link';

export default function MensHealthSOPs() {
    const sops = [
        {
            title: 'AI Scribe System SOP',
            description: 'Recording visits, Telegram approval, document injection',
            filename: 'SOP-AI-Scribe.pdf',
            icon: '🎤'
        },
        {
            title: 'Pre-Filled Doses SOP',
            description: 'How to prepare, use, and remove staged doses',
            filename: 'SOP-PreFilled-Doses.pdf',
            icon: '💉'
        },
        {
            title: 'Inventory Check SOP',
            description: 'Morning and EOD controlled substance checks',
            filename: 'SOP-Inventory-Check.pdf',
            icon: '📦'
        },
        {
            title: 'QuickBooks Override SOP',
            description: 'Dispensing to QuickBooks patients with override',
            filename: 'SOP-QuickBooks-Override.pdf',
            icon: '💳'
        },
        {
            title: 'Lab Management System',
            description: 'Ordering labs, reviewing results, and patient management',
            filename: 'SOP-Lab-System.pdf',
            icon: '🧪'
        },
        {
            title: 'Fax Processing System',
            description: 'Review incoming faxes and upload to patient charts',
            filename: 'SOP-Fax-System.pdf',
            icon: '📠'
        },
        {
            title: 'Pharmacy Tracking System',
            description: 'Specialty pharmacy orders, patient linking, and chart uploads',
            filename: 'SOP-Pharmacy-Tracking.html',
            icon: '💊'
        }
    ];

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1d30 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem'
        }}>
            <div style={{
                background: 'white',
                borderRadius: '1rem',
                padding: '2.5rem',
                maxWidth: '500px',
                width: '100%',
                boxShadow: '0 25px 50px rgba(0,0,0,0.3)'
            }}>
                <h1 style={{
                    color: '#0f172a',
                    fontSize: '1.5rem',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                }}>
                    📋 Men&apos;s Health SOPs
                </h1>
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Standard Operating Procedures for Clinical Staff
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sops.map((sop) => (
                        <a
                            key={sop.filename}
                            href={`/ops/menshealth/${sop.filename}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '1rem',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '0.5rem',
                                textDecoration: 'none',
                                color: '#0f172a',
                                transition: 'all 0.2s'
                            }}
                        >
                            <span style={{ fontSize: '2rem' }}>{sop.icon}</span>
                            <div>
                                <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{sop.title}</h3>
                                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>{sop.description}</p>
                            </div>
                        </a>
                    ))}
                </div>

                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', marginTop: '1.5rem' }}>
                    Last updated: January 28, 2026
                </p>

                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <Link href="/" style={{ fontSize: '0.85rem', color: '#0ea5e9' }}>
                        ← Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
