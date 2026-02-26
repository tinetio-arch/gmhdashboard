# Controlled Substance Inventory Check - Standard Operating Procedure (SOP)

**Effective Date**: January 12, 2026  
**Department**: Clinical Operations - Men's Health  
**Purpose**: DEA-compliant controlled substance inventory verification procedures

---

## ⚠️ WHY THIS MATTERS: THE PAIN POINTS

### DEA Compliance Requirements
The DEA (Drug Enforcement Administration) requires that all controlled substance dispensaries:
- Maintain accurate perpetual inventory records
- Be able to account for every milliliter of medication
- Document any discrepancies with explanations
- Conduct regular physical inventory counts

**Failure to comply can result in**:
- DEA license revocation
- Criminal penalties and fines
- Practice closure
- Personal liability for providers

### Historical Issues We're Preventing

| Pain Point | What Happened | How This SOP Prevents It |
|------------|---------------|--------------------------|
| **Inventory Drift** | Over time, small undocumented uses caused inventory to be off by entire vials | Daily checks catch drift immediately |
| **Lost Documentation** | Dispenses were done but not logged, creating DEA audit gaps | Morning check BLOCKS dispensing until reconciled |
| **Waste Not Recorded** | Needle dead-space (0.1ml per syringe) wasn't tracked | System auto-calculates and logs waste |
| **End-of-Day Discrepancies** | Staff left without recording last transactions | EOD check creates audit trail |
| **Audit Failures** | During DEA inspection, we couldn't explain differences | All discrepancies now require written explanation |

---

## 📋 OVERVIEW

You will perform **TWO inventory checks daily**:

| Check | When | Required? | Purpose |
|-------|------|-----------|---------|
| **Morning Check** | Before first patient | ✅ REQUIRED (blocks dispensing) | Verify nothing changed overnight |
| **EOD Check** | After last patient | 📝 Recommended | Audit trail, catch same-day errors |

---

## ☀️ MORNING CHECK (REQUIRED)

### When to Do This
- **EVERY morning** before seeing any patients
- The system will **BLOCK all dispensing** until this is complete
- Should take 2-3 minutes

### Step-by-Step Instructions

1. **Go to the Inventory Page**
   - Navigate to: `nowoptimal.com/ops/inventory`
   - You'll see the "📋 Morning Controlled Substance Check" card

2. **Read the System Expectations**
   - The system shows what it expects you to count:
   ```
   System expects: Carrie Boyd: 37 full + 15.6ml partial = 1125.6ml | TopRX: 2 vials = 20.0ml
   ```

3. **Physically Count Your Vials**
   - Count FULL vials (unopened or completely full)
   - Measure the PARTIAL vial (the one currently in use)
   - Use the vial markings or a syringe to measure partial volume

4. **Enter Your Counts**
   - **Carrie Boyd (30ml)**: Enter number of full vials AND ml in partial
   - **TopRX (10ml)**: Enter number of full vials

5. **Review for Discrepancy**
   - **Green**: Your count matches (within 2ml tolerance) ✅
   - **Yellow/Red**: Discrepancy detected - you'll need to explain

6. **If There's a Discrepancy**
   - A "Reason for Discrepancy" field appears
   - You MUST provide an explanation (examples below)
   - Click "Enter Prior Day Transactions" link if you forgot to log something

7. **Submit the Check**
   - Click "Submit Morning Check"
   - ✅ Dispensing is now unlocked for the day

### Common Discrepancy Reasons

| Situation | Example Explanation |
|-----------|---------------------|
| Forgot to log a dispense | "Dispense for John Doe yesterday not logged - added now" |
| Spilled medication | "Approximately 1ml spilled when drawing from vial" |
| Expired/damaged vial | "Vial V0089 removed - expired 01/10/2026" |
| Miscounted yesterday | "Recounted - 1 additional full vial found in storage" |

### Automatic Waste Documentation
- **Small differences (≤2ml)** are automatically documented as "user waste"
- This accounts for needle dead-space, minor spillage, etc.
- You don't need to explain differences of 2ml or less

---

## 🌙 END-OF-DAY (EOD) CHECK (RECOMMENDED)

### When to Do This
- After the last patient of the day
- Before leaving the clinic
- Takes 1-2 minutes

### Step-by-Step Instructions

