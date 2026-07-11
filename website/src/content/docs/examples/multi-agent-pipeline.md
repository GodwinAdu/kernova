---
title: "Content Pipeline"
description: Multi-agent content production pipeline — research, write, review, publish — with workflow orchestration.
---

A complete content production system with four specialized agents: a researcher that gathers source material, a writer that drafts articles, an editor that reviews and coordinates the pipeline, and a publisher that formats and distributes the final content. The pipeline uses workflow orchestration, approval gates, budget management, and accepts requests via email.

---

## Project Structure

```
content-pipeline/
├── src/
│   └── index.ts          # Main application entry point
├── templates/             # Article templates
│   └── blog-post.md
├── output/                # Published content
├── package.json
├── tsconfig.json
└── .env
```

---

## Setup

```bash
mkdir content-pipeline && cd content-pipeline
npm init -y
npm install @kernova/sdk @kernova/core
npm install -D typescript @types/node
npx tsc --init
mkdir templates output
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...
# Email config for receiving content requests
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
EMAIL_USER=content-bot@yourcompany.com
EMAIL_PASS=app-password-here
# Budget
MAX_DAILY_TOKENS=500000
COST_PER_1K_TOKENS=0.01
```

---

## Full Source Code

```typescript
// src/index.ts
import { Kernova } from '@kernova/sdk';
import { existsSync, mkdirSync } from 'fs';

const OUTPUT_DIR = './output';
const MAX_DAILY_TOKENS = Number(process.env.MAX_DAILY_TOKENS) || 500_000;

async function main() {
  // ─── 1. Initialize Kernova ────────────────────────────────────
  const app = await Kernova.create({
    env: 'production',
    dataDir: './pipeline-data',
    builtInTools: {
      enabled: ['web-search', 'http-fetch', 'file-write', 'date-time'],
      sandboxDir: OUTPUT_DIR,
    },
  });

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const kernel = app.getKernel();

  // ─── 2. Budget management ─────────────────────────────────────
  // Prevent runaway costs by setting a daily token budget
  kernel.budget.configure({
    owner: 'content-pipeline',
    maxTokens: MAX_DAILY_TOKENS,
    period: 'daily',
    action: 'reject', // Reject intents once budget is exhausted
  });

  // ─── 3. Define Agent: Researcher ──────────────────────────────
  app.agent('content-researcher', {
    instructions: `You are a content researcher. Your job:
- Receive a topic or brief from the editor
- Search the web for current information, statistics, and expert opinions
- Identify 3-5 key angles or talking points
- Find relevant quotes and data points with sources
- Compile a research brief (NOT a full article)

Output format:
## Research Brief: [Topic]
### Key Angles
1. ...
### Data Points
- Stat: ... (Source: ...)
### Quotes
- "..." — Person, Title (Source)
### Recommended Structure
- Suggested outline for the writer

Never write the full article — that's the writer's job.`,
    description: 'Gathers source material and produces research briefs',
    tools: ['web-search', 'http-fetch'],
  });

  // ─── 4. Define Agent: Writer ──────────────────────────────────
  app.agent('content-writer', {
    instructions: `You are a professional content writer. Your job:
- Receive a research brief and writing assignment from the editor
- Write engaging, well-structured articles based on the research
- Follow the company style guide (casual-professional tone, short paragraphs)
- Include data points and quotes from the research brief
- Target 800-1200 words for blog posts, 300-500 for newsletters

Writing rules:
- Open with a hook (question, surprising stat, or bold claim)
- Use subheadings every 200-300 words
- End with a clear call-to-action or takeaway
- Cite sources inline with [Source Name] notation
- Never fabricate statistics or quotes

Output the article in Markdown format.`,
    description: 'Drafts articles from research briefs',
  });

  // ─── 5. Define Agent: Editor ──────────────────────────────────
  app.agent('content-editor', {
    instructions: `You are the editorial lead and pipeline coordinator.
Your responsibilities:
- Review drafts for quality, accuracy, tone, and structure
- Provide specific, actionable feedback when revision is needed
- Approve content for publication when it meets standards
- Coordinate between researcher, writer, and publisher

