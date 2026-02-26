# Patient Workflows & Lifecycle Guide

**Last Updated**: January 14, 2026
**Status**: ACTIVE SOURCE OF TRUTH

This document defines the standard operating procedures (SOPs) for the three main patient tracks at Granite Mountain Health (GMH). All automation, staff training, and system configurations must align with these workflows.

---

## 1. Men's Health (TRT & Hormone Optimization)

**Goal**: Seamless onboarding for testosterone replacement therapy (TRT) and hormone optimization, ensuring DEA compliance and consistent monitoring.

### Phase 1: Intake & Discovery
> [!IMPORTANT]
> **Intake Flow Configuration**:
> The "Men's Health" Intake Flow must include **BOTH** the specific Men's forms **AND** the Standard forms (HIPAA, Consent to Treat, AI Scribe). Healthie only assigns ONE flow per group, so the Men's flow must be a "Master Flow".
> **Action Required**: Manually add "Consent to Treat" and "AI Scribe Consent" to the `NOWMensHealth.Care HRT/Peptide Client` flow.

1.  **Lead Capture**
    *   **Source**: Website / Ad -> GoHighLevel (GHL) Form.
    *   **Automation**:
        *   GHL creates "Opportunity" in Pipeline.
        *   "Max" (AI Voice Agent) calls lead to qualify and book Discovery Call (if needed) or Initial Consult.
2.  **Healthie Group Assignment (CRITICAL)**
    *   **All TRT/Injection Patients**: Must be added to Group **"NowMensHealth.Care"** (ID: 75522).
    *   **Automation**: Triggers Intake Flow: *"NOWMensHealth.Care HRT/Peptide Client"*.
3.  **Pre-Consult Requirements**
    *   **Lab Work**: Patient must complete initial blood panel *before* the provider visit.
    *   **Forms (in Intake Flow)**:
        *   "NOWOPTIMAL Patient Intake Form".
        *   "NOWMensHealth.Care Clinic Policies".
        *   "HIPAA Agreement".
4.  **Initial Consultation (45 min)**
    *   **Location**: **NOW Men's Health** (215 N McCormick).
    *   **Appointment Type**: `Initial Male Hormone Replacement Consult`.
    *   **Provider**: Aaron Whitten or Phil Schafer.
    *   **Action**: Review labs, diagnose hypogonadism/deficiency, extensive education.
    *   **Decision**: Start Therapy? (Y/N).

### Phase 2: Treatment Initiation
1.  **Prescription & Plan (Injections)**
    *   **Location**: **NOW Men's Health** (McCormick St).
    *   **Script**: Testosterone Cypionate (sent to pharmacy or in-house).
2.  **First Dose / Teach**
    *   **In-Office**: Nurse/MA teaches self-injection technique.
    *   **Documentation**: "Injection Training Checklist".

### Phase 2b: Pellet Workflow (Separate Track)
*   **Location**: **NOW Primary Care** (212 S Montezuma) - *Pellets are ONLY done here.*
*   **Group**: Patient must be in Group **"Pelleting Client"** (ID: 75977).
*   **Intake Flow**: *Currently falls back to 'Default' - Needs specific 'Pellet Consent' added manually.*
*   **Appointments**: `EvexiPel Initial Pelleting Procedure`.

### Phase 3: Maintenance & Monitoring
1.  **Recurring Billing**
    *   **Membership**: Setup recurring monthly Stripe subscription in Healthie for management fee (if applicable).
2.  **Monitoring Schedule**
    *   **6 Weeks**: "Lab Review" appointment (15 min) + repeat blood work (CBC, PSA, Total/Free T, Estradiol).
    *   **Every 3-6 Months**: Regular follow-ups.
3.  **Refills**
    *   **Request**: Patient requests via Portal or SMS.
    *   **Automation**: "Jessica" checks last visit date. If > 6 months, require appointment. If < 6 months, task provider for refill.

---

## 2. Weight Loss (Medical Weight Management)

**Goal**: Safe, effective weight loss using GLP-1s (Semaglutide/Tirzepatide) with tight inventory control.

### Phase 1: Intake
> [!IMPORTANT]
> **Intake Flow Configuration**:
> The "Weight Loss" Intake Flow is currently empty.
> **Action Required**: Manually add "HIPAA", "Consent to Treat", "AI Scribe", "Medical History", and "Weight Loss Agreement" to the `Weight Loss Program Client` flow.

1.  **Lead Capture & Triage**
    *   **Qualifying**: BMI > 27 (with co-morbidity) or > 30. Exclusion check (Medullary thyroid cancer history).
