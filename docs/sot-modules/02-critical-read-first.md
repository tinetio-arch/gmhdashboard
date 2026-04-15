- **Admin Password**: (see `.env.local`)

---

## 🚨 CRITICAL - READ FIRST

### 📘 NEW: Patient Workflows (Source of Truth)
**For all clinical procedures and patient lifecycles, refer to:**
👉 **[PATIENT_WORKFLOWS.md](file:///home/ec2-user/gmhdashboard/docs/PATIENT_WORKFLOWS.md)**

Defines comprehensive workflows for:
- 🚹 **Men's Health** (TRT, Hormones)
- ⚖️ **Weight Loss** (GLP-1s)
- 🩺 **Primary Care** (Membership)

### 👮 Staff SOPs (Mandatory)
**For Front Desk & Medical Assistants:**
👉 **[STAFF_ONBOARDING_SOP.md](file:///home/ec2-user/gmhdashboard/docs/STAFF_ONBOARDING_SOP.md)**
*Critical checklist for: Photos, Forms, and Medical History completeness.*

### 🧪 Lab Management System (UPDATED Jan 28, 2026)
**For ordering labs, reviewing results, and patient management:**
👉 **[SOP-Lab-System.html](file:///home/ec2-user/gmhdashboard/public/menshealth/SOP-Lab-System.html)**
*Comprehensive lab ordering, print requisitions, delete orders, result review, and critical alerts.*

### 🎤 AI Scribe System (NEW Jan 2026)
**For providers using AI-assisted clinical documentation:**
👉 **[SOP-AI-Scribe.pdf](file:///home/ec2-user/gmhdashboard/public/menshealth/SOP-AI-Scribe.pdf)**
*Recording visits, Telegram approval workflow, document injection to Healthie.*

> [!IMPORTANT]
> **SOP DEPLOYMENT RULE**: All new Men's Health SOPs must be generated as PDFs and added to `https://nowoptimal.com/ops/menshealth/` (Directory: `/home/ec2-user/gmhdashboard/public/menshealth/`). Do NOT create web pages for SOPs.

---

### Before Making ANY Changes
1. **Check disk space**: `df -h /` (must have >2GB free)
2. **Verify you're in the right directory**: `pwd` → should be `/home/ec2-user/gmhdashboard`
3. **Check PM2 working directory**: `pm2 describe gmh-dashboard | grep cwd` → should be `/home/ec2-user/gmhdashboard`
4. **Review recent changes**: Read the "Recent Changes" section below
5. **Test locally first**: `npm run dev` before deploying to production

### Emergency Contacts
- **If system is down**: Check PM2 logs first: `pm2 logs gmh-dashboard --lines 50`
- **If disk is full**: See "Disk Space Maintenance" section
- **If OAuth broken**: See "QuickBooks OAuth" section