Quality standards:
- Factual accuracy (all claims must be sourced)
- Engaging opening (no generic intros)
- Clear structure (proper use of headings)
- Appropriate length (within target range)
- Correct grammar and spelling
- Brand-appropriate tone

When reviewing, output:
VERDICT: APPROVED | REVISION_NEEDED
SCORE: X/10
FEEDBACK: (specific points if revision needed)`,
    description: 'Reviews content quality and coordinates the pipeline',
  });

  // ─── 6. Define Agent: Publisher ───────────────────────────────
  app.agent('content-publisher', {
    instructions: `You are the content publisher. Your job:
- Take approved, final articles and prepare them for distribution
- Add frontmatter (title, date, author, tags, description)
- Format for the target platform (blog, newsletter, social)
- Save the final file to the output directory
- Generate social media snippets (tweet-length summary)

Frontmatter format:
---
title: "Article Title"
date: "YYYY-MM-DD"
author: "Content Team"
tags: [tag1, tag2]
description: "SEO description under 160 chars"
---

Use the file-write tool to save the final article.
Use save-report to save to the output directory.`,
    description: 'Formats and publishes approved content',
    tools: ['file-write'],
  });

  // ─── 7. Define the content production workflow ────────────────
  app.workflow({
    id: 'content-production',
    name: 'Content Production Pipeline',
    description: 'Research → Write → Review → Publish',
    steps: [
      {
        id: 'research',
        name: 'Research Phase',
        agent: 'content-researcher',
        input: { topic: '{{topic}}', brief: '{{brief}}' },
        output: 'researchBrief',
      },
      {
        id: 'write',
        name: 'Writing Phase',
        agent: 'content-writer',
        input: { researchBrief: '{{researchBrief}}', format: '{{format}}' },
        output: 'draft',
        dependsOn: ['research'],
      },
      {
        id: 'review',
        name: 'Editorial Review',
        agent: 'content-editor',
        input: { draft: '{{draft}}', topic: '{{topic}}' },
        output: 'reviewResult',
        dependsOn: ['write'],
      },
      {
        id: 'publish',
        name: 'Publication',
        agent: 'content-publisher',
        input: { article: '{{draft}}', review: '{{reviewResult}}' },
        output: 'published',
        dependsOn: ['review'],
        // Approval gate: only runs if review passed
        condition: '{{reviewResult.verdict === "APPROVED"}}',
      },
    ],
  });

  // ─── 8. Main content production function ──────────────────────
  async function produceContent(topic: string, format: string = 'blog-post', brief?: string) {
    console.log(`[PIPELINE] Starting content production: "${topic}"`);
    const startTime = Date.now();

    // Check budget before starting
    const budgetStatus = kernel.budget.check('content-pipeline');
    if (!budgetStatus.allowed) {
      console.log(`[PIPELINE] Budget exhausted: ${budgetStatus.reason}`);
      return { success: false, reason: 'Budget exhausted' };
    }

    // Step 1: Research
    console.log('[PIPELINE] → Research phase');
    const { answer: researchBrief } = await app.ask(
      `Research the following topic for a ${format}: "${topic}"
       ${brief ? `Additional context: ${brief}` : ''}
       
       Produce a comprehensive research brief with key angles, 
       data points, quotes, and a recommended structure.`,
      { type: 'action', priority: 'high', owner: 'content-pipeline' },
    );

    // Step 2: Write
    console.log('[PIPELINE] → Writing phase');
    const { answer: draft } = await app.ask(
      `Write a ${format} based on this research brief:
       
       TOPIC: ${topic}
       
       RESEARCH:
       ${researchBrief}
       
       Write an engaging, well-structured article. Target 800-1200 words.
       Follow the style guide: casual-professional tone, short paragraphs, subheadings.`,
      { type: 'action', priority: 'high', owner: 'content-pipeline' },
    );

    // Step 3: Editorial Review (approval gate)
    console.log('[PIPELINE] → Editorial review');
    const { answer: review } = await app.ask(
      `Review this draft article for publication quality:
       
       TOPIC: ${topic}
       FORMAT: ${format}
       
       DRAFT:
       ${draft}
       
       Evaluate against quality standards and provide your VERDICT and SCORE.`,
      { type: 'query', priority: 'high', owner: 'content-pipeline' },
    );

    const approved = review.includes('APPROVED');
    let finalDraft = draft;

    // Step 3b: Revision loop (max 2 attempts)
    if (!approved) {
      console.log('[PIPELINE] → Revision requested');
      const { answer: revised } = await app.ask(
        `Revise this article based on editorial feedback:
         
         ORIGINAL DRAFT:
         ${draft}
         
         EDITOR FEEDBACK:
         ${review}
         
         Address all feedback points and improve the article.`,
        { type: 'action', priority: 'high', owner: 'content-pipeline' },
      );
      finalDraft = revised;

      // Second review
      const { answer: secondReview } = await app.ask(
        `Review this revised draft:
         ${revised}
         
         Previous feedback was: ${review}
         Has the revision addressed the concerns? VERDICT: APPROVED or REVISION_NEEDED`,
        { type: 'query', priority: 'medium', owner: 'content-pipeline' },
      );

      if (!secondReview.includes('APPROVED')) {
        console.log('[PIPELINE] ⚠ Content not approved after revision. Saving as draft.');
        await app.remember(
          `Content "${topic}" failed editorial review after revision. Needs human attention.`,
          'session',
          ['pipeline-failure', topic],
        );
        return { success: false, reason: 'Failed editorial review', draft: finalDraft, review: secondReview };
      }
    }

    // Step 4: Publish
    console.log('[PIPELINE] → Publishing');
    const { answer: publishResult } = await app.ask(
      `Publish this approved article:
       
       TOPIC: ${topic}
       FORMAT: ${format}
       
       ARTICLE:
       ${finalDraft}
       
       Add proper frontmatter, save to the output directory as "${topic.toLowerCase().replace(/\s+/g, '-')}.md",
       and generate a tweet-length summary for social media.`,
      { type: 'action', priority: 'medium', owner: 'content-pipeline' },
    );

    const durationMs = Date.now() - startTime;
    console.log(`[PIPELINE] ✓ Published in ${(durationMs / 1000).toFixed(1)}s`);

    // Remember what we produced for future reference
    await app.remember(
      `Published ${format}: "${topic}" on ${new Date().toISOString().split('T')[0]}`,
      'longterm',
      ['published-content', format, topic],
    );

    return { success: true, topic, format, durationMs, publishResult };
  }

  // ─── 9. Email channel for receiving content requests ──────────
  // Team members email the bot with article requests
  if (process.env.IMAP_HOST) {
    const { EmailAdapter } = await import('@kernova/core');
    const emailAdapter = new EmailAdapter({
      imapHost: process.env.IMAP_HOST!,
      imapPort: Number(process.env.IMAP_PORT) || 993,
      smtpHost: process.env.SMTP_HOST!,
      smtpPort: Number(process.env.SMTP_PORT) || 465,
      username: process.env.EMAIL_USER!,
      password: process.env.EMAIL_PASS!,
      useTls: true,
      pollIntervalMs: 60_000,
    });

    app.channel('email', emailAdapter);

    app.onMessage(async (msg) => {
      console.log(`[EMAIL] Content request from ${msg.sender}: ${msg.content.slice(0, 80)}`);

      // Parse the email for a content request
      const { answer: parsed } = await app.ask(
        `Parse this email as a content request. Extract:
         - Topic (what to write about)
         - Format (blog-post, newsletter, or social — default: blog-post)
         - Any special instructions or brief
         
         Email from ${msg.sender}:
         ${msg.content}
         
         Respond in JSON: { "topic": "...", "format": "...", "brief": "..." }`,
        { type: 'query' },
      );

      try {
        const request = JSON.parse(parsed);
        await app.enqueue('content-job', request, { priority: 'medium' });
        console.log(`[EMAIL] Queued content job: "${request.topic}"`);
      } catch {
        console.log('[EMAIL] Could not parse content request');
      }
    });
  }

  // ─── 10. Task queue handler ───────────────────────────────────
  kernel.taskQueue.registerHandler('content-job', async (task) => {
    const { topic, format, brief } = task.payload as {
      topic: string;
      format?: string;
      brief?: string;
    };
    await produceContent(topic, format || 'blog-post', brief);
  });

  // ─── 11. Scheduled weekly content generation ──────────────────
  // Every Monday at 8 AM, generate a content piece from the backlog
  app.schedule('weekly-content', '0 8 * * 1', async () => {
    console.log('[SCHEDULE] Weekly content generation triggered');

    // Ask the editor to pick a topic based on trends and past content
    const pastContent = await app.recall('published-content', { layer: 'longterm', limit: 10 });
    const pastTopics = pastContent.map(m => m.content).join('\n');

    const { answer: suggestion } = await app.ask(
      `As the editorial lead, suggest this week's content topic.
       
       Recently published:
       ${pastTopics || '(No prior content)'}
       
       Consider: trending topics in tech, gaps in our content library, 
       and audience engagement patterns.
       
       Respond with just the topic title and a one-line brief.
       Format: TOPIC: ...\nBRIEF: ...`,
      { type: 'query', priority: 'medium' },
    );

    const topicMatch = suggestion.match(/TOPIC:\s*(.+)/i);
    const briefMatch = suggestion.match(/BRIEF:\s*(.+)/i);

    if (topicMatch) {
      const topic = topicMatch[1].trim();
      const brief = briefMatch?.[1]?.trim();
      await app.enqueue('content-job', { topic, format: 'blog-post', brief }, { priority: 'medium' });
      console.log(`[SCHEDULE] Queued: "${topic}"`);
    }
  });

  // ─── 12. Budget monitoring trigger ────────────────────────────
  // Alert when budget is getting low
  app.trigger('budget-warning', 'budget.threshold.*', {
    goal: 'The content pipeline token budget is running low. Log a warning and pause non-critical content generation.',
    priority: 'high',
    cooldownMs: 3_600_000, // 1 hour cooldown
  });

  // ─── 13. Start the daemon ─────────────────────────────────────
  console.log('📝 Content Pipeline starting...');
  console.log(`   4 agents: researcher, writer, editor, publisher`);
  console.log(`   Email channel: ${process.env.EMAIL_USER || 'not configured'}`);
  console.log(`   Weekly content: Mondays at 8:00 AM`);
  console.log(`   Budget: ${MAX_DAILY_TOKENS.toLocaleString()} tokens/day`);
  console.log(`   Output: ${OUTPUT_DIR}`);

  await app.serve({
    shutdownTimeoutMs: 30_000,
    heartbeatIntervalMs: 30_000,
  });
}

main().catch(console.error);
```

