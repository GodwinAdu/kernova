---
title: "Customer Support Bot"
description: Build a multi-channel AI support agent with memory, escalation, and ticket tracking.
---

A production-ready customer support system with two specialized agents — a frontline bot that handles common questions and a specialist that takes over complex issues. The system remembers customer preferences, tracks conversations per ticket, auto-escalates unresolved problems, and sends a daily summary report.

---

## Project Structure

```
customer-support-bot/
├── src/
│   └── index.ts          # Main application entry point
├── package.json
├── tsconfig.json
└── .env
```

---

## Setup

```bash
mkdir customer-support-bot && cd customer-support-bot
npm init -y
npm install @kernova/sdk @kernova/core
npm install -D typescript @types/node
npx tsc --init
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...           # Or ANTHROPIC_API_KEY for Claude
WEBHOOK_PORT=3100               # Port for incoming customer messages
SLACK_WEBHOOK_URL=https://...   # Optional: Slack alerts for escalations
```

---

## Full Source Code

```typescript
// src/index.ts
import { Kernova } from '@kernova/sdk';

async function main() {
  // ─── 1. Initialize the Kernova runtime ────────────────────────
  const app = await Kernova.create({
    env: 'production',
    dataDir: './support-data',
    builtInTools: {
      enabled: ['http-fetch', 'date-time'],
    },
  });

  // ─── 2. Define the Frontline Support Agent ────────────────────
  // Handles common inquiries: billing, account, product questions.
  app.agent('frontline-support', {
    instructions: `You are a friendly customer support agent for Acme Corp.
Your responsibilities:
- Answer common questions about billing, accounts, and products
- Look up customer history from memory before responding
- Store important customer preferences for future interactions
- If you cannot resolve an issue within 2 exchanges, escalate

Tone: Professional but warm. Use the customer's name when available.
Never fabricate order numbers or account details.`,
    description: 'First-line support for common customer inquiries',
  });

  // ─── 3. Define the Specialist Agent ───────────────────────────
  // Handles escalated issues: refunds, technical bugs, account recovery.
  app.agent('specialist-support', {
    instructions: `You are a senior support specialist at Acme Corp.
You handle escalated issues that the frontline agent could not resolve.
Your responsibilities:
- Investigate complex technical issues
- Process refund requests (flag for human approval if > $100)
- Handle account recovery and security concerns
- Document resolution steps for future reference

