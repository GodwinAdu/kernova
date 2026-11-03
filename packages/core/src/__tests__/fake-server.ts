/**
 * A local HTTP server that stands in for a model provider's API in tests.
 * Requests are recorded; `handle` decides each response.
 */

import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  /** Path and query, as sent */
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
  /** The body parsed as JSON, when it is JSON */
  json?: any;
}

export type FakeResponse = {
  status?: number;
  headers?: Record<string, string>;
  /** An object is sent as JSON; a Uint8Array[] is sent as separate writes (for streams) */
  body?: unknown;
};

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function fakeServer(
  handle: (req: RecordedRequest, index: number) => FakeResponse | Promise<FakeResponse>,
): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json: unknown;
      try { json = body ? JSON.parse(body) : undefined; } catch { json = undefined; }
      const recorded: RecordedRequest = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body, json };
      requests.push(recorded);
      try {
        const out = await handle(recorded, requests.length - 1);
        const headers = { ...out.headers };
        if (Array.isArray(out.body) && out.body.every(b => b instanceof Uint8Array)) {
          res.writeHead(out.status ?? 200, headers);
          for (const piece of out.body as Uint8Array[]) {
            res.write(piece);
            await new Promise(r => setTimeout(r, 1));
          }
          res.end();
          return;
        }
        let payload: string | Uint8Array = '';
        if (typeof out.body === 'string' || out.body instanceof Uint8Array) {
          payload = out.body;
        } else if (out.body !== undefined) {
          payload = JSON.stringify(out.body);
          headers['content-type'] ??= 'application/json';
        }
        res.writeHead(out.status ?? 200, headers);
        res.end(payload);
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(error));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

/** Server-sent events body */
export function sseBody(events: unknown[]): string {
  return events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
}
