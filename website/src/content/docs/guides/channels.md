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

**Five platform-specific adapters — fully implemented:**

- **SlackAdapter** — Slack Web API + Events API with signature verification
- **DiscordAdapter** — Discord Gateway WebSocket + REST API with heartbeat/resume
- **TelegramAdapter** — Bot API with long-polling or webhook mode
- **WhatsAppAdapter** — Meta Cloud API with webhook verification
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
2. The channel adapter normalizes it into a standard `InboundMessage`
3. The `ConnectorRegistry` validates the message structure
4. An event `channel.message.received` is emitted on the EventBus
5. Registered message handlers are invoked
6. Optionally, the message is submitted as an intent to the Kernel for agent processing

### Outbound Flow

1. An agent produces a response (or the application sends one programmatically)
2. The `ConnectorRegistry` routes the message to the correct adapter by connector ID
3. The adapter's `send()` method serializes and delivers it to the platform
4. A `channel.message.sent` or `channel.message.failed` event is emitted

## Quick Start with SDK

```typescript
import { Kernova } from '@kernova/sdk';
import { WebhookChannelAdapter } from '@kernova/core';

const app = await Kernova.create();

// Register a webhook channel
app.channel('incoming', new WebhookChannelAdapter({ port: 3100, path: '/hooks' }));

// Handle all inbound messages
app.onMessage(async (msg) => {
  console.log(`[${msg.channel}] ${msg.sender}: ${msg.content}`);
});

await app.serve(); // Starts listening on configured ports
```

That's it — messages POSTed to `http://localhost:3100/hooks` are normalized and delivered to your handler.

## WebhookChannelAdapter

The webhook adapter starts a lightweight HTTP server and accepts inbound messages as JSON POST requests. It's the simplest path to production for server-to-server integrations.

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3100` | HTTP server port |
| `path` | `string` | `'/webhook'` | URL path to accept POST requests |
| `id` | `string` | auto-generated | Unique connector identifier |

### Behavior

- Starts an HTTP server bound to the configured port
- Accepts **POST** requests at the configured path with a JSON body
- Responds immediately with `200 OK` and `{ received: true, messageId }` — processing is asynchronous
- Returns `404` for non-POST methods or mismatched paths
- Returns `400` for missing/invalid JSON body

### Usage

```typescript
import { WebhookChannelAdapter } from '@kernova/core';

const webhook = new WebhookChannelAdapter({
  port: 3100,
  path: '/incoming',
});

// Register with the core ConnectorRegistry
kernel.channels.register({
  channelType: 'webhook',
  name: 'My Webhook',
  config: { port: 3100, path: '/incoming' },
});

// Or use the SDK shorthand
app.channel('webhooks', webhook);
```

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

### Response

```json
{
  "received": true,
  "messageId": "msg_a1b2c3d4"
}
```

### Testing with cURL

```bash
curl -X POST http://localhost:3100/incoming \
  -H "Content-Type: application/json" \
  -d '{"sender": "test-user", "content": "Hello from cURL"}'
```

## WebSocketChannelAdapter

The WebSocket adapter maintains persistent bidirectional connections — ideal for real-time user interfaces, chat applications, and dashboards that require instant message delivery.

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3200` | HTTP/WebSocket server port |
| `path` | `string` | `'/ws'` | WebSocket upgrade path |
| `keepaliveIntervalMs` | `number` | `30000` | Ping interval in milliseconds |

### Behavior

- Starts an HTTP server and upgrades connections to WebSocket at the configured path
- Sends **ping** frames at the configured keepalive interval — terminates clients that don't respond with **pong**
- Supports **multiple concurrent clients** (tracks all active connections)
- `send()` broadcasts to all connected clients
- Inbound messages are expected as JSON: `{ sender?, content }`

### Usage

```typescript
import { WebSocketChannelAdapter } from '@kernova/core';

const ws = new WebSocketChannelAdapter({
  port: 8080,
  path: '/ws',
  keepaliveIntervalMs: 30000,
});

app.channel('realtime', ws);
```

### Client-Side Connection

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ sender: 'user-1', content: 'Hello!' }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Response:', response);
};