You have access to internal tools. Be thorough and empathetic.`,
    description: 'Senior specialist for escalated support issues',
    tools: ['http-fetch'],
  });

  // ─── 4. Register custom tools ────────────────────────────────
  // Ticket status lookup tool
  app.tool('lookup-ticket', {
    description: 'Look up a support ticket by ID or customer email',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket ID (e.g., TKT-1234)' },
        email: { type: 'string', description: 'Customer email address' },
      },
    },
    execute: async (params) => {
      // In production, this would query your ticketing system
      const { ticketId, email } = params as { ticketId?: string; email?: string };
      return {
        ticketId: ticketId || 'TKT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        status: 'open',
        customer: email || 'customer@example.com',
        createdAt: new Date().toISOString(),
        history: ['Initial contact', 'Awaiting response'],
      };
    },
  });

  // Escalation tool
  app.tool('escalate-ticket', {
    description: 'Escalate a ticket to the specialist team',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        reason: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
    execute: async (params) => {
      const { ticketId, reason, priority } = params as Record<string, string>;
      console.log(`[ESCALATION] Ticket ${ticketId} → specialist (${priority}): ${reason}`);
      return { success: true, assignedTo: 'specialist-support', escalatedAt: new Date().toISOString() };
    },
  });

  // ─── 5. Set up the webhook channel for incoming messages ─────
  // Receives customer messages via HTTP POST to /messages
  const { WebhookChannelAdapter } = await import('@kernova/core');
  const webhookAdapter = new WebhookChannelAdapter({
    port: Number(process.env.WEBHOOK_PORT) || 3100,
    path: '/messages',
    secret: process.env.WEBHOOK_SECRET,
  });
  app.channel('customer-webhook', webhookAdapter);

  // ─── 6. Handle incoming customer messages ─────────────────────
  app.onMessage(async (msg) => {
    const customerId = msg.sender;
    const content = msg.content;

    console.log(`[INCOMING] ${customerId}: ${content}`);

    // Get or create a conversation thread for this customer
    const thread = app.thread(`support-${customerId}`);
    await thread.addMessage('user', content);

    // Recall customer history from memory
    const history = await app.recall(`customer ${customerId}`, { layer: 'longterm', limit: 5 });
    const customerContext = history.map(m => m.content).join('\n');

    // Build the full prompt with context
    const prompt = customerContext
      ? `Customer context:\n${customerContext}\n\nNew message from ${customerId}: ${content}`
      : `New message from ${customerId}: ${content}`;

    // Ask the frontline agent
    const { answer } = await app.ask(prompt, { owner: customerId });

    // Store the response in the thread
    await thread.addMessage('assistant', answer);

    // Remember key facts about this customer interaction
    if (content.toLowerCase().includes('prefer') || content.toLowerCase().includes('always')) {
      await app.remember(
        `Customer ${customerId} stated: "${content}"`,
        'longterm',
        ['customer-preference', customerId],
      );
    }

    console.log(`[RESPONSE] → ${customerId}: ${answer.slice(0, 100)}...`);
  });

  // ─── 7. Auto-escalation trigger ──────────────────────────────
  // If an intent fails (agent can't resolve), auto-escalate
  app.trigger('auto-escalate', 'intent.failed', {
    goal: 'A support request could not be resolved. Review the failed intent and escalate to the specialist team with full context.',
    priority: 'high',
    cooldownMs: 60_000, // Don't spam escalations — 1 min cooldown per trigger
  });

  // ─── 8. Scheduled daily summary report ────────────────────────
  // Every day at 9 AM, generate a summary of yesterday's tickets
  app.schedule('daily-summary', '0 9 * * *', async () => {
    console.log('[SCHEDULE] Generating daily support summary...');

    const { answer } = await app.ask(
      `Generate a daily support summary report. Include:
       - Total tickets handled today
       - Number of escalations
       - Common themes in customer issues
       - Any unresolved tickets that need attention
       Format as a brief executive summary.`,
      { type: 'action', priority: 'low' },
    );

    // Store the summary in memory for future reference
    await app.remember(
      `Daily support summary (${new Date().toISOString().split('T')[0]}): ${answer}`,
      'organizational',
      ['daily-summary', 'support-metrics'],
    );

    console.log(`[SUMMARY]\n${answer}`);
  });

  // ─── 9. Start the daemon ──────────────────────────────────────
  console.log('🤖 Customer Support Bot starting...');
  console.log(`   Webhook listening on port ${process.env.WEBHOOK_PORT || 3100}`);
  console.log('   Daily summary scheduled at 9:00 AM');
  console.log('   Auto-escalation enabled');

  await app.serve({
    shutdownTimeoutMs: 10_000,
    heartbeatIntervalMs: 30_000,
  });
}

main().catch(console.error);
```

---

## Testing It

Send a test message to the webhook:

```bash
curl -X POST http://localhost:3100/messages \
  -H "Content-Type: application/json" \
  -d '{"sender": "alice@example.com", "content": "I was charged twice for my subscription last month"}'
```

---

## What This Demonstrates

| Feature | Guide |
|---------|-------|
| Multi-agent architecture | [Building Agents](/guides/agents) |
| Webhook channel adapter | [Channels & Adapters](/guides/channels) |
| Long-term memory for customer preferences | [Context & Memory](/guides/context-memory) |
| Conversation threads per customer | [Context & Memory](/guides/context-memory#conversation-threads) |
| Proactive triggers for auto-escalation | [Triggers](/guides/triggers) |
| Scheduled tasks (daily summary) | [Scheduler](/guides/scheduler) |
| Daemon mode for production | [Daemon Mode](/guides/daemon) |
| Custom tool registration | [Tools](/guides/tools) |
