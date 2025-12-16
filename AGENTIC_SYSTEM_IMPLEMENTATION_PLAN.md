# Agentic System Implementation Plan

## 0. Purpose

Provide a complete, code-level blueprint for the Healthie + GoHighLevel + Heidi + DEA + Telegram system. This document covers:

- Phase 0 (**Vendor/API certainty**) – everything we must verify before coding.
- Phase 1 (**Domain architecture**) – explicit module contracts, data models, and flow diagrams.
- Integration surfaces, safety gates, and logging expectations.

> No code is implemented yet. This is the design that every future edit must follow.

---

## 1. System Map

```
┌───────────────────────────┐
│ Interaction Layer         │
│  • Telegram bot           │
│  • Next.js dashboard      │
│  • Heidi visit outputs    │
└───────────────┬───────────┘
                │
┌───────────────▼───────────┐
│ Orchestrator (Agent)      │
│  • Intent + policy engine │
│  • Calls typed tools      │
└───────────────┬───────────┘
                │
┌───────────────▼───────────┐
│ Domain Modules (lib/*)    │
│  • patients               │
│  • clinical               │
│  • prescribing            │
│  • deaDomain              │
│  • messaging/scheduling   │
│  • payments               │
│  • analytics              │
│  • audit                  │
└───────────────┬───────────┘
                │
┌───────────────▼───────────┐
│ External Systems & DB     │
│  • Healthie GraphQL       │
│  • GoHighLevel REST       │
│  • Heidi API/webhooks     │
│  • Postgres (DEA, audit)  │
│  • AWS SES                │
└───────────────────────────┘
```

---

## 2. Phase 0 – Vendor & API Ground Truth

### 2.1 Healthie (GraphQL)

| Area | Questions / Tasks | Notes |
|------|-------------------|-------|
| **E-RX** | • Is non-controlled e-prescribing enabled on current plan?<br>• Does API allow `createPrescription/sendPrescription`?<br>• If not, can API create draft orders/tasks?<br>• Does API run allergy/interaction checks automatically? | Determine final flow for `lib/prescribing.ts`. |
| **Labs** | • Confirm schema for lab results (`client.lab_results` fields).<br>• Are reference ranges & flags included?<br>• Can we filter by date/test? | Needed for analytics + alerts. |
| **Medications / Allergies / Problems** | • Identify GraphQL fields for medication list, allergies, diagnoses.<br>• Confirm read/write abilities (e.g., add allergy). | Supplies safety checks. |
| **Payments** | • Confirm `createInvoice`, `assignPackage`, `subscription` mutations availability.<br>• Can we read payment status, payment methods, and subscription history via API?<br>• Are payment webhooks available? | Invoices + auto card capture plan. |
| **Webhooks / Events** | • Does Healthie support pushing events (labs ready, invoices paid, etc.)?<br>• If no, schedule polling cadence. | Impacts Phase 8 alerts. |
| **Rate limits** | • Request current per-minute/hour limits.<br>• Determine retry/backoff policy. | Build into HTTP client. |
| **PHI / HIPAA** | • Confirm Healthie allows connecting to AI orchestrators provided HIPAA compliance is maintained.<br>• Ask about any partner requirements for automation. | Document in compliance section. |

### 2.2 GoHighLevel (REST)

| Area | Questions / Tasks | Notes |
|------|-------------------|-------|
| **Messaging** | • Endpoint to send SMS/email to contact? (Need payload schema.)<br>• Rate limits, cost per SMS/email.<br>• Ability to use stored templates with merge vars.<br>• Delivery status webhooks? | Drives `lib/messaging.ts`. |
| **Appointments** | • APIs for create/update/cancel appointments.<br>• Time zone expectations.<br>• Identifiers (contactId vs email/phone). | For scheduling + reminders. |
| **Automations** | • Can automations be triggered via API?<br>• How to tag contacts or update pipelines? | Optional but useful for “follow-up sequences.” |
| **Webhooks** | • Contact reply events?<br>• Appointment changes?<br>• Failed automations? | Input signals for agent notifications. |

### 2.3 Heidi (Clinical AI)