ws.onclose = () => {
  console.log('Disconnected from server');
};
```

### Keepalive & Connection Management

The adapter automatically pings connected clients every `keepaliveIntervalMs` milliseconds. If a client fails to respond with a pong frame before the next ping cycle, the connection is considered stale and terminated.

This ensures server resources are freed from zombie connections without manual intervention.

## SDK Methods

The SDK provides two primary methods for channel management:

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

### Chaining

Both methods return the app instance, enabling fluent configuration:

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

Registers a new channel adapter with configuration validation.

```typescript
kernel.channels.register({
  channelType: 'webhook',
  name: 'Production Webhook',
  config: { port: 3100, path: '/hooks' },
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

Sends an outbound message through the specified connector.

```typescript
await kernel.channels.send({
  connectorId: 'connector_abc123',
  message: { content: 'Hello from Kernova!' },
});
```

#### `status()`

Returns all registered connectors with their current connection state.

```typescript
const connectors = kernel.channels.status();
// [{ id, name, channelType, state: 'connected' | 'disconnected' | 'connecting' | 'failed' }]
```

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
  messageId: string;
  delivered: boolean;
  timestamp: string;
  error?: string;
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

| Platform | Status | Transport | Required Config |
|----------|--------|-----------|-----------------|
| Webhook | ✅ Production | HTTP POST receiver | `port`, `path` |
| WebSocket | ✅ Production | WS server + keepalive | `port`, `path`, `keepaliveIntervalMs` |
| Slack | ✅ Production | Web API + Events webhook | `botToken`, `signingSecret` |
| Discord | ✅ Production | Gateway WebSocket + REST | `botToken`, `applicationId` |
| Telegram | ✅ Production | Bot API (long-polling or webhook) | `botToken` |
| WhatsApp | ✅ Production | Meta Cloud API + webhook | `accessToken`, `phoneNumberId`, `verifyToken` |
| Email | ✅ Production | SMTP (send) + IMAP polling (receive) | `smtpHost`, `imapHost`, `username`, `password` |
| Microsoft Teams | ✅ Production | Bot Framework webhook | `appId`, `appPassword` |
| SMS (Twilio) | ✅ Production | Twilio REST API + webhook | `accountSid`, `authToken`, `fromNumber` |
| Signal | ✅ Production | signal-cli binary + polling | `signalCliPath`, `phoneNumber` |
| Matrix | ✅ Production | Client-Server API + /sync | `homeserverUrl`, `accessToken`, `userId` |
| IRC | ✅ Production | TCP/TLS socket + PRIVMSG | `server`, `port`, `nick`, `channels` |
| Voice (Twilio) | ✅ Production | REST API + TwiML webhook | `accountSid`, `authToken`, `fromNumber` |
| Push (FCM/APNs) | ✅ Production | HTTP push (send-only) | `provider`, `fcmServerKey` or APNs creds |
| RSS/Atom | ✅ Production | Feed polling (receive-only) | `feeds` array |

---

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
  webhookUrl: 'https://your-domain.com:443/telegram',
});
```

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
  webhookPort: 3400,  // Optional (default: 3400)
});
```

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
});

app.channel('teams', teams);
```

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
});

app.channel('sms', sms);
```

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
});

app.channel('voice', voice);
```

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

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    // Deliver the message to your platform
    const messageId = `msg_${Date.now()}`;

    try {
      // ... your delivery logic here
      return { messageId, delivered: true, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        messageId,
        delivered: false,
        timestamp: new Date().toISOString(),
        error: String(error),
      };
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
kernel.events.on('channel.message.received', (data) => {
  console.log(`New message from ${data.sender} via ${data.channelType}`);
});

kernel.events.on('channel.connection.failed', (data) => {
  console.error(`Channel "${data.name}" failed: ${data.reason}`);
  // Alert your monitoring system
});
```

## Best Practices

### Choosing the Right Adapter

- **Webhook** — Best for server-to-server integrations: CI/CD notifications, API callbacks, third-party service events. Stateless and simple.
- **WebSocket** — Best for real-time user interfaces: chat applications, live dashboards, collaborative tools. Persistent and low-latency.

### Security

- **Validate sender identity** in production. Raw webhook payloads can be spoofed — verify signatures, tokens, or IP allowlists.
- **Use HTTPS (TLS)** in front of webhook adapters. Deploy behind a reverse proxy (nginx, Caddy) or load balancer that terminates TLS.
- **Authenticate WebSocket connections** via a token in the initial handshake or first message. Don't assume all connected clients are trusted.

### Reliability

- **Monitor `channel.connection.failed` events** to detect connectivity issues early. Wire these to your alerting system.
- **Set appropriate keepalive intervals** for WebSocket. Too aggressive (< 10s) wastes bandwidth; too relaxed (> 60s) delays stale connection detection.
- **Handle delivery failures** gracefully. Check the `DeliveryReceipt` from `send()` and implement retry logic for critical messages.

### Scaling

- Each webhook adapter binds to its own port. In production, use a single reverse proxy that routes paths to the appropriate adapter.
- WebSocket adapters track all connected clients in memory. For horizontal scaling, use a shared pub/sub layer (Redis, NATS) to broadcast messages across instances.
- Use the `raw` field on `InboundMessage` to preserve platform-specific metadata that might be needed for advanced routing or auditing.
