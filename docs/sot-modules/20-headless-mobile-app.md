
**Alert Tiers** (Anti-Fatigue Strategy):
- **Level 5 (Critical)**: Immediate Google Chat + Telegram (e.g., K+ >6.5, PE)
- **Level 4 (Urgent)**: Immediate Google Chat (needs <3h attention)
- **Level 3 (Significant)**: Hourly digest (same-day review)
- **Level 2 (Important)**: Daily digest at 8am (24-48h follow-up)
- **Level 1 (Informational)**: No alert, logged to Snowflake only

**De-Duplication**: Snowflake tracks alert history - won't re-alert for same patient/finding in 24h

**Patient Matching**:
- Extract name/DOB from PDF (AWS Textract or pdf-parse)
- Query Snowflake cache first
- Fuzzy match against Healthie patients (Levenshtein distance)
- Confidence ≥0.9 → auto-match, <0.7 → manual review queue
- Cache matches in Snowflake for future speed

**Cost Estimate**:
- AWS Bedrock (AI analysis): ~$75/month (120 reports/day)
- Snowflake (warehouse): ~$60/month (X-Small warehouse)
- S3 storage: ~$1/month (500MB)
- **Total**: ~$135/month (use pdf-parse instead of Textract to save $30)

**Status**: Planning complete, ready for implementation (4 weeks)
**Location**: `/home/ec2-user/.gemini/antigravity/brain/.../document_automation_plan.md`

### Access Labs API Integration ✅ ACTIVE (Jan 2026)

**Purpose**: Direct API integration with Access Medical Labs for real-time lab result retrieval and review.

**API Credentials** (stored in `~/.env.production`):
- `ACCESS_LABS_USERNAME`: pschafer@nowoptimal.com
- `ACCESS_LABS_PASSWORD`: (encrypted)
- **Base URL**: `https://api.accessmedlab.com/apigateway/`

**Scripts** (`/home/ec2-user/scripts/labs/`):
| File | Purpose |
|------|---------|
| `access_labs_client.py` | API client (auth, results, orders) |
| `fetch_results.py` | Cron job - fetches new results every 30 min |
| `generate_lab_pdf.py` | PDF generation using reportlab |
| `lab_s3_storage.py` | S3 upload/download with presigned URLs |
| `healthie_lab_uploader.py` | Uploads PDFs to Healthie patient charts |

**Cron Schedule**: Every 30 minutes
```cron
*/30 * * * * cd /home/ec2-user/scripts/labs && /usr/bin/python3 fetch_results.py >> /var/log/access-labs.log 2>&1
```

**Data Flow**:
1. **Fetch**: Cron polls Access Labs API for new results
2. **Match Patient**: Fuzzy match (Snowflake cache → Healthie direct search)
3. **Generate PDF**: `generate_lab_pdf.py` creates professional PDF with critical value highlighting
4. **Upload to S3**: `gmh-clinical-data-lake/labs/pending/{accession}_{name}.pdf`
5. **Queue for Review**: Inserted into `lab_review_queue` PostgreSQL table (migrated from `data/labs-review-queue.json` on Feb 26, 2026)
6. **Provider Review**: Dashboard at `/ops/labs` shows pending labs
7. **Approve**: PDF uploaded to Healthie (initially hidden), then made visible on approval

**Patient Matching Logic** (Updated March 4, 2026 — 3-Tier Pipeline):
1. **Tier 1 (Postgres)**: Query local `patients` table for all patients with `healthie_client_id`, fuzzy match using `thefuzz` (token_sort_ratio ≥85%)
2. **Tier 2 (Healthie API)**: Direct search via `users(keywords: "...")` GraphQL query, filter active patients, DOB confirmation
3. **Tier 3 (Snowflake)**: Query `PATIENT_360_VIEW` as bonus/fallback if both above fail
- **Name normalization**: `_normalize_name()` converts `BADILLA` → `Badilla`, `DOE, JOHN` → `John Doe`
- **DOB normalization**: `_normalize_dob()` handles `MM/DD/YYYY`, `YYYY-MM-DD`, etc.

> [!IMPORTANT]
> **Previously** matching was Snowflake-only. If Snowflake was down, ALL matching silently returned 0%. The new Tier 1 (Postgres) is always available.

**Zero-Results Alerting** (Added March 4, 2026):
- State file: `/home/ec2-user/data/last-lab-results-seen.json`
- Sends Telegram alert if no new lab results for **48+ hours**
- Only fires once per drought period (resets when new results arrive)

**Key Fields from Snowflake** (`GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW`):
- `HEALTHIE_CLIENT_ID` → used as `healthie_id`
- `PATIENT_NAME` → fuzzy match target
- `DATE_OF_BIRTH` → DOB boost for confidence

**S3 Storage**:
- **Bucket**: `gmh-clinical-data-lake`
- **Pending**: `labs/pending/{accession}_{name}_{uuid}.pdf`
- **Approved**: `labs/approved/{accession}_{name}_{uuid}.pdf`

**Dashboard APIs** (`/app/api/labs/`):
- `GET /api/labs/review-queue` - List pending reviews
- `POST /api/labs/review-queue` - Approve/reject with Healthie upload
- `GET /api/labs/pdf/[id]` - Serve PDF from S3 (presigned URL)

**Critical Value Handling**:
- Severity levels 1-5 based on test abnormality flags
- Critical tests highlighted in PDF
- Google Chat alert for severity ≥4

### Service Health Monitoring (PM2)

**Purpose**: Automatic monitoring of critical PM2 services with Telegram alerts on down/recovery.

**Cron Schedule** (all times MST — cron runs in local timezone):
```cron
# Morning Telegram Report - 8:00am MST
0 8 * * * /home/ec2-user/scripts/cron-alert.sh "Morning Report" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts"

# Infrastructure Monitoring - 8:30am MST
30 8 * * * /home/ec2-user/scripts/cron-alert.sh "Infrastructure Monitor" "/usr/bin/python3 /home/ec2-user/scripts/unified_monitor.py"

