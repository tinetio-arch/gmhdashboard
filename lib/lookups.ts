import { query } from './db';

export type StatusOption = {
  status_key: string;
  display_name: string;
  row_hex_color: string | null;
  dashboard_row_hex_color: string | null;
  dashboard_alert_hex: string | null;
};

export type PaymentOption = {
  method_key: string;
  display_name: string;
  hex_color: string | null;
};

export type ClientTypeOption = {
  type_key: string;
  display_name: string;
  hex_color: string | null;
  is_primary_care: boolean;
};

export type LookupSets = {
  statuses: StatusOption[];
  paymentMethods: PaymentOption[];
  clientTypes: ClientTypeOption[];
};

export async function fetchLookupSets(): Promise<LookupSets> {
  const [statuses, paymentMethods, clientTypes] = await Promise.all([
    query<StatusOption>(
      'SELECT status_key, display_name, row_hex_color, dashboard_row_hex_color, dashboard_alert_hex FROM patient_status_lookup WHERE is_active ORDER BY sort_priority ASC'
    ),
    query<PaymentOption>(
      `SELECT method_key, display_name, hex_color
         FROM payment_method_lookup
        WHERE is_active AND method_key <> 'qbo'
        ORDER BY display_name ASC`
    ),
    query<ClientTypeOption>(
      `SELECT type_key, display_name, hex_color, is_primary_care
         FROM client_type_lookup
        WHERE is_active AND type_key NOT IN ('other', 'mens_health_qbo')
        ORDER BY display_name ASC`
    )
  ]);

  return { statuses, paymentMethods, clientTypes };
}
