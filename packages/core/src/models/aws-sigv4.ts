/**
 * AWS Signature Version 4 request signing (node:crypto, no AWS SDK).
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When temporary credentials expire */
  expiration?: Date;
}

export interface SignRequestInput {
  method: string;
  url: string;
  /** Headers to send (all of them are signed) */
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  region: string;
  service: string;
  credentials: AwsCredentials;
  /** Signing time (default: now) */
  date?: Date;
}

/**
 * Returns the headers to send: the input headers plus `x-amz-date`, `x-amz-security-token`
 * (for temporary credentials), and `authorization`. `host` is signed but not returned,
 * because fetch sets it from the URL.
 */
export function signRequest(input: SignRequestInput): Record<string, string> {
  const url = new URL(input.url);
  const date = input.date ?? new Date();
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value;
  headers['x-amz-date'] = amzDate;
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken;

  const signed: Record<string, string> = { ...headers, host: url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map(n => `${n}:${signed[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body ?? ''),
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  let key: Buffer = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  key = hmac(key, input.region);
  key = hmac(key, input.service);
  key = hmac(key, 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** RFC 3986 percent-encoding, as SigV4 requires */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The canonical path. Outside S3, each segment of the (already encoded) path is encoded
 * again, so a model ID's `:` (sent as %3A) is signed as %253A.
 */
function canonicalUri(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.split('/').map(awsUriEncode).join('/');
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
