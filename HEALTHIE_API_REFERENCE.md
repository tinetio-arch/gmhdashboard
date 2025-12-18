# Healthie API Complete Reference

Based on official Healthie API documentation: https://docs.gethealthie.com/

## Overview

Healthie is an **API-first platform** with a comprehensive **GraphQL API** that provides full access to all Healthie features.

---

## Authentication

### Method: Basic Authentication with API Key

```typescript
headers: {
  'Authorization': 'Basic YOUR_API_KEY_HERE',
  'AuthorizationSource': 'API',
  'Content-Type': 'application/json'
}
```

### Getting API Access

1. Log into your Healthie account
2. Complete "Activate a Partner" form
3. Healthie support will email you an API key
4. Use the API key in the `Authorization` header

### API Endpoint

```
https://api.gethealthie.com/graphql
```

---

## Core Concepts

### GraphQL Schema

Healthie uses GraphQL, which means:
- ✅ Query exactly what you need
- ✅ Get related data in one request
- ✅ Type-safe with introspection
- ✅ Real-time operations

### Key Types

- **Client** - Patient/client records
- **Package** - Recurring payment plans
- **Subscription** - Active package assignments
- **Invoice** - Billing invoices
- **Payment** - Payment transactions (via Stripe)
- **Appointment** - Scheduled sessions
- **Form** - Client intake forms
- **Document** - Client documents

---

## Common Queries

### Get Current User (Test Connection)

`currentUser` is the canonical “who am I?” query. Use it immediately after configuring the API key.

```graphql
query TestConnection {
  currentUser {
    id
    email
    first_name
    last_name
  }
}
```

Example response:

```json
{
  "data": {
    "currentUser": {
      "id": "12088269",
      "email": "admin@granitemountainhealth.com",
      "first_name": "Phil",
      "last_name": "Schafer"
    }
  }
}
```

If you call `me` you will receive `Field 'me' doesn't exist on type 'Query'`, so always use `currentUser`.

### Schema Discovery

Healthie allows full GraphQL introspection. Run queries like the following to see every field that exists, then pin the ones relevant to your workflows:

```graphql
{
  __schema {
    queryType {
      fields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
          }
        }
      }
    }
  }
}
```

From introspection we confirmed fields such as `appointments`, `labOrders`, `labResult`, `medications`, `medication`, `pharmacies`, `prescriptions`, `subscription`, and many others.

### Get Client / User Records