2.  **Healthie Group Assignment**
    *   **Group**: **"Weight Loss"** (ID: 75976).
    *   **Automation**: Triggers Intake Flow *"Weight Loss Program Client"*.
    *   *Warning*: This flow is currently EMPTY (only Welcome). Staff must manually send the "Weight Loss Program Agreement".
3.  **Initial Visit (30 min)**
    *   **Location**: Can be either, but typically **NOW Men's Health** (McCormick) for integrated metabolic health.
    *   **Appointment Type**: `Weight Loss Consult`.

### Phase 2: Active Weight Loss
1.  **Titration Schedule** (Typical)
    *   Month 1: 0.25 mg weekly.
    *   Month 2: 0.5 mg weekly.
    *   Month 3: 1.0 mg weekly.
    *   *Note*: Doses adjusted based on tolerance and results.
2.  **Dispensing / Administration**
    *   **Option A (In-Office)**: Weekly nurse visit (`Weight Loss Injection - 10 min`).
    *   **Option B (Home)**: Pre-filled syringes dispensed monthly (Requires "Staged Dose" workflow in Dashboard).
3.  **Inventory Logging (CRITICAL)**
    *   Staff **MUST** log every ml dispensed in the "Inventory" tab of GMH Dashboard.
    *   **Forms**: "Semaglutide/Tirzepatide Consent".

### Phase 3: Maintenance
1.  **Goal Reached**: Transition to maintenance dose or taper off.
2.  **Billing**: Automated monthly membership or pay-per-vial.
    *   *System Note*: Ensure `HEALTHIE_BILLING_ITEMS` sync detects payment to unlock inventory dispensing.

---

## 3. Primary Care (Membership Model)

**Goal**: Concierge-style primary care with low wait times and high availability for members.

### Phase 1: Enrollment
1.  **Location & Group**
    *   **Location**: **NOW Primary Care** (212 S Montezuma).
    *   **Group**: **"NowPrimary.Care"** (ID: 75523) or **"Pelleting Client"** (ID: 75977).
    *   **Automation**: Triggers **Default Intake Flow**.
    *   **Default Flow Content**:
        *   HIPAA Agreement.
        *   Consent to Treat.
        *   AI Scribe Consent.
        *   New Patient Medical History Questionnaire.
    *   *Note*: This is perfect for general sick visits. For Pellets, you may need to manually add a "Pellet Consent" if it's not in the general consent.
2.  **Membership Selection**
    *   **Tier 1: Elite** (Full access, $X/mo).
    *   **Tier 2: Premier** (Limited visits, $Y/mo).
    *   **Tier 3: TCMH** (Transitional Care, short term).
2.  **Forms**
    *   "Primary Care Membership Agreement" (Auto-renewal terms, 30-day cancel notice).
    *   "Medical History Comprehensive".

### Phase 2: Care Delivery
1.  **Access**
    *   **Appointments**: Same-day/Next-day for acute issues.
    *   **Communication**: Portal messaging + "Jessica" AI triage.
2.  **Annual Wellness**
    *   **Appointment**: `Annual Physical (60 min)`.
    *   **Labs**: Comprehensive panel (Metabolic, Lipid, Thyroid, etc.).

### Phase 3: Billing & Admin
1.  **Payment Failure Handling**
    *   **Trigger**: Stripe webhook -> GMH processed.
    *   **Action**: Status changed to `Hold - Payment Research`.
    *   **Notification**: Automated SMS to update card. Provider alerted not to book until resolved.

---

## System Integration Points (The "Source of Truth")

| Trigger Event | System Action | Owner |
| :--- | :--- | :--- |
| **New Lead** | Create GHL Contact + Add to "New Lead" Pipeline | GHL / Max AI |
| **Intake Form Completed** | Update Healthie Profile (Meds/Allergies) | Healthie Webhook |
| **Vial Dispensed** | Decrement Inventory + Create Financial Record | GMH Dashboard |
| **Payment Failed** | Set Status `Hold` + SMS Patient | `process-healthie-webhooks.ts` |
| **Visit Completed** | Generate Scribe Note + Send for Approval | `scribe_orchestrator.py` |

## Emergency / Exception Workflows

*   **AE (Adverse Event)**: Any severe reaction -> Immediate escalation to Medical Director + Incident Report Form.
*   **DEA Audit**: Staff initiates "Morning Check" via Telegram (`/check`) or Dashboard.
*   **System Outage**: All paper logging; back-entry into Dashboard within 24 hours.
