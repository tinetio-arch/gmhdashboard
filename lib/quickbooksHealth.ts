/**
 * QuickBooks Connection Health Monitoring
 * Provides robust connection status checking and monitoring
 */

import { createQuickBooksClient } from '@/lib/quickbooks';
import { query } from '@/lib/db';

export type ConnectionHealthStatus = {
  connected: boolean;
  lastChecked: Date;
  lastSuccessfulCheck: Date | null;
  error: string | null;
  tokenExpiresAt: Date | null;
  canRefresh: boolean;
  healthScore: number; // 0-100, based on recent connection success rate
};

/**
 * Actually test the QuickBooks connection by making a real API call
 */
export async function testQuickBooksConnection(): Promise<{
  connected: boolean;
  error: string | null;
  tokenExpiresAt: Date | null;
}> {
  try {
    const client = await createQuickBooksClient();
    
    if (!client) {
      return {
        connected: false,
        error: 'QuickBooks client not configured (missing credentials)',
        tokenExpiresAt: null,
      };
    }

    // Make a lightweight API call to test the connection
    // Use getCustomers() with limit=1 to minimize API usage
    try {
      // Test connection by making a minimal API call (limit to 1 customer)
      const customers = await client.getCustomers(1);
      
      // If we got here without error, connection is working
      // (Even if customers array is empty, that's fine - the API responded)
      
      // Get token expiration from database
      const tokens = await query<{ expires_at: Date }>(
        `SELECT expires_at 
         FROM quickbooks_oauth_tokens 
         WHERE realm_id IS NOT NULL 
         ORDER BY updated_at DESC 
         LIMIT 1`
      );

      return {
        connected: true,
        error: null,
        tokenExpiresAt: tokens.length > 0 ? tokens[0].expires_at : null,
      };
    } catch (apiError: any) {
      // If we get a 401, token might be expired but refreshable
      if (apiError.message?.includes('401') || apiError.message?.includes('Unauthorized')) {
        return {
          connected: false,
          error: 'Token expired or invalid. Attempting refresh...',
          tokenExpiresAt: null,
        };
      }
      
      return {
        connected: false,
        error: apiError.message || 'QuickBooks API call failed',
        tokenExpiresAt: null,
      };
    }
  } catch (error: any) {
    return {
      connected: false,
      error: error.message || 'Failed to create QuickBooks client',
      tokenExpiresAt: null,
    };
  }
}

/**
 * Get comprehensive connection health status
 */
export async function getQuickBooksHealthStatus(): Promise<ConnectionHealthStatus> {
  const now = new Date();
  
  // Get recent connection check history (handle case where table doesn't exist yet)
  let recentChecks: Array<{ checked_at: Date; connected: boolean; error: string | null }> = [];
  try {
    recentChecks = await query<{
      checked_at: Date;
      connected: boolean;
      error: string | null;
    }>(
      `SELECT checked_at, connected, error 
       FROM quickbooks_connection_health 
       WHERE checked_at > NOW() - INTERVAL '24 hours'
       ORDER BY checked_at DESC 
       LIMIT 100`
    );
  } catch (error) {
    // Table doesn't exist yet - that's okay, we'll create it with the migration
    console.log('[QuickBooks Health] Connection health table not found, will be created by migration');
  }

  // Perform current connection test first
  const currentTest = await testQuickBooksConnection();
  
  // Record this check in database (handle case where table doesn't exist yet)
  try {
    await query(
      `INSERT INTO quickbooks_connection_health (connected, error, checked_at)
       VALUES ($1, $2, NOW())`,
      [currentTest.connected, currentTest.error]
    );
  } catch (error) {
    // Table doesn't exist yet - that's okay
    console.log('[QuickBooks Health] Could not record check (table may not exist yet)');
  }

  // Re-fetch recent checks including the one we just recorded
  try {
    recentChecks = await query<{
      checked_at: Date;
      connected: boolean;
      error: string | null;
    }>(
      `SELECT checked_at, connected, error 
       FROM quickbooks_connection_health 
       WHERE checked_at > NOW() - INTERVAL '24 hours'
       ORDER BY checked_at DESC 
       LIMIT 100`
    );
  } catch (error) {
    // Table doesn't exist - use current test result only
  }

  // Calculate health score (percentage of successful checks in last 24h)
  const successfulChecks = recentChecks.filter(c => c.connected).length;
  const totalChecks = recentChecks.length;
  
  let healthScore: number;
  if (totalChecks === 0) {
    // No history yet - if current connection works, show 100%, otherwise 0%
    healthScore = currentTest.connected ? 100 : 0;
  } else {
    // Calculate based on history
    healthScore = Math.round((successfulChecks / totalChecks) * 100);
    
    // If current connection is working but score is low due to old failures, 
    // give it a boost (weight recent checks more)
    if (currentTest.connected && healthScore < 80 && totalChecks >= 3) {
      // Recent trend matters - if last 3 checks were successful, boost the score
      const recent3Checks = recentChecks.slice(0, 3);
      const recentSuccesses = recent3Checks.filter(c => c.connected).length;
      if (recentSuccesses === 3) {
        healthScore = Math.max(healthScore, 85); // Boost to at least 85% if recent trend is good
      }
    }
  }

  // Get last successful check (including current if successful)
  const lastSuccessful = recentChecks.find(c => c.connected) || (currentTest.connected ? { checked_at: new Date() } : null);

  // Get token expiration
  const tokens = await query<{ expires_at: Date }>(
    `SELECT expires_at 
     FROM quickbooks_oauth_tokens 
     WHERE realm_id IS NOT NULL 
     ORDER BY updated_at DESC 
     LIMIT 1`
  );

  const tokenExpiresAt = tokens.length > 0 ? tokens[0].expires_at : null;
  const canRefresh = tokenExpiresAt ? new Date(tokenExpiresAt) > now : false;

  return {
    connected: currentTest.connected,
    lastChecked: now,
    lastSuccessfulCheck: lastSuccessful ? lastSuccessful.checked_at : null,
    error: currentTest.error,
    tokenExpiresAt,
    canRefresh,
    healthScore,
  };
}

/**
 * Check if connection needs attention (disconnected or unhealthy)
 */
export async function needsConnectionAttention(): Promise<{
  needsAttention: boolean;
  reason: string | null;
  severity: 'critical' | 'warning' | 'info';
}> {
  const health = await getQuickBooksHealthStatus();
  
  if (!health.connected) {
    return {
      needsAttention: true,
      reason: health.error || 'QuickBooks is disconnected',
      severity: 'critical',
    };
  }

  if (health.healthScore < 80) {
    return {
      needsAttention: true,
      reason: `Connection health is low (${health.healthScore}% success rate)`,
      severity: 'warning',
    };
  }

  if (health.tokenExpiresAt) {
    const expiresAt = new Date(health.tokenExpiresAt);
    const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    
    if (hoursUntilExpiry < 1) {
      return {
        needsAttention: true,
        reason: 'Token expires in less than 1 hour',
        severity: 'warning',
      };
    }
  }

  return {
    needsAttention: false,
    reason: null,
    severity: 'info',
  };
}