| Area | Questions / Tasks |
|------|-------------------|
| **Data Access** | • API/webhook to fetch structured visit summaries? <br>• Can we tag visits with our `patient_id`? |
| **Data Shape** | • Does Heidi return structured JSON (HPI, Assessment, Plan) or only text? <br>• Are diagnoses, meds, orders explicitly listed? |
| **Usage Rights** | • Confirm ability to feed Heidi output into automation (labs, messages). |

### 2.4 Telegram Bot

| Item | Notes |
|------|-------|
| Message limit | 4096 characters per message; plan chunking for long reports. |
| Voice messages | Input voice -> Telegram handles speech-to-text; verify file size (≤20MB) and format conversions. |
| Rate limits | 30 messages/sec per bot; plan queue to avoid floods when sending multi-user alerts. |

### 2.5 AWS SES

| Item | Notes |
|------|-------|
| Domains | Confirm verified sending domains. |
| Content | Decide what content goes via SES vs GHL (SES for structured emails, GHL for patient SMS). |

### 2.6 Deliverable

Create/update documentation with definitive answers:

- Update `HEALTHIE_API_REFERENCE.md` with E-RX, labs, meds, allergies, payment answers.
- Create `GHL_API_REFERENCE.md` (if not existing) with endpoints, payloads, limits.
- Create `HEIDI_INTEGRATION_NOTES.md`.
- Add `TELEGRAM_LIMITS.md` (brief).

---

## 3. Phase 1 – Domain Architecture (Contracts & Data Flows)

### 3.1 Cross-System Data Ownership

| Domain | Source of Truth | Stored Locally? | Notes |
|--------|-----------------|-----------------|-------|
| Patient demographics | Healthie (clinical) + Postgres (master `patient_id`) | Yes, in `patients` table | Use DB as ID anchor; sync updates into Healthie/GHL. |
| Appointments & messaging | GoHighLevel | Mirror high-level info locally for analytics | Keep GHL as live comms system. |
| Clinical data (labs, meds, allergies, notes) | Healthie | Cache key summaries in DB if needed for performance | All clinical automation uses Healthie responses. |
| Payments (subscriptions, invoices) | Healthie | Mirror invoice status for dashboards | `healthie_*` tables already exist. |
| Controlled dispensing & DEA logs | Postgres | Yes | Only national DEA reporting uses DB records. |
| Analytics / alerts | Postgres + snapshots from external systems | Yes | `analytics` module aggregates. |

### 3.2 Module Contracts (*TypeScript-style definitions*)

#### 3.2.1 `lib/patients.ts`

```ts
export type PatientProfile = {
  patientId: string;
  fullName: string;
  dob?: string;
  email?: string;
  phone?: string;
  healthieClientId?: string;
  ghlContactId?: string;
};

export interface PatientsService {
  findByQuery(query: { name?: string; phone?: string; email?: string }): Promise<PatientProfile[]>;
  getById(patientId: string): Promise<PatientProfile>;
  ensureHealthieClient(patientId: string): Promise<string>;
  ensureGhlContact(patientId: string): Promise<string>;
  linkExternalIds(patientId: string, ids: { healthieClientId?: string; ghlContactId?: string }): Promise<void>;
}
```

**Implementation notes**
- Backed by `patients`, `healthie_clients`, `ghl_contacts`, etc.
- Always return match confidence when search is fuzzy; orchestrator must confirm ambiguous matches.

#### 3.2.2 `lib/clinical.ts`

```ts
export interface ClinicalService {
  getRecentLabs(patientId: string, opts?: { since?: string; limit?: number }): Promise<LabResult[]>;
  getLabTrends(patientId: string, analyte: string): Promise<LabTrend>;
  getMedicationList(patientId: string): Promise<Medication[]>;
  getAllergies(patientId: string): Promise<Allergy[]>;
  getProblems(patientId: string): Promise<Problem[]>;
  attachHeidiNote(patientId: string, note: HeidiNote): Promise<void>;
  createLabOrder(patientId: string, order: LabOrderInput): Promise<LabOrder>;
}
```

**Data Sources**: Healthie GraphQL (`client { lab_results, medications, allergies, problems }`).  
**Caching**: Optional short-term caching to reduce redundant queries.

#### 3.2.3 `lib/prescribing.ts`

