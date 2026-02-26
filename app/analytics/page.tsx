/**
 * Unified Analytics Dashboard Page
 * NEW PAGE - does not modify any existing dashboard code
 */
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import AnalyticsClient from './AnalyticsClient';

export const metadata: Metadata = {
    title: 'Analytics - GMH Dashboard',
    description: 'Real-time unified analytics for patients, integrations, financials, and system health',
};

export default async function AnalyticsPage() {
    // Require admin access
    await requireUser('admin');

    return <AnalyticsClient />;
}
