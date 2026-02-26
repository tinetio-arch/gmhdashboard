# AWS Infrastructure Monthly Cost Breakdown
**Generated**: December 28, 2025, 04:39 UTC  
**Region**: us-east-2 (Ohio)  
**Account**: Granite Mountain Health  

---

## 💰 TOTAL ESTIMATED MONTHLY COST: **$175 - $275/month**

*(Range depends on Snowflake usage and data transfer)*

---

## 📊 DETAILED COST BREAKDOWN

### 1. **EC2 Instance** - GMH Dashboard Server
**Instance Type**: t3.medium  
**Specs**: 2 vCPUs, 8GB RAM  
**Storage**: 50GB gp3 EBS volume  

**Costs**:
- EC2 Instance (730 hours/month): **$30.37/month**
  - On-Demand: $0.0416/hour × 730 = $30.37
- EBS Storage (50GB gp3): **$4.00/month**
  - gp3: $0.08/GB × 50GB = $4.00
- **Subtotal**: **$34.37/month**

**Optimization Potential**:
- Switch to 1-year Reserved Instance: **$20/month** (saves $10.37/month)
- If upgrade to t3.large (16GB RAM): **$60.74/month** + storage

---

### 2. **RDS PostgreSQL Database** - clinic-pg
**Instance**: Likely db.t3.micro or db.t3.small  
**Database Size**: 244 MB (very small)  
**Multi-AZ**: Unknown (assuming Single-AZ)  

**Estimated Costs** (based on typical small RDS):
- RDS Instance (db.t3.micro, Single-AZ): **$12.41/month**
  - On-Demand: $0.017/hour × 730 = $12.41
- Storage (20GB gp2, assuming): **$2.30/month**
  - gp2: $0.115/GB × 20GB = $2.30
- Backup Storage (first 20GB free): **$0/month**
- **Subtotal**: **$14.71/month**

**If using db.t3.small instead**:
- Instance: **$24.82/month**
- Storage: **$2.30/month**
- **Alternate Subtotal**: **$27.12/month**

**Optimization Potential**:
- Current database is only 244MB - could migrate to EC2 and save $15-27/month
- Or use AWS RDS Free Tier eligible instance (if new account): **$0/month** for 12 months

---

### 3. **S3 Storage** - Data Lake & Snowflake Staging
**Buckets**:
1. `gmh-clinical-data-lake` (created Dec 25)
2. `gmh-snowflake-stage` (for Snowflake ingestion)

**Estimated Storage**: ~10-50GB total (growing)

**Costs**:
- S3 Standard Storage (assuming 25GB): **$0.58/month**
  - $0.023/GB × 25GB = $0.58
- PUT/GET Requests (10,000/month): **$0.05/month**
- Data Transfer OUT (5GB/month): **$0.45/month**
- **Subtotal**: **$1.08/month**

**Growth Projection**:
- At 100GB: **$2.30/month**
- At 500GB: **$11.50/month**

---

### 4. **Snowflake Data Warehouse**
**Account**: GMH_CLINIC  
**Warehouse**: COMPUTE_WH (X-Small typically)  
**Usage**: Hourly sync jobs + Metabase queries

**Estimated Costs** (HIGHLY VARIABLE):
- Compute (X-Small warehouse, ~2 hours/day): **$10-30/month**
  - X-Small: $2/credit, ~0.5 credits/hour
  - 2 hours/day × 30 days × 0.5 credits × $2 = $60/month
  - With auto-suspend: ~$10-30/month (depends on actual usage)
- Storage (first 1TB free for 30 days, then): **$0-5/month**
  - $23/TB/month (likely under 100GB = ~$2.30/month)
- **Subtotal**: **$10-35/month**

**Optimization Potential**:
- Use smaller warehouse (XX-Small): Cut costs in half
- Optimize Snowpipe auto-ingest timing
- **Monitor carefully** - Snowflake can get expensive fast!

---

### 5. **CloudWatch & Monitoring**
**Services**: CloudWatch Agent, Log Storage, Alarms

**Costs**:
- Log Ingestion (5GB/month): **$2.50/month**
  - $0.50/GB × 5GB = $2.50
