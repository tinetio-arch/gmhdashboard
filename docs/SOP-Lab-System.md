# Lab Management System - Standard Operating Procedure (SOP)

**Effective Date**: January 22, 2026  
**Department**: Clinical Operations - Men's Health & Primary Care  
**Purpose**: Comprehensive lab ordering, result review, and patient management procedures

---

## 📋 OVERVIEW

The GMH Lab System integrates with **Access Medical Labs** to provide:
- **Lab Ordering**: Submit lab orders directly from the dashboard
- **Result Retrieval**: Automatic fetching of completed lab results every 30 minutes
- **Provider Review**: Queue system for providers to review and approve results
- **Patient Portal**: Approved results automatically visible in Healthie patient portal

### System Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Lab Dashboard** | `nowoptimal.com/ops/labs/` | Central hub for all lab operations |
| **Order Modal** | Dashboard → "Order Lab" button | Create new lab orders |
| **Review Queue** | Dashboard → "Review Queue" tab | Pending results for provider review |
| **Orders Tab** | Dashboard → "Order Labs" tab | Track submitted orders |

---

## 🏥 CLINIC & PROVIDER ASSIGNMENT

### Clinic Selection Rules

| Clinic | Client ID | Default Provider | Provider NPI |
|--------|-----------|------------------|--------------|
| **Tri-City Men's Health** | 22937 | Dr. Whitten | 1366037806 |
| **NOW Primary Care** | 72152 | Phil Schafer NP | 1790276608 |

> ⚠️ **IMPORTANT**: When ordering labs, the provider is automatically assigned based on the selected clinic. Do NOT manually override unless specifically instructed.

---

## 📝 ORDERING LABS

### Step 1: Access the Order Modal

1. Navigate to `nowoptimal.com/ops/labs/`
2. Click the **"+ Order Lab"** button in the top right
3. The Order Lab Modal will open

### Step 2: Select Clinic & Patient

1. **Clinic Selection**:
   - Select **Tri-City Men's Health** for TRT/Hormone patients
   - Select **NOW Primary Care** for primary care/weight loss patients

2. **Patient Selection**:
   - **Existing Patient**: Type the patient name to search, select from dropdown
   - **New Patient**: Click "New Patient" tab and fill in demographics manually

### Step 3: Select Lab Tests

| Category | Test Code | Description |
|----------|-----------|-------------|
| **Core Panels** | | |
| Male Pre-Treatment | 9757 | Initial hormone workup |
| Male Post-Treatment | 9761 | Follow-up hormone panel |
| Female Pre-Treatment | 9765 | Female hormone baseline |
| Female Post-Treatment | 9760 | Female hormone follow-up |
| **Add-Ons** | | |
| PSA | 146 | Prostate screening |
| **Restricted** (Requires Approval) | | |
| Lipid Panel | L509 | Cholesterol/Lipid profile |
| A1C | 202 | Diabetes screening |
| Custom | varies | Any non-standard test code |

### Step 4: Submit Order

1. Review all information
2. Click **"Submit Order"** (or "Request Approval" for restricted tests)
3. Order is sent to Access Medical Labs
4. Order appears in "Orders" tab with status

### Order Statuses

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `pending` | Waiting in queue | None - will auto-submit |
| `pending_approval` | Restricted test - needs admin | Admin must approve |
| `submitted` | Sent to Access Labs | Patient can go in for draw |
| `failed` | Submission error | Review error, re-submit |

---

## 📥 REVIEWING LAB RESULTS

### Automatic Result Fetching

- Results are automatically fetched from Access Labs **every 30 minutes**
- When results arrive, they appear in the **Review Queue**
- Critical values trigger **Google Chat alerts** and **Telegram notifications**

### Provider Review Workflow

1. **Navigate to Review Queue**
   - Go to `nowoptimal.com/ops/labs/`
   - Default view shows pending review items

2. **Review Each Result**
   - Click **"📄 View Results"** to open the PDF
   - Review all values, flag critical findings

3. **Patient Matching**
   - System auto-matches patients with ≥80% confidence
   - Low-confidence matches show a warning
   - If unmatched, click and search for correct patient

4. **Approve or Reject**
   - **✓ Approve**: Result is uploaded to Healthie and made visible to patient
   - **✗ Reject**: Result is archived with reason (requires note)

### Critical Value Alerts

These values trigger immediate alerts:

| Test | Critical Low | Critical High | Alert Method |
|------|--------------|---------------|--------------|
| Testosterone (Total) | < 200 | > 1500 | Telegram + Google Chat |
| PSA | - | > 4.0 | Telegram + Google Chat |
| Hematocrit | < 35% | > 54% | Telegram + Google Chat |
| Hemoglobin | < 10 | > 18 | Telegram + Google Chat |

---

## 👨‍⚕️ PATIENT LAB HISTORY

### Viewing Patient Lab History

1. Go to **Patients** page (`nowoptimal.com/ops/patients/`)
2. Find patient in list
3. Review **Last Lab** and **Next Lab** columns
4. Click patient to see full history

### Lab Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| ✅ Current | Green | Labs within expected range |
| ⏰ Due | Yellow | Labs needed within 30 days |
| 🚨 Overdue | Red | Labs past due date |
| ❓ Unknown | Gray | No lab history on file |

### Next Lab Due Calculation

- **TRT Patients**: Labs due every 6 months after stabilization
- **New Patients**: Follow-up at 6 weeks post-start
- **Weight Loss**: Quarterly metabolic panel

---

## 🔧 TROUBLESHOOTING

### Order Not Appearing in Access Labs

1. **Check Order Status**: Go to Orders tab, find the order
2. **If "submitted"**: Order may take up to 24 hours to appear in Access Labs portal
3. **If "failed"**: Click to view error, correct issue, re-submit
4. **If blank/stuck**: Contact IT - may be API connectivity issue

### Result Not Fetching

1. **Wait**: Results auto-fetch every 30 minutes
2. **Manual Fetch**: Run `python3 /home/ec2-user/scripts/labs/fetch_results.py`
3. **Check Logs**: `pm2 logs gmh-dashboard --lines 50`

### Patient Not Matching

1. **Manual Match**: Click the unmatched result
2. **Search by Name**: Enter exact patient name from Healthie
3. **Select Correct Patient**: Click to link
4. **Complete Review**: Approve after linking

### "Submitted" But No Confirmation

- Access Labs API returns empty 200 response on success
- This is NORMAL - verify in Access Labs portal
- If not appearing after 24 hours, contact Access Labs support

---

## 📞 CONTACTS & SUPPORT

| Issue | Contact |
|-------|---------|
| System Questions | IT/Aaron |
| Lab Results Questions | Provider on duty |
| Access Labs Portal | 1-800-XXX-XXXX |
| Patient Matching | Front desk staff |

---

## 📁 RELATED DOCUMENTS

- [Patient Workflows](file:///home/ec2-user/gmhdashboard/docs/PATIENT_WORKFLOWS.md) - Clinical procedures by visit type
- [Staff Onboarding SOP](file:///home/ec2-user/gmhdashboard/docs/STAFF_ONBOARDING_SOP.md) - New staff checklist
- [Inventory Check SOP](file:///home/ec2-user/gmhdashboard/docs/SOP-Inventory-Check.md) - DEA compliance

---

*Last Updated: January 22, 2026*
