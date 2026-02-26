# Pre-Filled Doses Standard Operating Procedure (SOP)

**Effective Date**: January 12, 2026  
**Department**: Clinical Operations  
**Purpose**: Guide for preparing, tracking, and dispensing pre-filled medication syringes

---

## 📋 OVERVIEW

The Pre-Filled Doses system allows you to prepare syringes the night before for patients scheduled the next day. This improves efficiency and reduces patient wait times while maintaining full DEA compliance.

### Key Benefits
- ✅ Faster patient check-in (syringes already prepared)
- ✅ Inventory automatically tracked
- ✅ DEA compliance maintained
- ✅ Easy to undo if patient no-shows

---

## 🌙 PART 1: Preparing Pre-Fills (Night Before)

### When to Do This
- End of day, after last patient
- Review tomorrow's schedule for which patients are coming in

### Step-by-Step Instructions

1. **Go to the Inventory Page**
   - Navigate to: `nowoptimal.com/ops/inventory`
   - You'll see the "💉 Prefilled Doses" card

2. **Click "+ Add Prefill"**
   - The form will appear

3. **Select the Patient**
   - **For scheduled patients**: Check the "Patient-Specific Prefill" box
     - Start typing the patient's name
     - Select them from the dropdown
   - **For walk-ins/unknowns**: Leave unchecked (it will be a "Generic" prefill)

4. **Enter Dose Details**
   - **Dose (mL)**: Amount of medication per syringe (e.g., 0.5, 0.7, 1.0)
   - **Waste (mL)**: Needle dead-space, usually 0.1ml
   - **# Syringes**: How many syringes for this patient (usually 4 for monthly)
   - **Staged For Date**: The date the patient is coming in

5. **Click "Save Prefill"**
   - ✅ Medication is deducted from inventory IMMEDIATELY
   - ✅ DEA transaction is created marked as "STAGED PREFILL"
   - ✅ Entry appears in the prefilled doses list

### What Happens Behind the Scenes
- The system picks a vial with enough medication
- That vial's remaining volume is reduced
- The DEA log shows the prefill was created

---

## ☀️ PART 2: Using Pre-Fills (When Patient Arrives)

### When to Do This
- Patient checks in for their appointment
- You physically hand them the pre-filled syringes

### Step-by-Step Instructions

1. **Go to Inventory OR Transactions Page**
   - Both pages show the "💉 Prefilled Doses" card

2. **Find the Patient's Prefill**
   - Look for their name in the list
   - You'll see: "Billy Garcia - 4 syringes × (0.5ml + 0.1ml waste) = 2.4ml"

3. **Physically Dispense to Patient**
   - Hand the syringes to the patient
   - Complete any required paperwork

4. **Click "✓ Use This"**
   - A confirmation message appears
   - Click OK to confirm

5. **Done!**
   - ✅ Dispense record is created for the patient
   - ✅ DEA transaction is updated (NOT duplicated)
   - ✅ Prefill disappears from the list
   - ✅ Record appears in Transactions table

---

## ❌ PART 3: Removing Pre-Fills (Patient No-Show or Error)

### When to Do This
- Patient didn't show up
- Prefill was made in error
- Syringes were wasted/contaminated

### Step-by-Step Instructions

1. **Find the Prefill in the List**

2. **Click "Remove"**
   - Confirmation: "Remove this staged dose? This will restore the medication to inventory."
   - Click OK

3. **Done!**
   - ✅ Medication is RESTORED to the original vial
   - ✅ DEA transaction is marked as "[VOIDED - Prefill removed]"
   - ✅ Inventory is back to where it was

---

## 📊 INVENTORY & DEA COMPLIANCE

### How Inventory is Affected

| Action | Inventory Change | DEA Log Entry |
|--------|------------------|---------------|
| Create Prefill | **Decreased** | "STAGED PREFILL: [Patient] - X syringes" |
| Use Prefill | No change (already deducted) | Existing entry updated: "→ DISPENSED TO: [Patient]" |
| Remove Prefill | **Restored** | Existing entry updated: "[VOIDED - Prefill removed]" |