Use the `user`/`users` queries to fetch patient demographics (clients are specialized users):

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    email
    first_name
    last_name
    phone_number
    dob
    address
    city
    state
    zip
    created_at
    updated_at
  }
}
```

Search by contact info:

```graphql
query FindUsers($email: String, $phone: String) {
  users(email: $email, phone_number: $phone) {
    id
    email
    phone_number
    first_name
    last_name
  }
}
```

Maintain a local `patient_id ↔ Healthie user_id` map to avoid fuzzy matching downstream.

### Appointments

`appointment(id: ID!)` and `appointments(...)` expose scheduling data.

```graphql
query UpcomingAppointments($userId: ID!, $start: ISO8601DateTime!, $end: ISO8601DateTime!) {
  appointments(user_id: $userId, start_at: $start, end_at: $end) {
    id
    start_at
    end_at
    status
    appointment_type { id name }
    location { id name }
  }
}
```

### Labs & Results

Use `labOrders` to list IDs by patient, then detail each via `labResult`.

```graphql
query LabResultDetail($resultId: ID!) {
  labResult(id: $resultId) {
    id
    lab_order_id
    interpretation
    status_flag
    lab_observation_requests {
      lab_analyte
      lab_observation_results {
        quantitative_result
        qualitative_result
        units
        reference_range
        is_abnormal
        interpretation
      }
    }
    document { id download_url }
  }
}
```

Useful fields (per introspection):

- `LabResult`: `patient`, `ordering_physician`, `interpretation`, `status_flag`, `result_type`, `document`.
- `LabObservationResult`: `quantitative_result`, `qualitative_result`, `units`, `reference_range`, `is_abnormal`, `abnormal_flag`, `notes`.

### Medications

`medications(user_id: ID!, active: Boolean, search: String, ...) : [MedicationType!]`

```graphql
query ActiveMedications($patientId: ID!) {
  medications(user_id: $patientId, active: true) {
    id
    name
    dosage
    frequency
    route
    directions
    normalized_status
    start_date
    end_date
  }
}
```

`MedicationType` exposes `active`, `normalized_status`, `dosage`, `frequency`, `route`, `directions`, `start_date`, `end_date`, `code`, `comment`, and audit timestamps.

### Prescriptions & Pharmacies (E-RX)

- `prescriptions(user_id: ID!, status: String, limit: Int)`
- `prescription(id: ID!)`
- `pharmacies(search: String!, limit: Int)`

`Prescription` fields: `product_name`, `dosage`, `directions`, `quantity`, `refills`, `unit`, `route`, `days_supply`, `date_written`, `status`, `normalized_status`, `pharmacy`, `prescriber_name`, `rx_reference_number`, `ndc`, `schedule`, `first_prescription_diagnosis`, `second_prescription_diagnosis`.

`Pharmacy` fields: `name`, `line1`, `line2`, `city`, `state`, `zip`, `phone_number`, `latitude`, `longitude`.

> Healthie routes transmissions through DoseSpot; confirm with support whether API-based submission is enabled or limited to read/draft access.

### Subscriptions & Recurring Payments

`subscription(id: ID!) : SubscriptionInstance`

Notable fields: `plan_name`, `interval`, `monthly_cost_of_base_plan`, `annual_total`, `credit_balance`, `is_trialing`, `set_to_cancel`, `has_scheduled_change`, `trial_end_at`, `access_will_stop_at`, `card_type`, `last_four`, `card_expiration`, `stripe_subscription_id`, `stripe_plan`, `last_invoice`, `upcoming_invoice`.

Manage lifecycle with `assignPackage`, `cancelPackageAssignment`, `pauseSubscription`, etc.

### Requested Payments / Invoices

`requestedPayments(client_id: ID!, status: String) : [RequestedPayment!]`

```graphql
query RequestedPayments($clientId: ID!, $status: String) {
  requestedPayments(client_id: $clientId, status: $status) {
    id
    amount
    description
    status
    due_date
    invoice_number
    client { id first_name last_name }
  }
}
```

Pair with `createInvoice` (mutation) to issue new invoices and capture payment methods.

### Get All Packages

```graphql
query GetPackages {
  packages {
    id
    name
    description
    price
    billing_frequency
    number_of_sessions
    created_at
  }
}
```

---

## Common Mutations

### Create Client

```graphql
mutation CreateClient($input: createClientInput!) {
  createClient(input: $input) {
    client {
      id
      user_id
      first_name
      last_name
      email
      phone_number
      created_at
    }
  }
}
```

**Input:**
```typescript
{
  first_name: string
  last_name: string
  email?: string
  phone_number?: string
  dob?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}
