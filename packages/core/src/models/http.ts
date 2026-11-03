/**
 * HTTP helpers shared by the model providers.
 */

import type { CompletionRequest, ContentPart, ModelMessage, ReasoningEffort, ResponseFormat } from "@kernova/types";

/** Statuses worth retrying: timeouts, rate limits, and transient server errors (529 = Anthropic overloaded) */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Longest server-requested wait we honour before giving up instead */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * fetch() with retries on rate limits, transient server errors, and network failures.
 * Uses Retry-After when the server sends it, otherwise exponential backoff with jitter.
 * Aborting `init.signal` stops both the request and any wait between attempts.
 * After the last attempt the final response is returned as-is for the caller to report.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt >= maxRetries || init.signal?.aborted || isAbortError(error))
        throw error;
      await sleep(backoffMs(attempt), init.signal);
      continue;
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries)
      return response;

    const delay = retryAfterMs(response) ?? backoffMs(attempt);
    if (delay > MAX_RETRY_AFTER_MS) return response;
    await response.body?.cancel().catch(() => {});
    await sleep(delay, init.signal);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

function retryAfterMs(response: Response): number | undefined {
  const ms = Number(response.headers.get("retry-after-ms"));
  if (ms > 0) return ms;
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Reads a server-sent events stream and yields each event's `data` payload.
 * Multi-line data fields are joined with newlines, per the SSE spec.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          if (data.length > 0) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
        }
      }
    }
    if (buffer.startsWith("data:"))
      data.push(buffer.slice(buffer.startsWith("data: ") ? 6 : 5));
    if (data.length > 0) yield data.join("\n");
  } finally {
    // The consumer may stop early; release the connection
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Splits a data: URI into its MIME type and base64 payload. */
export function parseDataUri(
  url: string,
): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

/** All system messages joined into one instruction block (providers that take a single system field). */
export function joinSystemMessages(
  messages: ModelMessage[],
): string | undefined {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter(Boolean);
  return system.length > 0 ? system.join("\n\n") : undefined;
}

/** Parses tool-call arguments, tolerating malformed JSON from the model. */
export function parseToolArguments(
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

/** Effort levels from least to most thinking */
export const EFFORT_LEVELS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The level in `allowed` closest to `effort` (ties go to the higher level), for models that
 * only take some levels
 */
export function nearestEffort<T extends ReasoningEffort>(effort: ReasoningEffort, allowed: readonly T[]): T {
  const rank = EFFORT_LEVELS.indexOf(effort);
  let best = allowed[0];
  let bestDistance = Infinity;
  for (const level of allowed) {
    const distance = Math.abs(EFFORT_LEVELS.indexOf(level) - rank);
    if (distance < bestDistance || (distance === bestDistance && EFFORT_LEVELS.indexOf(level) > EFFORT_LEVELS.indexOf(best))) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** The levels OpenAI's reasoning_effort takes (newer models; older ones take fewer) */
export const OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** The effort level that roughly matches a thinking token budget, for models that only take levels */
export function effortForBudget(budgetTokens: number): ReasoningEffort {
  if (budgetTokens <= 0) return "none";
  if (budgetTokens <= 1024) return "minimal";
  if (budgetTokens <= 4096) return "low";
  if (budgetTokens <= 12288) return "medium";
  if (budgetTokens <= 24576) return "high";
  if (budgetTokens <= 49152) return "xhigh";
  return "max";
}

/** The output token cap to use when a request doesn't set maxTokens */
export const DEFAULT_MAX_TOKENS = 4096;

/** The default output cap when the model is asked to reason: thinking counts toward the cap */
export const REASONING_MAX_TOKENS = 16384;

/** Whether a request asks the model to think */
export function wantsReasoning(request: CompletionRequest): boolean {
  const r = request.reasoning;
  if (!r) return false;
  if (r.effort === "none") return false;
  return r.effort !== undefined || (r.budgetTokens ?? 0) > 0 || r.includeThoughts === true;
}

/** A JSON response format: any JSON object, or JSON matching a schema */
export type JsonFormat = Exclude<ResponseFormat, { type: "text" }>;

/** The JSON format a request asks for (`jsonMode` is shorthand for `{ type: 'json' }`), or undefined for text */
export function jsonFormatOf(request: CompletionRequest): JsonFormat | undefined {
  const format = request.responseFormat;
  if (format) return format.type === "text" ? undefined : format;
  return request.jsonMode ? { type: "json" } : undefined;
}

/** Parses a JSON answer, tolerating a markdown code fence around it. Undefined when it isn't valid JSON */
export function parseJsonContent(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?[ \t]*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return undefined;
  }
}

/** System instruction for providers (or requests) without a native JSON mode */
export function jsonInstruction(format: JsonFormat): string {
  return format.type === "json_schema"
    ? `Respond with only JSON that matches this JSON Schema, with no other text:\n${JSON.stringify(format.schema)}`
    : "Respond with only a valid JSON object, with no other text.";
}

/** A JSON Schema without the `$schema` keyword, which several APIs reject */
export function withoutSchemaKeyword(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/** The inline data of an audio or file part, with a clear error for URLs (the provider needs the bytes) */
export function requireDataUri(
  part: Extract<ContentPart, { url: string }>,
  provider: string,
): { mimeType: string; data: string } {
  const inline = parseDataUri(part.url);
  if (inline) return inline;
  const shown = part.url.length > 80 ? `${part.url.slice(0, 80)}...` : part.url;
  throw new Error(`${provider} needs ${part.type} input as a data: URI (base64), not a URL (${shown})`);
}

/** The MIME type of a part: from its data URI, its mimeType, or its URL's extension */
export function mimeTypeOf(part: Extract<ContentPart, { url: string }>): string {
  return parseDataUri(part.url)?.mimeType ?? part.mimeType ?? guessMimeType(part.url, part.type);
}

const MIME_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  webm: "audio/webm", mp4: "video/mp4", mov: "video/quicktime",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", html: "text/html",
  json: "application/json", doc: "application/msword", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** The MIME type a URL's file extension suggests */
export function guessMimeType(url: string, kind: string): string {
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
  return (ext && MIME_TYPES[ext]) || (kind === "image" ? "image/jpeg" : "application/octet-stream");
}

/** The file extension for a MIME type (the reverse of guessMimeType) */
export function extensionOf(mimeType: string): string | undefined {
  const type = mimeType.toLowerCase().split(";")[0].trim();
  if (type === "audio/mp3") return "mp3";
  if (type === "audio/x-wav" || type === "audio/wave") return "wav";
  return Object.entries(MIME_TYPES).find(([, mime]) => mime === type)?.[0];
}

/**
 * Runs `fn` over `items` in batches of `size`, up to `concurrency` batches at a time,
 * and returns the results in input order.
 */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[]) => Promise<R[]>,
  concurrency = 1,
): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const results: R[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const out = await fn(batches[index]);
      if (out.length !== batches[index].length) {
        throw new Error(`Expected ${batches[index].length} results, got ${out.length}`);
      }
      results[index] = out;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return results.flat();
}

/** Reads an API error response into an Error with its status and message */
export async function apiError(label: string, response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  let message = text;
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string; Message?: string };
    const detail = typeof body.error === "string" ? body.error : body.error?.message ?? body.message ?? body.Message;
    if (detail) message = detail;
  } catch {
    // Not JSON: keep the text
  }
  return new Error(`${label} (${response.status}): ${message || response.statusText}`);
}

/** A credential (token or key set) that's fetched once and reused until shortly before it expires */
export interface CachedSource<T> {
  get(): Promise<T>;
}

/** A bearer token source */
export type TokenSource = CachedSource<string>;

/**
 * Caches what `fetch` returns until 5 minutes before its `expiresAt` (ms since the epoch;
 * Infinity for credentials that don't expire). Concurrent callers share one fetch.
 */
export function cached<T>(fetch: () => Promise<{ value: T; expiresAt: number }>): CachedSource<T> {
  let current: { value: T; expiresAt: number } | undefined;
  let pending: Promise<{ value: T; expiresAt: number }> | undefined;
  return {
    async get() {
      if (current && current.expiresAt - Date.now() > 5 * 60_000) return current.value;
      pending ??= fetch().finally(() => { pending = undefined; });
      current = await pending;
      return current.value;
    },
  };
}

/** A cached bearer token source */
export function cachedToken(fetchToken: () => Promise<{ token: string; expiresAt: number }>): TokenSource {
  return cached(async () => {
    const { token, expiresAt } = await fetchToken();
    return { value: token, expiresAt };
  });
}

/** ISO date for a Unix timestamp in seconds, or undefined */
export function unixToIso(seconds: unknown): string | undefined {
  return typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}
