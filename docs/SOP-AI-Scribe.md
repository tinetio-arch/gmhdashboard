# AI Scribe System - Standard Operating Procedure (SOP)

**Effective Date**: January 27, 2026  
**Department**: Clinical Operations - All Locations  
**Purpose**: Provider guide for AI-assisted clinical documentation using the NOW Scribe system

---

## 📋 OVERVIEW

The AI Scribe System automates clinical documentation by:
- **Recording** visit audio via iOS Shortcut
- **Transcribing** conversation using AWS Medical Transcribe
- **Generating** SOAP notes, work excuses, discharge instructions, and prescriptions
- **Reviewing** via Telegram for provider approval
- **Injecting** approved documents directly into Healthie EHR

### Key Benefits
| Feature | Benefit |
|---------|---------|
| 🎤 Hands-free recording | Focus on patient, not typing |
| 🤖 AI-generated SOAP | Consistent, comprehensive notes |
| 📱 Telegram approval | Review/edit anywhere |
| ⚡ One-tap injection | Documents in chart instantly |

---

## 👨‍⚕️ PROVIDER SETUP

### Step 1: iOS Shortcut Installation

Each provider has a unique iOS Shortcut. Install yours:

| Provider | Healthie ID | Shortcut |
|----------|-------------|----------|
| Phil Schafer NP | `12088269` | NOW Scribe - Phil |
| Dr. Aaron Whitten | `12093125` | NOW Scribe - Aaron |

**To Install:**
1. Open the **Shortcuts** app on your iPhone
2. Create a new shortcut named `NOW Scribe - [Your Name]`
3. Add **Record Audio** action (set quality to "Very High")
4. Add **Get Contents of URL** action:
   - URL: `https://nowoptimal.com/upload`
   - Method: `PUT`
   - Headers: `Content-Type: audio/x-m4a` and `X-Provider-Id: YOUR_ID`
   - Body: Recorded Audio from Step 1

### Step 2: Telegram Setup

Your Telegram account must be linked to receive approval requests.
Contact admin if you're not receiving Telegram messages.

---

## 🎤 RECORDING A VISIT

### Starting the Recording

1. **Tap your Scribe shortcut** on iPhone (home screen or Shortcuts app)
2. **Begin recording** - speak naturally with the patient
3. Recording captures: symptoms, history, complaints, your exam findings, and plan

### Best Practices

| ✅ Do | ❌ Don't |
|-------|---------|
| State patient's full name clearly | Rely on pronouns alone |
| Verbalize your exam findings | Skip describing what you observe |
| Speak your assessment out loud | Assume AI can read your mind |
| Mention any work/school notes needed | Forget to mention documentation needs |
| State prescription details if applicable | Use abbreviations for medications |

### Stopping the Recording

1. **Tap "Stop"** on the recording interface
2. Audio automatically uploads to secure server
3. You'll receive a **Telegram notification** within 2-3 minutes

---

## 📱 TELEGRAM APPROVAL WORKFLOW

### Understanding the Approval Message

When your Telegram notification arrives, you'll see:

```
📋 NEW SOAP NOTE READY FOR REVIEW

👤 Patient: John Doe (ID: 12345678)
📅 Visit Type: Follow-up
✅ Confidence: 92%

📝 SOAP NOTE PREVIEW:
[Abbreviated preview...]

🔘 Quick Actions:
[✅ Confirm & Send] [❌ Reject]
[📄 View Full SOAP] [🔄 Change Patient]
[📋 Work Note] [🏥 Discharge]
```

### Action Buttons Explained

| Button | What It Does |
|--------|--------------|
| **✅ Confirm & Send** | Approve and inject all selected documents to Healthie |
| **❌ Reject** | Discard documents (saved to S3 for later if needed) |
| **📄 View Full SOAP** | See complete SOAP note before approving |
| **🔄 Change Patient** | Search and select different patient |
| **📋 Work Note** | Add work excuse to documents (must tap BEFORE confirming) |
| **🏥 Discharge** | Add discharge instructions (must tap BEFORE confirming) |

### Correct Workflow Order

> ⚠️ **IMPORTANT**: Add documents BEFORE confirming!

