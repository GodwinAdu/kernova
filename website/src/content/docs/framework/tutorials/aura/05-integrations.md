---
title: Integrations
description: Connect to Gmail, Google Calendar, GitHub, Notion, Slack, and WhatsApp — full CRUD with permission controls.
---

## What You'll Build

Full integrations with Gmail (21 actions), Google Calendar (10 actions), GitHub, Notion, Slack, and WhatsApp. Each integration includes permission controls so the user decides what Aura can and can't do autonomously.

## Integration Architecture

```
User Settings (per-integration toggles)
    │
    ▼
Permission Check → Blocked? → Return error
    │
    ▼ (allowed)
Load Credentials (OAuth tokens / API keys)
    │
    ▼
Token Refresh (if expired)
    │
    ▼
API Call → Return structured result
```

Every integration tool follows this pattern: check permissions first, load tokens, refresh if needed, then act.

## Gmail — Full Email Management

This is the most complex tool in Aura. It supports 21 actions across read, write, organize, and batch operations.

Create `agents/tools/gmail.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'gmail',
  description: 'Full Gmail management — read, search, send, reply, forward, archive, delete, spam, star, label, and batch operations.',
  parameters: {
    action: {
      type: 'string',
      description: 'Action: "inbox", "search", "read", "send", "reply", "forward", "archive", "trash", "delete", "spam", "star", "markRead", "label", "batchArchive", "batchDelete", "batchRead"',
      required: true,
    },
    query: { type: 'string', description: 'Gmail search syntax (from:, is:unread, newer_than:1d)', required: false },
    to: { type: 'string', description: 'Recipient email(s)', required: false },
    subject: { type: 'string', description: 'Email subject', required: false },
    body: { type: 'string', description: 'Email body (plain text)', required: false },
    messageId: { type: 'string', description: 'Gmail message ID for read/reply/archive/etc.', required: false },
    messageIds: { type: 'string', description: 'Comma-separated IDs for batch ops', required: false },
    label: { type: 'string', description: 'Label name for label/unlabel actions', required: false },
    maxResults: { type: 'number', description: 'Max results (default: 10)', required: false },
  },
  execute: async (params, ctx) => {
    const { action, query, to, subject, body, messageId, messageIds, label, maxResults } = params;
    ctx.log(`📧 Gmail: ${action} ${query || to || messageId || ''}`);

    // ─── Permission Check ─────────────────────────────────────────
    try {
      const settingsRes = await fetch('http://localhost:3000/api/settings', { signal: AbortSignal.timeout(2000) });
      if (settingsRes.ok) {
        const settings = await settingsRes.json() as any;
        if (!settings.autonomousMode) {
          return { error: 'Autonomous mode disabled. Enable in Settings.', blocked: true };
        }
        // Check granular permissions per action type
        const readActions = ['inbox', 'search', 'read'];
        const writeActions = ['send', 'reply', 'forward'];
        if (readActions.includes(action as string) && settings.google_readInbox === false) {
          return { error: 'Inbox reading disabled in settings.', blocked: true };
        }
        if (writeActions.includes(action as string) && settings.google_sendEmail === false) {
          return { error: 'Sending emails disabled in settings.', blocked: true };
        }
      }
    } catch {}

    // ─── Load & Refresh Token ─────────────────────────────────────
    const tokens = await loadGoogleTokens();
    if (!tokens) return { error: 'Google not connected. Connect in Settings → Integrations.' };

    const accessToken = await getValidToken(tokens, ctx);
    if (!accessToken) return { error: 'Token expired. Reconnect Google in Settings.' };

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    // ─── Route to action handler ─────────────────────────────────
    switch (action) {
      case 'inbox': {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults || 10}&q=in:inbox`, { headers });
        const data = await res.json() as any;
        if (!data.messages?.length) return { emails: [], message: 'Inbox is empty.' };
        const emails = await Promise.all(data.messages.slice(0, 10).map((m: any) => getEmailMeta(m.id, headers)));
        return { emails: emails.filter(Boolean), count: data.resultSizeEstimate };
      }
      case 'send': {
        if (!to || !subject || !body) return { error: 'to, subject, and body required' };
        const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64url');
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify({ raw }) });
        const sent = await res.json() as any;
        return { sent: true, id: sent.id, to, subject, message: `✅ Email sent to ${to}` };
      }
      case 'reply': {
        if (!messageId || !body) return { error: 'messageId and body required for reply' };
        const orig = await getEmailMeta(messageId as string, headers);
        if (!orig) return { error: 'Could not read original email' };
        const replyTo = orig.from.match(/<(.+)>/)?.[1] || orig.from;
        const replySubject = orig.subject.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`;
        const raw = Buffer.from(`To: ${replyTo}\r\nSubject: ${replySubject}\r\nIn-Reply-To: ${orig.messageIdHeader}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64url');
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify({ raw, threadId: orig.threadId }) });
        return { sent: true, to: replyTo, subject: replySubject, message: `✅ Reply sent to ${replyTo}` };
      }
      // ... archive, trash, star, label, batch ops follow the same pattern
      default:
        return { error: `Unknown action: "${action}"` };
    }
  },
});
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project, enable Gmail API and Calendar API
3. Create OAuth 2.0 credentials (Web application)
4. Set redirect URI to `http://localhost:3000/api/auth/google/callback`
5. Add scopes: `gmail.modify`, `calendar.events`, `userinfo.email`

