# Fax Processing System - Standard Operating Procedure (SOP)

**Effective Date**: January 28, 2026  
**Department**: Clinical Operations - Men's Health & Primary Care  
**Purpose**: Review and route incoming faxes to patient charts in Healthie

---

## 📋 OVERVIEW

The GMH Fax System automatically receives, analyzes, and queues incoming faxes for staff review. Key features:
- **Automatic Reception**: Faxes sent to our number arrive in the dashboard automatically
- **AI Summarization**: Each fax is analyzed by AI to identify patient name, sender, and content type
- **One-Click Upload**: Approved faxes are uploaded directly to the patient's Healthie chart
- **Audit Trail**: All actions are logged with who approved/rejected and when

### System Access

| Component | Location | Purpose |
|-----------|----------|---------|
| **Fax Dashboard** | `nowoptimal.com/ops/faxes/` | Review and process incoming faxes |
| **View PDF** | Click "📄 View PDF" on any fax | See the original fax document |
| **Patient Search** | Type patient name when approving | Link fax to correct patient |

---

## 📥 RECEIVING FAXES

### How Faxes Arrive

1. **Incoming fax** is received at our fax number
2. **Fax is forwarded** as email to `fax@nowprimary.care`
3. **System processes** the PDF and extracts content
4. **AI analyzes** the fax to identify:
   - Patient name (if visible)
   - Sending facility/doctor
   - Fax type (lab results, referral, records request, etc.)
   - Urgency level
5. **Fax appears** in the Pending queue on the dashboard

> ⚠️ **NOTE**: Faxes typically appear in the dashboard within 1-2 minutes of receipt. If a fax is not appearing, check the sender sent to the correct number.

---

## 📝 PROCESSING FAXES

### Step 1: Access the Fax Dashboard

1. Navigate to `nowoptimal.com/ops/faxes/`
2. You will see three tabs:
   - **Pending**: New faxes awaiting review
   - **Approved**: Faxes uploaded to patient charts
   - **Rejected**: Faxes marked as not needed

### Step 2: Review Each Fax

1. **Read the AI Summary** - Quick overview of what the fax contains
2. **Check Patient Name** - AI-detected patient name (if found)
3. **Check Sender** - AI-detected sending facility
4. **View the PDF** - Click "📄 View PDF" to see the actual document

### Step 3: Approve or Reject

#### ✓ To APPROVE (Upload to Healthie):

1. **Search for Patient**: Type the patient's name in the search box
   - Minimum 2 characters to start searching
   - Select the correct patient from the dropdown
2. **Click "✓ Approve & Upload"**
3. The fax PDF is automatically uploaded to the patient's Healthie Documents
4. The fax moves to the "Approved" tab

#### ✗ To REJECT:

1. **Click "✕ Reject"**
2. The fax moves to the "Rejected" tab
3. Use for: junk faxes, duplicates, wrong number, etc.

### Step 4: Un-Rejecting (If Needed)

If you rejected a fax by mistake:
1. Go to the **Rejected** tab
2. Find the fax
3. Click **"↩ Move to Pending"**
4. The fax returns to the Pending queue

---

## 🏷️ FAX TYPES

The AI categorizes faxes into these types:

| Type | Description | Action |
|------|-------------|--------|
| **Lab Results** | Blood work, test results | Upload to patient chart |
| **Referral** | Specialist referral letters | Upload to patient chart |
| **Medical Records** | Patient history requests/responses | Upload to patient chart |
| **Prescription** | Rx-related correspondence | Upload to patient chart |
| **Insurance** | Prior auth, coverage info | Upload or forward to billing |
| **Other** | Uncategorized | Review manually |

---

## 🔧 TROUBLESHOOTING

### Fax Not Appearing

1. **Wait 2-3 minutes** - Processing takes a moment
2. **Refresh the page** - New faxes may not auto-update
3. **Check sender** - Confirm they sent to correct fax number
4. **Contact IT** if fax still missing after 10 minutes

### Patient Not Found in Search

1. **Check spelling** - Search is case-insensitive but sensitive to typos
2. **Try partial name** - Search works on first or last name
3. **Verify patient exists** - Check Healthie directly
4. **Only active patients** appear in search results

### PDF Won't Open

1. **Try a different browser** - Chrome works best
2. **Disable popup blockers** - PDF opens in new tab
3. **Contact IT** if PDF link is broken

### Wrong Patient Selected

If you accidentally uploaded to the wrong patient:
1. **Contact IT immediately** - Document can be moved in Healthie
2. Note the fax date/time and correct patient name
3. Do NOT re-approve the same fax (creates duplicates)

---

## 📊 DAILY WORKFLOW

### Start of Day

1. Navigate to `nowoptimal.com/ops/faxes/`
2. Check the **Pending** tab count
3. Process each fax systematically:
   - Review AI summary
   - View PDF
   - Match to patient
   - Approve or reject

### Throughout Day

- New faxes arrive continuously
- Check back periodically (suggestion: every 1-2 hours)
- High-urgency faxes may also trigger Google Chat alerts

### End of Day

- Verify Pending queue is at zero (or only items requiring provider review)
- Note any issues for follow-up

---

## 📞 CONTACTS & SUPPORT

| Issue | Contact |
|-------|---------|
| System Questions | IT/Aaron |
| Patient Matching Help | Front desk supervisor |
| PDF Not Loading | IT |
| Healthie Upload Issues | IT |

---

## 📁 RELATED DOCUMENTS

- [Lab System SOP](file:///home/ec2-user/gmhdashboard/docs/SOP-Lab-System.md) - Lab ordering and results review
- [Staff Onboarding SOP](file:///home/ec2-user/gmhdashboard/docs/STAFF_ONBOARDING_SOP.md) - New staff checklist

---

*Last Updated: January 28, 2026*
