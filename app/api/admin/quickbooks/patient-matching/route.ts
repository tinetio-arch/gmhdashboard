import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createQuickBooksClient } from '@/lib/quickbooks';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    // Create QuickBooks client
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      return NextResponse.json(
        { error: 'QuickBooks not connected. Please connect first.' },
        { status: 400 }
      );
    }

    // Get all QuickBooks customers
    const qbCustomers = await qbClient.getCustomers() as any[];

    // Get all dashboard patients
    const dashboardPatients = await query<{
      patient_id: string;
      full_name: string;
      email: string | null;
      phone_primary: string | null;
      payment_method_key: string;
    }>(`
      SELECT patient_id, full_name, email, phone_primary, payment_method_key
      FROM patients
      WHERE status_key NOT IN ('inactive', 'discharged')
    `);

    // Get existing mappings
    const existingMappings = await query<{
      patient_id: string;
      qb_customer_id: string;
    }>(`
      SELECT patient_id, qb_customer_id
      FROM patient_qb_mapping
      WHERE is_active = TRUE
    `);

    const mappedPatientIds = new Set(existingMappings.map(m => m.patient_id));
    const mappedQbCustomerIds = new Set(existingMappings.map(m => m.qb_customer_id));

    // Find potential matches
    const potentialMatches: Array<{
      patient: typeof dashboardPatients[0];
      qbCustomer: any;
      matchReason: string;
      confidence: 'high' | 'medium' | 'low';
    }> = [];

    for (const patient of dashboardPatients) {
      // Skip already mapped patients
      if (mappedPatientIds.has(patient.patient_id)) {
        continue;
      }

      for (const qbCustomer of qbCustomers) {
        // Skip already mapped QBO customers
        if (mappedQbCustomerIds.has(qbCustomer.Id)) {
          continue;
        }

        let matchReason = '';
        let confidence: 'high' | 'medium' | 'low' = 'low';

        // Check email match
        if (patient.email && qbCustomer.PrimaryEmailAddr?.Address) {
          const patientEmail = patient.email.toLowerCase().trim();
          const qbEmail = qbCustomer.PrimaryEmailAddr.Address.toLowerCase().trim();

          if (patientEmail === qbEmail) {
            matchReason = `Email match: ${patientEmail}`;
            confidence = 'high';
          }
        }

        // Check phone match
        if (!matchReason && patient.phone_primary && qbCustomer.PrimaryPhone?.FreeFormNumber) {
          const patientPhone = patient.phone_primary.replace(/\D/g, '');
          const qbPhone = qbCustomer.PrimaryPhone.FreeFormNumber.replace(/\D/g, '');

          if (patientPhone === qbPhone) {
            matchReason = `Phone match: ${patient.phone_primary}`;
            confidence = 'high';
          }
        }

        // Check name similarity (if no email/phone match)
        if (!matchReason) {
          const patientName = patient.full_name.toLowerCase().replace(/[^a-z\s]/g, '');
          const qbName = qbCustomer.DisplayName.toLowerCase().replace(/[^a-z\s]/g, '');

          // Simple similarity check
          const patientWords = patientName.split(/\s+/);
          const qbWords = qbName.split(/\s+/);

          const commonWords = patientWords.filter(word =>
            word.length > 2 && qbWords.some((qbWord: string) =>
              qbWord.includes(word) || word.includes(qbWord)
            )
          );

          if (commonWords.length >= 2) {
            matchReason = `Name similarity: "${patient.full_name}" ↔ "${qbCustomer.DisplayName}"`;
            confidence = 'medium';
          }
        }

        if (matchReason) {
          potentialMatches.push({
            patient,
            qbCustomer,
            matchReason,
            confidence
          });
        }
      }
    }

    // Sort by confidence
    potentialMatches.sort((a, b) => {
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });

    // Get patients with QuickBooks payment method but no mapping
    // Include both 'quickbooks' and 'jane_quickbooks' (mixed) patients
    const unmappedQuickBooksPatients = dashboardPatients.filter(p =>
      (p.payment_method_key === 'quickbooks' || p.payment_method_key === 'qbo' || p.payment_method_key === 'jane_quickbooks') 
      && !mappedPatientIds.has(p.patient_id)
    );

    // Get QBO customers with recurring transactions but no dashboard mapping
    const recurringCustomers = await qbClient.getActiveRecurringTransactions();
    const recurringCustomerIds = new Set(recurringCustomers.map(r => r.CustomerRef?.value).filter(Boolean));
    const unmappedRecurringCustomers = (qbCustomers as any[]).filter((c: any) =>
      recurringCustomerIds.has(c.Id) && !mappedQbCustomerIds.has(c.Id)
    );

    // Return all customers for mapping (not just potential matches)
    const allCustomers = qbCustomers.map((c: any) => ({
      Id: c.Id,
      DisplayName: c.DisplayName,
      PrimaryEmailAddr: c.PrimaryEmailAddr,
      PrimaryPhone: c.PrimaryPhone
    }));

    // Format unmapped recurring customers with full details for intake
    // We'll fetch full customer details (including address) when intake is triggered
    const unmappedRecurringForIntake = unmappedRecurringCustomers.map((c: any) => ({
      Id: c.Id,
      DisplayName: c.DisplayName,
      PrimaryEmailAddr: c.PrimaryEmailAddr?.Address || null,
      PrimaryPhone: c.PrimaryPhone?.FreeFormNumber || null
    }));

    return NextResponse.json({
      potentialMatches: potentialMatches.slice(0, 50), // Limit to top 50
      unmappedQuickBooksPatients,
      unmappedRecurringCustomers: unmappedRecurringForIntake,
      allCustomers, // Include all customers for manual mapping
      totalQbCustomers: qbCustomers.length,
      totalDashboardPatients: dashboardPatients.length,
      totalMappings: existingMappings.length
    });
  } catch (error) {
    console.error('Error in patient matching:', error);
    return NextResponse.json(
      { error: 'Failed to perform patient matching' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    const { patientId, qbCustomerId, matchMethod } = await req.json();

    if (!patientId || !qbCustomerId) {
      return NextResponse.json(
        { error: 'Patient ID and QuickBooks Customer ID are required' },
        { status: 400 }
      );
    }

    // Get customer details for the mapping
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      return NextResponse.json(
        { error: 'QuickBooks not connected' },
        { status: 400 }
      );
    }

    const customer = await qbClient.getCustomer(qbCustomerId);

    // Create the mapping
    await query(`
      INSERT INTO patient_qb_mapping (
        patient_id, qb_customer_id, qb_customer_email, qb_customer_name, match_method
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (patient_id, qb_customer_id) DO UPDATE SET
        qb_customer_email = EXCLUDED.qb_customer_email,
        qb_customer_name = EXCLUDED.qb_customer_name,
        match_method = EXCLUDED.match_method,
        updated_at = NOW()
    `, [
      patientId,
      qbCustomerId,
      customer.PrimaryEmailAddr?.Address || null,
      customer.DisplayName,
      matchMethod || 'manual'
    ]);

    // Update patient payment method if not already set
    await query(`
      UPDATE patients SET
        payment_method_key = 'quickbooks',
        updated_at = NOW()
      WHERE patient_id = $1 AND payment_method_key != 'quickbooks'
    `, [patientId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error creating patient mapping:', error);
    return NextResponse.json(
      { error: 'Failed to create patient mapping' },
      { status: 500 }
    );
  }
}
