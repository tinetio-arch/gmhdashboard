# Jane Time-Based Revenue Metrics - Analysis

## ✅ YES - We Can Get Daily, Weekly, and Monthly Metrics!

### Available Date Fields in Webhook Payloads:

#### Appointment-Level Dates:
- **`appointmentsObject[*].arrived_at`** - When appointment occurred (PRIMARY DATE FOR REVENUE)
- **`appointmentsObject[*].start_at`** - Appointment start time
- **`appointmentsObject[*].booked_at`** - Booking date
- **`appointmentsObject[*].patient_paid`** - Boolean indicating payment status
- **`appointmentsObject[*].purchase_state`** - Payment status (paid, unpaid, no_charge)

#### Summary Dates:
- **`last_appointment.arrived_at`** - Most recent appointment date
- **`last_payment_reminder`** - Last payment date (if available)
- **`total_appt_arrived`** - Total completed visits

---

## 📊 How to Calculate Time-Based Metrics:

### 1. **Daily Revenue**
- Extract all appointments where `patient_paid = true`
- Group by `arrived_at` date (convert to YYYY-MM-DD)
- Sum payment amounts per day
- **Note:** Payment amounts may need to be calculated from appointment pricing or use prorated `total_payment_amount`

### 2. **Weekly Revenue**
- Group daily revenue by week (start of week = Sunday)
- Sum all revenue within each week
- Track unique patients per week

### 3. **Monthly Revenue**
- Group daily revenue by month (YYYY-MM)
- Sum all revenue within each month
- Track unique patients per month

---

## 🔍 Payment Amount Challenge:

**Issue:** `patient_paid` is a boolean, not a dollar amount.

**Solutions:**
1. **Use Appointment Pricing**: Extract treatment/service prices from appointments
2. **Prorate Total Revenue**: Divide `total_payment_amount` by number of paid appointments
3. **Use Purchase/Sale IDs**: Look up actual payment amounts from `purchase_id`, `sale_id`, or `order_id`
4. **Webhook History**: Track incremental changes in `total_payment_amount` over time

**Recommended Approach:** 
- For historical data: Use `total_payment_amount` divided by appointments count (approximation)
- For new data: Track incremental changes in webhook payloads over time to calculate daily payments
- **Best Solution**: Store webhook snapshots over time to track `total_payment_amount` changes

---

## 📈 Implementation Plan:

### Phase 1: Basic Time-Based Metrics (Using Current Data)
1. Extract all appointments with `patient_paid = true`
2. Group by `arrived_at` date
3. Use `total_payment_amount / total_appt_arrived` as average per appointment
4. Calculate daily/weekly/monthly totals

### Phase 2: Accurate Payment Tracking (Requires Historical Webhooks)
1. Store webhook snapshots with timestamps
2. Track changes in `total_payment_amount` between webhooks
3. Attribute payment changes to specific dates
4. Build accurate historical revenue timeline

### Phase 3: Real-Time Updates
1. Calculate daily revenue from new webhooks
2. Update time-based metrics in real-time
3. Build dashboard visualizations

---

## 💡 Quick Answer:

**YES, we can get daily, weekly, and monthly metrics!**

**Using:**
- Appointment `arrived_at` dates for grouping
- `patient_paid` status for filtering
- `total_payment_amount` for revenue totals
- Appointment counts for volume metrics

**Limitations:**
- Payment amounts per appointment are approximate without historical webhook tracking
- Need to track webhook changes over time for exact daily payments

**Next Step:** Implement the revenue queries with time-based grouping functions I've created in `janeRevenueQueries.ts`

