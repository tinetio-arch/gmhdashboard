import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createHealthieClient } from '@/lib/healthie';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  try {
    const healthieClient = createHealthieClient();
    
    if (!healthieClient) {
      return NextResponse.json(
        { success: false, error: 'Healthie client not configured' },
        { status: 400 }
      );
    }

    // Get packages from Healthie
    const healthiePackages = await healthieClient.getPackages();

    // Get packages from database
    const dbPackages = await query<{
      id: number;
      healthie_package_id: string;
      name: string;
      description: string | null;
      price: number;
      billing_frequency: string;
      number_of_sessions: number | null;
      qb_recurring_template_name: string | null;
      created_at: Date;
    }>(
      `SELECT id, healthie_package_id, name, description, price, billing_frequency,
              number_of_sessions, qb_recurring_template_name, created_at
       FROM healthie_packages
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );

    // Get package usage statistics
    const packageUsage = await query<{
      healthie_package_id: string;
      subscription_count: number;
      active_subscription_count: number;
    }>(
      `SELECT 
        hp.healthie_package_id,
        COUNT(hs.id) as subscription_count,
        COUNT(CASE WHEN hs.status = 'active' THEN 1 END) as active_subscription_count
       FROM healthie_packages hp
       LEFT JOIN healthie_subscriptions hs ON hp.healthie_package_id = hs.healthie_package_id AND hs.is_active = TRUE
       WHERE hp.is_active = TRUE
       GROUP BY hp.healthie_package_id`
    );

    const usageMap = new Map(
      packageUsage.map(u => [u.healthie_package_id, {
        subscriptionCount: Number(u.subscription_count),
        activeSubscriptionCount: Number(u.active_subscription_count),
      }])
    );

    return NextResponse.json({
      success: true,
      healthiePackages,
      dbPackages: dbPackages.map(p => ({
        ...p,
        usage: usageMap.get(p.healthie_package_id) || {
          subscriptionCount: 0,
          activeSubscriptionCount: 0,
        },
      })),
    });
  } catch (error) {
    console.error('Healthie packages error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get packages' 
      },
      { status: 500 }
    );
  }
}


