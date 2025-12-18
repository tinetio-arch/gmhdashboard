# Agentic System Quick Start Guide

## What You're Building

An AI assistant that can:
- ✅ Understand natural language commands
- ✅ Access all your systems (Database, Healthie, Email, etc.)
- ✅ Execute complex multi-step actions
- ✅ Respond via Telegram (voice or text)

**Example:** "Send email to John Smith with his last labs" → Done! ✅

---

## Step 1: Install Dependencies

```bash
npm install @modelcontextprotocol/sdk
npm install langchain @langchain/core @langchain/openai
npm install node-telegram-bot-api
npm install @aws-sdk/client-ses  # Already have this
```

---

## Step 2: Set Up MCP Servers

I've created 3 MCP servers for you:

1. **Database MCP** (`lib/mcp/database-server.ts`)
   - Query patients
   - Get patient info
   - Get lab data

2. **Healthie MCP** (`lib/mcp/healthie-server.ts`)
   - Get client info
   - Get labs from Healthie
   - Get invoices/subscriptions

3. **Email MCP** (`lib/mcp/email-server.ts`)
   - Send emails via AWS SES
   - Format patient lab emails

---

## Step 3: Create LangChain Agent

Create `lib/agents/medical-assistant.ts`:

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';

// Connect to your MCP servers
// (Implementation details in full guide)
```

---

## Step 4: Create Telegram Bot

Create `lib/telegram/bot.ts`:

```typescript
import TelegramBot from 'node-telegram-bot-api';

// Set up bot with voice support
// Connect to your agent
```

---

## Step 5: Test It!

```bash
# Start the agent server
npm run agent:start

# In Telegram, send voice message:
# "Send email to John Smith with his last labs"
```

---

## Environment Variables Needed

```bash
# LLM (choose one)
OPENAI_API_KEY=your_key_here
# OR
ANTHROPIC_API_KEY=your_key_here

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# Your existing
HEALTHIE_API_KEY=your_key
DATABASE_HOST=...
AWS_SES_REGION=...
```

---

## Next Steps

1. ✅ MCP servers created (done!)
2. ⏳ Set up LangChain agent
3. ⏳ Create Telegram bot
4. ⏳ Test end-to-end
5. ⏳ Deploy to AWS

---

## Full Implementation

See `AGENTIC_SYSTEM_PLAN.md` for complete details!