1. **Go to the Inventory Page**
   - Navigate to: `nowoptimal.com/ops/inventory`
   - Scroll to "📋 End-of-Day Controlled Substance Check"

2. **Count Your Vials** (same as morning)
   - Full vials count
   - Partial vial measurement

3. **Enter Your Counts**

4. **Submit the Check**
   - Click "Submit EOD Check"
   - ✅ Creates audit trail for the day

### Why EOD Check is Important
- Catches any dispenses you forgot to log TODAY
- Creates a "closing" record for the day
- Makes next morning's reconciliation easier
- Demonstrates best practices during DEA inspections

---

## 📊 UNDERSTANDING THE SYSTEM

### How Inventory is Tracked

```
Vial V0129 (30ml)
├── Received: 30ml (full)
├── Dispense 1: -2.4ml (4 syringes × 0.5ml + 0.1ml waste)
├── Dispense 2: -2.4ml
├── Dispense 3: -2.4ml
├── Current: 22.8ml remaining
└── Status: Active (In Progress)
```

Each dispense deducts from the vial and logs to the DEA record.

### The 2ml Tolerance Rule

| Difference | What Happens |
|------------|--------------|
| **0-2ml** | Auto-documented as "user waste" - no explanation needed |
| **>2ml** | Flagged as discrepancy - explanation REQUIRED |

**Why 2ml?** Each syringe has ~0.1ml of dead-space in the needle. With 16+ syringes per patient visit, this adds up. The 2ml threshold accounts for this normal variance.

### What Gets Reported

Your inventory checks are:
- ✅ Logged in the database with timestamp and your name
- ✅ Included in the Morning Telegram Report to management
- ✅ Available for DEA audit if requested
- ✅ Used to calculate expected inventory for next check

---

## ⚠️ TROUBLESHOOTING

### "Dispensing Blocked - Morning Check Required"
- **Cause**: You haven't completed the morning inventory check
- **Solution**: Go to Inventory page and complete the morning check

### My count is way off (>10ml difference)
- **First**: Double-check your count
- **Second**: Check if transactions from yesterday weren't logged
- **Third**: Document the discrepancy with as much detail as possible
- **Fourth**: Notify management immediately

### I forgot to do an EOD check yesterday
- **Solution**: Complete your morning check as normal
- **Note**: The system reconciles from the last check, so it will catch up

### The partial vial measurement is hard to read
- **Solution**: Draw medication into a syringe to measure, then return it to vial
- **Note**: Small measurement errors (<0.5ml) are expected and acceptable

### I need to enter a transaction from a previous day
- **Solution**: On the Inventory page, click "→ Enter Prior Day Transactions"
- **Note**: Backdated transactions are tracked and flagged in reports

### My count seems off but I have prefilled doses ready
- **IMPORTANT**: Prefilled medication is ALREADY deducted from vials
- **Example**: If V0129 was 30ml and you prefilled 9.6ml, the vial now has 20.4ml
- Check the "💉 Prefilled Doses" section to see what's staged
- Your physical count + prefilled doses should equal system total

---

## 🔐 DEA AUDIT PREPARATION

If a DEA inspector visits, you should be able to:

1. **Show the controlled substance check log**
   - All morning/EOD checks with timestamps

2. **Explain any discrepancies**
   - All discrepancies have documented reasons

3. **Trace any vial from receipt to empty**
   - System shows full history per vial

4. **Account for all medication**
   - Every ml is logged as dispense, waste, or discrepancy

5. **Explain prefilled doses**
   - Show the staged doses list
   - Demonstrate how they're tracked from prefill to dispense

---

## 📋 QUICK REFERENCE CARD

### Morning (REQUIRED)
1. Go to `nowoptimal.com/ops/inventory`
2. Read expected count
3. Count full vials + measure partial
4. Enter counts
5. Explain if >2ml difference
6. Submit

### EOD (Recommended)
1. Go to `nowoptimal.com/ops/inventory`
2. Count vials
3. Enter counts
4. Submit

### If Counts Don't Match
1. Recount carefully
2. Check the prefilled doses list
3. Check for unlogged transactions
4. Document the reason
5. Submit anyway (don't falsify!)

---

## 📞 QUESTIONS?

- **System Issues**: Contact IT/Aaron
- **DEA Compliance Questions**: Contact Aaron Whitten
- **Discrepancy Concerns**: Document thoroughly and notify management

---

*Last Updated: January 13, 2026*
