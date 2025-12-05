/**
 * Complete Jane Revenue Queries - Extract from ALL webhooks, not just mapped patients
 * This gives you total Jane revenue including patients not yet in your system
 */

import { query } from './db';

export type JaneRevenueSummary = {
  totalRevenue: number;
  totalPayments: number;
  totalPurchased: number;
  outstandingBalance: number;
  totalPatients: number;
  mappedPatients: number;
  unmappedPatients: number;
  averageRevenuePerPatient: number;
  revenueByMonth: Array<{
    month: string;
    revenue: number;
    patientCount: number;
  }>;
};

export type JanePatientRevenue = {
  patientId: string | null;
  patientName: string;
  clinicsyncPatientId: string;
  isMapped: boolean;
  totalRevenue: number;
  totalPayments: number;
  totalPurchased: number;
  outstandingBalance: number;
  totalVisits: number;
  lastPaymentDate: string | null;
  lastWebhookDate: string | null;
};

/**
 * Get total Jane revenue from ALL ClinicSync webhook data
 * IMPORTANT: This extracts from ALL webhooks, not just mapped patients
 * This gives complete Jane revenue including patients not in your system yet
 */
export async function getTotalJaneRevenue(
  startDate?: Date,
  endDate?: Date
): Promise<JaneRevenueSummary> {
  // Get ALL unique ClinicSync patient IDs from webhooks (not just mapped ones)
  const allWebhookPatients = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL`
  );

  console.log(`Found ${allWebhookPatients.length} unique ClinicSync patients in webhooks`);

  // Get mapped patient IDs for comparison
  const mappedPatientIds = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT cm.clinicsync_patient_id
     FROM patient_clinicsync_mapping cm
     INNER JOIN patients p ON p.patient_id = cm.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL`
  );

  const mappedSet = new Set(mappedPatientIds.map(p => p.clinicsync_patient_id));
  console.log(`Found ${mappedSet.size} mapped patients in system`);

  // Get latest webhook for each patient (from ALL webhooks)
  const patientRevenues: Array<{
    patientId: string | null;
    patientName: string;
    clinicsyncPatientId: string;
    isMapped: boolean;
    revenue: number;
    payments: number;
    purchased: number;
    balance: number;
    visits: number;
  }> = [];

  for (const webhookPatient of allWebhookPatients) {
    const clinicsyncPatientId = webhookPatient.clinicsync_patient_id;
    if (!clinicsyncPatientId) continue;

    const webhooks = await query<{
      payload: any;
    }>(
      `SELECT payload
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [clinicsyncPatientId]
    );

    if (webhooks.length === 0) continue;

    const payload = typeof webhooks[0].payload === 'string'
      ? JSON.parse(webhooks[0].payload)
      : webhooks[0].payload;

    // Extract financial data
    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || '0') || 0;
    const totalPaymentMade = parseFloat(payload.total_payment_made || '0') || 0;
    const totalPurchased = parseFloat(payload.total_purchased || '0') || 0;
    const outstandingBalance = parseFloat(payload.total_remaining_balance || payload.amount_owing || payload.balance || '0') || 0;
    const totalVisits = parseInt(payload.total_appt_arrived || '0', 10) || 0;

    // Get patient name from payload
    const patientName = payload.first_name && payload.last_name
      ? `${payload.first_name} ${payload.last_name}`
      : payload.patient_name
      ? payload.patient_name
      : `Jane Patient ${clinicsyncPatientId}`;

    // Check if mapped
    const isMapped = mappedSet.has(clinicsyncPatientId);
    
    // Try to get system patient ID if mapped
    let patientId: string | null = null;
    if (isMapped) {
      const mapped = await query<{
        patient_id: string;
        full_name: string;
      }>(
        `SELECT p.patient_id, p.full_name
         FROM patient_clinicsync_mapping cm
         INNER JOIN patients p ON p.patient_id = cm.patient_id
         WHERE cm.clinicsync_patient_id = $1
         LIMIT 1`,
        [clinicsyncPatientId]
      );
      if (mapped.length > 0) {
        patientId = mapped[0].patient_id;
      }
    }

    // Use total_payment_amount as primary revenue metric
    const revenue = totalPaymentAmount || totalPaymentMade || totalPurchased;

    if (revenue > 0) {
      patientRevenues.push({
        patientId,
        patientName,
        clinicsyncPatientId,
        isMapped,
        revenue,
        payments: totalPaymentMade,
        purchased: totalPurchased,
        balance: outstandingBalance,
        visits: totalVisits
      });
    }
  }

  // Calculate totals
  const totalRevenue = patientRevenues.reduce((sum, p) => sum + p.revenue, 0);
  const totalPayments = patientRevenues.reduce((sum, p) => sum + p.payments, 0);
  const totalPurchased = patientRevenues.reduce((sum, p) => sum + p.purchased, 0);
  const outstandingBalance = patientRevenues.reduce((sum, p) => sum + p.balance, 0);
  const mappedPatients = patientRevenues.filter(p => p.isMapped).length;
  const unmappedPatients = patientRevenues.filter(p => !p.isMapped).length;

  return {
    totalRevenue,
    totalPayments,
    totalPurchased,
    outstandingBalance,
    totalPatients: patientRevenues.length,
    mappedPatients,
    unmappedPatients,
    averageRevenuePerPatient: patientRevenues.length > 0 ? totalRevenue / patientRevenues.length : 0,
    revenueByMonth: []
  };
}

/**
 * Get revenue breakdown by patient from ALL webhooks
 */
export async function getJanePatientRevenue(): Promise<JanePatientRevenue[]> {
  // Get ALL unique ClinicSync patient IDs from webhooks
  const allWebhookPatients = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL`
  );

  // Get mapped patient IDs
  const mappedPatientIds = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT cm.clinicsync_patient_id
     FROM patient_clinicsync_mapping cm
     INNER JOIN patients p ON p.patient_id = cm.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL`
  );

  const mappedSet = new Set(mappedPatientIds.map(p => p.clinicsync_patient_id));
  const revenues: JanePatientRevenue[] = [];

  for (const webhookPatient of allWebhookPatients) {
    const clinicsyncPatientId = webhookPatient.clinicsync_patient_id;
    if (!clinicsyncPatientId) continue;

    const webhooks = await query<{
      payload: any;
    }>(
      `SELECT payload
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [clinicsyncPatientId]
    );

    if (webhooks.length === 0) continue;

    const payload = typeof webhooks[0].payload === 'string'
      ? JSON.parse(webhooks[0].payload)
      : webhooks[0].payload;

    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || '0') || 0;
    const totalPaymentMade = parseFloat(payload.total_payment_made || '0') || 0;
    const totalPurchased = parseFloat(payload.total_purchased || '0') || 0;
    const outstandingBalance = parseFloat(payload.total_remaining_balance || payload.amount_owing || payload.balance || '0') || 0;
    const totalVisits = parseInt(payload.total_appt_arrived || '0', 10) || 0;
    const lastPaymentDate = payload.last_payment_reminder?.date || payload.last_payment_date || null;

    const patientName = payload.first_name && payload.last_name
      ? `${payload.first_name} ${payload.last_name}`
      : payload.patient_name
      ? payload.patient_name
      : `Jane Patient ${clinicsyncPatientId}`;

    const isMapped = mappedSet.has(clinicsyncPatientId);
    
    let patientId: string | null = null;
    if (isMapped) {
      const mapped = await query<{
        patient_id: string;
      }>(
        `SELECT p.patient_id
         FROM patient_clinicsync_mapping cm
         INNER JOIN patients p ON p.patient_id = cm.patient_id
         WHERE cm.clinicsync_patient_id = $1
         LIMIT 1`,
        [clinicsyncPatientId]
      );
      if (mapped.length > 0) {
        patientId = mapped[0].patient_id;
      }
    }

    revenues.push({
      patientId,
      patientName,
      clinicsyncPatientId,
      isMapped,
      totalRevenue: totalPaymentAmount || totalPaymentMade || totalPurchased,
      totalPayments: totalPaymentMade,
      totalPurchased: totalPurchased,
      outstandingBalance: outstandingBalance,
      totalVisits: totalVisits,
      lastPaymentDate: lastPaymentDate,
      lastWebhookDate: null
    });
  }

  return revenues
    .filter(r => r.totalRevenue > 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/**
 * Extract payment events from ALL webhooks for time-based metrics
 */
export async function extractPaymentEventsFromAllWebhooks(): Promise<Array<{
  patientId: string | null;
  patientName: string;
  clinicsyncPatientId: string;
  paymentDate: string | null;
  paymentAmount: number;
  appointmentDate: string | null;
  visitNumber: number | null;
}>> {
  // Get ALL unique ClinicSync patient IDs from webhooks
  const allWebhookPatients = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL`
  );

  const paymentEvents: Array<{
    patientId: string | null;
    patientName: string;
    clinicsyncPatientId: string;
    paymentDate: string | null;
    paymentAmount: number;
    appointmentDate: string | null;
    visitNumber: number | null;
  }> = [];

  for (const webhookPatient of allWebhookPatients) {
    const clinicsyncPatientId = webhookPatient.clinicsync_patient_id;
    if (!clinicsyncPatientId) continue;

    const webhooks = await query<{
      payload: any;
    }>(
      `SELECT payload
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [clinicsyncPatientId]
    );

    if (webhooks.length === 0) continue;

    const payload = typeof webhooks[0].payload === 'string'
      ? JSON.parse(webhooks[0].payload)
      : webhooks[0].payload;

    // Extract payments from appointments array
    const appointments = payload.appointmentsObject || [];
    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || '0') || 0;
    const paidAppointments = appointments.filter((appt: any) => appt.patient_paid === true || appt.purchase_state === 'paid');
    const avgPaymentPerAppointment = paidAppointments.length > 0 ? totalPaymentAmount / paidAppointments.length : 0;

    // Try to get patient ID if mapped
    const mappedPatient = await query<{
      patient_id: string;
    }>(
      `SELECT p.patient_id
       FROM patient_clinicsync_mapping cm
       INNER JOIN patients p ON p.patient_id = cm.patient_id
       WHERE cm.clinicsync_patient_id = $1
       LIMIT 1`,
      [clinicsyncPatientId]
    );
    const patientId = mappedPatient.length > 0 ? mappedPatient[0].patient_id : null;

    const patientName = payload.first_name && payload.last_name
      ? `${payload.first_name} ${payload.last_name}`
      : payload.patient_name
      ? payload.patient_name
      : `Jane Patient ${clinicsyncPatientId}`;
    
    appointments.forEach((appt: any, idx: number) => {
      if (!(appt.patient_paid === true || appt.purchase_state === 'paid')) return;
      if (!clinicsyncPatientId) return;
      
      const paymentAmount = avgPaymentPerAppointment;
      const appointmentDate = appt.arrived_at || appt.start_at || appt.booked_at || null;
      const paymentDate = appointmentDate;

      paymentEvents.push({
        patientId,
        patientName,
        clinicsyncPatientId,
        paymentDate: paymentDate ? new Date(paymentDate).toISOString().split('T')[0] : null,
        paymentAmount,
        appointmentDate: appointmentDate ? new Date(appointmentDate).toISOString().split('T')[0] : null,
        visitNumber: idx + 1
      });
    });
  }

  return paymentEvents;
}







