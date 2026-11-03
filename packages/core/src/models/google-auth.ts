/**
 * Google Cloud authentication for Vertex AI, without the Google SDK.
 *
 * Finds credentials the way Google's client libraries do (Application Default Credentials):
 *   1. `accessToken` / `getAccessToken()` you pass in
 *   2. `credentials` (parsed key file) or `keyFile` you pass in
 *   3. GOOGLE_APPLICATION_CREDENTIALS (path to a service account key or ADC file)
 *   4. The gcloud ADC file (`gcloud auth application-default login`):
 *      ~/.config/gcloud/application_default_credentials.json, or %APPDATA%\gcloud\... on Windows
 *   5. The metadata server, on Google Cloud (Cloud Run, Cloud Functions, App Engine, GKE, Compute Engine)
 *
 * Service account keys are exchanged for tokens with a signed JWT (RS256, node:crypto);
 * gcloud user credentials with their refresh token.
 */

import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apiError, cachedToken, type TokenSource } from './http.js';

/** A Google credentials file: a service account key or gcloud user credentials */
export interface GoogleCredentials {
  type: string;
  project_id?: string;
  quota_project_id?: string;
  client_email?: string;
  private_key?: string;
  private_key_id?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}

export interface GoogleAuthConfig {
  /** A ready access token (you refresh it) */
  accessToken?: string;

  /** Your own token source, for example from google-auth-library */
  getAccessToken?: () => string | Promise<string>;

  /** Parsed contents of a service account key or ADC file */
  credentials?: GoogleCredentials;

  /** Path to a service account key or ADC file (default: GOOGLE_APPLICATION_CREDENTIALS, then the gcloud ADC file) */
  keyFile?: string;

  /** Use the metadata server (default: when running on Google Cloud and no other credentials are found) */
  metadataServer?: boolean;

  /** OAuth scopes (default: cloud-platform) */
  scopes?: string[];

  /** Timeout for token requests in ms (default: 10000) */
  timeoutMs?: number;
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Where gcloud keeps Application Default Credentials */
export function adcFilePath(): string {
  const configDir = process.env.CLOUDSDK_CONFIG
    || (process.platform === 'win32' && process.env.APPDATA
      ? join(process.env.APPDATA, 'gcloud')
      : join(homedir(), '.config', 'gcloud'));
  return join(configDir, 'application_default_credentials.json');
}

/** Whether this process looks like it runs on Google Cloud, where the metadata server is available */
function onGoogleCloud(): boolean {
  return Boolean(
    process.env.K_SERVICE || process.env.CLOUD_RUN_JOB || process.env.FUNCTION_TARGET
    || process.env.GAE_SERVICE || process.env.GAE_APPLICATION
    || process.env.GCE_METADATA_HOST || process.env.GCE_METADATA_IP,
  );
}

function metadataBase(): string {
  const host = process.env.GCE_METADATA_HOST || process.env.GCE_METADATA_IP || 'metadata.google.internal';
  return `http://${host}/computeMetadata/v1`;
}

export class GoogleAuth {
  /** Where the credentials came from, for error messages */
  readonly source: string | undefined;

  private readonly tokens: TokenSource | undefined;
  private readonly credentials: GoogleCredentials | undefined;
  private readonly problem: string | undefined;
  private readonly useMetadata: boolean;
  private readonly timeoutMs: number;
  private metadataProject: Promise<string | undefined> | undefined;

  constructor(config: GoogleAuthConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
    const scopes = config.scopes?.length ? config.scopes : [CLOUD_PLATFORM_SCOPE];

    let credentials: GoogleCredentials | undefined;
    let problem: string | undefined;
    let source: string | undefined;
    let tokens: TokenSource | undefined;
    let useMetadata = false;

    if (config.getAccessToken) {
      const getAccessToken = config.getAccessToken;
      tokens = { get: async () => getAccessToken() };
      source = 'getAccessToken()';
    } else if (config.accessToken) {
      const token = config.accessToken;
      tokens = { get: async () => token };
      source = 'accessToken';
    } else {
      if (config.credentials) {
        credentials = config.credentials;
        source = 'credentials';
      } else {
        const file = config.keyFile ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
          ?? (existsSync(adcFilePath()) ? adcFilePath() : undefined);
        if (file) {
          source = file;
          try {
            credentials = JSON.parse(readFileSync(file, 'utf8')) as GoogleCredentials;
          } catch (error) {
            problem = `Can't read Google credentials from ${file}: ${(error as Error).message}`;
          }
        }
      }

      if (credentials) {
        try {
          tokens = tokenSourceFor(credentials, scopes, this.timeoutMs);
        } catch (error) {
          problem = (error as Error).message;
        }
      } else if (!problem && (config.metadataServer ?? onGoogleCloud())) {
        useMetadata = true;
        source = 'metadata server';
        tokens = cachedToken(() => this.metadataToken(scopes));
      }
    }

    this.credentials = credentials;
    this.problem = problem;
    this.source = source;
    this.tokens = tokens;
    this.useMetadata = useMetadata;
  }

