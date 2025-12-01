/**
 * Jane Revenue Queries
 * Extract and calculate Jane revenue from ClinicSync Pro webhook data
 */

import { query } from './db';

export type JaneRevenueSummary = {
  totalRevenue: number;
  totalPayments: number;
  totalPurchased: number;
  outstandingBalance: number;
  totalPatients: number;
  averageRevenuePerPatient: number;
  revenueByMonth: Array<{
    month: string;
    revenue: number;
    patientCount: number;
  }>;
};

export type JanePatientRevenue = {
  patientId: string;
  patientName: string;
  clinicsyncPatientId: string;
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
 * IMPORTANT: This extracts revenue from ALL webhooks, not just mapped patients
 * This gives you complete Jane revenue including patients not yet in your system
 */
export async function getTotalJaneRevenue(
  startDate?: Date,
  endDate?: Date
): Promise<JaneRevenueSummary> {
  // Build a list of unique ClinicSync patients along with any mapped patient info.
  const janePatients = await query<{
    clinicsync_patient_id: string;
    patient_id: string | null;
    full_name: string | null;
  }>(
    `WITH distinct_patients AS (
       SELECT DISTINCT clinicsync_patient_id
       FROM clinicsync_webhook_events
       WHERE payload IS NOT NULL
         AND clinicsync_patient_id IS NOT NULL
     )
     SELECT
       dp.clinicsync_patient_id,
       cm.patient_id,
       p.full_name
     FROM distinct_patients dp
     LEFT JOIN patient_clinicsync_mapping cm
       ON cm.clinicsync_patient_id = dp.clinicsync_patient_id
     LEFT JOIN patients p ON p.patient_id = cm.patient_id`
  );

  // Get latest webhook for each patient
  const patientRevenues: Array<{
    patientId: string;
    patientName: string;
    clinicsyncPatientId: string;
    revenue: number;
    payments: number;
    purchased: number;
    balance: number;
    visits: number;
    lastWebhookDate: string | null;
  }> = [];

  for (const patient of janePatients) {
    const clinicsyncPatientId = patient.clinicsync_patient_id;
    if (!clinicsyncPatientId) continue;

    if (!patient.clinicsync_patient_id) continue;

    // Get most recent webhook for this patient
    // Note: ClinicSync webhooks should have consistent financial totals, so any webhook works
    const webhooks = await query<{
      payload: any;
      event_type: string;
      created_at: string | null;
    }>(
      `SELECT payload, event_type, created_at
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [clinicsyncPatientId]
    );

    if (webhooks.length === 0) continue;

    const rawPayload = webhooks[0].payload;
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload)
      : rawPayload || {};

    const patientName =
      patient.full_name ||
      (payload.first_name && payload.last_name
        ? `${payload.first_name} ${payload.last_name}`
        : payload.patient_name || `ClinicSync Patient ${clinicsyncPatientId}`);

    // Extract financial data
    const totalPaymentAmount = parseFloat(payload.total_payment_amount || payload.total_payment_made || '0') || 0;
    const totalPaymentMade = parseFloat(payload.total_payment_made || '0') || 0;
    const totalPurchased = parseFloat(payload.total_purchased || '0') || 0;
    const outstandingBalance = parseFloat(payload.total_remaining_balance || payload.amount_owing || payload.balance || '0') || 0;
    const totalVisits = parseInt(payload.total_appt_arrived || '0', 10) || 0;

    // Use total_payment_amount as the primary revenue metric
    // This represents total lifetime revenue from Jane
    patientRevenues.push({
      patientId: patient.patient_id ?? clinicsyncPatientId,
      patientName,
      clinicsyncPatientId,
      revenue: totalPaymentAmount || totalPaymentMade || totalPurchased, // Fallback chain
      payments: totalPaymentMade,
      purchased: totalPurchased,
      balance: outstandingBalance,
      visits: totalVisits,
      lastWebhookDate: webhooks[0].created_at ?? null
    });
  }

  // Calculate totals
  const totalRevenue = patientRevenues.reduce((sum, p) => sum + p.revenue, 0);
  const totalPayments = patientRevenues.reduce((sum, p) => sum + p.payments, 0);
  const totalPurchased = patientRevenues.reduce((sum, p) => sum + p.purchased, 0);
  const outstandingBalance = patientRevenues.reduce((sum, p) => sum + p.balance, 0);

  // Group by month (simplified - would need actual webhook timestamps)
  const revenueByMonth: Array<{ month: string; revenue: number; patientCount: number }> = [];

  return {
    totalRevenue,
    totalPayments,
    totalPurchased,
    outstandingBalance,
    totalPatients: patientRevenues.length,
    averageRevenuePerPatient: patientRevenues.length > 0 ? totalRevenue / patientRevenues.length : 0,
    revenueByMonth
  };
}

/**
 * Get revenue breakdown by Jane patient
 */
export async function getJanePatientRevenue(): Promise<JanePatientRevenue[]> {
  // Get all Jane patients with ClinicSync IDs
  const janePatients = await query<{
    patient_id: string;
    full_name: string;
    clinicsync_patient_id: string | null;
  }>(
    `SELECT DISTINCT p.patient_id, p.full_name, cm.clinicsync_patient_id
     FROM patients p
     LEFT JOIN patient_clinicsync_mapping cm ON cm.patient_id = p.patient_id
     WHERE p.payment_method_key IN ('jane', 'jane_quickbooks')
       AND NOT (COALESCE(p.status_key, '') ILIKE 'inactive%' OR COALESCE(p.status_key, '') ILIKE 'discharg%')
       AND cm.clinicsync_patient_id IS NOT NULL
     ORDER BY p.full_name`
  );

  const revenues: JanePatientRevenue[] = [];

  for (const patient of janePatients) {
    if (!patient.clinicsync_patient_id) continue;

    // Get most recent webhook
    // Note: ClinicSync webhooks should have consistent financial totals, so any webhook works
    const webhooks = await query<{
      payload: any;
      event_type: string;
    }>(
      `SELECT payload, event_type
       FROM clinicsync_webhook_events
       WHERE clinicsync_patient_id = $1
         AND payload IS NOT NULL
       LIMIT 1`,
      [patient.clinicsync_patient_id]
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
    const lastPaymentDate = payload.last_payment_reminder || payload.last_payment_date || null;

    revenues.push({
      patientId: patient.patient_id,
      patientName: patient.full_name,
      clinicsyncPatientId: patient.clinicsync_patient_id,
      totalRevenue: totalPaymentAmount || totalPaymentMade || totalPurchased,
      totalPayments: totalPaymentMade,
      totalPurchased: totalPurchased,
      outstandingBalance: outstandingBalance,
      totalVisits: totalVisits,
      lastPaymentDate: lastPaymentDate,
      lastWebhookDate: null // TODO: Extract from webhook table
    });
  }

  return revenues.sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/**
 * Extract payment events with dates from webhook appointments
 * This allows us to calculate daily/weekly/monthly revenue
 */
export async function extractPaymentEvents(): Promise<Array<{
  patientId: string;
  patientName: string;
  clinicsyncPatientId: string;
  paymentDate: string | null;
  paymentAmount: number;
  appointmentDate: string | null;
  visitNumber: number | null;
}>> {
  // Get ALL unique ClinicSync patient IDs from webhooks (not just mapped ones)
  const allWebhookPatients = await query<{
    clinicsync_patient_id: string;
  }>(
    `SELECT DISTINCT clinicsync_patient_id
     FROM clinicsync_webhook_events
     WHERE payload IS NOT NULL
       AND clinicsync_patient_id IS NOT NULL`
  );

  const paymentEvents: Array<{
    patientId: string;
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

    const mappedPatient = await query<{
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

    const mappedPatientRecord = mappedPatient[0];
    const mappedPatientId = mappedPatientRecord?.patient_id ?? null;
    const mappedPatientName = mappedPatientRecord?.full_name ?? null;
    
    for (let idx = 0; idx < appointments.length; idx++) {
      const appt = appointments[idx];
      // Only include appointments that were paid
      if (!(appt.patient_paid === true || appt.purchase_state === 'paid')) continue;
      
      // Use average payment per appointment (since we don't have individual payment amounts)
      const paymentAmount = avgPaymentPerAppointment;
      
      // Use arrived_at as the primary date (when appointment actually occurred)
      // Fall back to start_at or booked_at if arrived_at is not available
      const appointmentDate = appt.arrived_at || 
                              appt.start_at ||
                              appt.booked_at ||
                              null;

      // Payment date is typically the same as appointment date for Jane
      const paymentDate = appointmentDate;

      // Get patient name from payload or system
      const patientName = payload.first_name && payload.last_name
        ? `${payload.first_name} ${payload.last_name}`
        : payload.patient_name
        ? payload.patient_name
        : `ClinicSync Patient ${clinicsyncPatientId}`;
      const displayName = mappedPatientName || patientName;

      paymentEvents.push({
      patientId: mappedPatientId ?? clinicsyncPatientId,
        patientName: displayName,
        clinicsyncPatientId: clinicsyncPatientId,
        paymentDate: paymentDate ? new Date(paymentDate).toISOString().split('T')[0] : null, // YYYY-MM-DD format
        paymentAmount,
        appointmentDate: appointmentDate ? new Date(appointmentDate).toISOString().split('T')[0] : null,
        visitNumber: idx + 1
      });
    }

    // Also check last_payment_reminder for most recent payment
    if (payload.last_payment_reminder) {
      const reminder = payload.last_payment_reminder;
      const reminderAmount = parseFloat(
        (typeof reminder === 'object' && reminder !== null ? reminder.amount : reminder) ||
          payload.total_payment_amount ||
          '0'
      ) || 0;

      const reminderDate =
        typeof reminder === 'object' && reminder !== null
          ? reminder.date || null
          : typeof reminder === 'string'
            ? reminder
            : null;

      const hasExistingEvents = paymentEvents.some(event => event.clinicsyncPatientId === clinicsyncPatientId);

      if (reminderAmount > 0 && !hasExistingEvents) {
        paymentEvents.push({
          patientId: mappedPatientId ?? clinicsyncPatientId,
          patientName: mappedPatientName || (payload.patient_name ?? `ClinicSync Patient ${clinicsyncPatientId}`),
          clinicsyncPatientId,
          paymentDate: reminderDate,
          paymentAmount: reminderAmount,
          appointmentDate: null,
          visitNumber: null
        });
      }
    }
  }

  return paymentEvents;
}

/**
 * Get Jane revenue for a specific time period
 * Uses appointment dates and payment dates from webhook data
 */
export async function getJaneRevenueByPeriod(
  startDate: Date,
  endDate: Date
): Promise<{
  totalRevenue: number;
  patientCount: number;
  breakdown: Array<{
    patientId: string;
    patientName: string;
    revenue: number;
  }>;
  dailyBreakdown: Array<{
    date: string;
    revenue: number;
    patientCount: number;
  }>;
}> {
  const paymentEvents = await extractPaymentEvents();
  
  // Filter by date range
  const filteredEvents = paymentEvents.filter(event => {
    if (!event.paymentDate && !event.appointmentDate) return false;
    
    const eventDate = event.paymentDate || event.appointmentDate;
    if (!eventDate) return false;
    
    const date = new Date(eventDate);
    return date >= startDate && date <= endDate;
  });

  const totalRevenue = filteredEvents.reduce((sum, event) => sum + event.paymentAmount, 0);
  const uniquePatients = new Set(filteredEvents.map(e => e.patientId));

  // Group by day
  const dailyMap = new Map<string, { revenue: number; patients: Set<string> }>();
  filteredEvents.forEach(event => {
    const eventDate = event.paymentDate || event.appointmentDate;
    if (!eventDate) return;
    
    const date = new Date(eventDate);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { revenue: 0, patients: new Set() });
    }
    
    const dayData = dailyMap.get(dateKey)!;
    dayData.revenue += event.paymentAmount;
    dayData.patients.add(event.patientId);
  });

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      revenue: data.revenue,
      patientCount: data.patients.size
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalRevenue,
    patientCount: uniquePatients.size,
    breakdown: Array.from(uniquePatients).map(patientId => {
      const patientEvents = filteredEvents.filter(e => e.patientId === patientId);
      const patient = patientEvents[0];
      return {
        patientId,
        patientName: patient.patientName,
        revenue: patientEvents.reduce((sum, e) => sum + e.paymentAmount, 0)
      };
    }),
    dailyBreakdown
  };
}

/**
 * Get daily Jane revenue breakdown
 */
export async function getJaneRevenueDaily(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string;
  revenue: number;
  paymentCount: number;
  patientCount: number;
}>> {
  const period = await getJaneRevenueByPeriod(startDate, endDate);
  return period.dailyBreakdown.map(day => ({
    date: day.date,
    revenue: day.revenue,
    paymentCount: 0, // TODO: Count from events
    patientCount: day.patientCount
  }));
}

/**
 * Get weekly Jane revenue breakdown
 */
export async function getJaneRevenueWeekly(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  week: string; // Format: "YYYY-WW" or "Week of MM/DD"
  revenue: number;
  paymentCount: number;
  patientCount: number;
}>> {
  const daily = await getJaneRevenueDaily(startDate, endDate);
  
  // Group by week
  const weeklyMap = new Map<string, { revenue: number; payments: number; patients: Set<string> }>();
  
  daily.forEach(day => {
    const date = new Date(day.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
    const weekKey = `${weekStart.getFullYear()}-W${String(Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;
    
    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, { revenue: 0, payments: 0, patients: new Set() });
    }
    
    const weekData = weeklyMap.get(weekKey)!;
    weekData.revenue += day.revenue;
    weekData.payments += day.paymentCount;
    // Note: Can't track unique patients per week from daily data alone
  });
  
  return Array.from(weeklyMap.entries()).map(([week, data]) => ({
    week: `Week of ${new Date(week).toLocaleDateString()}`,
    revenue: data.revenue,
    paymentCount: data.payments,
    patientCount: data.patients.size
  }));
}

/**
 * Get monthly Jane revenue breakdown
 */
export async function getJaneRevenueMonthly(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  month: string; // Format: "YYYY-MM" or "January 2024"
  revenue: number;
  paymentCount: number;
  patientCount: number;
}>> {
  const daily = await getJaneRevenueDaily(startDate, endDate);
  
  // Group by month
  const monthlyMap = new Map<string, { revenue: number; payments: number; patients: Set<string> }>();
  
  daily.forEach(day => {
    const date = new Date(day.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { revenue: 0, payments: 0, patients: new Set() });
    }
    
    const monthData = monthlyMap.get(monthKey)!;
    monthData.revenue += day.revenue;
    monthData.payments += day.paymentCount;
  });
  
  return Array.from(monthlyMap.entries()).map(([month, data]) => {
    const [year, monthNum] = month.split('-');
    const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleString('default', { month: 'long' });
    return {
      month: `${monthName} ${year}`,
      revenue: data.revenue,
      paymentCount: data.payments,
      patientCount: data.patients.size
    };
  });
}