1. **Review** the SOAP preview
2. **Change Patient** if needed (tap 🔄, type name, select)
3. **Add Documents** if needed (tap 📋 Work Note or 🏥 Discharge)
4. **Confirm & Send** once everything looks correct

Once you confirm, the session ends and documents are injected.

---

## 🔄 CHANGING PATIENT

If the AI identified the wrong patient:

1. Tap **🔄 Change Patient**
2. **Type the patient's name** in your reply
3. Select from the search results
4. Message updates with correct patient
5. Proceed with confirmation

### New Patients

Patients recently added to Healthie are automatically searchable. The system checks:
1. Snowflake database (synced every 6 hours)
2. Healthie API directly (real-time fallback for new patients)

---

## 📄 ADDING WORK/SCHOOL NOTES

### Work Excuse (Off-Work Note)

1. Tap **📋 Work Note** button
2. System extracts relevant info from SOAP note
3. PDF preview is attached
4. Document is queued for injection
5. **Then tap Confirm & Send**

### Discharge Instructions

1. Tap **🏥 Discharge** button
2. System generates patient-friendly instructions from PLAN
3. PDF preview is attached
4. Document is queued for injection
5. **Then tap Confirm & Send**

---

## ✅ WHAT GETS INJECTED

Upon approval, documents are injected to Healthie:

| Document | Location in Healthie |
|----------|---------------------|
| SOAP Note | Chart Notes → Private Note |
| Work Excuse | Documents (as PDF) |
| Discharge Instructions | Documents (as PDF) |
| School Excuse | Documents (as PDF) |

### Verification

After confirmation, you receive a message with:
- ✅ Status: `approved_and_injected`
- 📋 Links to injected documents in Healthie

---

## ⚠️ TROUBLESHOOTING

### "No patients found" Error

**Cause**: Patient not in Snowflake or Healthie
**Solution**: 
- Try alternate spelling
- For brand new patients, wait 1 minute and retry (real-time API lookup)
- Contact admin if patient exists in Healthie but isn't found

### Telegram Message Not Received

**Cause**: Bot not linked, server issue, or wrong chat ID
**Solution**:
- Verify bot is active in your Telegram
- Check that you've messaged the bot at least once
- Contact admin to verify chat ID configuration

### Wrong Visit Type Classification

**Cause**: AI misinterpreted the conversation
**Solution**: 
- Review and approve - classification doesn't affect SOAP content
- For recurring issues, report to admin for prompt tuning

### Documents Not Appearing in Healthie

**Cause**: Healthie API issue or network timeout
**Solution**:
- Check Healthie directly for the chart note
- Review S3 bucket for saved documents
- Contact admin with the scribe job ID

---

## 🔒 SAFETY & DATA

### All Documents Are Preserved

Even if approval fails:
- ✅ Audio saved to S3
- ✅ Transcript saved to S3  
- ✅ Generated documents saved to S3
- ❌ Nothing injected until YOU approve

### Timeout Behavior

| Timeout | Result |
|---------|--------|
| 1 hour no response | Session expires, documents saved to S3 |
| Telegram offline | Documents saved, can reprocess later |
| Network failure | Documents saved, retry available |

### Recovery

If you need to recover documents from a failed session:
1. Contact admin with approximate time of recording
2. Documents can be retrieved from S3
3. Manual injection is available if needed

---

## 📞 SUPPORT

| Issue | Contact |
|-------|---------|
| Shortcut not working | IT/Admin |
| Telegram not receiving | IT/Admin |
| Patient not found | Front desk staff first, then IT |
| Clinical question about AI output | Review manually, flag for prompt improvement |

---

## 📁 RELATED DOCUMENTS

- [iOS Shortcut Setup Guide](file:///home/ec2-user/notebooklm-sync/exports/documentation/scripts_scribe_IOS_SHORTCUT_SETUP.md)
- [Safety & Recovery Guide](file:///home/ec2-user/notebooklm-sync/exports/documentation/scripts_scribe_SAFETY_GUIDE.md)
- [Staff Onboarding SOP](file:///home/ec2-user/gmhdashboard/docs/STAFF_ONBOARDING_SOP.md)

---

*Last Updated: January 27, 2026*
