/**
 * Built-in Tool: http-fetch
 *
 * Makes HTTP requests to external URLs with configurable method, headers, body, and timeout.
 * Uses the Node.js native fetch API.
 *
 * Returns response body (as text), status code, and response headers.
 * Handles errors (network failures, timeouts) gracefully — returns error message as tool result.
 *
 * URLs come from the model, so by default the tool refuses to reach private, loopback,
 * link-local (including cloud metadata at 169.254.169.254), and other internal addresses.
 * Every redirect hop is checked the same way. Response bodies are capped in size.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { ToolDefinition } from '../plugins/plugin-registry.js';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

export interface HttpFetchOptions {
  /** Allow requests to private, loopback, and link-local addresses (default: false) */
  allowPrivateNetwork?: boolean;
  /** Maximum response body size in bytes; longer bodies are truncated (default: 1,000,000) */
  maxResponseBytes?: number;
  /** Default and maximum timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** DNS resolver, for tests */
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

// Separate lists: a BlockList also matches IPv4 addresses against IPv6 rules
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** True for loopback, private, link-local, multicast, and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) is judged by its IPv4 address
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (dotted) return blockedV4.check(dotted[1], 'ipv4');
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return blockedV4.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, 'ipv4');
    }
    return blockedV6.check(address, 'ipv6');
  }
  return true;
}

const defaultLookup = (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true });

export function createHttpFetchTool(options: HttpFetchOptions = {}): ToolDefinition {
  const maxTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const lookup = options.lookup ?? defaultLookup;

  /** Throws if the URL is not http(s) or resolves to an internal address. */
  async function checkUrl(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported protocol "${url.protocol}". Only http and https are allowed.`);
    }
    if (options.allowPrivateNetwork) return;

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname);
    const blocked = addresses.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      throw new Error(
        `Blocked: ${url.hostname} resolves to a private or internal address (${blocked.address}). ` +
        'Set builtInTools.httpFetch.allowPrivateNetwork to allow it.',
      );
    }
  }

  return {
    id: 'http-fetch',
    name: 'HTTP Fetch',
    description: 'Make HTTP requests to external URLs and return the response body, status code, and headers.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET',
          description: 'HTTP method to use',
        },
        headers: {
          type: 'object',
          description: 'HTTP headers to include in the request',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body (for POST, PUT, PATCH)',
        },
        timeout: {
          type: 'number',
          description: `Timeout in milliseconds (at most ${maxTimeout})`,
          default: maxTimeout,
        },
      },
      required: ['url'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const url = params.url as string;
      let method = (params.method as string) || 'GET';
      const headers = (params.headers as Record<string, string>) || {};
      let body = params.body as string | undefined;
      const requested = Number(params.timeout);
      const timeout = requested > 0 ? Math.min(requested, maxTimeout) : maxTimeout;

      // Create an AbortController for timeout handling (covers DNS checks and redirects too)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const timedOut = { error: true, message: `Request timed out after ${timeout}ms` };

      try {
        let target = url;
        let response: Response | undefined;

        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          await checkUrl(new URL(target));
          if (controller.signal.aborted) return timedOut;

          response = await fetch(target, {
            method,
            headers,
            body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
            signal: controller.signal,
            redirect: 'manual',
          });

          const location = response.headers.get('location');
          if (response.status < 300 || response.status >= 400 || !location) break;
          if (hop === MAX_REDIRECTS) {
            return { error: true, message: `Too many redirects (more than ${MAX_REDIRECTS})` };
          }

          // Follow the redirect ourselves so every hop is checked
          target = new URL(location, target).href;
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET';
            body = undefined;
          }
        }

        const { text, truncated } = await readBody(response!, maxBytes);

        // Collect response headers
        const responseHeaders: Record<string, string> = {};
        response!.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: response!.status,
          statusText: response!.statusText,
          headers: responseHeaders,
          body: text,
          ...(truncated && { truncated: true }),
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return timedOut;
        }

        return {
          error: true,
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

/** Reads the response body as text, stopping at maxBytes. */
async function readBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const stream = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!stream) {
    const text = await response.text();
    return text.length > maxBytes ? { text: text.slice(0, maxBytes), truncated: true } : { text, truncated: false };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - received));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }

  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}
