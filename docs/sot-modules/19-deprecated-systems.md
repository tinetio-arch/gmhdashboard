- **Routes**: Billing/payments, insurance, claims, appointment no-shows/cancels, intake blockers
- **Keywords**: billing, payment, insurance, authorization, claim, denial, no-show, cancel

**2. NOW Exec/Finance**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8`
- **Routes**: KPIs, revenue, reconciliation, patient complaints, leadership decisions
- **Keywords**: KPI, revenue, forecast, reconciliation, QuickBooks, complaint, executive

**3. NOW Patient Outreach**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A`
- **Routes**: Retention, engagement, human follow-up needed
- **Keywords**: retention, outreach, follow-up, engagement, membership, churn risk

**4. NOW Clinical Alerts**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI`
- **Routes**: Lab results, vitals, medications, clinical follow-ups
- **Keywords**: lab, vital, clinical, abnormal, out of range, medication, refill

**Routing Logic**: AI analyzes email → classifies with confidence score → posts formatted card to appropriate space → tags suggested assignee
**Goal**: Auto-upload lab results and imaging reports to Healthie patient charts

**Sources Integrated**:
1. **LabGen** (Lab Results)
   - Portal: https://access.labsvc.net/labgen/
   - Credentials: `pschafer` / `xSqQaE1232` ✅ Verified working
   - Browser automation (Playwright)
   - Downloads PDF reports every 15 minutes
   
2. **InteliPACS** (Imaging Reports)
   - Portal: https://images.simonmed.com/Portal/app
   - Credentials: `phil.schafer` / `Welcome123!` ✅ Verified working
   - Browser automation (Playwright)
   - Monitors "Critical" findings tab
   - Downloads STAT priority reports

**Architecture** (LabGen/InteliPACS → S3 → Snowflake → Healthie):
1. **Browser Automation**: Playwright scripts poll both portals every 15 min
2. **S3 Storage**: PDFs stored in `s3://gmh-documents/incoming/{labs|imaging}/`
3. **Snowflake Middleware** (HIPAA-compliant tracking):
   - `document_intake` - Ingestion tracking
   - `patient_matches` - Name/DOB → Healthie patient_id mapping
   - `ai_analysis_results` - Severity scores (1-5 scale)
   - `alert_history` - De-duplication, anti-fatigue
   - `audit_log` - Full HIPAA audit trail
4. **AI Analysis**: Extract patient name/DOB, match to Healthie patient, analyze severity
5. **Healthie Upload**: Auto-upload as "provider-only" (hidden from patient)
6. **Smart Alerts**: Google Chat with tiered severity (prevent alert fatigue)
