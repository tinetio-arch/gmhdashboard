/**
 * Integration Status Monitoring
 * Provides status for all integrations (QuickBooks, Jane/ClinicSync, GHL)
 */

import { getQuickBooksHealthStatus, needsConnectionAttention } from '@/lib/quickbooksHealth';
import { query } from '@/lib/db';

export type IntegrationStatus = {
  name: string;
  connected: boolean;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  lastChecked: Date | null;
  error: string | null;
  healthScore: number | null;
  canRefresh: boolean;
};

/**
 * Get QuickBooks integration status
 */
async function getQuickBooksStatus(): Promise<IntegrationStatus> {
  try {
    const health = await getQuickBooksHealthStatus();
    const attention = await needsConnectionAttention();
    
    let status: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
    // If connected, show as healthy unless it's a critical issue
    // This prioritizes showing green when syncing is working
    if (health.connected) {
      if (attention.severity === 'critical') {
        status = 'critical';
      } else {
        // Connected and working - show as healthy even if there are minor warnings
        status = 'healthy';
      }
    } else if (attention.severity === 'critical') {
      status = 'critical';
    } else if (attention.severity === 'warning') {
      status = 'warning';
    }

    return {
      name: 'QuickBooks',
      connected: health.connected,
      status,
      lastChecked: health.lastChecked,
      error: health.error,
      healthScore: health.healthScore,
      canRefresh: health.canRefresh,
    };
  } catch (error: any) {
    return {
      name: 'QuickBooks',
      connected: false,
      status: 'critical',
      lastChecked: null,
      error: error.message || 'Failed to check QuickBooks status',
      healthScore: null,
      canRefresh: false,
    };
  }
}

/**
 * Get Jane/ClinicSync integration status
 */
async function getJaneStatus(): Promise<IntegrationStatus> {
  try {
    // Check if we have active memberships (indicates data is flowing)
    // This is more reliable than checking webhook events table structure
    let hasActiveData = false;
    let hasRecentActivity = false;
    let latestActivity: Date | null = null;
    
    try {
      const activeMemberships = await query<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM clinicsync_memberships
          WHERE COALESCE(membership_status, '') NOT IN ('inactive', 'discharged')`
      );
      hasActiveData = (activeMemberships[0]?.count || 0) > 0;
    } catch (err: any) {
      if (err?.message?.includes('membership_status')) {
        try {
          const fallbackMemberships = await query<{ count: number }>(
            `SELECT COUNT(*) AS count FROM clinicsync_memberships`
          );
          hasActiveData = (fallbackMemberships[0]?.count || 0) > 0;
        } catch (fallbackErr) {
          console.error('Error checking active memberships (fallback):', fallbackErr);
        }
      } else {
        console.error('Error checking active memberships:', err);
      }
    }

    // Try to check webhook events with multiple possible column names
    try {
      // Try created_at first
      const recentWebhooks = await query<{ count: number; latest: Date | null }>(
        `SELECT 
           COUNT(*) as count,
           MAX(created_at) as latest
         FROM clinicsync_webhook_events
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      );
      hasRecentActivity = (recentWebhooks[0]?.count || 0) > 0;
      latestActivity = recentWebhooks[0]?.latest ? new Date(recentWebhooks[0].latest) : null;
    } catch (err: any) {
      // If created_at doesn't exist, try other column names or just check if table has data
      if (err.message?.includes('created_at')) {
        try {
          // Fallback: just check if table exists and has any data
          const anyWebhooks = await query<{ count: number }>(
            `SELECT COUNT(*) as count FROM clinicsync_webhook_events LIMIT 1`
          );
          hasRecentActivity = (anyWebhooks[0]?.count || 0) > 0;
        } catch (fallbackErr) {
          console.error('Error checking webhook events (fallback):', fallbackErr);
        }
      }
    }

    // Determine status
    let status: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
    if (hasRecentActivity && hasActiveData) {
      status = 'healthy';
    } else if (hasActiveData) {
      status = 'healthy'; // Has active memberships is good enough
    } else if (hasRecentActivity) {
      status = 'warning'; // Has webhooks but no active memberships
    } else {
      status = 'critical'; // No data at all
    }

    return {
      name: 'Jane (ClinicSync)',
      connected: hasRecentActivity || hasActiveData,
      status,
      lastChecked: latestActivity,
      error: hasActiveData || hasRecentActivity ? null : 'No active memberships or webhook activity found',
      healthScore: hasActiveData ? 100 : (hasRecentActivity ? 75 : 0),
      canRefresh: false,
    };
  } catch (error: any) {
    return {
      name: 'Jane (ClinicSync)',
      connected: false,
      status: 'critical',
      lastChecked: null,
      error: error.message || 'Failed to check Jane status',
      healthScore: null,
      canRefresh: false,
    };
  }
}

