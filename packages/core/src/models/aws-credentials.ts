/**
 * AWS credentials without the AWS SDK. Looks in the same places the AWS CLI and SDKs do,
 * first match wins:
 *   1. Keys or a credentials function you pass in
 *   2. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN (skipped when a profile is passed in)
 *   3. The shared files' profile (AWS_PROFILE, default `default`): static keys or `credential_process`
 *      in ~/.aws/credentials and ~/.aws/config
 *   4. Web identity (EKS IRSA): AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN
 *   5. Container credentials (ECS, EKS Pod Identity): AWS_CONTAINER_CREDENTIALS_RELATIVE_URI / _FULL_URI
 *   6. EC2 instance metadata (IMDSv2), when `instanceMetadata: true`
 *
 * For SSO and assume-role profiles, add
 *   credential_process = aws configure export-credentials --profile NAME --format process
 * to the profile.
 */

import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AwsCredentials } from './aws-sigv4.js';
import { apiError, cached, type CachedSource } from './http.js';

export interface AwsCredentialsConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;

  /** Your own credentials, or a function that returns them (for example from @aws-sdk/credential-providers) */
  credentials?: AwsCredentials | (() => AwsCredentials | Promise<AwsCredentials>);

  /** Profile in the shared config files (default: AWS_PROFILE, then `default`) */
  profile?: string;

  /** Get credentials from the EC2 instance metadata service when nothing else is found (default: false) */
  instanceMetadata?: boolean;

  /** Timeout for credential requests in ms (default: 5000) */
  timeoutMs?: number;
}

type Section = Record<string, string>;

/** Parses an INI file (the AWS shared credentials and config format) */
export function parseIni(text: string): Record<string, Section> {
  const sections: Record<string, Section> = {};
  let current: Section | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = sections[header[1].trim()] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (current && eq > 0) current[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function readIni(path: string): Record<string, Section> {
  try {
    return existsSync(path) ? parseIni(readFileSync(path, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** The settings for a profile, merged from ~/.aws/config and ~/.aws/credentials (credentials win) */
export function loadProfile(profile: string): Section {
  const configFile = process.env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config');
  const credentialsFile = process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials');
  const config = readIni(configFile);
  const credentials = readIni(credentialsFile);
  return {
    ...(config[profile === 'default' ? 'default' : `profile ${profile}`] ?? config[profile] ?? {}),
    ...(credentials[profile] ?? {}),
  };
}

/** The region: passed in, AWS_REGION, AWS_DEFAULT_REGION, then the profile's region */
export function resolveAwsRegion(region: string | undefined, profile?: string): string | undefined {
  return region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
    || loadProfile(profile || process.env.AWS_PROFILE || 'default').region || undefined;
}

export class AwsCredentialChain {
  /** Where the credentials come from, for error messages */
  readonly source: string | undefined;
  private readonly provider: CachedSource<AwsCredentials> | undefined;
  private readonly problem: string | undefined;

  constructor(config: AwsCredentialsConfig = {}, region?: string) {
    const timeoutMs = config.timeoutMs ?? 5000;
    const found = findCredentials(config, region, timeoutMs);
    this.source = found?.source;
    this.provider = found?.provider;
    this.problem = found?.problem;
  }

  hasCredentials(): boolean {
    return this.provider !== undefined;
  }

  describeProblem(): string {
    return this.problem ?? 'No AWS credentials found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, '
      + 'configure a profile (aws configure), or set AWS_BEARER_TOKEN_BEDROCK.';
  }

  async get(): Promise<AwsCredentials> {
    if (!this.provider) throw new Error(this.describeProblem());
    return this.provider.get();
  }
}

/** Never-expiring credentials */
function fixed(credentials: AwsCredentials): CachedSource<AwsCredentials> {
  return { get: async () => credentials };
}

function expiryOf(credentials: AwsCredentials): number {
  return credentials.expiration ? credentials.expiration.getTime() : Infinity;
}

function findCredentials(
  config: AwsCredentialsConfig,
  region: string | undefined,
  timeoutMs: number,
): { source: string; provider?: CachedSource<AwsCredentials>; problem?: string } | undefined {
  if (config.credentials) {
    const given = config.credentials;
    return {
      source: 'credentials',
      provider: typeof given === 'function'
        ? cached(async () => { const c = await given(); return { value: c, expiresAt: expiryOf(c) }; })
        : fixed(given),
    };
  }
  if (config.accessKeyId && config.secretAccessKey) {
    return {
      source: 'accessKeyId',
      provider: fixed({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken }),
    };
  }

  const env = process.env;
  if (!config.profile && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return {
      source: 'environment',
      provider: fixed({
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        ...(env.AWS_SESSION_TOKEN && { sessionToken: env.AWS_SESSION_TOKEN }),
      }),
    };
  }

  const profileName = config.profile || env.AWS_PROFILE || 'default';
  const profile = loadProfile(profileName);
  if (profile.aws_access_key_id && profile.aws_secret_access_key) {
    return {
      source: `profile ${profileName}`,
      provider: fixed({
        accessKeyId: profile.aws_access_key_id,
        secretAccessKey: profile.aws_secret_access_key,
        ...(profile.aws_session_token && { sessionToken: profile.aws_session_token }),
      }),
    };
  }
  if (profile.credential_process) {
    const command = profile.credential_process;
    return {
      source: `profile ${profileName} (credential_process)`,
      provider: cached(async () => {
        const c = await processCredentials(command, Math.max(timeoutMs, 30_000));
        return { value: c, expiresAt: expiryOf(c) };
      }),
    };
  }
  const explicitProfile = Boolean(config.profile || env.AWS_PROFILE);
  if (explicitProfile && (profile.sso_session || profile.sso_start_url || profile.role_arn)) {
    return {
      source: `profile ${profileName}`,
      problem: `AWS profile "${profileName}" uses SSO or assume-role, which Kernova can't sign in with directly. `
        + `Add "credential_process = aws configure export-credentials --profile ${profileName} --format process" to it.`,
    };
  }

  if (env.AWS_WEB_IDENTITY_TOKEN_FILE && env.AWS_ROLE_ARN) {
    const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE;
    const roleArn = env.AWS_ROLE_ARN;
    const sessionName = env.AWS_ROLE_SESSION_NAME || `kernova-${Date.now()}`;
    return {
      source: 'web identity',
      provider: cached(async () => {
        const c = await webIdentityCredentials(tokenFile, roleArn, sessionName, region, timeoutMs);
        return { value: c, expiresAt: expiryOf(c) };
      }),
    };
  }

  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return {
      source: 'container',
      provider: cached(async () => {
        const c = await containerCredentials(timeoutMs);
        return { value: c, expiresAt: expiryOf(c) };
      }),
    };
  }

  if (config.instanceMetadata && env.AWS_EC2_METADATA_DISABLED !== 'true') {
    return {
      source: 'instance metadata',
      provider: cached(async () => {
        const c = await instanceMetadataCredentials(timeoutMs);
        return { value: c, expiresAt: expiryOf(c) };
      }),
    };
  }

  return undefined;
}

/** Credentials in the JSON shape the AWS credential endpoints and credential_process return */
interface AwsCredentialJson {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken?: string;
  Token?: string;
  Expiration?: string;
}

function fromJson(json: AwsCredentialJson, label: string): AwsCredentials {
  if (!json.AccessKeyId || !json.SecretAccessKey) throw new Error(`${label} returned no credentials`);
  const sessionToken = json.SessionToken ?? json.Token;
  return {
    accessKeyId: json.AccessKeyId,
    secretAccessKey: json.SecretAccessKey,
    ...(sessionToken && { sessionToken }),
    ...(json.Expiration && { expiration: new Date(json.Expiration) }),
  };
}

function processCredentials(command: string, timeoutMs: number): Promise<AwsCredentials> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`credential_process failed: ${stderr.trim() || error.message}`));
      try {
        resolve(fromJson(JSON.parse(stdout) as AwsCredentialJson, 'credential_process'));
      } catch (parseError) {
        reject(new Error(`credential_process output isn't valid: ${(parseError as Error).message}`));
      }
    });
  });
}

