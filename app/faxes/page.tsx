export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import FaxesDashboardClient from './FaxesDashboardClient';
import { getPool } from '@/lib/db';

export const metadata: Metadata = {
    title: 'Faxes - GMH Dashboard',
    description: 'Review and approve incoming faxes',
};

interface FaxQueueItem {
    id: string;
    s3_key: string;
    from_address: string;
    subject: string;
    body_text: string;
    pdf_s3_key: string | null;
    received_at: string;
    ai_summary: string | null;
    ai_fax_type: string | null;
    ai_patient_name: string | null;
    ai_sending_facility: string | null;
    ai_urgency: string | null;
    ai_key_findings: string[] | null;
    healthie_patient_id: string | null;
    status: string;
    approved_at: string | null;
}

async function loadFaxQueue(): Promise<FaxQueueItem[]> {
    try {
        const pool = getPool();
        const result = await pool.query(`
            SELECT 
                id, s3_key, from_address, subject, 
                LEFT(body_text, 500) as body_text,
                pdf_s3_key, received_at,
                ai_summary, ai_fax_type, ai_patient_name, 
                ai_sending_facility, ai_urgency, ai_key_findings,
                healthie_patient_id, status, approved_at
            FROM fax_queue
            ORDER BY received_at DESC
            LIMIT 100
        `);

        return result.rows.map(row => ({
            ...row,
            received_at: row.received_at?.toISOString() || null,
            approved_at: row.approved_at?.toISOString() || null,
        }));
    } catch (error) {
        console.error('Failed to load fax queue:', error);
        return [];
    }
}

export default async function FaxesPage() {
    await requireUser('read');

    const faxQueue = await loadFaxQueue();

    const pending = faxQueue.filter(f => f.status === 'pending_review').length;
    const approved = faxQueue.filter(f => f.status === 'approved').length;

    return (
        <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
            {/* Header */}
            <div style={{ marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div>
                        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
                            📠 Fax Management
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
                            Review incoming faxes. Approve to upload to patient's Healthie chart.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <Link
                            href="/"
                            style={{
                                color: '#0ea5e9',
                                textDecoration: 'none',
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                padding: '0.5rem 1rem',
                                borderRadius: '0.5rem',
                                border: '1px solid #0ea5e9'
                            }}
                        >
                            ← Dashboard
                        </Link>
                    </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <div style={{
                        padding: '1rem 1.5rem',
                        backgroundColor: '#fef3c7',
                        borderRadius: '0.5rem',
                        border: '1px solid #f59e0b'
                    }}>
                        <span style={{ fontWeight: 700, fontSize: '1.5rem', color: '#b45309' }}>{pending}</span>
                        <span style={{ marginLeft: '0.5rem', color: '#92400e' }}>Pending Review</span>
                    </div>
                    <div style={{
                        padding: '1rem 1.5rem',
                        backgroundColor: '#d1fae5',
                        borderRadius: '0.5rem',
                        border: '1px solid #10b981'
                    }}>
                        <span style={{ fontWeight: 700, fontSize: '1.5rem', color: '#047857' }}>{approved}</span>
                        <span style={{ marginLeft: '0.5rem', color: '#065f46' }}>Approved</span>
                    </div>
                </div>
            </div>

            <FaxesDashboardClient faxQueue={faxQueue} />
        </section>
    );
}