```ts
export interface PrescriptionIntent {
  patientId: string;
  medication: {
    drugName: string;
    strength: string;
    route: string;
    frequency: string;
    durationDays?: number;
    quantity?: number;
    refills?: number;
    indication?: string;
  };
  pharmacy: {
    name: string;
    ncpdpId?: string;
    address?: string;
    phone?: string;
  };
}

export interface SafetyReport {
  allergies: AllergyCheckResult;
  interactions: InteractionCheckResult;
  refillWindowOk: boolean;
  notes: string[];
}

export interface PrescriptionDraft {
  id: string;
  patient: PatientProfile;
  intent: PrescriptionIntent;
  safety: SafetyReport;
  status: 'pending' | 'ready';
}

export interface PrescribingService {
  proposeNonControlledPrescription(intent: PrescriptionIntent): Promise<PrescriptionDraft>;
  submitPrescription(draftId: string): Promise<{ success: boolean; healthiePrescriptionId?: string }>;
}
```

**Safety**: Run checks via Healthie data + optional third-party drug database.  
**Control flow**: Draft must be confirmed by user before `submit`.

#### 3.2.4 `lib/deaDomain.ts`

```ts
export interface DeaService {
  recordDispense(input: DispenseInput): Promise<DispenseRecord>;
  signDispense(input: { dispenseId: string; signerUserId: string; note?: string; ip?: string }): Promise<void>;
  getUnsignedDispenses(): Promise<DispenseRecord[]>;
  generateDeaReport(range: { start: string; end: string }): Promise<DeaReport>;
  reconcileInventory(): Promise<InventoryStatus>;
}
```

**Backed by**: existing tables + `signDispense`.  
**Transactions**: Wrap every write in DB transaction + log to `audit`.

#### 3.2.5 `lib/messaging.ts`

```ts
export interface MessagingService {
  sendPatientMessage(patientId: string, payload: {
    channel: 'sms' | 'email';
    templateId?: string;
    body?: string;
    metadata?: Record<string, string>;
  }): Promise<MessageReceipt>;

  broadcast(plan: { patientIds: string[]; templateId: string; previewOnly?: boolean }): Promise<BroadcastPreview | BroadcastResult>;
}
```

**Implementation**: GoHighLevel API for SMS/email; SES optional for system emails.  
**Requirements**: Always log message payload + status; support preview mode for agent workflows.

#### 3.2.6 `lib/scheduling.ts`

```ts
export interface SchedulingService {
  schedule(patientId: string, details: AppointmentDetails): Promise<AppointmentRecord>;
  reschedule(appointmentId: string, newTime: string): Promise<void>;
  cancel(appointmentId: string, reason?: string): Promise<void>;
}
```

**Data Source**: GoHighLevel appointments endpoints.  
**Edge Cases**: Manage time zones, conflicting bookings.

#### 3.2.7 `lib/payments.ts`

```ts
export interface PaymentsService {
  ensurePaymentMethod(patientId: string): Promise<PaymentMethodStatus>;
  createInvoice(patientId: string, invoice: InvoiceInput): Promise<InvoiceRecord>;
  createBulkInvoices(criteria: BulkInvoiceCriteria): Promise<BulkInvoiceResult>;
  refreshPaymentStatuses(patientIds?: string[]): Promise<PaymentStatusSummary>;
}
```

**Data**: Healthie GraphQL + `healthie_invoices` table.  
**Side-effects**: Update local tables; log via `audit`.

#### 3.2.8 `lib/analytics.ts`

```ts
export interface AnalyticsService {
  getMorningBriefing(date: string): Promise<{
    schedule: ScheduleSummary;
    urgentLabs: LabAlert[];
    deaStatus: DeaStatusSummary;
    payments: PaymentAlert[];
    keyMetrics: PracticeMetrics;
  }>;

  getOverdueLabs(): Promise<OverdueLabReport>;
  getRevenueSummary(range: DateRange): Promise<RevenueSummary>;
  getDeaStatus(): Promise<DeaStatusSummary>;
}
```

**Implementation**: SQL queries (for DEA, revenue) + Healthie/GHL data for labs + scheduling.

#### 3.2.9 `lib/audit.ts`

```ts
export async function logEvent(event: {
  actorId: string;
  patientId?: string;
  action: string;
  system: 'HEALTHIE' | 'GHL' | 'DEA' | 'DB' | 'EMAIL' | 'TELEGRAM';
  payload: Record<string, any>;
}): Promise<void>;
```