async function webIdentityCredentials(
  tokenFile: string,
  roleArn: string,
  sessionName: string,
  region: string | undefined,
  timeoutMs: number,
): Promise<AwsCredentials> {
  const host = region ? `sts.${region}.amazonaws.com` : 'sts.amazonaws.com';
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      Action: 'AssumeRoleWithWebIdentity',
      Version: '2011-06-15',
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      WebIdentityToken: readFileSync(tokenFile, 'utf8').trim(),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`AWS STS AssumeRoleWithWebIdentity error (${response.status}): ${/<Message>([^<]*)<\/Message>/.exec(xml)?.[1] ?? xml}`);
  }
  const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
  return fromJson({
    AccessKeyId: tag('AccessKeyId') ?? '',
    SecretAccessKey: tag('SecretAccessKey') ?? '',
    SessionToken: tag('SessionToken'),
    Expiration: tag('Expiration'),
  }, 'AWS STS');
}

async function containerCredentials(timeoutMs: number): Promise<AwsCredentials> {
  const env = process.env;
  const url = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
    ? `http://169.254.170.2${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}`
    : env.AWS_CONTAINER_CREDENTIALS_FULL_URI!;
  const token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE
    ? readFileSync(env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE, 'utf8').trim()
    : env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  const response = await fetch(url, {
    headers: token ? { Authorization: token } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw await apiError('AWS container credentials error', response);
  return fromJson(await response.json() as AwsCredentialJson, 'The container credentials endpoint');
}

async function instanceMetadataCredentials(timeoutMs: number): Promise<AwsCredentials> {
  const base = (process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT || 'http://169.254.169.254').replace(/\/+$/, '');
  const signal = () => AbortSignal.timeout(timeoutMs);
  const tokenResponse = await fetch(`${base}/latest/api/token`, {
    method: 'PUT',
    headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
    signal: signal(),
  });
  if (!tokenResponse.ok) throw await apiError('EC2 instance metadata token error', tokenResponse);
  const headers = { 'X-aws-ec2-metadata-token': await tokenResponse.text() };

  const roleResponse = await fetch(`${base}/latest/meta-data/iam/security-credentials/`, { headers, signal: signal() });
  if (!roleResponse.ok) throw await apiError('EC2 instance metadata role error (does the instance have an IAM role?)', roleResponse);
  const role = (await roleResponse.text()).split('\n')[0].trim();

  const response = await fetch(`${base}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`, { headers, signal: signal() });
  if (!response.ok) throw await apiError('EC2 instance metadata credentials error', response);
  return fromJson(await response.json() as AwsCredentialJson, 'EC2 instance metadata');
}
