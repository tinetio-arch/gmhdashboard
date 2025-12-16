# Agentic AI System Plan: Multi-System Integration

## Vision

**"Hey, send an email to John Smith with his last labs"** → System automatically:
1. Finds John Smith in your database
2. Retrieves his lab results from Healthie
3. Formats the email with lab data
4. Sends via AWS SES
5. Confirms completion

All through **natural language voice commands** via Telegram.

---

## Your Current Systems

### ✅ What You Have:
- **PostgreSQL Database** - Patient data, labs, inventory
- **Healthie API** - EMR, labs, client data
- **AWS SES** - Email sending (already configured)
- **GoHighLevel (GHL)** - CRM integration
- **Jane** - Some patient data
- **QuickBooks** - (being phased out)
- **Stripe** - (will integrate)

### 🔄 What You're Adding:
- **Heidi** - Medical transcription/AI documentation
- **Telegram Bot** - Voice command interface
- **Agentic AI System** - Orchestrates everything

---

## Recommended Architecture: MCP + LangChain

### **Model Context Protocol (MCP)**
- ✅ **Perfect for multi-system integration**
- ✅ **Standardized way to connect AI to your systems**
- ✅ **Used by Healthie Dev Assist** (you saw this in docs!)
- ✅ **Works with Claude, GPT-4, etc.**

### **LangChain Agents**
- ✅ **Orchestrates complex workflows**
- ✅ **Natural language understanding**
- ✅ **Tool calling (database, APIs, email)**
- ✅ **Memory and context**

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Telegram Bot (Voice Input)                   │
│         "Send email to John Smith with his labs"         │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Agentic AI System (LangChain)               │
│  • Understands natural language                          │
│  • Plans actions                                         │
│  • Calls tools in sequence                              │
└────────────────────┬──────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Database │  │ Healthie │  │   Email  │
│   MCP    │  │   MCP    │  │   MCP    │
└──────────┘  └──────────┘  └──────────┘
        │            │            │
        └────────────┼────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   PostgreSQL    Healthie API   AWS SES
```

---

## Implementation Plan

### Phase 1: MCP Servers (Week 1-2)

Create MCP servers for each system:

#### 1. Database MCP Server
```typescript
// lib/mcp/database-server.ts
// Exposes your PostgreSQL database as MCP tools
Tools:
- query_patients(name, email, phone)
- get_patient_labs(patient_id)
- get_patient_info(patient_id)
- search_patients(query)
```

#### 2. Healthie MCP Server
```typescript
// lib/mcp/healthie-server.ts
// Exposes Healthie API as MCP tools
Tools:
- get_client_labs(client_id)
- get_client_info(client_id)
- create_invoice(client_id, amount)
- get_subscriptions(client_id)
```

#### 3. Email MCP Server
```typescript
// lib/mcp/email-server.ts
// Exposes AWS SES as MCP tools
Tools:
- send_email(to, subject, body, attachments?)
- send_patient_labs_email(patient_email, lab_data)
```

#### 4. Heidi MCP Server
```typescript
// lib/mcp/heidi-server.ts
// Exposes Heidi API as MCP tools
Tools:
- transcribe_audio(audio_file)
- generate_clinical_notes(transcription)
- sync_to_healthie(notes, client_id)
```

### Phase 2: LangChain Agent (Week 2-3)

```typescript
// lib/agents/medical-assistant.ts
// Main agent that orchestrates everything

Agent Capabilities:
- Understands natural language commands
- Plans multi-step actions
- Calls MCP tools in sequence
- Handles errors gracefully
- Provides status updates
```

### Phase 3: Telegram Bot (Week 3-4)

```typescript
// lib/telegram/bot.ts
// Telegram bot with voice support

Features:
- Voice message input
- Text command input
- Real-time responses
- Status updates
- Error handling
```

### Phase 4: Integration (Week 4)

- Connect all pieces
- Test workflows
- Add error handling
- Security & authentication

---

## Example Workflow

### Command: "Send email to John Smith with his last labs"

**Step 1: Agent understands**
```json
{
  "action": "send_email",
  "recipient": "John Smith",
  "content": "last labs"
}
```

**Step 2: Agent plans**
1. Find patient "John Smith" in database
2. Get Healthie client ID
3. Fetch lab results from Healthie
4. Format email with labs
5. Send via SES

**Step 3: Agent executes**
```typescript
// 1. Find patient
const patient = await mcpDatabase.query_patients({
  name: "John Smith"
});