### Morning Inventory Check
- Pre-filled doses are **already deducted** from vials
- The system shows: "System expects: X ml" - this accounts for prefills
- Count your vials normally - prefilled medication is already removed

### Example Timeline
```
6:00 PM (Night Before)
  → Create prefill for Billy Garcia: 4 syringes = 2.4ml
  → Vial V0129: 30ml → 27.6ml (deducted)
  → DEA shows: "STAGED PREFILL: Billy Garcia - 4 syringes"

8:00 AM (Morning Check)
  → System expects V0129 to have 27.6ml
  → You count and confirm 27.6ml ✅

10:00 AM (Patient Arrives)
  → Hand Billy his syringes
  → Click "Use This"
  → DEA updated: "→ DISPENSED TO: Billy Garcia on 01/13/2026"

OR (If Billy No-Shows)

5:00 PM (End of Day)
  → Click "Remove"
  → Vial V0129: 27.6ml → 30ml (restored)
  → DEA shows: "[VOIDED - Prefill removed]"
```

---

## ⚠️ TROUBLESHOOTING

### "No vials have enough medication"
- **Cause**: All vials are too low for this prefill
- **Solution**: Create smaller prefills or wait for new vials

### "Patient required to use this prefill"
- **Cause**: This is a generic prefill and you need to specify who it's for
- **Solution**: When you click "✓ Use This", a patient search box will appear. Type the patient's name and select them.

### "Cannot remove: prefill is already dispensed"
- **Cause**: You already clicked "Use This" for this prefill
- **Solution**: This is not an error - the prefill was successfully used. Nothing to do.

### "Cannot remove: prefill is already discarded"
- **Cause**: Someone already removed this prefill
- **Solution**: This is not an error - check if another staff member removed it.

### Prefill shows wrong information
- **Solution**: Remove it and create a new one. You cannot edit prefills.

### Double-clicked and created duplicates
- **Solution**: System prevents this with a loading state. If duplicates appear, remove the extra one. Inventory will be restored correctly.

### Generic Prefill - How to Select Patient
1. Click "✓ Use This" on the generic prefill
2. A popup will appear with a patient search box
3. Type the patient's name
4. Click on the patient in the dropdown
5. Click "✓ Dispense to Patient"

---

## 🔴 CRITICAL RULES

1. **DO NOT click buttons multiple times** - Wait for the system to respond
2. **Morning check ACCOUNTS for prefills** - Prefilled medication is already deducted from vials
3. **Removing a prefill = medication restored** - Only remove if patient truly no-showed or prefill was an error
4. **One DEA entry per prefill** - Using a prefill updates the existing entry, doesn't create a new one
5. **If counts don't match** - Check the staged doses list first before investigating discrepancy

---

## 📊 UNDERSTANDING THE MATH

### What the System Tracks
| Location | Description |
|----------|-------------|
| **Vials (in storage)** | Medication still in vials, ready to be drawn |
| **Prefilled Syringes** | Medication already drawn, waiting for patient |
| **Dispensed** | Medication given to patients |

### Example Calculation
```
BEFORE PREFILLING:
  Vial V0129: 30ml (full)
  Total: 30ml

AFTER CREATING 1 PREFILL (9.6ml):
  Vial V0129: 20.4ml (partial)
  Staged Syringes: 9.6ml (ready to dispense)
  Total: 30ml (nothing lost!)

AFTER PATIENT RECEIVES PREFILL:
  Vial V0129: 20.4ml (no change)
  Staged Syringes: 0ml (moved to dispensed)
  Dispensed: 9.6ml
  Total: 30ml (nothing lost!)
```

### Morning Check with Prefills
```
Your count: 35 full vials + 1 partial (20.4ml) + 1 partial (8ml) = 1078.4ml
Staged prefills: 1 prefill = 9.6ml
System expects: 1078.4ml in vials + 9.6ml in syringes = 1088ml total

IMPORTANT: When counting vials, the prefilled amount is ALREADY 
removed from the vial. Count what you see!
```

---

## 📞 QUESTIONS?

Contact Aaron Whitten or check the system documentation at:
`nowoptimal.com/ops/` (Admin section)

---

*Last Updated: January 13, 2026*
