# SOP: QuickBooks Patient Dispense Override

**Effective Date**: January 14, 2026  
**Department**: Men's Health  
**Purpose**: Procedure for dispensing testosterone to patients who use QuickBooks billing when absolutely necessary

---

## Background

Patients with QuickBooks as their payment method are being migrated to Healthie EMR billing. Until migration is complete, the system will block dispensing to these patients by default.

However, there are situations where you may need to dispense urgently. This SOP explains the override process.

---

## When You Will See This Warning

When you select a patient in the Transactions page who has "QuickBooks" as their method of payment:

1. A **red warning box** appears: "⛔ Dispense Restricted"
2. The patient's **last successful payment date and amount** is displayed (if available)
3. A **"Request Override"** button is shown

---

## Override Procedure

### Step 1: Verify Patient Eligibility
Before requesting an override, confirm:
- [ ] Patient has a valid prescription on file
- [ ] Patient is in good standing (labs current, no holds)
- [ ] There is a legitimate clinical reason to dispense today

### Step 2: Request Override
1. Click the **"Request Override"** button
2. A text box will appear requesting a reason
3. Enter a **clear, specific reason** for the override, for example:
   - "Patient traveling tomorrow, cannot wait for billing migration"
   - "Urgent clinical need per Dr. Whitten"
   - "Billing migration scheduled for next week"

### Step 3: Submit Override
1. Click **"Confirm Override & Notify Billing"**
2. The system will:
   - Send a notification to the Billing team via Google Chat
   - Allow you to proceed with the dispense
3. The warning box will turn **yellow** showing "⚠️ Override Active"

### Step 4: Complete Dispense
- Fill in all dispense details as normal
- Click **Record Dispense**
- The transaction will be logged with the override reason noted

---

## What Happens After Override

1. **Billing team receives immediate notification** with:
   - Patient name
   - Override reason
   - Staff member who dispensed
   - Date/time

2. **Billing team must** prioritize migrating this patient to Healthie EMR

3. **Transaction is logged** in the DEA log as normal

---

## Important Notes

⚠️ **Do NOT use override as a routine workaround**. The goal is to migrate all QuickBooks patients to Healthie EMR.

⚠️ **Override reasons are audited**. Provide legitimate, specific reasons.

⚠️ **If you see "No payment history available"**, this may indicate:
- The patient is new to QuickBooks
- There are duplicate patient records (notify admin)
- The QuickBooks sync needs updating

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Override button not working | Check internet connection, try refreshing page |
| "Failed to send notification" error | Retry, or contact admin if persistent |
| Payment history not showing | Patient may be a duplicate or new - proceed with override if clinically needed |
| Override approved but still can't dispense | Fill in all required fields (date, vial, dose, syringes) |

---

## Questions?

Contact:
- **Billing questions**: Google Chat "NOW Ops & Billing" space
- **Technical issues**: Contact system administrator
