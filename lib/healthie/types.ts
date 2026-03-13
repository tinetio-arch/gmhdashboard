/**
 * Healthie API Type Definitions
 *
 * All TypeScript types and interfaces for Healthie API integration.
 *
 * See: https://docs.gethealthie.com/
 */

export type HealthieConfig = {
  apiKey: string;
  apiUrl?: string;
  trtRegimenMetadataKey?: string;
  lastDispenseMetadataKey?: string;
};

export type HealthieClientData = {
  id: string;
  user_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  dob?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  created_at?: string;
  updated_at?: string;
  user_group_id?: string;
  active?: boolean;
};

export type HealthieUserRecord = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  dob?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HealthieLocationInput = {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type UpdateClientPayload = Partial<CreateClientInput> & {
  location?: HealthieLocationInput;
  active?: boolean;
};

export type HealthiePackage = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  billing_frequency?: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  number_of_sessions?: number;
  created_at?: string;
  updated_at?: string;
};

export type HealthieSubscription = {
  id: string;
  client_id: string;
  package_id: string;
  status?: 'active' | 'cancelled' | 'paused';
  start_date?: string;
  next_charge_date?: string;
  amount?: number;
  offering_name?: string;
  billing_frequency?: string;
  billing_items_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type CreateClientInput = {
  first_name: string;
  last_name: string;
  email?: string;
  phone_number?: string;
  dob?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  dietitian_id?: string;
  metadata?: string;
  user_group_id?: string;
  additional_record_identifier?: string;
  record_identifier?: string;
  restricted?: boolean;
  dont_send_welcome?: boolean;
  skipped_email?: boolean;
  skip_set_password_state?: boolean;
  gender?: string;
  legal_name?: string;
  ssn?: string;
  timezone?: string;
  other_provider_ids?: string[];
};

export type CreatePackageInput = {
  name: string;
  description?: string;
  price: number;
  billing_frequency: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  number_of_sessions?: number;
};

export type AssignPackageInput = {
  client_id: string;
  package_id: string;
  start_date?: string;
};

export type HealthieInvoice = {
  id: string;
  client_id: string;
  invoice_number?: string;
  amount: number;
  status?: 'draft' | 'sent' | 'paid' | 'cancelled';
  due_date?: string;
  created_at?: string;
  updated_at?: string;
};

export type CreateInvoiceInput = {
  client_id: string;
  amount: number;
  description?: string;
  due_date?: string;
  send_email?: boolean;
};

export type HealthiePaymentMethod = {
  id: string;
  type: string;
  last_four?: string | null;
  is_default?: boolean | null;
  expires_at?: string | null;
};

export type HealthieMedication = {
  id: string;
  name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  directions?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  normalized_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HealthieAllergy = {
  id: string;
  name?: string | null;
  reaction?: string | null;
  severity?: string | null;
  notes?: string | null;
};

export type HealthiePrescription = {
  id: string;
  product_name?: string | null;
  dosage?: string | null;
  directions?: string | null;
  quantity?: string | null;
  refills?: string | null;
  unit?: string | null;
  route?: string | null;
  days_supply?: number | null;
  date_written?: string | null;
  status?: string | null;
  normalized_status?: string | null;
  pharmacy?: HealthiePharmacy | null;
  prescriber_name?: string | null;
  rx_reference_number?: string | null;
  ndc?: string | null;
  schedule?: string | null;
};

export type HealthiePharmacy = {
  id: string;
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone_number?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

export type CreateChartNoteInput = {
  client_id: string;
  body: string;
  title?: string;
  status?: string;
  author_id?: string;
  template_id?: string;
};

export type HealthieChartNote = {
  id: string;
  title?: string | null;
  status?: string | null;
  body?: string | null;
};

export type HealthieBillingItem = {
  id: string;
  amount_paid: string | null;
  amount_paid_string: string | null;
  state: string | null;
  created_at: string | null;
  offering_name: string | null;
  payment_medium: string | null;
  shown_description: string | null;
  recipient_name: string | null;
};
