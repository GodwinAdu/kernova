/**
 * Helpers for channel adapters that receive HTTP requests from a platform:
 * bounded body reading and verification that a request really came from the platform.
 */

import { createHmac, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Largest inbound request body accepted (1 MB) */
export const MAX_INBOUND_BODY_BYTES = 1_048_576;

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

/** Read a request body, refusing more than `maxBytes` */
export function readBody(req: IncomingMessage, maxBytes = MAX_INBOUND_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Constant-time string comparison */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The value of a single-valued request header */
export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether `signature` is the hex HMAC-SHA256 of `body` with `secret`.
 * Accepts "sha256=<hex>" (GitHub, Meta) or a bare hex digest.
 */
export function verifyHmacSha256(secret: string, body: Buffer | string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const given = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  return safeEqual(given.toLowerCase(), expected);
}

/**
 * The public URL a request was sent to: `configuredUrl` when given (the URL entered in the
 * platform's console), else rebuilt from X-Forwarded-Proto / X-Forwarded-Host / Host.
 */
export function requestUrl(req: IncomingMessage, configuredUrl?: string): string {
  if (configuredUrl) {
    // Keep the query string the platform added
    const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
    return configuredUrl.includes('?') ? configuredUrl : configuredUrl + query;
  }
  const proto = header(req, 'x-forwarded-proto')?.split(',')[0].trim() || 'http';
  const host = header(req, 'x-forwarded-host')?.split(',')[0].trim() || header(req, 'host') || 'localhost';
  return `${proto}://${host}${req.url ?? '/'}`;
}

/**
 * Twilio request validation: X-Twilio-Signature is the base64 HMAC-SHA1, keyed with the
 * auth token, of the full URL followed by each POST parameter's name and value, sorted by name.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const names = [...new Set(params.keys())].sort();
  let data = url;
  for (const name of names) {
    for (const value of params.getAll(name)) data += name + value;
  }
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  return safeEqual(signature, expected);
}

// ─── Microsoft Bot Framework ─────────────────────────────────────────────────

const BOT_FRAMEWORK_OPENID = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';
const KEY_CACHE_MS = 24 * 60 * 60 * 1000;
/** Unknown key IDs trigger a refresh at most this often, so forged tokens can't make us hammer the key endpoint */
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 300;

interface SigningKey extends JsonWebKey {
  kid?: string;
  endorsements?: string[];
}

export interface BotFrameworkVerifierOptions {
  /** The bot's Microsoft App ID: tokens must be issued for it */
  appId: string;
  /** OpenID metadata URL (default: the public Bot Framework cloud) */
  openIdMetadataUrl?: string;
  /** Expected token issuer (default: https://api.botframework.com) */
  issuer?: string;
  /** For tests */
  fetch?: typeof fetch;
}

/**
 * Validates the bearer token Bot Framework sends with each activity: an RS256 JWT signed by a
 * key from Bot Framework's published key set, issued by Bot Framework, for this bot's app ID,
 * not expired, and (when the activity has one) for the activity's service URL.
 */
export class BotFrameworkTokenVerifier {
  private keys: SigningKey[] = [];
  private keysFetchedAt = 0;
  private lastRefreshAttempt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BotFrameworkVerifierOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async verify(authorization: string | undefined, activity: { serviceUrl?: string; channelId?: string }): Promise<boolean> {
    if (!authorization?.startsWith('Bearer ')) return false;
    const parts = authorization.slice(7).split('.');
    if (parts.length !== 3) return false;

    let headerJson: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      headerJson = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    if (headerJson.alg !== 'RS256' || !headerJson.kid) return false;

    const key = await this.findKey(headerJson.kid);
    if (!key) return false;
    // A key endorsed for specific channels only signs tokens for those channels
    if (activity.channelId && key.endorsements?.length && !key.endorsements.includes(activity.channelId)) return false;

    const signedPart = Buffer.from(`${parts[0]}.${parts[1]}`);
    let valid: boolean;
    try {
      const { kid: _kid, endorsements: _endorsements, ...jwk } = key;
      valid = verify('RSA-SHA256', signedPart, createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch {
      return false;
    }
    if (!valid) return false;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== (this.options.issuer ?? BOT_FRAMEWORK_ISSUER)) return false;
    if (!audiences.includes(this.options.appId)) return false;
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return false;
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return false;
    // The token names the service URL it was issued for; replies may only go there
    const serviceUrl = claims.serviceurl ?? claims.serviceUrl;
    if (activity.serviceUrl && typeof serviceUrl === 'string' && serviceUrl !== activity.serviceUrl) return false;
    return true;
  }

  private async findKey(kid: string): Promise<SigningKey | undefined> {
    const stale = Date.now() - this.keysFetchedAt >= KEY_CACHE_MS;
    let key = stale ? undefined : this.keys.find(k => k.kid === kid);
    if (!key && (stale || Date.now() - this.lastRefreshAttempt >= MIN_REFRESH_INTERVAL_MS)) {
      await this.refreshKeys();
      key = this.keys.find(k => k.kid === kid);
    }
    return key;
  }

  private async refreshKeys(): Promise<void> {
    this.lastRefreshAttempt = Date.now();
    try {
      const metadata = await (await this.fetchImpl(this.options.openIdMetadataUrl ?? BOT_FRAMEWORK_OPENID)).json() as { jwks_uri?: string };
      if (!metadata.jwks_uri) return;
      const jwks = await (await this.fetchImpl(metadata.jwks_uri)).json() as { keys?: SigningKey[] };
      if (jwks.keys?.length) {
        this.keys = jwks.keys;
        this.keysFetchedAt = Date.now();
      }
    } catch {
      // Keep the keys we have; tokens signed by unknown keys are refused
    }
  }
}

// ─── Reply targets ───────────────────────────────────────────────────────────

/** How many recent conversations an adapter remembers */
const MAX_REMEMBERED_TARGETS = 1000;

/**
 * The conversations an adapter has received messages from (a chat, channel, or number),
 * with optional per-conversation data (e.g. a Teams service URL). A reply without an explicit
 * recipient may only go to a configured default or to the one conversation there is, never to
 * "whoever wrote last" while several people are talking to the bot.
 */
export class ReplyTargets<T = true> {
  private readonly targets = new Map<string, T>();

  remember(target: string, data: T = true as T): void {
    this.targets.delete(target);
    this.targets.set(target, data);
    if (this.targets.size > MAX_REMEMBERED_TARGETS) {
      this.targets.delete(this.targets.keys().next().value!);
    }
  }

  get(target: string): T | undefined {
    return this.targets.get(target);
  }

  /** The target to send to, or why there isn't one */
  resolve(recipient?: string, fallback?: string): { target: string } | { error: string } {
    if (recipient) return { target: recipient };
    if (fallback) return { target: fallback };
    if (this.targets.size === 1) return { target: this.targets.keys().next().value! };
    return {
      error: this.targets.size === 0
        ? 'No recipient: no message has been received yet'
        : "Several conversations are active: pass the recipient (the inbound message's replyTo)",
    };
  }
}