- Log Storage (10GB): **$0.30/month**
  - $0.03/GB × 10GB = $0.30
- Alarms (10 alarms): **$1.00/month**
  - $0.10/alarm × 10 = $1.00
- Metrics: **$0/month** (10 custom metrics free)
- **Subtotal**: **$3.80/month**

---

### 6. **Data Transfer**
**Estimate**: Minimal (most traffic is internal)

**Costs**:
- Data Transfer OUT to Internet (10GB/month): **$0.90/month**
  - First 10GB free (might cover this)
  - $0.09/GB for next 10TB
- Regional transfer (EC2 ↔ RDS): **$0/month** (free in same AZ)
- **Subtotal**: **$0-1/month**

---

### 7. **Third-Party Services**

#### Healthie (EHR)
- **Status**: External service (not AWS cost)
- **Estimated**: $100-500/month (depending on plan)

#### QuickBooks Online
- **Status**: External service (not AWS cost)
- **Estimated**: $30-200/month (depending on plan)

#### Deepgram (AI Scribe - Audio Transcription)
- **Usage**: Per-minute transcription
- **Estimated**: $10-50/month (depends on visit volume)

#### AWS Bedrock (Claude AI)
- **Usage**: AI Scribe document generation, Telegram bot
- **Costs**: Pay-per-token
  - Anthropic Claude 3: ~$0.015/1K tokens (input)
  - Estimated usage (100 scribe sessions/month): **$20-50/month**
- **Subtotal**: **$20-50/month**

---

## 📈 MONTHLY COST SUMMARY

### AWS Infrastructure Only:
| Service | Low Estimate | High Estimate |
|---------|-------------|---------------|
| EC2 Instance | $34.37 | $34.37 |
| RDS PostgreSQL | $14.71 | $27.12 |
| S3 Storage | $1.08 | $5.00 |
| Snowflake | $10.00 | $100.00 |
| CloudWatch | $3.80 | $5.00 |
| Data Transfer | $0.00 | $2.00 |
| AWS Bedrock (AI) | $20.00 | $50.00 |
| **AWS TOTAL** | **$83.96** | **$223.49** |

### Third-Party Services (NOT included above):
| Service | Est. Cost |
|---------|-----------|
| Healthie | $100-500/month |
| QuickBooks | $30-200/month |
| Deepgram | $10-50/month |
| Domain/SSL | $10-20/month |
| **3rd Party TOTAL** | **$150-770/month** |

---

## 🎯 TOTAL INFRASTRUCTURE COST ESTIMATES

### Conservative Estimate (Low Usage):
**AWS**: $84/month  
**Current setup with minimal Snowflake usage**

### Realistic Estimate (Current Usage):
**AWS**: $150-175/month  
**With moderate Snowflake queries and AI Scribe usage**

### High Estimate (Heavy Usage):
**AWS**: $220-275/month  
**With heavy Snowflake usage, lots of AI Scribe sessions**

### Including Third-Party Services:
**TOTAL**: $234 - $1,045/month  
*(Depending on Healthie/QuickBooks plans and usage)*

---

## 🔍 CURRENT USAGE INDICATORS

Based on your current system (Dec 28, 2025):
- ✅ EC2: 38% disk usage (19GB of 50GB)
- ✅ RDS: 244MB database (very small)
- ✅ S3: Recently created buckets (low data volume)
- ⚠️ Snowflake: Active sync every 6 hours (moderate compute)
- ⚠️ AI Scribe: Running but usage unknown
- ✅ Memory: 88% used (need more RAM - see upgrade recommendation)

**Current Month Estimate**: **$150-200/month** for AWS alone

---

## 💡 COST OPTIMIZATION RECOMMENDATIONS

### Immediate (Can Do Now):
1. **EC2 Reserved Instance** (1-year commitment)
   - **Saves**: $10/month
   - Change from: $30.37 → $20/month

2. **RDS Right-Sizing**
   - Your DB is only 244MB! Consider:
   - Migrate to EC2 PostgreSQL: **Saves $15-27/month**
   - Or downgrade to smallest RDS instance

3. **Snowflake Auto-Suspend**
   - **Saves**: $20-50/month
   - Set warehouse to suspend after 1 minute idle
   - Current: May be running 24/7 unnecessarily