  /** Whether credentials were found (nothing is contacted to check them) */
  hasCredentials(): boolean {
    return this.tokens !== undefined;
  }

  /** Why no credentials are usable, when they aren't */
  describeProblem(): string {
    return this.problem
      ?? 'No Google Cloud credentials found. Run `gcloud auth application-default login`, '
        + 'set GOOGLE_APPLICATION_CREDENTIALS to a service account key file, or pass credentials.';
  }

  /** The project the credentials belong to, when the file says */
  projectId(): string | undefined {
    return this.credentials?.project_id ?? this.credentials?.quota_project_id;
  }

  /** The project billed for requests made with user credentials (sent as x-goog-user-project) */
  quotaProject(): string | undefined {
    return this.credentials?.type === 'authorized_user' ? this.credentials.quota_project_id : undefined;
  }

  /** The project from the metadata server, when running on Google Cloud */
  async metadataProjectId(): Promise<string | undefined> {
    if (!this.useMetadata) return undefined;
    this.metadataProject ??= fetch(`${metadataBase()}/project/project-id`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).then(async r => (r.ok ? (await r.text()).trim() || undefined : undefined)).catch(() => undefined);
    return this.metadataProject;
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error(this.describeProblem());
    return this.tokens.get();
  }

  private async metadataToken(scopes: string[]): Promise<{ token: string; expiresAt: number }> {
    const query = scopes.length === 1 && scopes[0] === CLOUD_PLATFORM_SCOPE ? '' : `?scopes=${encodeURIComponent(scopes.join(','))}`;
    const response = await fetch(`${metadataBase()}/instance/service-accounts/default/token${query}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw await apiError('Google metadata server token error', response);
    const data = await response.json() as { access_token: string; expires_in: number };
    return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }
}

function tokenSourceFor(credentials: GoogleCredentials, scopes: string[], timeoutMs: number): TokenSource {
  if (credentials.type === 'service_account') {
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('The service account key is missing client_email or private_key');
    }
    return cachedToken(() => serviceAccountToken(credentials, scopes, timeoutMs));
  }
  if (credentials.type === 'authorized_user') {
    if (!credentials.client_id || !credentials.client_secret || !credentials.refresh_token) {
      throw new Error('The user credentials are missing client_id, client_secret, or refresh_token');
    }
    return cachedToken(() => refreshUserToken(credentials, timeoutMs));
  }
  throw new Error(
    `Google credentials of type "${credentials.type}" aren't supported. Use a service account key, `
    + '`gcloud auth application-default login`, or pass getAccessToken.',
  );
}

/** Signs a JWT for the service account and exchanges it for an access token */
export async function serviceAccountToken(
  credentials: GoogleCredentials,
  scopes: string[],
  timeoutMs = 10_000,
): Promise<{ token: string; expiresAt: number }> {
  const tokenUri = credentials.token_uri || DEFAULT_TOKEN_URI;
  const assertion = signJwt(credentials, scopes, tokenUri);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw await apiError('Google service account token error', response);
  const data = await response.json() as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

/** A signed RS256 JWT asserting the service account's identity, valid for an hour */
export function signJwt(credentials: GoogleCredentials, scopes: string[], audience: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(credentials.private_key_id && { kid: credentials.private_key_id }) };
  const claims = { iss: credentials.client_email, scope: scopes.join(' '), aud: audience, iat, exp: iat + 3600 };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key!, 'base64url');
  return `${unsigned}.${signature}`;
}

async function refreshUserToken(credentials: GoogleCredentials, timeoutMs: number): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(credentials.token_uri || DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.client_id!,
      client_secret: credentials.client_secret!,
      refresh_token: credentials.refresh_token!,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw await apiError('Google user credentials token error', response);
  const data = await response.json() as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}
