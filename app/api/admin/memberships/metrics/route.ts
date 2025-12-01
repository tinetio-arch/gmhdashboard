import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

type CountRow = {
  total: string;
  active: string;
  mapped: string;
  unmatched: string;
};

type RevenueRow = {
  total: string;
};

type CountOnlyRow = {
  count: string;
};

const toNumber = (value?: string | number | null) => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (date: Date) => date.toISOString().split('T')[0];

export async function GET(req: NextRequest) {
  await requireApiUser(req, 'admin');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const [counts] = await query<CountRow>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_active) AS active,
      COUNT(*) FILTER (WHERE patient_id IS NOT NULL) AS mapped,
      COUNT(*) FILTER (WHERE patient_id IS NULL) AS unmatched
    FROM clinicsync_memberships
  `);

  const [paymentIssues] = await query<CountOnlyRow>(`
    SELECT COUNT(*) AS count
    FROM clinicsync_memberships
    WHERE COALESCE(amount_due, 0)::numeric > 0
       OR COALESCE(balance_owing, 0)::numeric > 0
  `);

  const dailyRevenue = await query<RevenueRow>(
    `
      SELECT COALESCE(SUM(amount_due), 0) AS total
      FROM clinicsync_memberships
      WHERE amount_due IS NOT NULL
        AND next_payment_due = $1
    `,
    [formatDate(today)]
  );

  const weeklyRevenue = await query<RevenueRow>(
    `
      SELECT COALESCE(SUM(amount_due), 0) AS total
      FROM clinicsync_memberships
      WHERE amount_due IS NOT NULL
        AND next_payment_due >= $1
        AND next_payment_due < $2
    `,
    [formatDate(weekStart), formatDate(weekEnd)]
  );

  const monthlyRevenue = await query<RevenueRow>(
    `
      SELECT COALESCE(SUM(amount_due), 0) AS total
      FROM clinicsync_memberships
      WHERE amount_due IS NOT NULL
        AND next_payment_due >= $1
        AND next_payment_due < $2
    `,
    [formatDate(monthStart), formatDate(monthEnd)]
  );

  return NextResponse.json({
    dailyRevenue: toNumber(dailyRevenue[0]?.total),
    weeklyRevenue: toNumber(weeklyRevenue[0]?.total),
    monthlyRevenue: toNumber(monthlyRevenue[0]?.total),
    totalMemberships: toNumber(counts?.total),
    activeMemberships: toNumber(counts?.active),
    paymentIssues: toNumber(paymentIssues?.count),
    unmatchedMemberships: toNumber(counts?.unmatched),
    mappedMemberships: toNumber(counts?.mapped)
  });
}