4. **S3 Lifecycle Policies**
   - Move old data to Glacier after 90 days
   - **Saves**: $5-10/month (as data grows)

### Short-Term (This Month):
5. **Upgrade EC2 to t3.large** (addresses memory issue)
   - Current: t3.medium ($30/month)
   - Upgrade: t3.large ($61/month)
   - **Added cost**: +$31/month
   - **Benefit**: Fixes timeout/crash issues, no more manual reboots

6. **Add 4GB Swap** (FREE - already recommended)
   - **Cost**: $0
   - **Benefit**: Prevents crashes

7. **Monitor Snowflake Spend**
   - Set up billing alerts at $50, $100, $150
   - Review query efficiency weekly

### Long-Term (Next Quarter):
8. **Move Metabase to RDS**
   - Free up EC2 memory
   - Or use Metabase Cloud ($85/month but removes self-hosting burden)

9. **Batch AI Processing**
   - Process AI Scribe sessions in batches
   - **Saves**: $10-20/month on Bedrock costs

10. **Data Archival Strategy**
    - Archive old patient data to cheaper storage
    - **Saves**: $5-15/month

---

## ⚠️ COST RISKS & SURPRISES

### Watch Out For:
1. **Snowflake Can Explode** 🚨
   - If warehouse left running: **+$300-1,000/month** easily
   - Monitor daily!
   - Set up auto-suspend (1 min idle)

2. **AI Scribe Token Usage** 📈
   - Claude 3 costs scale with usage
   - 1,000 visits/month could be **$500+**
   - Monitor token usage closely

3. **Data Transfer Costs** 💸
   - Large Metabase dashboard exports
   - Snowflake data egress
   - Can add **$20-100/month** unexpectedly

4. **RDS Storage Growth** 📊
   - Database growing from 244MB
   - Watch for log files accumulating
   - Monitor and prune old data

---

## 📅 PROJECTED 6-MONTH COSTS

**Assuming moderate growth:**

| Month | Est. AWS Cost | Notes |
|-------|---------------|-------|
| Month 1 (Current) | $150 | Current usage |
| Month 2 | $175 | EC2 upgrade to t3.large |
| Month 3 | $165 | Reserved instance savings kick in |
| Month 4 | $170 | Growing data volume |
| Month 5 | $175 | More AI Scribe usage |
| Month 6 | $180 | Steady state |
| **Average** | **$169/month** | **$1,014/6 months** |

---

## ✅ RECOMMENDED IMMEDIATE ACTIONS

**To Control Costs:**
1. [ ] Set up AWS Budget Alerts ($200/month)
2. [ ] Configure Snowflake auto-suspend (1 min)
3. [ ] Review Snowflake query history (find expensive queries)
4. [ ] Set up Cost Explorer tags for each service
5. [ ] Enable AWS Cost Anomaly Detection
6. [ ] Monitor Bedrock token usage daily

**To Fix Performance (Costs Extra But Necessary):**
7. [ ] Upgrade to t3.large ($31/month extra) - **prevents crashes**
8. [ ] Add 4GB swap (free) - **prevents out-of-memory**

---

## 🎯 FINAL RECOMMENDATION

### Your Current Monthly Costs:
```
AWS Infrastructure:     $150-175/month
Healthie (estimate):    $200/month
QuickBooks (estimate):  $50/month
Other services:         $50/month
──────────────────────────────────
TOTAL:                  $450-475/month
```

### Recommended Configuration:
```
EC2 (t3.large Reserved): $40/month
RDS (optimized):        $15/month
S3:                     $5/month
Snowflake (optimized):  $30/month
CloudWatch:             $4/month
AWS Bedrock:            $30/month
──────────────────────────────────
AWS TOTAL:              $124/month ← 20% savings!
```

**Bottom Line**: You can run this entire infrastructure for **$400-450/month total** if you optimize Snowflake and use reserved instances.

---

**Questions to Answer for Better Estimate:**
1. What's your current Healthie plan cost?
2. How many AI Scribe sessions do you process per month?
3. Do you need Multi-AZ RDS (high availability)?
4. What's your expected patient/data growth rate?

I can refine this estimate with those details!