```

### Update Client

```graphql
mutation UpdateClient($id: ID!, $input: updateClientInput!) {
  updateClient(id: $id, input: $input) {
    client {
      id
      first_name
      last_name
      email
      phone_number
    }
  }
}
```

### Create Package

```graphql
mutation CreatePackage($input: createPackageInput!) {
  createPackage(input: $input) {
    package {
      id
      name
      description
      price
      billing_frequency
      number_of_sessions
    }
  }
}
```

**Input:**
```typescript
{
  name: string
  description?: string
  price: number
  billing_frequency: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  number_of_sessions?: number
}
```

### Assign Package to Client (Create Subscription)

```graphql
mutation AssignPackage($input: assignPackageInput!) {
  assignPackage(input: $input) {
    subscription {
      id
      client_id
      package_id
      status
      start_date
      next_charge_date
      amount
    }
  }
}
```

**Input:**
```typescript
{
  client_id: string
  package_id: string
  start_date?: string  // ISO date string
}
```

### Create Invoice

```graphql
mutation CreateInvoice($input: createInvoiceInput!) {
  createInvoice(input: $input) {
    invoice {
      id
      client_id
      invoice_number
      amount
      status
      due_date
      created_at
    }
  }
}
```

**Input:**
```typescript
{
  client_id: string
  amount: number
  description?: string
  due_date?: string  // ISO date string
  send_email?: boolean
}
```

---

## Payment Methods

### Check if Client Has Payment Method

```graphql
query GetClientPaymentMethods($clientId: ID!) {
  client(id: $clientId) {
    payment_methods {
      id
      type
      last_four
      is_default
      expires_at
    }
  }
}
```

**Note:** Payment methods are stored securely via Stripe integration. When clients pay invoices, their payment method is automatically saved.

---

## Billing Frequencies

Healthie supports these billing frequencies:
- `one_time` - Single payment
- `weekly` - Weekly recurring
- `biweekly` - Every 2 weeks
- `monthly` - Monthly recurring
- `quarterly` - Every 3 months
- `yearly` - Annual

---

## Subscription Statuses

- `active` - Subscription is active and charging
- `cancelled` - Subscription has been cancelled
- `paused` - Subscription is temporarily paused

---

## Invoice Statuses

- `draft` - Invoice created but not sent
- `sent` - Invoice sent to client
- `paid` - Invoice has been paid
- `cancelled` - Invoice was cancelled

---

## Error Handling

Healthie API returns errors in GraphQL format:

```json
{
  "errors": [
    {
      "message": "Error message here",
      "extensions": {
        "code": "ERROR_CODE"
      }
    }
  ]
}
```

Common error codes:
- `UNAUTHENTICATED` - Invalid or missing API key
- `NOT_FOUND` - Resource doesn't exist
- `VALIDATION_ERROR` - Invalid input data
- `PERMISSION_DENIED` - Insufficient permissions

---

## Rate Limits

Healthie API has rate limits (check documentation for current limits). Best practices:
- Implement retry logic with exponential backoff
- Cache frequently accessed data
- Batch operations when possible

---

## Integration Best Practices

### 1. Error Handling

```typescript
try {
  const result = await healthie.createClient(input);
} catch (error) {
  if (error.message.includes('UNAUTHENTICATED')) {
    // Handle auth error
  } else if (error.message.includes('NOT_FOUND')) {
    // Handle not found
  } else {
    // Handle other errors
  }
}
```

### 2. Retry Logic

```typescript
async function createClientWithRetry(input, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await healthie.createClient(input);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
}
```

### 3. Batch Operations

When migrating many patients:
- Process in batches (e.g., 10 at a time)
- Add delays between batches
- Track progress in database
- Handle failures gracefully

---

## Developer Tools

### Healthie Dev Assist

Healthie provides "Dev Assist" tool that:
- Integrates with AI development tools
- Helps write and test GraphQL queries
- Provides real-time API exploration
- Can be used without API key (sandbox mode)

Access: https://help.gethealthie.com/article/1290-healthie-dev-assist

---

## Stripe Integration

Healthie has built-in Stripe integration:
- ✅ Payment processing handled by Healthie/Stripe
- ✅ Payment methods stored securely
- ✅ Recurring charges automated
- ✅ Invoice payments automatically processed

You don't need to integrate Stripe separately - Healthie handles it!

---

## Migration Strategy

### Phase 1: Setup
1. Get API credentials
2. Test connection
3. Create packages (migrate from QuickBooks plans)

### Phase 2: Client Migration
1. For each patient:
   - Check if exists in Healthie (by email/phone)
   - Create if doesn't exist
   - Update if exists
   - Store Healthie client ID in your database

### Phase 3: Subscription Setup
1. For each patient with recurring payment:
   - Find/create matching package
   - Assign package to client
   - Set start date
   - Track subscription ID

### Phase 4: Invoice Setup
1. Send invoices to all migrated clients
2. Track payment status
3. Verify payment methods saved

---

## Resources

- **API Documentation**: https://docs.gethealthie.com/
- **GraphQL Schema Explorer**: Available in Healthie dashboard
- **Support**: Contact Healthie support for API access
- **Dev Assist**: https://help.gethealthie.com/article/1290-healthie-dev-assist

---

## Summary

✅ **Use Healthie GraphQL API** for:
- Real-time operations
- Creating/updating clients
- Managing subscriptions
- Processing payments
- Full CRUD access

❌ **Don't use Bridge** for:
- Operations (it's read-only)
- Real-time needs (15 min delay)
- Creating data (can't create)

Your current implementation is on the right track - just needs authentication fix!