---

## Testing It

Trigger content production manually:

```bash
# Start the pipeline
npx tsx src/index.ts

# In another terminal, enqueue a content job directly
curl -X POST http://localhost:8080/intent \
  -H "Content-Type: application/json" \
  -d '{"goal": "Produce a blog post about AI agents in DevOps"}'
```

Or send an email to your configured address:

```
Subject: Blog post request
Body: Write a blog post about how AI agents are transforming DevOps automation.
      Focus on monitoring, remediation, and incident response.
```

Check the `output/` directory for published content.

---

## What This Demonstrates

| Feature | Guide |
|---------|-------|
| Multi-agent delegation (4 specialized agents) | [Multi-Agent Systems](/guides/multi-agent) |
| Workflow engine orchestration | [Workflows](/guides/workflows) |
| Approval gates (editor review) | [Workflows](/guides/workflows#conditional-steps) |
| Email channel for requests | [Channels & Adapters](/guides/channels) |
| Scheduled weekly generation | [Scheduler](/guides/scheduler) |
| Budget management | [Governance](/guides/governance) |
| Task queue for job processing | [Task Queue](/guides/task-queue) |
| Long-term memory (content history) | [Context & Memory](/guides/context-memory) |
| Proactive triggers (budget alerts) | [Triggers](/guides/triggers) |
| Daemon mode for production | [Daemon Mode](/guides/daemon) |
