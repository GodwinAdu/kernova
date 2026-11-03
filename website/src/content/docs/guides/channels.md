---
title: "Channels"
description: Connect Kernova to external messaging platforms — Webhook, WebSocket, and platform-specific adapters for Slack, Discord, and more.
---

Channels are bidirectional bridges between Kernova and external messaging platforms. Inbound messages are normalized into a common format and dispatched as intents; outbound responses flow back to the originating channel for delivery.

## Overview

The channel system provides a unified interface for connecting Kernova to any messaging platform — from simple webhook endpoints to persistent WebSocket connections to third-party chat platforms.

**Two general-purpose adapters:**

- **WebhookChannelAdapter** — HTTP POST-based ingestion for server-to-server integrations
- **WebSocketChannelAdapter** — Persistent bidirectional connections for real-time communication

**Thirteen platform adapters** ([full list](#platform-adapters)), including:

- **SlackAdapter** — Slack Web API + Events API with signature verification
- **DiscordAdapter** — Discord Gateway WebSocket + REST API with heartbeat/resume
- **TelegramAdapter** — Bot API with long-polling or webhook mode
- **WhatsAppAdapter** — Meta Cloud API with the webhook subscription handshake
- **EmailAdapter** — Raw SMTP sending + IMAP polling for receiving

**SDK integration** is designed for minimal boilerplate:

```typescript
app.channel('incoming', adapter);   // Register a channel
app.onMessage(async (msg) => {});   // Handle inbound messages
```

Under the hood, the **ConnectorRegistry** manages all adapters — handling registration, reconnection logic, message normalization, and routing.

## Architecture

```
External Platform ←→ Channel Adapter ←→ ConnectorRegistry ←→ EventBus → Kernel (Intent)
```

### Inbound Flow

1. A message arrives at the platform (HTTP POST, WebSocket frame, Slack event, etc.)
2. The channel adapter checks that it really came from the platform (signature or token), then normalizes it into a standard `InboundMessage` with a `replyTo` address
3. The `ConnectorRegistry` validates the message structure
4. An event `channel.message.received` is emitted on the EventBus (with the sender, not the content)
5. Handlers registered with `kernel.channels.onMessage()` (or `app.onMessage()`) are invoked
6. Your handler typically submits the content as an intent and answers with `reply()` — see [Receiving and Replying](#receiving-and-replying)

### Outbound Flow

1. An agent produces a response (or the application sends one programmatically)
2. The `ConnectorRegistry` routes the message to the correct adapter by connector ID
3. The adapter's `send()` method delivers it to the `recipient` (an inbound message's `replyTo`) on the platform
4. A `channel.message.sent` or `channel.message.failed` event is emitted

## Quick Start with SDK

```typescript
import { Kernova, WebhookChannelAdapter } from '@kernova/sdk';

const app = await Kernova.create();

// Register a webhook channel (it starts listening right away)
app.channel('incoming', new WebhookChannelAdapter({ port: 3100, path: '/hooks' }));

// Handle all inbound messages
app.onMessage(async (msg) => {
  console.log(`[${msg.channel}] ${msg.sender}: ${msg.content}`);
});

await app.serve(); // Runs until SIGINT / SIGTERM
```

That's it — messages POSTed to `http://localhost:3100/hooks` are normalized and delivered to your handler. Without a `secret` the adapter only accepts requests from this machine; add one before exposing it ([signing requests](#signing-requests)).

## WebhookChannelAdapter

The webhook adapter starts a lightweight HTTP server and accepts inbound messages as JSON POST requests. It's the simplest path to production for server-to-server integrations.

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3100` | HTTP server port |
| `path` | `string` | `'/webhook'` | URL path to accept POST requests |
| `secret` | `string` | — | Shared secret. Requests must carry the HMAC-SHA256 of their raw body (recommended) |
| `signatureHeader` | `string` | `'x-kernova-signature'` | Header carrying the signature |
| `host` | `string` | all interfaces with a `secret`, else `127.0.0.1` | Interface to listen on |
| `id` | `string` | auto-generated | Unique connector identifier |

### Behavior

- Accepts **POST** requests at the configured path with a JSON body (up to 1 MB)
- With a `secret`: requests without a valid signature get `401`. Without one, the server only listens on `127.0.0.1`, so nothing outside the machine can post (set `host` to override)
- Responds immediately with `200 OK` and `{ received: true, messageId }` — processing is asynchronous
- Returns `404` for non-POST methods or mismatched paths, `400` for invalid JSON, `413` for bodies over 1 MB

### Usage

```typescript
import { WebhookChannelAdapter } from '@kernova/sdk';

app.channel('webhooks', new WebhookChannelAdapter({
  port: 3100,
  path: '/incoming',
  secret: process.env.WEBHOOK_SECRET,
}));
```

The webhook and WebSocket adapters are used directly (`await adapter.connect()`) or through `app.channel()`; [`kernel.channels`](#connectorregistry-core-api) manages the platform adapters.

### Expected POST Body

```json
{
  "sender": "user@example.com",
  "content": "Hello, can you help me?",
  "timestamp": "2025-07-10T14:30:00Z"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `sender` | Yes | Identifier for the message author |
| `content` | Yes | The message text |
| `timestamp` | No | ISO 8601 timestamp (defaults to server time) |

### Signing Requests

The signature is the hex HMAC-SHA256 of the exact body bytes, sent as `sha256=<hex>`:

```typescript
import { createHmac } from 'node:crypto';

const body = JSON.stringify({ sender: 'ci', content: 'Build failed on main' });
const signature = createHmac('sha256', process.env.WEBHOOK_SECRET!).update(body).digest('hex');

await fetch('https://hooks.example.com/incoming', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-kernova-signature': `sha256=${signature}` },
  body,
});
```

### Testing with cURL

```bash
BODY='{"sender": "test-user", "content": "Hello from cURL"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')

curl -X POST http://localhost:3100/incoming \
  -H "Content-Type: application/json" \
  -H "x-kernova-signature: sha256=$SIG" \
  -d "$BODY"
```

Without a `secret` (local testing), leave out the signature header.

## WebSocketChannelAdapter

The WebSocket adapter maintains persistent bidirectional connections — ideal for real-time user interfaces, chat applications, and dashboards that require instant message delivery.

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3200` | HTTP/WebSocket server port |
| `path` | `string` | `'/ws'` | WebSocket upgrade path |
| `keepaliveIntervalMs` | `number` | `30000` | Ping interval in milliseconds |
| `token` | `string` | — | Clients must send `Authorization: Bearer <token>`, or `?token=<token>` in the URL (browsers can't set headers) |
| `allowedOrigins` | `string[]` | — | Browser origins allowed to connect, e.g. `['https://app.example.com']` |
| `host` | `string` | all interfaces with a `token`, else `127.0.0.1` | Interface to listen on |

### Behavior

- Starts an HTTP server and upgrades connections to WebSocket at the configured path
- **Who can connect:** with a `token`, clients without it get `401`. Browsers don't apply CORS to WebSockets, so a browser connection (one that sends an `Origin`) is refused (`403`) unless its origin is in `allowedOrigins`, or (without a list) it presents the token. Without a token the server listens on `127.0.0.1` only
- Sends **ping** frames at the configured keepalive interval — terminates clients that don't respond with **pong**
- Inbound messages are JSON `{ sender?, content }` (up to 1 MB). Each message's `replyTo` is the sending client's ID
- `send(message, recipient)` goes to that client; without a recipient it broadcasts to every client

### Usage

```typescript
import { WebSocketChannelAdapter } from '@kernova/sdk';

app.channel('realtime', new WebSocketChannelAdapter({
  port: 8080,
  token: process.env.WS_TOKEN,
  allowedOrigins: ['https://app.example.com'],
}));

// Answer each client on its own connection
app.onMessage(async (msg) => {
  const { answer } = await app.ask(msg.content, { threadId: msg.replyTo });
  await app.reply(msg, answer);
});
```

### Client-Side Connection

```javascript
const ws = new WebSocket(`wss://chat.example.com/ws?token=${encodeURIComponent(token)}`);

ws.onopen = () => {
  ws.send(JSON.stringify({ sender: 'user-1', content: 'Hello!' }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data); // { type: 'message', content, timestamp }
  console.log('Response:', response.content);
};
```

A token in browser code is visible to that page's users: use it to keep strangers out, not as a per-user credential. For per-user auth, issue short-lived tokens from your backend.

### Keepalive & Connection Management

The adapter automatically pings connected clients every `keepaliveIntervalMs` milliseconds. If a client fails to respond with a pong frame before the next ping cycle, the connection is considered stale and terminated.

This ensures server resources are freed from zombie connections without manual intervention.

## SDK Methods

The SDK provides three methods for channel management:

### `app.channel(name, adapter)`

Registers a channel adapter with the application. Returns `this` for chaining.

```typescript
app.channel('hooks', new WebhookChannelAdapter({ port: 3100 }));
```

### `app.onMessage(handler)`

Registers a global handler invoked for **all** inbound messages across all channels. Returns `this` for chaining.

```typescript
app.onMessage(async (msg) => {
  console.log(`Received: ${msg.content}`);
});
```

### `app.reply(message, content)`

Answers an inbound message on the adapter it came from, to its sender (`message.replyTo`). Returns the adapter's `DeliveryReceipt`.

```typescript
app.onMessage(async (msg) => {
  await app.reply(msg, `Got it: ${msg.content}`);
});
```

### Chaining

`channel()` and `onMessage()` return the app instance, enabling fluent configuration:

```typescript
app
  .channel('hooks', new WebhookChannelAdapter({ port: 3100 }))
  .channel('ws', new WebSocketChannelAdapter({ port: 8080 }))
  .onMessage(async (msg) => {
    // This handler receives messages from both channels
    console.log(`[${msg.channel}] ${msg.sender}: ${msg.content}`);
  });
```

## ConnectorRegistry (Core API)

For advanced use cases that bypass the SDK, the `ConnectorRegistry` is available directly on the kernel. It manages the full lifecycle of channel adapters.

### Methods

#### `register(input)`

Registers a platform connector (one of the [platform adapters](#platform-adapters)) with configuration validation. Returns the connector definition, whose `id` the other methods take.

```typescript
const slack = kernel.channels.register({
  channelType: 'slack',
  name: 'Support Slack',
  config: { type: 'slack', botToken: process.env.SLACK_BOT_TOKEN!, signingSecret: process.env.SLACK_SIGNING_SECRET! },
});
```

#### `connect(connectorId)`

Initiates connection to the platform for the specified connector.

```typescript
await kernel.channels.connect('connector_abc123');
```

#### `disconnect(connectorId)`

Gracefully disconnects from the platform and cancels any pending reconnection attempts.

```typescript
await kernel.channels.disconnect('connector_abc123');
```

#### `send(request)`

Sends an outbound message through the specified connector, to `recipient` (an inbound message's `replyTo`).

```typescript
await kernel.channels.send({
  connectorId: 'connector_abc123',
  recipient: 'C024BE91L',            // e.g. a Slack channel ID
  message: { content: 'Hello from Kernova!' },
});
```

#### `onMessage(handler)`

Handles inbound messages from every connector. Returns a function that removes the handler. A handler that throws emits `channel.handler.failed`.

#### `reply(message, content)`

Sends `content` (a string or an `OutboundMessage`) back on the message's connector, to its `replyTo`.

#### `status()`

Returns all registered connectors with their current connection state.

```typescript
const connectors = kernel.channels.status();
// [{ id, name, channelType, state: 'connected' | 'disconnected' | 'connecting' | 'failed' }]
```

## Receiving and Replying

Each inbound message has a `replyTo` address: the chat, channel, conversation, room, or phone number a reply should go to. Pass it back when you send, so concurrent conversations each get their own answers:

```typescript
// kernel.channels (platform adapters)
kernel.channels.onMessage(async (msg) => {
  const intent = await kernel.submit({
    goal: msg.content,
    owner: msg.sender,
    metadata: { threadId: `${msg.connectorId}:${msg.replyTo}` }, // one conversation per chat
  });
  await kernel.channels.reply(msg, intent.result?.summary ?? 'Sorry, something went wrong.');
});

// Or explicitly
await kernel.channels.send({ connectorId: msg.connectorId, recipient: msg.replyTo, message: { content: 'Hi!' } });
```

```typescript
// SDK (webhook, WebSocket, or any SDKChannelAdapter)
app.onMessage(async (msg) => {
  const { answer } = await app.ask(msg.content, { threadId: `${msg.connectorId}:${msg.replyTo}` });
  await app.reply(msg, answer);
});
```

Without a recipient, an adapter sends to its configured default (`defaultChannel` for Slack, `defaultRecipient` for Email, the first room for Matrix, the first channel for IRC) or to the only conversation it has seen. Once several people are talking to the bot, a send without a recipient fails instead of guessing.

---

## Message Types

All channel communication uses these standardized interfaces:

### InboundMessage

```typescript
interface InboundMessage {
  id: string;           // Unique message identifier
  sender: string;       // Author identifier (email, user ID, etc.)
  channel: string;      // Channel name (e.g., 'hooks', 'realtime')
  content: string;      // Message text content
  timestamp: string;    // ISO 8601 timestamp
  connectorId: string;  // Internal connector reference
  raw?: unknown;        // Original platform-specific payload (for advanced processing)
  replyTo?: string;     // Where a reply goes (chat, channel, conversation, number); pass as `recipient`
}
```

### OutboundMessage

```typescript
interface OutboundMessage {
  content: string;        // Plain text response
  structured?: unknown;   // Rich content (cards, buttons, embeds, etc.)
}
```

The `structured` field allows platform-specific rich content. Each adapter is responsible for serializing structured content into its platform's format — or falling back to `content` if the platform doesn't support it.

### DeliveryReceipt

```typescript
interface DeliveryReceipt {
  success: boolean;
  platformMessageId?: string; // The platform's ID for the sent message
  timestamp: string;
  error?: string;             // Why delivery failed (e.g. no recipient)
}
```

## Reconnection & Resilience

Channel adapters are designed for production reliability. The `ConnectorRegistry` implements automatic reconnection and graceful degradation.

### Exponential Backoff

On connection failure, the registry retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | 1 second |
| 2 | 2 seconds |
| 3 | 4 seconds |
| 4 | 8 seconds |
| 5 | 16 seconds |
| 6+ | 60 seconds (max) |

### State Transitions

```
disconnected → connecting → connected
                    ↓
                 failed → reconnecting → connected
                              ↓
                           failed (retry with backoff)
```

### Behavior Details

- **Explicit disconnect** cancels all pending reconnection attempts — no automatic retry
- **Delivery timeout**: if `send()` takes longer than 30 seconds, it returns a failure receipt
- **Structured content degradation**: if a platform rejects rich content (cards, buttons), the adapter automatically falls back to plain text using the `content` field
- **Connection state** is always queryable via `kernel.channels.status()`

## Platform Adapters

All platform adapters ship fully implemented with `@kernova/core`. No external dependencies needed — they use native `fetch`, `net`, `tls`, `crypto`, and the `ws` library (already bundled).

| Platform | Transport | Inbound requests | Required Config |
|----------|-----------|------------------|-----------------|
| Webhook | HTTP POST receiver | ✅ HMAC-SHA256 with `secret` (localhost-only without one) | `port`, `path` |
| WebSocket | WS server + keepalive | ✅ `token` and `allowedOrigins` (localhost-only without a token) | `port`, `path` |
| Slack | Web API + Events webhook | ✅ Signing secret (HMAC-SHA256), 5-minute replay window | `botToken`, `signingSecret` |
| Discord | Gateway WebSocket + REST | Outbound connection | `botToken`, `applicationId` |
| Telegram | Bot API (long-polling or webhook) | Polling: outbound. Webhook: ✅ secret token (generated automatically) | `botToken` |
| WhatsApp | Meta Cloud API + webhook | ✅ `X-Hub-Signature-256` with `appSecret` (required to receive) | `accessToken`, `phoneNumberId`, `verifyToken`, `appSecret` |
| Email | SMTP (send) + IMAP polling (receive) | Outbound connection | `smtpHost`, `imapHost`, `username`, `password` |
| Microsoft Teams | Bot Framework webhook | ✅ Bot Framework token (JWT, checked against Microsoft's keys) | `appId`, `appPassword` |
| SMS (Twilio) | Twilio REST API + webhook | ✅ `X-Twilio-Signature` | `accountSid`, `authToken`, `fromNumber` |
| Signal | signal-cli binary + polling | Outbound (local binary) | `signalCliPath`, `phoneNumber` |
| Matrix | Client-Server API + /sync | Outbound connection | `homeserverUrl`, `accessToken`, `userId` |
| IRC | TCP/TLS socket + PRIVMSG | Outbound connection | `server`, `port`, `nick`, `channels` |
| Voice (Twilio) | REST API + TwiML webhook | ✅ `X-Twilio-Signature` | `accountSid`, `authToken`, `fromNumber` |
| Push (FCM/APNs) | HTTP push (send-only) | — | `provider`, `fcmServerKey` or APNs creds |
| RSS/Atom | Feed polling (receive-only) | Outbound connection | `feeds` array |

Every adapter that runs a webhook server checks that requests really come from the platform, and rejects bodies over 1 MB. Twilio signs the exact public URL it calls: behind a proxy or tunnel, set `webhookUrl` to the URL configured in Twilio (otherwise it's rebuilt from `X-Forwarded-Proto`/`X-Forwarded-Host`/`Host`).

### Slack Adapter

Connects to Slack using the Web API for sending and the Events API (via HTTP webhook) for receiving. Includes HMAC-SHA256 signature verification.

**Config:**
```typescript
import { SlackAdapter } from '@kernova/core';

const slack = new SlackAdapter({
  type: 'slack',
  botToken: process.env.SLACK_BOT_TOKEN!,    // xoxb-...
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  port: 3300,           // Webhook server port (optional, default: 3300)
  defaultChannel: 'C0123456789',  // Fallback channel for outbound (optional)
});
```

**Setup steps:**
1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable "Event Subscriptions" and point the Request URL to `http://your-server:3300/`
3. Subscribe to `message.channels` and `message.im` events
4. Install the app to your workspace and copy the Bot Token + Signing Secret

**Features:**
- `auth.test` verification on connect
- Webhook signature verification (timing-safe HMAC-SHA256)
- URL verification challenge (automatic)
- Slack blocks support via `message.structured` (pass an array of block objects)
- Bot message filtering (ignores own messages)
- Channel routing (replies in the same channel the message came from)

**Example:**
```typescript
kernel.channels.register({ channelType: 'slack', name: 'team-slack', config: slackConfig });
await kernel.channels.connect('connector_id');

// Send a message with blocks
await kernel.channels.send({
  connectorId: 'connector_id',
  message: {
    content: 'Deployment successful!',
    structured: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Deploy* completed ✅' } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Logs' } }] },
    ],
  },
});
```

---

### Discord Adapter

Connects to Discord using the Gateway WebSocket (for receiving messages) and REST API (for sending). Handles heartbeat, identify, resume, and automatic reconnection.

**Config:**
```typescript
import { DiscordAdapter } from '@kernova/core';

const discord = new DiscordAdapter({
  type: 'discord',
  botToken: process.env.DISCORD_BOT_TOKEN!,
  applicationId: process.env.DISCORD_APP_ID!,
});
```

**Setup steps:**
1. Create an application at [discord.com/developers](https://discord.com/developers/applications)
2. Create a Bot and copy the token
3. Enable "Message Content Intent" in the Bot settings
4. Invite the bot to your server with the `bot` scope and `Send Messages` + `Read Messages` permissions

**Features:**
- Gateway v10 WebSocket with heartbeat + jitter
- Auto-identify with intents: `GUILD_MESSAGES | MESSAGE_CONTENT`
- Resume on unexpected disconnect (preserves session)
- Fatal error detection (invalid token, disallowed intents) → no retry
- Embed support via `message.structured.embeds`
- Bot message filtering (ignores messages from bots)

**Example:**
```typescript
kernel.channels.register({ channelType: 'discord', name: 'game-server', config: discordConfig });
await kernel.channels.connect('connector_id');

// Send with an embed
await kernel.channels.send({
  connectorId: 'connector_id',
  message: {
    content: 'New alert:',
    structured: {
      embeds: [{
        title: 'Server Alert',
        description: 'CPU usage is above 90%',
        color: '#ff0000',
        fields: [{ name: 'Server', value: 'prod-1', inline: true }],
      }],
    },
  },
});
```

---

### Telegram Adapter

Connects to Telegram using the Bot API. Supports both long-polling (no server needed) and webhook mode (for production).

**Config:**
```typescript
import { TelegramAdapter } from '@kernova/core';

// Long-polling mode (simplest — no public URL needed)
const telegram = new TelegramAdapter({
  type: 'telegram',
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
});

// Webhook mode (production — requires public HTTPS URL)
const telegramProd = new TelegramAdapter({
  type: 'telegram',
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  webhookUrl: 'https://your-domain.com/telegram',
  webhookPort: 8443,  // Local port behind your proxy (default: the URL's port)
});
```

In webhook mode the adapter registers the webhook with a secret token (random per connect, or `secretToken`), and refuses updates that don't carry it in `X-Telegram-Bot-Api-Secret-Token`, as well as requests to other paths.

**Setup steps:**
1. Talk to [@BotFather](https://t.me/BotFather) on Telegram
2. Create a bot and copy the token
3. For long-polling: no further setup needed
4. For webhook: set up a public HTTPS endpoint

**Features:**
- `getMe` verification on connect
- Long-polling with 30s timeout (efficient — no constant requests)
- Webhook mode with `setWebhook`/`deleteWebhook` lifecycle
- Markdown formatting in outbound messages
- Inline keyboard buttons via `message.structured.buttons`
- Chat ID routing per sender (replies in same chat)

**Example:**
```typescript
kernel.channels.register({ channelType: 'telegram', name: 'support-bot', config: telegramConfig });
await kernel.channels.connect('connector_id');

// Send with inline keyboard
await kernel.channels.send({
  connectorId: 'connector_id',
  message: {
    content: 'How can I help you?',
    structured: {
      buttons: [
        { label: '📋 Check Status', action: 'check_status' },
        { label: '🆘 Get Support', action: 'support' },
      ],
    },
  },
});
```

---

### WhatsApp Adapter

Connects to WhatsApp Business using the Meta Cloud API. Receives messages via a webhook server; sends via the Messages API.

**Config:**
```typescript
import { WhatsAppAdapter } from '@kernova/core';

const whatsapp = new WhatsAppAdapter({
  type: 'whatsapp',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
  phoneNumberId: process.env.WHATSAPP_PHONE_ID!,
  verifyToken: 'my-custom-verify-token',  // You choose this — used for webhook verification
  appSecret: process.env.WHATSAPP_APP_SECRET!, // App Dashboard → Settings → Basic; verifies each message
  webhookPort: 3400,  // Optional (default: 3400)
});
```

Meta signs each webhook POST with your app secret (`X-Hub-Signature-256`). Requests with a missing or wrong signature get `401`, and without `appSecret` the adapter refuses all incoming messages (`403`), because forged ones can't be told apart. Sending works without it.

**Setup steps:**
1. Create a Meta Business app at [developers.facebook.com](https://developers.facebook.com)
2. Add the WhatsApp product and get a permanent access token
3. Configure the webhook URL to point to `http://your-server:3400/`
4. Use your `verifyToken` when Meta verifies the webhook endpoint

**Features:**
- Token verification via phone number info API
- Webhook verification (GET with `hub.verify_token` / `hub.challenge`)
- Nested event parsing (`entry[0].changes[0].value.messages[0]`)
- Text message filtering (only `type === 'text'`)
- Reply routing (sends to last sender's phone number)
- Immediate 200 response (per Meta webhook requirements)

**Example:**
```typescript
kernel.channels.register({ channelType: 'whatsapp', name: 'support-wa', config: whatsappConfig });
await kernel.channels.connect('connector_id');

// Messages arrive via webhook and trigger your handler
app.onMessage(async (msg) => {
  if (msg.channel === 'whatsapp') {
    console.log(`WhatsApp from +${msg.sender}: ${msg.content}`);
  }
});
```

---

### Email Adapter

Connects to email using raw SMTP for sending and IMAP polling for receiving. Uses Node.js native `net`/`tls` modules — no external email libraries needed.

**Config:**
```typescript
import { EmailAdapter } from '@kernova/core';

const email = new EmailAdapter({
  type: 'email',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  username: 'your-bot@gmail.com',
  password: process.env.EMAIL_APP_PASSWORD!,
  useTls: true,
  pollIntervalMs: 60000,       // Check for new mail every 60s
  defaultRecipient: 'team@company.com',  // Fallback send-to address
});
```

**Setup steps:**
1. Create a dedicated email account for the bot
2. Enable IMAP access in your email provider settings
3. For Gmail: generate an App Password (Settings → Security → App Passwords)
4. Provide SMTP and IMAP host/port for your provider

**Features:**
- SMTP client: EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT
- IMAP polling: LOGIN → SELECT INBOX → SEARCH UNSEEN → FETCH → STORE +FLAGS (\Seen)
- TLS support for both SMTP and IMAP
- RFC 2822 message formatting
- Auto-reply routing (replies to last sender)
- Polls at configurable interval (caps at 10 messages per poll to avoid overload)

**Example:**
```typescript
kernel.channels.register({ channelType: 'email', name: 'inbox', config: emailConfig });
await kernel.channels.connect('connector_id');

// New emails trigger the message handler
app.onMessage(async (msg) => {
  if (msg.channel === 'email') {
    console.log(`Email from ${msg.sender}: ${msg.content}`);
    // msg.raw contains { subject, uid } for additional context
  }
});

// Reply to the sender
await kernel.channels.send({
  connectorId: 'connector_id',
  message: { content: 'Thanks for your email! I am looking into this.' },
});
```

**Common email providers:**

| Provider | SMTP Host | SMTP Port | IMAP Host | IMAP Port |
|----------|-----------|-----------|-----------|-----------|
| Gmail | smtp.gmail.com | 465 | imap.gmail.com | 993 |
| Outlook | smtp-mail.outlook.com | 587 | outlook.office365.com | 993 |
| Yahoo | smtp.mail.yahoo.com | 465 | imap.mail.yahoo.com | 993 |
| Zoho | smtp.zoho.com | 465 | imap.zoho.com | 993 |

---

### Microsoft Teams Adapter

Connects via the Bot Framework for sending and receiving messages in Teams channels and 1:1 chats.

**Config:**
```typescript
import { TeamsAdapter } from '@kernova/core';

const teams = new TeamsAdapter({
  type: 'teams',
  appId: process.env.TEAMS_APP_ID!,
  appPassword: process.env.TEAMS_APP_PASSWORD!,
  tenantId: process.env.TEAMS_TENANT_ID,  // Optional — multi-tenant if omitted
  port: 3400,                              // Messaging endpoint port (default: 3400)
});

app.channel('teams', teams);
```

Each activity must carry a Bot Framework token: a JWT signed with one of Microsoft's published keys, issued for your `appId`, unexpired, and for the activity's `serviceUrl`. Anything else gets `401`, so a forged request can't make the bot send its access token to another server. The adapter refreshes its own access token before it expires. For sovereign clouds, set `openIdMetadataUrl`.

**Setup steps:**
1. Register a bot at [dev.botframework.com](https://dev.botframework.com)
2. Create an Azure AD App Registration — copy App ID and generate a Password
3. Configure the messaging endpoint to point to `http://your-server:3000/api/messages`
4. Install the bot in your Teams tenant

**Features:**
- Bot Framework token authentication on connect
- Webhook server for incoming activity (messages, events)
- Adaptive card support via `message.structured`
- Reply routing (responds in the same conversation)

---

### SMS Adapter (Twilio)

Send and receive SMS messages via the Twilio API.

**Config:**
```typescript
import { SmsAdapter } from '@kernova/core';

const sms = new SmsAdapter({
  type: 'sms',
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  fromNumber: '+15551234567',
  webhookPort: 3500,  // Optional (default: 3500)
  webhookUrl: 'https://your-domain.com/sms', // The URL set in Twilio, when behind a proxy or tunnel
});

app.channel('sms', sms);
```

Requests must carry a valid `X-Twilio-Signature` (computed with your auth token over the URL Twilio called); others get `403`.

**Setup steps:**
1. Create a Twilio account at [twilio.com](https://www.twilio.com)
2. Buy a phone number with SMS capability
3. Set the phone number's webhook URL to `http://your-server:3500/sms`
4. Copy your Account SID and Auth Token

**Features:**
- HTTP Basic Auth for Twilio API calls
- Webhook receiver for inbound SMS (Twilio POST with `From`, `Body`)
- Immediate 200 response per Twilio webhook requirements
- Reply routing to last sender's phone number

---

### Signal Adapter

Connects to Signal via the `signal-cli` command-line tool.

**Config:**
```typescript
import { SignalAdapter } from '@kernova/core';

const signal = new SignalAdapter({
  type: 'signal',
  signalCliPath: '/usr/local/bin/signal-cli',
  phoneNumber: '+15559876543',
  pollIntervalMs: 5000,  // Check for new messages every 5s
});

app.channel('signal', signal);
```

**Setup steps:**
1. Install [signal-cli](https://github.com/AsamK/signal-cli)
2. Register or link a phone number: `signal-cli -u +1555... register`
3. Verify with the code: `signal-cli -u +1555... verify CODE`
4. Ensure the binary is accessible at the configured path

**Features:**
- Sends via `signal-cli send -m "message" recipient`
- Receives via `signal-cli receive --json` polling
- JSON output parsing for sender, body, timestamp
- Configurable poll interval

---

### Matrix Adapter

Connects to any Matrix homeserver using the Client-Server API.

**Config:**
```typescript
import { MatrixAdapter } from '@kernova/core';

const matrix = new MatrixAdapter({
  type: 'matrix',
  homeserverUrl: 'https://matrix.org',
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  userId: '@kernova-bot:matrix.org',
  roomIds: ['!abc123:matrix.org', '!def456:matrix.org'],
});

app.channel('matrix', matrix);
```

**Setup steps:**
1. Create a bot account on your homeserver
2. Get an access token via `POST /_matrix/client/v3/login`
3. Invite the bot to rooms and configure `roomIds`

**Features:**
- Token verification via `/_matrix/client/v3/account/whoami`
- Joins configured rooms on connect
- Long-polling via `/sync` with `since` token for incremental updates
- Sends messages as `m.room.message` events
- Supports formatted messages via `message.structured.format`

---

### IRC Adapter

Raw TCP/TLS connection to IRC servers with standard protocol handling.

**Config:**
```typescript
import { IrcAdapter } from '@kernova/core';

const irc = new IrcAdapter({
  type: 'irc',
  server: 'irc.libera.chat',
  port: 6697,
  nick: 'kernova-bot',
  channels: ['#support', '#general'],
  password: process.env.IRC_PASSWORD,  // Optional NickServ password
  useTls: true,
});

app.channel('irc', irc);
```

**Setup steps:**
1. Choose an IRC network (Libera.Chat, OFTC, etc.)
2. Register a nickname with NickServ (optional but recommended)
3. Configure channels to join

**Features:**
- TCP/TLS connection via native `net`/`tls` modules
- Automatic NICK + USER + JOIN on connect
- PING/PONG keepalive handling
- Parses PRIVMSG for inbound messages
- Sends PRIVMSG to last-received channel
- Password authentication (NickServ IDENTIFY)

---

### Voice Adapter (Twilio)

Make and receive phone calls with text-to-speech and speech-to-text via Twilio Voice.

**Config:**
```typescript
import { VoiceAdapter } from '@kernova/core';

const voice = new VoiceAdapter({
  type: 'voice',
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  fromNumber: '+15551234567',
  webhookPort: 3600,
  ttsVoice: 'alice',  // TTS voice (default: 'alice')
  webhookUrl: 'https://your-domain.com/voice', // The URL set in Twilio, when behind a proxy or tunnel
});

app.channel('voice', voice);
```

Requests must carry a valid `X-Twilio-Signature`, so nobody else can make the bot place calls on your Twilio account.

**Setup steps:**
1. Same Twilio account as SMS
2. Configure the phone number's Voice webhook to `http://your-server:3600/voice`
3. Enable speech recognition in your Twilio console

**Features:**
- Outbound calls via Twilio REST API with TwiML `<Say>` verb
- Inbound call webhook with TwiML `<Gather>` for speech input
- Converts `SpeechResult` parameter to text messages
- Reply routing to last caller

---

### Push Notifications Adapter (FCM/APNs)

Send push notifications to mobile devices. This is **send-only** — push notifications don't have an inbound channel.

**Config:**
```typescript
import { PushAdapter } from '@kernova/core';

// Firebase Cloud Messaging
const push = new PushAdapter({
  type: 'push',
  provider: 'fcm',
  fcmServerKey: process.env.FCM_SERVER_KEY!,
});

// Apple Push Notification Service
const pushApple = new PushAdapter({
  type: 'push',
  provider: 'apns',
  apnsKeyPath: './certs/AuthKey.p8',
  apnsKeyId: 'ABC123DEF4',
  apnsTeamId: 'TEAM123456',
  apnsBundleId: 'com.myapp.ios',
});

app.channel('push', push);
```

**Features:**
- FCM: POST to `https://fcm.googleapis.com/fcm/send` with server key auth
- APNs: HTTP/2 POST with JWT bearer token
- Supports title + body + custom data payload via `message.structured`
- Send-only — `onMessage` is a no-op (mobile devices push back via other channels)
- Delivery receipt indicates success/failure from the push service

**Example — sending a push:**
```typescript
await kernel.channels.send({
  connectorId: 'push-connector-id',
  message: {
    content: 'Your order has shipped!',
    structured: {
      title: 'Order Update',
      body: 'Your order #1234 has shipped and will arrive tomorrow.',
      data: { orderId: '1234', action: 'view_order' },
      deviceToken: 'user-device-token-here',
    },
  },
});
```

---

### RSS/Atom Feed Adapter

Monitor RSS and Atom feeds for new entries. This is **receive-only** — you can't publish to an RSS feed.

**Config:**
```typescript
import { RssAdapter } from '@kernova/core';

const rss = new RssAdapter({
  type: 'rss',
  feeds: [
    { url: 'https://blog.example.com/feed.xml', name: 'Company Blog' },
    { url: 'https://news.ycombinator.com/rss', name: 'Hacker News' },
    { url: 'https://arxiv.org/rss/cs.AI', name: 'AI Papers' },
  ],
  pollIntervalMs: 300_000,  // Check every 5 minutes
});

app.channel('rss', rss);
```

**Features:**
- Polls configured feed URLs at the specified interval
- Parses XML for `<item>` / `<entry>` elements (supports both RSS 2.0 and Atom)
- Extracts title, link, description/summary, and GUID
- Tracks seen GUIDs to avoid duplicate processing
- New items are dispatched as inbound messages
- Receive-only — `send()` returns an error

**Example — reacting to new articles:**
```typescript
app.onMessage(async (msg) => {
  if (msg.channel === 'rss') {
    console.log(`New article from ${msg.sender}: ${msg.content}`);
    // msg.raw contains { title, link, description, guid, feedName }
    await app.ask(`Summarize this article: ${msg.raw.link}`);
  }
});
```

## Custom Adapter

Building your own channel adapter is straightforward. Implement the `SDKChannelAdapter` interface:

```typescript
import type {
  SDKChannelAdapter,
  InboundMessage,
  OutboundMessage,
  DeliveryReceipt,
} from '@kernova/types';

class MyCustomAdapter implements SDKChannelAdapter {
  readonly id = 'my-adapter';
  readonly type = 'custom';

  private handler?: (msg: InboundMessage) => Promise<void>;

  async connect(): Promise<void> {
    // Initialize your connection (open sockets, start polling, etc.)
    console.log('Custom adapter connected');
  }

  async disconnect(): Promise<void> {
    // Clean up resources
    console.log('Custom adapter disconnected');
  }

  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    // Deliver the message to `recipient` (an inbound message's replyTo) on your platform
    try {
      const platformMessageId = await myPlatform.post(recipient, message.content);
      return { success: true, platformMessageId, timestamp: new Date().toISOString() };
    } catch (error) {
      return { success: false, timestamp: new Date().toISOString(), error: String(error) };
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  // Call this internally when your platform delivers a message
  protected async receiveMessage(sender: string, content: string): Promise<void> {
    if (!this.handler) return;

    await this.handler({
      id: `msg_${Date.now()}`,
      sender,
      channel: this.type,
      content,
      timestamp: new Date().toISOString(),
      connectorId: this.id,
    });
  }
}
```

Register it like any other adapter:

```typescript
app.channel('custom', new MyCustomAdapter());
```

## Events

The channel system emits events on the kernel's EventBus at every significant lifecycle point:

| Event | Emitted When | Payload |
|-------|--------------|---------|
| `channel.message.received` | Inbound message arrives | `{ messageId, sender, channelType }` |
| `channel.message.sent` | Outbound successfully delivered | `{ messageId, recipient }` |
| `channel.message.failed` | Outbound delivery failed | `{ messageId, reason }` |
| `channel.connected` | Adapter establishes connection | `{ name, channelType }` |
| `channel.disconnected` | Adapter disconnects | `{ name }` |
| `channel.connection.failed` | Connection attempt fails | `{ name, reason }` |

### Subscribing to Events

```typescript
kernel.events.subscribe('channel.message.received', ({ data }) => {
  console.log(`New message from ${data.sender} via ${data.channelType}`);
});

kernel.events.subscribe('channel.connection.failed', ({ data }) => {
  console.error(`Channel "${data.name}" failed: ${data.reason}`);
  // Alert your monitoring system
});
```

## Best Practices

### Choosing the Right Adapter

- **Webhook** — Best for server-to-server integrations: CI/CD notifications, API callbacks, third-party service events. Stateless and simple.
- **WebSocket** — Best for real-time user interfaces: chat applications, live dashboards, collaborative tools. Persistent and low-latency.

### Security

- **Inbound requests are verified.** Every adapter with a webhook server checks the platform's signature or token (see the [table](#platform-adapters)). Configure the secret each one needs (`secret`, `appSecret`, `signingSecret`, `authToken`) and keep it out of source control.
- **Use HTTPS (TLS)** in front of webhook adapters. Deploy behind a reverse proxy (nginx, Caddy) or load balancer that terminates TLS. For Twilio, set `webhookUrl` to the public URL.
- **Authenticate WebSocket connections** with `token`, and list browser origins in `allowedOrigins`.
- **Reply with `replyTo`.** `reply(msg, …)` or `send(…, msg.replyTo)` keeps each conversation's answers in that conversation.
- **Treat `sender` as a label.** It comes from the platform (or, for the generic webhook and WebSocket adapters, from the client), so check it against your own user records before granting anything.

### Reliability

- **Monitor `channel.connection.failed` events** to detect connectivity issues early. Wire these to your alerting system.
- **Set appropriate keepalive intervals** for WebSocket. Too aggressive (< 10s) wastes bandwidth; too relaxed (> 60s) delays stale connection detection.
- **Handle delivery failures** gracefully. Check the `DeliveryReceipt` from `send()` and implement retry logic for critical messages.

### Scaling

- Each webhook adapter binds to its own port. In production, use a single reverse proxy that routes paths to the appropriate adapter.
- WebSocket adapters track all connected clients in memory. For horizontal scaling, use a shared pub/sub layer (Redis, NATS) to broadcast messages across instances.
- Use the `raw` field on `InboundMessage` to preserve platform-specific metadata that might be needed for advanced routing or auditing.