**Storage**: `audit_events` table (columns: id, timestamp, actor, patient_id, system, action, payload JSONB).  
**Usage**: Called by every domain module before returning success.

### 3.3 GraphQL Layer (for Next.js UI)

- `lib/graphql/schema.ts` exposes UI queries/resolvers that **call domain modules only**.
- Example queries:
  - `morningBriefing(date) → AnalyticsService.getMorningBriefing`
  - `patientOverview(patientId) → combine Patients + Clinical`
  - `deaStatus → DeaService.getDeaStatus`

No business logic in React components; all flows reuse the same modules used by the agent.

### 3.4 Orchestrator / Agent Skeleton

- **Intent types**: `GET_SUMMARY`, `GET_LABS`, `SEND_MESSAGE`, `SCHEDULE`, `PRESCRIBE_NON_CONTROLLED`, `DISPENSE_CONTROLLED`, `INVOICE`, `DEA_REPORT`, etc.
- **Policies**:
  - Non-controlled prescriptions require human confirmation and safety check pass.
  - Controlled dispensing only via DEA module with explicit confirmation.
  - Bulk messaging/invoices require preview.
  - All actions log to `audit`.
- **Tools mapping**:

| Tool Name | Backing Module |
|-----------|----------------|
| `patientsTool` | `lib/patients` |
| `clinicalTool` | `lib/clinical` |
| `prescribingTool` | `lib/prescribing` |
| `deaTool` | `lib/deaDomain` |
| `messagingTool` | `lib/messaging` |
| `schedulingTool` | `lib/scheduling` |
| `paymentsTool` | `lib/payments` |
| `analyticsTool` | `lib/analytics` |

- **Adapters**:
  - Telegram: HTTP webhook -> orchestrator; replies via sendMessage/editMessage.
  - CLI/HTTP (optional) for development testing.

### 3.5 Data Flow Examples

#### 3.5.1 Non-Controlled Prescription
```
Telegram → orchestrator (intent PRESCRIBE_NON_CONTROLLED)
  → patients.findByQuery
  → clinical.getAllergies + getMedicationList
  → prescribing.proposeNonControlledPrescription
  → [User confirms]
  → prescribing.submitPrescription
  → messaging.sendPatientMessage (notify)
  → audit.logEvent
```

#### 3.5.2 Controlled Dispense (Testosterone)
```
Telegram → orchestrator (intent DISPENSE_CONTROLLED)
  → patients.getById
  → dea.recordDispense (transactional)
  → [Optional immediate sign via dea.signDispense]
  → messaging.sendPatientMessage
  → audit.logEvent
```

#### 3.5.3 Bulk Overdue Lab Messages
```
Telegram → orchestrator (intent BROADCAST_LAB_REMINDERS)
  → analytics.getOverdueLabs
  → messaging.broadcast (preview mode)
  → [User confirms]
  → messaging.broadcast (execute)
  → audit.logEvent
```

#### 3.5.4 Morning Briefing
```
Scheduled job → analytics.getMorningBriefing
  → Telegram push with buttons
```

### 3.6 Safety & Compliance Hooks

- **Allergy/interaction check** is mandatory for prescriptions; failure blocks submission.
- **DEA operations** require capturing signer identity + IP + timestamp.
- **Messaging** respects per-patient daily caps; templates stored centrally.
- **Audit log** entry required before returning success for any write.
- **Manual override** path for every automated suggestion (e.g., Heidi-based tasks).

---

## 4. Implementation Readiness Checklist

1. ✅ **Documentation updated** with Phase 0 answers (Healthie, GHL, Heidi, Telegram, SES).
2. ✅ **Domain module specs** documented (this file).
3. 🔲 **Code scaffolding** (coming next phases):
   - Create module files with interfaces + TODOs.
   - Update GraphQL schema to call these modules.
4. 🔲 **Agent skeleton** configured to use read-only tools first.

---

## 5. Next Actions (Post-Design)

1. Send vendor questions (Phase 0) and document responses.
2. Create stub implementations for each module with TypeScript interfaces.
3. Write automated tests (where feasible) for module contracts before wiring the agent.

This plan should be treated as the canonical reference. Any future coding should cite which section it implements and ensure compliance with the safety, logging, and ownership boundaries outlined above.

