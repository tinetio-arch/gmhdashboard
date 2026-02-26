/**
 * Patient Pipeline API - Funnel visualization of patient lifecycle
 * 
 * Shows patients across stages:
 * - New (this week/month)
 * - Active
 * - On Hold (payment, other)
 * - Inactive/Churned
 * 
 * Includes drill-down capability to see patients at each stage
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface PipelineStage {
    stage: string;
    count: number;
    percentOfTotal: number;
    change7d: number; // +/- vs last week
    patients?: PatientSummary[];
}

interface PatientSummary {
    id: string;
    name: string;
    status: string;
    dateAdded: string;
    clientType: string;
    lastActivity?: string;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const includePatients = searchParams.get('includePatients') === 'true';
    const stage = searchParams.get('stage'); // Filter to specific stage

    try {
        // Get all patient status counts
        const statusCounts = await query<{ status_key: string; status: string; count: string }>(`
            SELECT 
                COALESCE(status_key, 'unknown') as status_key,
                COALESCE(status, 'Unknown') as status,
                COUNT(*) as count
            FROM patients
            GROUP BY status_key, status
            ORDER BY count DESC
        `);

        // Get new patients counts
        const newCounts = await query<{ period: string; count: string }>(`
            SELECT 
                CASE 
                    WHEN date_added >= CURRENT_DATE - 7 THEN 'week'
                    WHEN date_added >= CURRENT_DATE - 30 THEN 'month'
                    ELSE 'older'
                END as period,
                COUNT(*) as count
            FROM patients
            GROUP BY 
                CASE 
                    WHEN date_added >= CURRENT_DATE - 7 THEN 'week'
                    WHEN date_added >= CURRENT_DATE - 30 THEN 'month'
                    ELSE 'older'
                END
        `);

        // Get weekly comparison
        const priorWeek = await query<{ count: string }>(`
            SELECT COUNT(*) as count
            FROM patients
            WHERE date_added >= CURRENT_DATE - 14 AND date_added < CURRENT_DATE - 7
        `);

        // Categorize into pipeline stages
        let activeCount = 0;
        let holdCount = 0;
        let inactiveCount = 0;
        let otherCount = 0;

        for (const row of statusCounts) {
            const count = parseInt(row.count);
            const statusKey = (row.status_key || '').toLowerCase();
            const status = (row.status || '').toLowerCase();

            if (statusKey === 'inactive' || status.includes('inactive') || status.includes('churned')) {
                inactiveCount += count;
            } else if (statusKey.includes('hold') || status.includes('hold')) {
                holdCount += count;
            } else if (statusKey === 'active' || !statusKey || statusKey === 'unknown') {
                activeCount += count;
            } else {
                otherCount += count;
            }
        }

        const totalPatients = activeCount + holdCount + inactiveCount + otherCount;
        const newThisWeek = parseInt(newCounts.find(n => n.period === 'week')?.count || '0');
        const newThisMonth = parseInt(newCounts.find(n => n.period === 'month')?.count || '0') + newThisWeek;
        const priorWeekNew = parseInt(priorWeek[0]?.count || '0');

        const pipeline: PipelineStage[] = [
            {
                stage: 'New (This Week)',
                count: newThisWeek,
                percentOfTotal: totalPatients > 0 ? (newThisWeek / totalPatients * 100) : 0,
                change7d: newThisWeek - priorWeekNew
            },
            {
                stage: 'Active',
                count: activeCount,
                percentOfTotal: totalPatients > 0 ? (activeCount / totalPatients * 100) : 0,
                change7d: 0 // Would need historical data
            },
            {
                stage: 'On Hold',
                count: holdCount,
                percentOfTotal: totalPatients > 0 ? (holdCount / totalPatients * 100) : 0,
                change7d: 0
            },
            {
                stage: 'Inactive',
                count: inactiveCount,
                percentOfTotal: totalPatients > 0 ? (inactiveCount / totalPatients * 100) : 0,
                change7d: 0
            }
        ];

        // If requesting patients for a specific stage
        if (includePatients && stage) {
            let whereClause = '';
            switch (stage.toLowerCase()) {
                case 'new':
                    whereClause = "date_added >= CURRENT_DATE - 7";
                    break;
                case 'active':
                    whereClause = "(status_key IS NULL OR status_key = 'active' OR status_key = 'unknown') AND status_key != 'inactive'";
                    break;
                case 'hold':
                    whereClause = "status_key ILIKE '%hold%' OR status ILIKE '%hold%'";
                    break;
                case 'inactive':
                    whereClause = "status_key = 'inactive' OR status ILIKE '%inactive%' OR status ILIKE '%churned%'";
                    break;
                default:
                    whereClause = "1=1";
            }

            // Use correct columns: patient_id, full_name
            const patients = await query<{
                patient_id: string;
                full_name: string;
                status: string;
                date_added: string;
                client_type_key: string;
            }>(`
                SELECT 
                    patient_id,
                    COALESCE(full_name, 'Unknown') as full_name,
                    COALESCE(status, 'Unknown') as status,
                    date_added,
                    COALESCE(client_type_key, 'unknown') as client_type_key
                FROM patients
                WHERE ${whereClause}
                ORDER BY date_added DESC
                LIMIT 50
            `);

            const stageIndex = pipeline.findIndex(p =>
                p.stage.toLowerCase().includes(stage.toLowerCase())
            );

            if (stageIndex >= 0) {
                pipeline[stageIndex].patients = patients.map(p => ({
                    id: p.patient_id,
                    name: p.full_name || 'Unknown',
                    status: p.status,
                    dateAdded: p.date_added,
                    clientType: p.client_type_key
                }));
            }
        }


        // Get hold breakdown for actionable insights
        const holdBreakdown = await query<{ status: string; count: string }>(`
            SELECT status, COUNT(*) as count
            FROM patients
            WHERE status_key ILIKE '%hold%' OR status ILIKE '%hold%'
            GROUP BY status
            ORDER BY count DESC
        `);

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            summary: {
                total: totalPatients,
                active: activeCount,
                hold: holdCount,
                inactive: inactiveCount,
                newThisWeek,
                newThisMonth
            },
            pipeline,
            holdBreakdown: holdBreakdown.map(h => ({
                status: h.status,
                count: parseInt(h.count)
            })),
            metrics: {
                retentionRate: totalPatients > 0
                    ? ((activeCount / (activeCount + inactiveCount)) * 100).toFixed(1)
                    : '0',
                holdRate: totalPatients > 0
                    ? ((holdCount / totalPatients) * 100).toFixed(1)
                    : '0',
                weeklyGrowth: priorWeekNew > 0
                    ? (((newThisWeek - priorWeekNew) / priorWeekNew) * 100).toFixed(1)
                    : '0'
            }
        });

    } catch (error) {
        console.error('Patient pipeline error:', error);
        return NextResponse.json({
            error: 'Failed to fetch patient pipeline',
            details: String(error)
        }, { status: 500 });
    }
}
