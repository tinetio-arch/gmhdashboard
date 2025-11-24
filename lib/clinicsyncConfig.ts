// ClinicSync Webhook Configuration
// This file contains settings for filtering and processing ClinicSync webhook data

export const CLINICSYNC_CONFIG = {
  // Webhook filtering settings
  webhook: {
    // Whether to filter out patients without membership data
    filterNonMembershipPatients: true,
    
    // Whether to filter by specific pass types
    filterByPassTypes: true,
    
    // Pass IDs that indicate membership/package relationships we care about
    relevantPassIds: [
      3,  // Insurance Supplemental
      7,  // Pro-Bono passes
      52, // TCMH passes
      65, // TCMH New Patient passes  
      72, // TCMH New Patient (On Peptides)
      // Add more pass IDs as needed
    ],
    
    // Keywords in pass names that indicate membership/package relationships
    membershipKeywords: [
      'tcmh',
      'membership', 
      'package',
      'primecare',
      'supplemental',
      'pro-bono',
      'peptides'
    ],
    
    // Minimum balance threshold to consider a patient as having active membership
    minimumBalanceThreshold: 0.01, // $0.01 or more
    
    // Whether to process patients with outstanding balances even without explicit membership data
    processOutstandingBalances: true,
  },
  
  // Sync settings (for manual/scheduled syncs)
  sync: {
    // Whether to apply membership filtering during manual syncs
    filterNonMembershipPatients: false, // Usually false for manual syncs to get all data
    
    // Batch size for processing large sync operations
    batchSize: 100,
  },
  
  // Logging settings
  logging: {
    // Whether to log skipped patients (can be noisy) - DISABLED to reduce log noise
    logSkippedPatients: false,
    
    // Whether to log detailed membership detection info
    logMembershipDetection: false,
    
    // Whether to log successful processing
    logSuccessfulProcessing: true,
    
    // Whether to log sync frequency tracking
    logSyncTracking: true,
  }
};

// Helper function to check if a pass ID is relevant
export function isRelevantPassId(passId: number): boolean {
  return CLINICSYNC_CONFIG.webhook.relevantPassIds.includes(passId);
}

// Helper function to check if a pass name contains membership keywords
export function hasRelevantPassName(passName: string): boolean {
  if (!passName) return false;
  
  const lowerName = passName.toLowerCase();
  return CLINICSYNC_CONFIG.webhook.membershipKeywords.some(keyword => 
    lowerName.includes(keyword)
  );
}

// Helper function to check if a balance meets the threshold
export function meetsBalanceThreshold(balance: number): boolean {
  return balance >= CLINICSYNC_CONFIG.webhook.minimumBalanceThreshold;
}
