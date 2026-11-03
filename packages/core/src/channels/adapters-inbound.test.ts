/**
 * Inbound request verification and reply routing for the channel adapters, over real HTTP.
 * Platform APIs are replaced by a stubbed fetch; requests to the adapters use node:http.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { WebhookChannelAdapter } from './adapters/webhook-adapter.js';
import { WebSocketChannelAdapter } from './adapters/websocket-adapter.js';
import { SmsAdapter } from './adapters/sms-adapter.js';
import { WhatsAppAdapter } from './adapters/whatsapp-adapter.js';
import { ConnectorRegistry } from './connector-registry.js';
import { EventBus } from '../events/event-bus.js';
import type { InboundMessage } from '@kernova/types';

const port = () => 21000 + Math.floor(Math.random() * 20000);

function post(url: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Length': Buffer.byteLength(body), ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Records platform API calls and answers them */
function stubPlatform(answer: (url: string, body: string) => unknown = () => ({ ok: true })) {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), body: typeof init?.body === 'string' ? init.body : '' };
    calls.push(call);
    // Like a real network call, let timers and I/O run (Telegram's getUpdates long-polls)
    await new Promise((resolve) => setTimeout(resolve, call.url.endsWith('/getUpdates') ? 50 : 1));
    return new Response(JSON.stringify(answer(call.url, call.body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.unstubAllGlobals();
});

describe('WebhookChannelAdapter', () => {
  it('with a secret, accepts only correctly signed requests', async () => {
    const p = port();
    const adapter = new WebhookChannelAdapter({ port: p, path: '/hooks', secret: 'hook-secret' });
    const received: InboundMessage[] = [];
    adapter.onMessage(async (m) => { received.push(m); });
    await adapter.connect();
    cleanups.push(() => adapter.disconnect());

    const body = JSON.stringify({ sender: 'ci', content: 'build failed' });
    const signature = `sha256=${createHmac('sha256', 'hook-secret').update(body).digest('hex')}`;

    expect((await post(`http://127.0.0.1:${p}/hooks`, body)).status).toBe(401);
    expect((await post(`http://127.0.0.1:${p}/hooks`, body, { 'x-kernova-signature': 'sha256=' + '0'.repeat(64) })).status).toBe(401);
    expect((await post(`http://127.0.0.1:${p}/hooks`, body, { 'x-kernova-signature': signature })).status).toBe(200);
    await vi.waitFor(() => expect(received.map(m => m.content)).toEqual(['build failed']));
  });

  it('without a secret, listens on localhost only and refuses oversized bodies', async () => {
    const p = port();
    const adapter = new WebhookChannelAdapter({ port: p });
    await adapter.connect();
    cleanups.push(() => adapter.disconnect());

    const address = ((adapter as unknown as { server: { address(): AddressInfo } }).server).address();
    expect(address.address).toBe('127.0.0.1');
    expect((await post(`http://127.0.0.1:${p}/webhook`, 'x'.repeat(1_100_000)).catch(() => ({ status: 413 }))).status).toBe(413);
  });
});

describe('WebSocketChannelAdapter', () => {
  const open = (url: string, headers: Record<string, string> = {}) => new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once('error', reject);
  });

  it('requires the token, checks browser origins, and replies only to the sender', async () => {
    const p = port();
    const adapter = new WebSocketChannelAdapter({ port: p, token: 'ws-token', allowedOrigins: ['https://app.example'] });
    const received: InboundMessage[] = [];
    adapter.onMessage(async (m) => { received.push(m); });
    await adapter.connect();
    cleanups.push(() => adapter.disconnect());
    const url = `ws://127.0.0.1:${p}/ws`;

    await expect(open(url)).rejects.toThrow('401');
    await expect(open(`${url}?token=ws-token`, { Origin: 'https://evil.example' })).rejects.toThrow('403');

    const alice = await open(`${url}?token=ws-token`, { Origin: 'https://app.example' });
    const bob = await open(url, { Authorization: 'Bearer ws-token' });
    cleanups.push(async () => { alice.close(); bob.close(); });

    const bobInbox: string[] = [];
    bob.on('message', (data) => bobInbox.push(String(data)));
    const aliceReply = new Promise<string>((resolve) => alice.once('message', (data) => resolve(String(data))));

    alice.send(JSON.stringify({ content: 'hello from alice' }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await adapter.send({ content: 'just for alice' }, received[0].replyTo);

    expect(JSON.parse(await aliceReply).content).toBe('just for alice');
    await new Promise((r) => setTimeout(r, 50));
    expect(bobInbox).toEqual([]);
  });
});

describe('SmsAdapter (Twilio)', () => {
  it('accepts only requests with a valid X-Twilio-Signature and replies to the right number', async () => {
    const calls = stubPlatform(() => ({ sid: 'SM123' }));
    const p = port();
    const adapter = new SmsAdapter({ type: 'sms', accountSid: 'AC1', authToken: 'twilio-token', fromNumber: '+15550000000', webhookPort: p });
    const received: Array<{ sender: string; replyTo?: string }> = [];
    adapter.onMessage((m) => { received.push(m); });
    await adapter.connect();
    cleanups.push(() => adapter.disconnect());

    const url = `http://127.0.0.1:${p}/sms`;
    const form = (from: string) => new URLSearchParams({ From: from, Body: 'hi', MessageSid: 'SM1' });
    const signed = (params: URLSearchParams) => {
      const data = url + [...params.keys()].sort().map(k => k + params.get(k)).join('');
      return createHmac('sha1', 'twilio-token').update(data).digest('base64');
    };
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    expect((await post(url, form('+15551111111').toString(), headers)).status).toBe(403);
    for (const from of ['+15551111111', '+15552222222']) {
      const params = form(from);
      expect((await post(url, params.toString(), { ...headers, 'X-Twilio-Signature': signed(params) })).status).toBe(200);
    }
    expect(received.map(m => m.sender)).toEqual(['+15551111111', '+15552222222']);

    // Two people are texting: a reply needs a recipient instead of going to whoever wrote last
    expect((await adapter.send({ content: 'reply' })).success).toBe(false);
    expect((await adapter.send({ content: 'reply' }, received[0].replyTo)).success).toBe(true);
    expect(new URLSearchParams(calls.at(-1)!.body).get('To')).toBe('+15551111111');
  });
});

describe('WhatsAppAdapter', () => {
  it('refuses webhook POSTs without an app secret, and verifies them with one', async () => {
    stubPlatform(() => ({ id: 'phone' }));
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '4915', type: 'text', text: { body: 'hallo' } }] } }] }] });
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;

    const p1 = port();
    const noSecret = new WhatsAppAdapter({ type: 'whatsapp', accessToken: 't', phoneNumberId: '1', verifyToken: 'v', webhookPort: p1 });
    await noSecret.connect();
    cleanups.push(() => noSecret.disconnect());
    expect((await post(`http://127.0.0.1:${p1}/`, body, { 'x-hub-signature-256': signature })).status).toBe(403);

    const p2 = port();
    const adapter = new WhatsAppAdapter({ type: 'whatsapp', accessToken: 't', phoneNumberId: '1', verifyToken: 'v', appSecret: 'app-secret', webhookPort: p2 });
    const received: string[] = [];
    adapter.onMessage((m) => { received.push(m.content); });
    await adapter.connect();
    cleanups.push(() => adapter.disconnect());
    expect((await post(`http://127.0.0.1:${p2}/`, body)).status).toBe(401);
    expect((await post(`http://127.0.0.1:${p2}/`, body, { 'x-hub-signature-256': signature })).status).toBe(200);
    expect(received).toEqual(['hallo']);
  });
});