Add to `.env.local`:
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Token Refresh Flow

Tokens expire after 1 hour. The `getValidToken()` helper checks expiry and refreshes automatically:

```typescript
async function getValidToken(tokens: any, ctx: any): Promise<string | null> {
  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 60000) {
    return tokens.access_token; // Still valid
  }
  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (res.ok) {
    const data = await res.json() as any;
    tokens.access_token = data.access_token;
    tokens.expiry_date = Date.now() + (data.expires_in * 1000);
    // Persist to file and/or database
    return data.access_token;
  }
  return null;
}
```

## Google Calendar — 10 Actions

Create `agents/tools/google-calendar.ts` with actions: `today`, `upcoming`, `create`, `update`, `delete`, `search`, `free`, `get`, `move`, `listCalendars`.

The pattern mirrors Gmail — permission check, token load, API call:

```typescript
case 'create': {
  if (!title || !startTime) return { error: 'title and startTime required' };
  const event = {
    summary: title,
    start: { dateTime: new Date(startTime as string).toISOString(), timeZone: 'UTC' },
    end: { dateTime: new Date(endTime || Date.now() + 3600000).toISOString(), timeZone: 'UTC' },
    description, location,
    attendees: attendees ? (attendees as string).split(',').map(e => ({ email: e.trim() })) : undefined,
  };
  const res = await fetch(`${baseUrl}/events`, { method: 'POST', headers, body: JSON.stringify(event) });
  const created = await res.json() as any;
  return { created: true, id: created.id, title: created.summary, link: created.htmlLink };
}
```

## GitHub, Notion, Slack, WhatsApp

These follow simpler patterns (API key auth rather than OAuth):

- **GitHub** — uses `GITHUB_TOKEN` for repos, issues, PRs, notifications, code search
- **Notion** — uses `NOTION_API_KEY` for pages, databases, search
- **Slack** — uses `SLACK_BOT_TOKEN` for channels, messages, status
- **WhatsApp** — uses WhatsApp Business API for sending messages and media

Each is a single tool file with an `action` parameter that routes to the right API call.

## Permission Controls

The settings UI exposes per-integration toggles:

```typescript
// Settings shape
{
  autonomousMode: true,       // Master switch
  google_readInbox: true,     // Can read emails
  google_sendEmail: true,     // Can send emails
  google_archiveEmail: true,  // Can archive/star/label
  google_deleteEmail: false,  // Can permanently delete (off by default!)
  google_readCalendar: true,
  google_createEvent: true,
  google_deleteEvent: false,
  github_enabled: true,
  notion_enabled: true,
  slack_enabled: true,
}
```

**Why granular permissions?** You might trust Aura to read your inbox and archive newsletters, but not to delete emails permanently. The user stays in control.

## Exercise

1. Set up Google OAuth and connect Gmail — send yourself a test email through Aura
2. Ask "What's on my calendar today?" and verify the Calendar tool works
3. Toggle `google_sendEmail` off in settings — try sending an email and see it get blocked
4. Add a new integration for a service you use (Twitter/X, Spotify, Linear, etc.)
5. Try: "Check my inbox, archive all newsletters, and summarize what's left"

Next: we'll build 10 specialist agents that bring deep domain expertise.
