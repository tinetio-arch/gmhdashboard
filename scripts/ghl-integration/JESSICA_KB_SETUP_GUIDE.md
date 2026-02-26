# Jessica Voice AI - GHL Knowledge Base Setup Guide

## Overview

We've split Jessica's configuration into two parts:
1. **Slim Prompt** (~550 words) - Behavioral instructions only
2. **Knowledge Base** (12 articles) - Reference information

This approach improves AI performance by reducing cognitive load.

---

## Step-by-Step Setup Instructions

### STEP 1: Create Knowledge Base in GHL

1. Log into GoHighLevel
2. Navigate to: **Settings** → **AI** → **Knowledge Base**
3. Click **"Create Knowledge Base"**
4. Name it: `NOW Primary Care - Jessica`
5. Click **Create**

---

### STEP 2: Add Knowledge Articles

For each section in `JESSICA_KNOWLEDGE_BASE.md`, create a separate article:

1. Click **"Add Article"** or **"Add Content"**
2. Copy the content between the `---` dividers
3. **Article Title:** Use the "Article X: [Name]" as the title
4. **Content:** Paste the content under that article
5. Click **Save**

**Articles to Create:**
| # | Title | Key Content |
|---|-------|-------------|
| 1 | Practice Information | Address, hours, phone, fax |
| 2 | Rebranding Information | Granite Mountain → NOW Primary Care |
| 3 | Men's Health Routing | TRT/testosterone → Men's Health clinic |
| 4 | Prescription Refill Procedures | Refill workflow, Farmakaio |
| 5 | Lab and Imaging Results | HIPAA rules, what to say |
| 6 | Appointment Types | Available visit types |
| 7 | New Patient Process | Account creation workflow |
| 8 | Transfer Scenarios | When to transfer to human |
| 9 | Emergency Protocol | 911 situations |
| 10 | HIPAA Compliance Rules | Privacy requirements |
| 11 | Billing and Payments | Balance check, payment links |
| 12 | Conversational Examples | Good/bad phrases |

---

### STEP 3: Connect Knowledge Base to Voice Agent

1. Navigate to: **Settings** → **AI Agents** → **Jessica**
2. Look for **"Knowledge Base"** or **"Knowledge Sources"** section
3. Click **"Add Knowledge Source"** or **"Connect"**
4. Select: `NOW Primary Care - Jessica`
5. Click **Save**

---

### STEP 4: Update Voice Agent Instructions

1. In Jessica's Voice Agent settings, find **"Instructions"**
2. **DELETE** the current long prompt
3. **PASTE** the contents of `JESSICA_SLIM_PROMPT.md` (the short version)
4. Click **Save**

---

### STEP 5: Add Knowledge Retrieval Instruction

Add this line to the end of the slim prompt:

```
**KNOWLEDGE BASE:** For detailed procedures, sample responses, or reference information, search the connected knowledge base.
```

---

### STEP 6: Test the Configuration

Make a test call and verify:

1. ✅ Jessica greets appropriately
2. ✅ Asks if new or existing patient
3. ✅ Requests name and DOB for verification
4. ✅ Uses correct practice info (from Knowledge Base)
5. ✅ Routes testosterone to Men's Health
6. ✅ Properly handles verification failure

---

## File Locations

| File | Purpose |
|------|---------|
| `JESSICA_SLIM_PROMPT.md` | Paste into GHL Voice Agent Instructions |
| `JESSICA_KNOWLEDGE_BASE.md` | Reference for creating KB articles |
| `JESSICA_CURRENT_PROMPT.md` | Old full prompt (backup) |

---

## Troubleshooting

**If Jessica doesn't use Knowledge Base info:**
- Verify the KB is connected in Voice Agent settings
- Check that articles are published/saved
- Add explicit instruction: "Search knowledge base for [topic]"

**If Jessica is still too verbose:**
- Reduce the slim prompt further
- Move more content to Knowledge Base

**If verification still fails:**
- This is a GHL limitation with custom action response handling
- Consider Retell AI for better code-level control

---

## Comparison

| Metric | Old Prompt | New Setup |
|--------|------------|-----------|
| Prompt Words | 3,065 | 550 |
| Prompt Characters | 19,182 | 3,400 |
| Reference Data | In prompt | In KB |
| Cognitive Load | HIGH | LOW |
| Maintainability | Hard | Easy |

---

Last Updated: 2026-01-04