// 2. Get Healthie client
const healthieClient = await mcpHealthie.get_client_info({
  patient_id: patient.id
});

// 3. Get labs
const labs = await mcpHealthie.get_client_labs({
  client_id: healthieClient.id
});

// 4. Format email
const emailBody = formatLabsEmail(patient, labs);

// 5. Send
await mcpEmail.send_email({
  to: patient.email,
  subject: `Lab Results - ${patient.name}`,
  body: emailBody
});
```

**Step 4: Agent responds**
```
✅ Email sent to John Smith (john@example.com)
📋 Included lab results from 2024-01-15
```

---

## Tools & Technologies

### Core Stack
- **LangChain** - Agent framework
- **MCP (Model Context Protocol)** - System integration
- **Telegram Bot API** - Voice/text interface
- **OpenAI/Anthropic** - LLM for understanding

### Your Systems (via MCP)
- PostgreSQL (database MCP server)
- Healthie API (Healthie MCP server)
- AWS SES (email MCP server)
- Heidi API (Heidi MCP server)
- Stripe API (Stripe MCP server - future)

---

## Security Considerations

### 1. Authentication
- Telegram bot requires auth token
- Only authorized users can send commands
- MCP servers require API keys

### 2. Authorization
- Check user permissions before actions
- Log all agent actions
- Audit trail for compliance

### 3. Data Privacy
- HIPAA compliance for patient data
- Secure API connections
- Encrypted data transmission

---

## Example Commands

### Patient Information
- "What's John Smith's phone number?"
- "Show me all patients with overdue labs"
- "Find patients with payment issues"

### Lab Results
- "Send John Smith's last labs via email"
- "What were John's lab results from last month?"
- "Email all patients with new lab results"

### Invoicing
- "Create an invoice for John Smith for $180"
- "Send invoice to all patients with outstanding balance"
- "Check payment status for John Smith"

### Scheduling
- "Schedule John Smith for next Tuesday at 2pm"
- "Show me all appointments this week"
- "Cancel John Smith's appointment tomorrow"

### General
- "How many active patients do we have?"
- "What's our revenue this month?"
- "Show inventory status"

---

## Getting Started

### Step 1: Install Dependencies
```bash
npm install langchain @langchain/core @langchain/openai
npm install node-telegram-bot-api
npm install @modelcontextprotocol/sdk
```

### Step 2: Set Up MCP Servers
- Create MCP server for each system
- Expose as tools
- Test connections

### Step 3: Create Agent
- Set up LangChain agent
- Connect MCP tools
- Test basic commands

### Step 4: Telegram Bot
- Create Telegram bot
- Add voice support
- Connect to agent

### Step 5: Deploy
- Deploy to AWS EC2
- Set up webhooks
- Test end-to-end

---

## Benefits

### ✅ Efficiency
- Voice commands faster than clicking
- Multi-step actions automated
- No context switching

### ✅ Integration
- All systems connected
- Single interface for everything
- Real-time data access

### ✅ Scalability
- Easy to add new systems
- Easy to add new commands
- MCP standard makes it simple

### ✅ User Experience
- Natural language (no training needed)
- Works from anywhere (Telegram)
- Instant responses

---

## Next Steps

1. **Decide on LLM**: OpenAI GPT-4 or Anthropic Claude?
2. **Set up MCP servers**: Start with Database + Healthie
3. **Create basic agent**: Test with simple commands
4. **Add Telegram bot**: Voice input support
5. **Expand capabilities**: Add more commands

---

## Cost Estimate

- **LLM API**: ~$20-50/month (depending on usage)
- **Telegram Bot**: Free
- **MCP Servers**: Free (your code)
- **Infrastructure**: Already have AWS
- **Total**: ~$20-50/month

---

## Timeline

- **Week 1-2**: MCP servers (Database, Healthie, Email)
- **Week 2-3**: LangChain agent setup
- **Week 3-4**: Telegram bot integration
- **Week 4**: Testing & deployment
- **Total**: ~4 weeks

---

## Questions to Answer

1. **Which LLM?** (OpenAI GPT-4 or Anthropic Claude)
2. **Telegram only?** (or also WhatsApp, SMS?)
3. **Voice only?** (or also text commands?)
4. **Who has access?** (all staff or just admins?)
5. **What commands first?** (prioritize most used)

---

This system will transform how you interact with your practice management system! 🚀

