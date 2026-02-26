# Patient Workflow Routing Guide

## Patient Types & Workflows

### 1. Sick Visit
**Trigger**: Patient says "I'm sick", "not feeling well", "need to be seen today"
**Who**: Anyone needing acute care, may not be established patient
**Workflow**: 
- Collect: Name, DOB, symptoms, insurance
- Send Sick Visit intake forms via Healthie
- Offer same-day or next-day appointment if available
- Tag in GHL: `SickVisit`, `urgent_care`

### 2. Primary Care
**Trigger**: Annual exam, physical, check-up, wellness visit, routine care
**Who**: Established or new patients for ongoing primary care
**Workflow**:
- Send Primary Care intake paperwork
- Schedule routine appointment
- Tag in GHL: `PrimaryCare`

### 3. Pelleting
**Trigger**: Patient mentions hormone pelleting, pellet therapy
**Who**: Patients seeking hormone pellet therapy
**Workflow**:
- Send Pelleting-specific intake forms
- Schedule pellet consultation
- Tag in GHL: `Pelleting`

### 4. Weight Loss
**Trigger**: Weight loss, GLP-1, Semaglutide, Ozempic, weight management
**Who**: Patients seeking medical weight loss treatment
**Workflow**:
- Send Weight Loss intake paperwork
- Schedule weight loss consultation
- Tag in GHL: `WeightLoss`

### 5. Men's Health
**Trigger**: Testosterone, TRT, Low T, men's health, ED, hormones
**Who**: Male patients seeking hormone/sexual health treatment
**Action**: **DO NOT HANDLE - TRANSFER TO NOWMENSHEALTH.CARE**
- Transfer to: 928-212-2772
- Location: 215 N. McCormick St, Prescott, AZ 86301

---

## Decision Flow

```
Patient calls
    │
    ├─→ Known in GHL?
    │   ├─→ YES: Verify DOB
    │   │   ├─→ Has Healthie ID + Paperwork Complete?
    │   │   │   ├─→ YES: Proceed with request (appointment, refill, etc.)
    │   │   │   └─→ NO: "We need to update your info. What brings you in?"
    │   │   │       └─→ Route to appropriate workflow ↓
    │   └─→ NO: "Are you a new patient?"
    │       └─→ YES: Route to appropriate workflow ↓
    │
    └─→ What do they need?
        ├─→ "I'm sick" → Sick Visit Workflow
        ├─→ "Annual/Physical/Check-up" → Primary Care Workflow
        ├─→ "Pelleting/Pellets" → Pelleting Workflow
        ├─→ "Weight loss/GLP-1" → Weight Loss Workflow
        └─→ "Testosterone/Men's health" → TRANSFER to 928-212-2772
```

---

## Healthie Workflow Assignments

When creating/updating patients in Healthie, assign to user group:

| Patient Type | Healthie Group ID (env var) | Triggers |
|-------------|----------------------------|----------|
| Sick Visit | `HEALTHIE_SICK_VISIT_GROUP_ID` | Sick visit intake forms |
| Primary Care | `HEALTHIE_PRIMARY_CARE_GROUP_ID` | Primary care intake forms |
| Pelleting | `HEALTHIE_PELLETING_GROUP_ID` | Pelleting intake forms |
| Weight Loss | `HEALTHIE_WEIGHT_LOSS_GROUP_ID` | Weight loss intake forms |

Each group auto-triggers the appropriate intake workflow in Healthie.

---

## GHL Tags to Apply

| Situation | Tags to Add |
|-----------|-------------|
| New patient created via Jessica | `via_jessica_ai`, `new_patient`, `[PatientType]` |
| Existing patient needs workflow | `needs_workflow`, `[PatientType]` |
| Sick visit (urgent) | `SickVisit`, `urgent_care` |
| Callback requested | `callback_lab_results` or `callback_imaging_results` |
| Men's health (transferred) | `transferred_to_mens_health` |

---

## Custom Fields to Track

| Field | Purpose | Values |
|-------|---------|--------|
| `healthie_patient_id` | Link to Healthie record | Healthie user ID |
| `paperwork_complete` | Intake forms done? | "true" / "false" |
| `patient_type` | Primary service line | SickVisit, PrimaryCare, Pelleting, WeightLoss |
| `last_workflow_date` | When workflow was sent | ISO date |
| `created_by` | How patient was added | "Jessica AI", "Manual", "Website" |

---

## Workflow Completion Detection

After sending patient to workflow in Healthie, track completion:

1. **Healthie webhook** fires when forms completed
2. **Update GHL** custom field: `paperwork_complete: "true"`
3. **Remove tag**: `needs_workflow`
4. **Add tag**: `ready_for_appointment`
5. **Notify Google Chat**: Patient ready to schedule

---

## Google Chat Notifications

### Callback Requests (Lab/Imaging)
**Sent to**: Appropriate space based on patient type
**Timeframe**: 24-72 hours
**Contains**: Patient name, phone, request type, GHL link

**Task Tracking**:
- [ ] Provider callback requested: [Date/Time]
- [ ] Provider contacted patient: [Date/Time]
- [ ] Outcome: [Resolved / Needs follow-up / No answer]

### Workflow Assignments
**Sent to**: Appropriate space
**Contains**: "New [Type] patient needs intake review"

---

## Examples

### Example 1: Sick Call (Not Established)
```
Caller: "Hi, I'm really sick and need to be seen today."
Jessica: "I'm sorry you're not feeling well. Are you an existing patient with us?"
Caller: "No, I've never been there."
Jessica: "No problem. Let me get you set up. What's your name?"
[Collect info → create_new_patient with type: "SickVisit"]
Jessica: "I've created your account and sent you intake paperwork. 
Given that you're sick, let me see if we have same-day availability..."
[Check availability → Offer urgent slots]
```

### Example 2: Established Patient, Missing Paperwork
```
Caller: "I'd like to schedule a physical."
Jessica: "I'll pull up your account. What's your date of birth?"
[Verify → healthie_patient_id missing]
Jessica: "I see you in our system, John. We're updating our records. 
I'll get you set up with our primary care intake workflow and then 
we can schedule your physical. You'll receive an email with the forms 
shortly. Should only take about 10 minutes to complete."
```

### Example 3: Weight Loss Patient (Complete)
```
Caller: "I need a refill on my Semaglutide."
Jessica: "I can help with that. Date of birth?"
[Verify → has healthie_patient_id + paperwork complete]
Jessica: "Great! I've got your info, Sarah. I'll send a message to your 
provider about your Semaglutide refill. Which pharmacy?"
```

---

## Quick Reference: When to Route vs Transfer

**Route to Workflow** (Jessica handles):
- Sick Visit
- Primary Care
- Pelleting
- Weight Loss

**Transfer to Men's Health** (Jessica does NOT handle):
- Testosterone
- TRT
- Men's hormones
- ED treatment
- Any men's health specific

---

This guide ensures consistent patient routing and proper workflow assignment!
