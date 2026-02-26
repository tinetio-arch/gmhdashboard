# Healthie API - Complete Automation Guide

**Last Updated**: December 28, 2025, 21:44 UTC  
**Location**: This document provides complete reference for Healthie API automation capabilities

---

## ✅ What CAN Be Automated

### Forms (`createCustomModuleForm`, `createCustomModule`)
- **Create form templates** via API
- **Add questions/fields** to forms via API  
- **All question types supported**: text, textarea, number, checkbox, radio, signature, date, file, phone
- **Script**: `/home/ec2-user/gmhdashboard/scripts/create-healthie-forms.ts`

### Appointment Types (`createAppointmentType`)
- **Create appointment types** with name, duration, price, contact type
- **Set booking permissions** (clients_can_book)
- **Script**: `/home/ec2-user/scripts/healthie/create-appointment-types.ts`

### Client Management  
- **Create clients** (`createClient`)
- **Update clients** (`updateClient`)
- **Assign to groups** (via `user_group_id` in updateClient)
- **Add tags** (via API)

---

## ❌ What CANNOT Be Automated

### Intake Flows
- **No `createIntakeFlow` mutation** exists in schema
- **Must be created manually** in Healthie UI (Settings > Forms > Intake Flows)
- **Workaround**: Create forms via API, then manually add to flows

### Client Groups
- **No `createClientGroup` mutation** found
- **Must be created manually** in Healthie UI (Settings > Clients > Groups)

### Smart Fields
- **No API for configuring Smart Field mappings**
- **Must be configured manually** per form in Healthie UI

### Workflows/Automations
- No mutation found for creating automated task workflows
- Must be configured manually in Healthie UI

---

## 🚨 CRITICAL: Rate Limiting

### Standard Rate Limits
- **General API**: 250 requests per second
- **Sign-in requests**: 100 per minute
- **Reset window**: Typically 1 second for general, 1 minute for sign-in

### Burst Violation Penalties
- **Rapid burst requests** (39+ in quick succession) trigger **extended rate limits**
- **Duration**: 30-60+ minutes (observed)
- **Tied to API key**, NOT IP address


- **Cannot bypass with VPN** - rate limit follows the API credentials

### Lessons Learned (Dec 28, 2025)
1. ❌ **NEVER** send 39+ requests without testing first
2. ✅ **ALWAYS** test with 1 request before bulk operations
3. ✅ **ADD delays** between requests (200-500ms minimum)
4. ✅ **Implement exponential backoff** if errors occur
5. ⚠️ **VPN does NOT help** - rate limits are credential-based, not IP-based

### Rate Limit Recovery
```bash
# Test if rate limit cleared
cd /home/ec2-user/scripts/healthie
export HEALTHIE_API_KEY="your-key"
node test-rate-limit.js
```

---

## 📋 Automation Scripts

### Form Creation (READY TO USE)
**Location**: `/home/ec2-user/gmhdashboard/scripts/create-healthie-forms.ts`

**Creates 5 forms**:
1. Weight Loss Program Agreement (12 questions)
2. EvexiPel Pelleting Consent (10 questions)
3. Primary Care Membership Agreement (14 questions)
4. Urgent Care Chief Complaint (6 questions)
5. ABX Tactical Services Agreement (9 questions)

**Usage**:
```bash
cd /home/ec2-user/gmhdashboard
export HEALTHIE_API_KEY="gh_live_..."
npx tsx scripts/create-healthie-forms.ts
```

**Time**: ~2-3 minutes to create all 5 forms

### Appointment Types Creation (USE WITH CAUTION)
**Location**: `/home/ec2-user/scripts/healthie/create-appointment-types.ts`

**Creates**: All 56 Granite Mountain Health appointment types

**⚠️ IMPORTANT**: This script triggered the rate limit. Use with caution:
1. Test with ONE type first
2. Add longer delays (500ms-1s between requests)
3. Consider batching (create 10, wait 5 min, create next 10)

---

## 🔧 API Authentication

### Headers Required
```typescript
{
  'Content-Type': 'application/json',
  'Authorization': `Basic ${HEALTHIE_API_KEY}`,  // Raw key, NO Base64
  'AuthorizationSource': 'API',
}
```

### Common Mistake
❌ **DON'T**: Base64 encode the API key  
✅ **DO**: Use raw API key with "Basic" prefix

### API Key Location
- **Production**: Stored in `/home/ec2-user/gmhdashboard/.env.local` as `HEALTHIE_API_KEY`
- **Value**: `gh_live_SHmVYEL4hDX2o7grAgDDVvDkpvYgzRHzlZlgQOZ7WTp9KZgmAeEgJpOtB8HLMCVp`

---

## 📖 GraphQL Schema Introspection

### List All Mutations
```bash
cd /home/ec2-user/gmhdashboard
export HEALTHIE_API_KEY="your-key"
npx tsx scripts/list-all-mutations.ts
```

### Inspect Specific Type
```bash
npx tsx scripts/introspect-healthie.ts AppointmentType
```

### Schema Location
- **Full schema**: `/home/ec2-user/healthie-schema.json`

---

## 🎯 Recommended Workflow

### For New Automation Projects

1. **Research First**
   - Search schema for relevant mutations
   - Check Healthie documentation
   - Look for existing examples in codebase

2. **Test Minimally**
   - Create 1 test object first
   - Verify response structure
   - Confirm no rate limit issues

3. **Scale Gradually**
   - Add delays between requests (500ms)
   - Batch operations (10 at a time)
   - Monitor for errors

4. **Fallback to Manual**
   - If no API mutation exists → use UI
   - Document manual steps clearly
   - Automate what you can, manual for the rest

---

## 📊 Current Automation Status

### ✅ Fully Automated
- ✅ Form creation (5 forms ready to deploy)
- ✅ Client creation/updates
- ✅ Appointment type creation (with caution on rate limits)

### ⚠️ Hybrid (API + Manual)
- ⚠️ Intake flows (forms via API, flow config manual)
- ⚠️ Smart Fields (forms via API, mappings manual)

### ❌ Manual Only
- ❌ Client group creation
- ❌ Workflow automation configuration  
- ❌ Advanced availability settings

---

## 📝 Additional Resources

- **Migration Plans**: `/home/ec2-user/.gemini/antigravity/brain/.../`
  - `workflow_migration_plan.md` - Strategic overview
  - `workflow_execution_guide.md` - Step-by-step manual steps
  - `healthie_api_automation_plan.md` - API automation details

- **Healthie Docs**: https://developers.gethealthie.com
- **Schema Explorer**: Available in Healthie Settings > Developers

---

**Remember**: Automation is powerful, but knowing when to do things manually is equally important. Healthie's UI is well-designed for tasks like creating intake flows - sometimes manual is faster and safer.
