export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import LabsDashboardClient from './LabsDashboardClient';

export const metadata: Metadata = {
    title: 'Labs Management - GMH Dashboard',
    description: 'Lab orders, results review, and critical alerts management',
};

import { getPool } from '@/lib/db';

// Load lab queue data
async function loadLabData() {
    const fs = await import('fs');

    const reviewQueueFile = '/home/ec2-user/gmhdashboard/data/labs-review-queue.json';

    let reviewQueue: any[] = [];
    let ordersQueue: any[] = [];

    // Load Review Queue from File (Legacy/Current implementation)
    try {
        const reviewData = await fs.promises.readFile(reviewQueueFile, 'utf-8');
        reviewQueue = JSON.parse(reviewData);
    } catch {
        reviewQueue = [];
    }

    // Load Orders from Database
    try {
        const pool = getPool();
        const res = await pool.query(`
            SELECT 
                id,
                clinic_id,
                patient_id,
                patient_first_name || ' ' || patient_last_name as patient_name,
                patient_first_name,
                patient_last_name,
                test_codes,
                status,
                priority,
                created_at,
                submitted_at,
                submission_error,
                ordering_provider
            FROM lab_orders
            ORDER BY created_at DESC
        `);

        ordersQueue = res.rows.map(row => ({
            id: row.id,
            patient: {
                first_name: row.patient_first_name,
                last_name: row.patient_last_name
            },
            tests: row.test_codes || [],
            priority: row.priority || 'ROUTINE',
            status: row.status,
            created_at: row.created_at.toISOString(),
            submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
            error: row.submission_error
        }));

    } catch (e) {
        console.error("Failed to load lab orders from DB:", e);
        ordersQueue = [];
    }

    return { reviewQueue, ordersQueue };
}

export default async function LabsPage() {
    await requireUser('read');

    const { reviewQueue, ordersQueue } = await loadLabData();

    // Calculate stats
    const pendingReview = reviewQueue.filter(i => i.status === 'pending_review').length;
    const approvedToday = reviewQueue.filter(i =>
        i.status === 'approved' &&
        i.uploaded_at &&
        new Date(i.uploaded_at).toDateString() === new Date().toDateString()
    ).length;

    const pendingOrders = ordersQueue.filter(o => o.status === 'pending').length;
    const submittedOrders = ordersQueue.filter(o => o.status === 'submitted').length;

    // Find critical results (high severity)
    const criticalResults = reviewQueue.filter(i =>
        i.status === 'pending_review' &&
        (i.tests_found?.some((t: string) => t.toLowerCase().includes('critical')) ||
            i.match_confidence && i.match_confidence < 0.5)
    );

    return (
        <section style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
            {/* Header */}
            <div style={{ marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div>
                        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#0f172a', fontWeight: 700 }}>
                            🧪 Labs Management
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '48rem' }}>
                            Manage lab orders, review incoming results, and track critical values.
                            Integrated with Access Medical Labs and Healthie.
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
                            ← Main Dashboard
                        </Link>
                        <Link
                            href="/patient-hub"
                            style={{
                                color: '#059669',
                                textDecoration: 'none',
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                padding: '0.5rem 1rem',
                                borderRadius: '0.5rem',
                                border: '1px solid #059669'
                            }}
                        >
                            Patient Hub →
                        </Link>
                    </div>
                </div>

                {/* Stats Bar moved to Client Component */}
            </div>

            {/* Pass data to client component */}
            <LabsDashboardClient
                reviewQueue={reviewQueue}
                ordersQueue={ordersQueue}
            />
        </section>
    );
}
