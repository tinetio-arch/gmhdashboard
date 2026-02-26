/**
 * Revenue Details API - Detailed revenue breakdown with date range support
 * 
 * Features:
 * - Date range filtering (7d, 30d, 90d, custom)
 * - Source breakdown (QuickBooks vs Healthie)
 * - Daily/weekly trends
 * - Top transactions list
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import * as fs from 'fs';

interface DailyRevenue {
    date: string;
    quickbooks: number;
    healthie: number;
    total: number;
}

interface Transaction {
    id: string;
    date: string;
    source: 'quickbooks' | 'healthie';
    amount: number;
    customer?: string;
    description?: string;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    try {
        // ==================== QUICKBOOKS REVENUE ====================
        let qbWhereClause = `receipt_date >= CURRENT_DATE - ${days}`;
        if (startDate && endDate) {
            qbWhereClause = `receipt_date >= '${startDate}' AND receipt_date <= '${endDate}'`;
        }

        // Summary
        const qbSummary = await query<{ total: string; count: string }>(`
            SELECT 
                COALESCE(SUM(amount), 0) as total,
                COUNT(*) as count
            FROM quickbooks_sales_receipts
            WHERE ${qbWhereClause}
        `);

        // Daily breakdown
        const qbDaily = await query<{ day: string; amount: string; count: string }>(`
            SELECT 
                TO_CHAR(receipt_date, 'YYYY-MM-DD') as day,
                SUM(amount) as amount,
                COUNT(*) as count
            FROM quickbooks_sales_receipts
            WHERE ${qbWhereClause}
            GROUP BY receipt_date::date
            ORDER BY day DESC
        `);

        // Recent transactions
        const qbTransactions = await query<{
            id: string;
            receipt_date: string;
            amount: string;
            receipt_number: string;
            note: string;
        }>(`
            SELECT 
                qb_sales_receipt_id as id,
                receipt_date::date as receipt_date,
                amount,
                COALESCE(receipt_number, 'N/A') as receipt_number,
                note
            FROM quickbooks_sales_receipts
            WHERE ${qbWhereClause}
            ORDER BY receipt_date DESC
            LIMIT 20
        `);


        // ==================== HEALTHIE REVENUE ====================
        let healthieSummary = { total: 0, count: 0 };
        let healthieDaily: { day: string; amount: number }[] = [];

        // Read from cache - cache uses day7/day30 keys (per source of truth)
        try {
            const cacheFile = '/tmp/healthie-revenue-cache.json';
            if (fs.existsSync(cacheFile)) {
                const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (days <= 1) {
                    // For 1 day, we don't have granular daily data, use day7 divided by 7
                    healthieSummary = { total: Math.round((cache.day7 || 0) / 7), count: 0 };
                } else if (days <= 7) {
                    healthieSummary = { total: cache.day7 || 0, count: 0 };
                } else {
                    healthieSummary = { total: cache.day30 || 0, count: 0 };
                }

                // Get daily data if available
                if (Array.isArray(cache.daily)) {
                    healthieDaily = cache.daily;
                }
            }
        } catch (e) {
            console.error('Healthie cache read failed:', e);
        }


        // ==================== BUILD RESPONSE ====================
        const qbTotal = parseFloat(qbSummary[0]?.total || '0');
        const qbCount = parseInt(qbSummary[0]?.count || '0');

        // Merge daily data
        const dailyMap = new Map<string, DailyRevenue>();

        // 1. Add QuickBooks data
        for (const row of qbDaily) {
            const dateStr = row.day; // already YYYY-MM-DD
            dailyMap.set(dateStr, {
                date: dateStr,
                quickbooks: parseFloat(row.amount),
                healthie: 0,
                total: parseFloat(row.amount)
            });
        }

        // 2. Add Healthie data
        for (const row of healthieDaily) {
            const dateStr = row.day; // should be YYYY-MM-DD from Snowflake

            // Only include if within date range
            // (Basic check - UI filters further)

            const current = dailyMap.get(dateStr) || {
                date: dateStr,
                quickbooks: 0,
                healthie: 0,
                total: 0
            };

            current.healthie = row.amount;
            current.total += row.amount;

            dailyMap.set(dateStr, current);
        }

        // Sort by date descending
        const sortedDaily = Array.from(dailyMap.values()).sort((a, b) =>
            b.date.localeCompare(a.date)
        );

        // Convert transactions
        const transactions: Transaction[] = qbTransactions.map(t => ({
            id: t.id,
            date: t.receipt_date,
            source: 'quickbooks' as const,
            amount: parseFloat(t.amount),
            customer: `Receipt #${t.receipt_number}`,
            description: t.note
        }));


        // Calculate trends
        const today = new Date();
        const priorPeriodStart = new Date(today);
        priorPeriodStart.setDate(priorPeriodStart.getDate() - days * 2);
        const priorPeriodEnd = new Date(today);
        priorPeriodEnd.setDate(priorPeriodEnd.getDate() - days);

        const priorQb = await query<{ total: string }>(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM quickbooks_sales_receipts
            WHERE receipt_date >= '${priorPeriodStart.toISOString().split('T')[0]}'
            AND receipt_date < '${priorPeriodEnd.toISOString().split('T')[0]}'
        `);
        const priorTotal = parseFloat(priorQb[0]?.total || '0');
        const currentTotal = qbTotal + healthieSummary.total;
        const changePercent = priorTotal > 0
            ? ((currentTotal - priorTotal) / priorTotal * 100).toFixed(1)
            : '0';

        return NextResponse.json({
            period: {
                days,
                startDate: startDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                endDate: endDate || new Date().toISOString().split('T')[0]
            },
            summary: {
                total: qbTotal + healthieSummary.total,
                quickbooks: {
                    total: qbTotal,
                    count: qbCount
                },
                healthie: {
                    total: healthieSummary.total,
                    count: healthieSummary.count
                },
                trend: {
                    priorPeriod: priorTotal,
                    changePercent: parseFloat(changePercent),
                    direction: parseFloat(changePercent) >= 0 ? 'up' : 'down'
                }
            },
            daily: sortedDaily.slice(0, 30),
            recentTransactions: transactions
        });

    } catch (error) {
        console.error('Revenue details error:', error);
        return NextResponse.json({
            error: 'Failed to fetch revenue details',
            details: String(error)
        }, { status: 500 });
    }
}
