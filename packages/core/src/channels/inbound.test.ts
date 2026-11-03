import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  BotFrameworkTokenVerifier,
  ReplyTargets,
  verifyHmacSha256,
  verifyTwilioSignature,
} from './inbound.js';

describe('verifyHmacSha256', () => {
  const body = '{"content":"hi"}';
  const digest = createHmac('sha256', 's3cret').update(body).digest('hex');

  it('accepts "sha256=<hex>" and bare hex signatures', () => {
    expect(verifyHmacSha256('s3cret', body, `sha256=${digest}`)).toBe(true);
    expect(verifyHmacSha256('s3cret', body, digest)).toBe(true);
  });

  it('rejects a wrong, missing, or differently-keyed signature', () => {
    expect(verifyHmacSha256('s3cret', body, undefined)).toBe(false);
    expect(verifyHmacSha256('s3cret', body, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(verifyHmacSha256('other', body, digest)).toBe(false);
    expect(verifyHmacSha256('s3cret', body + ' ', digest)).toBe(false);
  });
});

describe('verifyTwilioSignature', () => {
  // Twilio's published test vector (twilio-node webhook tests)
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = new URLSearchParams({
    CallSid: 'CA1234567890ABCDE',
    Caller: '+14158675309',
    Digits: '1234',
    From: '+14158675309',
    To: '+18005551212',
  });

  it('matches Twilio\'s reference signature', () => {
    expect(verifyTwilioSignature('12345', url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(true);
  });

  it('rejects tampered parameters, another URL, or another token', () => {
    const tampered = new URLSearchParams(params);
    tampered.set('To', '+19005550000');
    expect(verifyTwilioSignature('12345', url, tampered, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(false);
    expect(verifyTwilioSignature('12345', 'https://evil.example/myapp.php?foo=1&bar=2', params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(false);
    expect(verifyTwilioSignature('54321', url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(false);
    expect(verifyTwilioSignature('12345', url, params, undefined)).toBe(false);
  });
});

describe('ReplyTargets', () => {
  it('uses the recipient, then the fallback, then the only conversation', () => {
    const targets = new ReplyTargets();
    expect(targets.resolve()).toEqual({ error: expect.stringMatching(/no message has been received/) });
    expect(targets.resolve(undefined, '#general')).toEqual({ target: '#general' });

    targets.remember('chat-1');
    expect(targets.resolve()).toEqual({ target: 'chat-1' });

    targets.remember('chat-2');
    expect(targets.resolve()).toEqual({ error: expect.stringMatching(/Several conversations/) });
    expect(targets.resolve('chat-1')).toEqual({ target: 'chat-1' });
  });
});

describe('BotFrameworkTokenVerifier', () => {
  const appId = 'app-123';
  const serviceUrl = 'https://smba.trafficmanager.net/teams/';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', endorsements: ['msteams'] };

  const fetches: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    fetches.push(String(url));
    const body = String(url).endsWith('openidconfiguration')
      ? { jwks_uri: 'https://login.example/keys' }
      : { keys: [jwk] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const token = (claims: Record<string, unknown>, key: KeyObject = privateKey, kid = 'key-1') => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = encode({ alg: 'RS256', kid, typ: 'JWT' });
    const payload = encode(claims);
    const signature = sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), key).toString('base64url');
    return `Bearer ${head}.${payload}.${signature}`;
  };
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const valid = () => ({ iss: 'https://api.botframework.com', aud: appId, exp: nowSeconds() + 600, nbf: nowSeconds() - 60, serviceurl: serviceUrl });
  const activity = { serviceUrl, channelId: 'msteams' };

  it('accepts a token signed by a Bot Framework key for this bot', async () => {
    const verifier = new BotFrameworkTokenVerifier({ appId, fetch: fakeFetch });
    expect(await verifier.verify(token(valid()), activity)).toBe(true);
  });

  it('rejects tokens for another bot, expired, from another issuer, or for another service URL', async () => {
    const verifier = new BotFrameworkTokenVerifier({ appId, fetch: fakeFetch });
    expect(await verifier.verify(token({ ...valid(), aud: 'someone-else' }), activity)).toBe(false);
    expect(await verifier.verify(token({ ...valid(), exp: nowSeconds() - 3600 }), activity)).toBe(false);
    expect(await verifier.verify(token({ ...valid(), iss: 'https://evil.example' }), activity)).toBe(false);
    expect(await verifier.verify(token(valid()), { serviceUrl: 'https://evil.example/', channelId: 'msteams' })).toBe(false);
  });

  it('rejects forged signatures, missing tokens, and keys not endorsed for the channel', async () => {
    const verifier = new BotFrameworkTokenVerifier({ appId, fetch: fakeFetch });
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await verifier.verify(token(valid(), attacker), activity)).toBe(false);
    expect(await verifier.verify(undefined, activity)).toBe(false);
    expect(await verifier.verify('Bearer not-a-jwt', activity)).toBe(false);
    expect(await verifier.verify(token(valid()), { serviceUrl, channelId: 'slack' })).toBe(false);
  });

  it("doesn't refetch keys for every unknown key ID", async () => {
    fetches.length = 0;
    const verifier = new BotFrameworkTokenVerifier({ appId, fetch: fakeFetch });
    await verifier.verify(token(valid()), activity);
    const afterFirst = fetches.length;
    for (let i = 0; i < 5; i++) await verifier.verify(token(valid(), privateKey, `unknown-${i}`), activity);
    expect(fetches.length).toBe(afterFirst);
  });
});