/**
 * Get GHL integration status
 * This function also serves as a "keepalive" - it makes an actual API call to GHL
 * to prevent the token from expiring due to 90-day inactivity
 */
async function getGHLStatus(): Promise<IntegrationStatus> {
  try {
    // Check if GHL API key is configured
    const hasApiKey = !!process.env.GHL_API_KEY;
    
    if (!hasApiKey) {
      return {
        name: 'GoHighLevel',
        connected: false,
        status: 'critical',
        lastChecked: null,
        error: 'GHL API key not configured',
        healthScore: null,
        canRefresh: false,
      };
    }

    // IMPORTANT: Make an actual API call to GHL to keep the token active
    // GoHighLevel deletes tokens that haven't been used in 90 days
    // This lightweight call (getting tags) will prevent token expiration
    let apiConnected = false;
    let apiError: string | null = null;
    try {
      const { createGHLClient } = await import('./ghl');
      const client = createGHLClient();
      if (client) {
        // Make a lightweight API call to test the connection and keep token active
        await client.getTags();
        apiConnected = true;
      } else {
        apiError = 'Failed to create GHL client';
      }
    } catch (error: any) {
      apiError = error.message || 'GHL API connection failed';
      // Check if it's a token error
      if (apiError && (apiError.includes('Invalid Private Integration token') || 
          apiError.includes('token') || 
          apiError.includes('unauthorized') ||
          apiError.includes('401'))) {
        apiError = 'GHL API token expired or invalid - please regenerate in GoHighLevel';
      }
    }

    // Check recent sync activity
    const recentSyncs = await query<{ count: number; latest: Date }>(
      `SELECT 
         COUNT(*) as count,
         MAX(created_at) as latest
       FROM ghl_sync_history
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    );

    const hasRecentActivity = recentSyncs[0]?.count > 0;
    const latestActivity = recentSyncs[0]?.latest;

    // Check if we have mapped contacts
    const mappedContacts = await query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM patients
       WHERE ghl_contact_id IS NOT NULL`
    );

    const hasMappedContacts = (mappedContacts[0]?.count || 0) > 0;

    let status: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
    if (apiError) {
      status = 'critical';
    } else if (apiConnected && hasRecentActivity && hasMappedContacts) {
      status = 'healthy';
    } else if (apiConnected && hasMappedContacts && !hasRecentActivity) {
      status = 'warning';
    } else if (apiConnected) {
      status = 'warning'; // Configured and connected but no activity
    } else {
      status = 'critical';
    }

    return {
      name: 'GoHighLevel',
      connected: apiConnected,
      status,
      lastChecked: new Date(), // Always update lastChecked when we make the API call (keeps token active)
      error: apiError || (hasRecentActivity ? null : 'No sync activity in last 24 hours'),
      healthScore: apiConnected ? (hasRecentActivity ? 100 : (hasMappedContacts ? 50 : 25)) : 0,
      canRefresh: false,
    };
  } catch (error: any) {
    return {
      name: 'GoHighLevel',
      connected: false,
      status: 'critical',
      lastChecked: null,
      error: error.message || 'Failed to check GHL status',
      healthScore: null,
      canRefresh: false,
    };
  }
}

/**
 * Get all integration statuses
 */
export async function getAllIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const [quickbooks, jane, ghl] = await Promise.all([
    getQuickBooksStatus(),
    getJaneStatus(),
    getGHLStatus(),
  ]);

  return [quickbooks, jane, ghl];
}