describe('ConnectorRegistry', () => {
  it('hands inbound messages to onMessage() handlers and reply() answers the same chat', async () => {
    let delivered = false;
    const calls = stubPlatform((url) => {
      if (url.endsWith('/getMe')) return { ok: true, result: { id: 1, username: 'bot' } };
      if (url.endsWith('/getUpdates')) {
        if (delivered) return { ok: true, result: [] };
        delivered = true;
        return { ok: true, result: [{ update_id: 1, message: { message_id: 1, chat: { id: 4242, type: 'private' }, from: { id: 7, username: 'ada' }, date: 1_700_000_000, text: 'ping' } }] };
      }
      return { ok: true, result: { message_id: 99 } };
    });

    const events = new EventBus({ persistent: false });
    const registry = new ConnectorRegistry(events, { dataDir: '.' });
    await registry.start();
    const received: InboundMessage[] = [];
    registry.onMessage(async (m) => {
      received.push(m);
      await registry.reply(m, 'pong');
    });

    const connector = registry.register({ channelType: 'telegram', name: 'tg', config: { type: 'telegram', botToken: 'bot-token' } });
    await registry.connect(connector.id);
    cleanups.push(async () => { await registry.disconnect(connector.id); await registry.stop(); });

    await vi.waitFor(() => expect(calls.some(c => c.url.endsWith('/sendMessage'))).toBe(true));
    expect(received[0]).toMatchObject({ content: 'ping', sender: 'ada', replyTo: '4242' });
    expect(JSON.parse(calls.find(c => c.url.endsWith('/sendMessage'))!.body)).toMatchObject({ chat_id: '4242', text: 'pong' });
  });
});
