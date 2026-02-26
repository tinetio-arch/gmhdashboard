# Controlled Substance Dispensing System
## Staff Quick Reference Guide

---

## 🏥 Overview

This guide explains the testosterone dispensing system for DEA compliance. The system tracks every vial from receipt to dispensing, maintaining an accurate log for regulatory requirements.

---

## 📦 Inventory Types

| Type | Size | Vendor | Usage |
|------|------|--------|-------|
| **Carrie Boyd** | 30ml vials | Carrie Boyd | Multi-dose (dispense partial amounts) |
| **TopRX** | 10ml vials | TopRX | Usually dispensed whole (entire vial at once) |

---

## 🔄 Daily Workflow

### Step 1: Morning Controlled Substance Check (REQUIRED)

**Before dispensing any controlled substances each day:**

1. **Go to Inventory page** in the Dashboard
2. **Physically count** all testosterone vials
3. **Enter your count** in the Morning Check form:
   - Carrie Boyd: Full vials + partial ml remaining
   - TopRX: Number of full vials
4. **Click "Complete Morning Check"**

**If counts don't match:**
- System shows a yellow warning
- **You MUST enter a reason** (e.g., "Vial broken", "Dispensed but not logged")
- The system auto-adjusts inventory to match your count
- Everything is recorded for audit trail

✅ **Check completed** → Green banner, staff may now dispense
❌ **Check not done** → Red warning, system blocks dispensing

---

### Step 4: End of Day (EOD) Inventory Check

**Before closing each day:**

1. **Go to Inventory page** in the Dashboard
2. **Physically count** all vials
3. **Enter your count** in the EOD Check form (purple form on right)
4. **Click "Complete EOD Check"**

This verifies the day's dispensing was recorded correctly.

---

### Step 2: Dispensing Testosterone

#### From the Dashboard:

1. Go to **Inventory** → **Transaction Form**
2. Select the **patient** from dropdown
3. The system **auto-selects the current active vial**
4. Enter:
   - **Dose per syringe** (e.g., 0.5ml)
   - **Number of syringes** (e.g., 8)
5. Review the summary:
   - Dispensed amount calculated automatically
   - **Waste**: 0.1ml × syringes (needle dead-space)
   - **Remaining**: Shows what's left in vial after
6. Click **Submit Transaction**
7. Provider signs the dispense record

#### Important Notes:
- 🔴 **Cannot select empty vials** - System filters them out
- 🔴 **Cannot dispense from 0ml vials** - API rejects it
- ⚠️ If dose exceeds remaining, system prompts to split across vials

---

### Step 3: 10ml Whole Vial Dispense

For TopRX 10ml vials (usually dispensed entire):

1. Select the 10ml vial
2. Check **"Dispense entire vial"** checkbox
3. Entire remaining volume is dispensed
4. Waste = 0 (no partial use)
5. Submit

---

## 📱 Telegram Commands

| Command | Description |
|---------|-------------|
| `/dea` or `/inventory` | Show current inventory status |
| `/t` | Quick alias for inventory |
| `/check cb:1,6.8 tr:24` | Record morning check |
| `/dea-history` | View check history |
| `/help` | Show all commands |

---

## 📊 How the Math Works

### Waste Calculation
Every syringe wastes **0.1ml** (needle dead-space). This is automatically tracked.

**Example:**
- Dose: 0.5ml × 8 syringes = 4.0ml dispensed
- Waste: 0.1ml × 8 syringes = 0.8ml waste
- **Total removal from vial:** 4.8ml

### Vial Usage (FIFO)
The system uses **First In, First Out**:
1. Oldest vial is emptied first
2. When vial = 0ml, moves to next vial
3. Only 1 vial should be "in progress" at a time

---

## ⚠️ Red Flags / What to Watch For

| Situation | What It Means | Action |
|-----------|---------------|--------|
| System shows more inventory than physical | Dispenses happened but weren't logged | Investigate, document discrepancy |
| Physical shows more than system | Vials received but not entered in system | Enter missing vials |
| Vial at 0ml still showing in dropdown | Should not happen (system filters) | Report to admin |
| "Cannot dispense" error | Vial is empty | Select different vial |
| Provider signature pending | Dispense not fully documented | Get provider to sign |

---

## 🗂️ Vial Statuses

| Status | Meaning | Color |
|--------|---------|-------|
| **Active** | Available for dispensing | Green |
| **In Progress** | Currently being dispensed from (partial remaining) | Yellow |
| **Empty** (0ml) | Fully used, archived | Red/Grey |
| **Expired** | Past expiration date | Red |

---

## 📋 Record Keeping

Every dispense creates:
1. **Dispenses table** - Patient, dose, syringes, waste
2. **DEA Transactions** - Official controlled substance log
3. **Vial update** - Remaining volume reduced
4. **Signature record** - Who authorized

### Who Can See What:
- **Staff**: Record dispenses, view inventory
- **Providers**: Sign dispenses, view DEA log
- **Admin**: Full access, reconciliation tools

---

## 🔍 Checking Inventory Status

### Via Dashboard:
- **Inventory page** → Shows all vials
- **Summary cards** → Active vials, remaining volume

### Via Telegram:
```
/dea
```
Returns:
- Carrie Boyd: X full + Y partial vials, Zml remaining
- TopRX: X vials, Yml remaining
- Last 7 days dispense activity
- Today's check status

---

## 🚨 If Something Goes Wrong

### Wrong vial selected:
- If not yet submitted: Change selection
- If submitted: Contact admin to void and re-enter

### Patient dispensed but not logged:
- This creates the discrepancy we saw
- ALWAYS log in dashboard BEFORE/IMMEDIATELY AFTER dispensing
- If discovered later: Admin can add manual entry

### System and physical counts don't match:
1. Recount physical inventory
2. Check for unlogged dispenses
3. Check for lost/broken vials
4. Document discrepancy with full explanation
5. Admin can reconcile system

---

## 📞 Support Contacts

| Issue | Contact |
|-------|---------|
| System errors | IT/Admin |
| Discrepancy found | Management + Document |
| DEA compliance questions | Compliance Officer |
| Patient questions | Provider |

---

## ✅ Daily Checklist

### Morning (Before First Patient)
- [ ] Go to Inventory page
- [ ] Complete Morning Check (yellow form)
- [ ] Verify green "Morning check completed" banner appears

### During Day
- [ ] Log ALL dispenses in dashboard before/during service
- [ ] Ensure provider signs all dispense records

### End of Day (Before Closing)
- [ ] Complete EOD Check (purple form)
- [ ] Verify physical count matches displayed totals
- [ ] If discrepancy: Enter reason and investigate

---

*Last Updated: January 6, 2026*
*System Version: GMH Dashboard v2.0*
