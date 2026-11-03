/**
 * kernova doctor
 *
 * Checks every AI provider Kernova finds, through the same provider classes the kernel uses
 * (so cloud sign-in for Azure, Bedrock, and Vertex AI is checked too):
 * - chat completion, tool calling, streaming, and embeddings
 * - a local Ollama server, when one is running
 *
 * Usage:
 *   kernova doctor
 *   kernova doctor --verbose
 *   kernova doctor --provider bedrock [--provider vertex]   # check these providers only
 */

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  BedrockProvider,
  OllamaProvider,
  createProvider,
  detectProvidersFromCatalog,
  type ModelProvider,
} from '@kernova/core';
import type { StreamChunk } from '@kernova/types';
import { success, info, warn, error, printBanner } from '../ui.js';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface ProviderCheck {
  provider: string;
  id: string;
  model: string;
  chat: CheckStatus;
  toolCalling: CheckStatus;
  streaming: CheckStatus;
  embeddings: CheckStatus;
  error?: string;
  /** What failed in the checks after chat */
  notes: string[];
  latencyMs?: number;
}

/** Longest a single check may take */
const CHECK_TIMEOUT_MS = 60_000;

/** Room for models that think before answering */
const CHECK_MAX_TOKENS = 1024;

export async function handleDoctor(args: string[]): Promise<void> {
  printBanner();
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │  🩺 Kernova Doctor — Provider Diagnostics │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');

  const verbose = args.includes('--verbose') || args.includes('-v');
  const requested = optionValues(args, '--provider');

  // Load .env.local / .env
  loadEnv(resolve(process.cwd()));

  info('Checking configured AI providers...\n');

  const { providers, notes } = await findProviders(requested);
  for (const note of notes) info(note);
  if (notes.length) console.log('');

  if (providers.length === 0) {
    error('No providers configured! Set at least one API key in .env.local, for example:');
    console.log('    OPENAI_API_KEY=sk-...');
    console.log('    ANTHROPIC_API_KEY=sk-ant-...');
    console.log('    GEMINI_API_KEY=AI...');
    console.log('  or start a local model server: ollama serve');
    console.log('  Every supported provider: https://kernova2026.vercel.app/guides/providers/');
    process.exitCode = 1;
    return;
  }

  const results: ProviderCheck[] = [];
  for (const provider of providers) {
    info(`Testing ${provider.name}...`);
    const result = await checkProvider(provider);
    results.push(result);
    printResult(result, verbose);
  }

  // Summary
  console.log('\n  ═══════════════════════════════════════════');
  console.log('  SUMMARY\n');

  const width = Math.max(20, ...results.map(r => r.provider.length + 1));
  console.log(`  ${'Provider'.padEnd(width)} Chat  Tools  Stream  Embed`);
  console.log(`  ${'─'.repeat(width + 29)}`);
  for (const r of results) {
    console.log(`  ${r.provider.padEnd(width)} ${icon(r.chat)}     ${icon(r.toolCalling)}      ${icon(r.streaming)}       ${icon(r.embeddings)}`);
  }

  const working = results.filter(r => r.chat === 'pass');
  console.log(`\n  ${working.length}/${results.length} providers working.`);

  if (working.length > 0) {
    console.log('');
    success(`Kernova is ready to use with: ${working.map(r => r.provider).join(', ')}`);
  } else {
    console.log('');
    error('No providers are working. Check your API keys and network connection.');
    process.exitCode = 1;
  }
}

/**
 * The providers to check: the ones named with --provider, or every provider detected from the
 * environment plus a running Ollama server. Also returns hints about providers that weren't added.
 */
export async function findProviders(requested: string[] = []): Promise<{ providers: ModelProvider[]; notes: string[] }> {
  const notes: string[] = [];

  if (requested.length > 0) {
    const providers: ModelProvider[] = [];
    for (const id of requested) {
      try {
        const provider = createProvider(id);
        if (provider.isAvailable()) providers.push(provider);
        else notes.push(`${provider.name} isn't set up: ${await unavailableReason(provider)}`);
      } catch (err) {
        notes.push((err as Error).message);
      }
    }
    return { providers, notes };
  }

  const providers = detectProvidersFromCatalog();
  const ids = new Set(providers.map(p => p.id));

  // Bedrock isn't auto-detected from plain AWS credentials (they're often there for other reasons)
  if (!ids.has('bedrock') && new BedrockProvider().isAvailable()) {
    notes.push('AWS credentials found. To check AWS Bedrock with them, run: kernova doctor --provider bedrock');
  }

  const ollama = await runningOllama();
  if (ollama) providers.push(ollama);
  else notes.push('Ollama is not running (optional; start it with: ollama serve)');

  return { providers, notes };
}

/** An Ollama provider for a server that's running, using a model it has pulled */
async function runningOllama(): Promise<ModelProvider | undefined> {
  const baseUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || undefined;
  const probe = new OllamaProvider({ baseUrl });
  try {
    const models = await withTimeout(probe.listModels(), 3000, 'Ollama did not answer');
    if (models.length === 0) return undefined;
    const wanted = process.env.OLLAMA_MODEL;
    const model = models.find(m => m.id === wanted || m.id === `${wanted}:latest`)?.id
      ?? models.find(m => m.id.startsWith(probe.defaultModel))?.id
      ?? models[0].id;
    return new OllamaProvider({ baseUrl, defaultModel: model });
  } catch {
    return undefined;
  }
}

/** What an unavailable provider is missing: its complete() says so before sending anything */
async function unavailableReason(provider: ModelProvider): Promise<string> {
  try {
    await provider.complete({ model: '', messages: [] });
    return 'unknown reason';
  } catch (err) {
    return (err as Error).message;
  }
}

/** Runs chat, tool calling, streaming, and embeddings checks against one provider */
export async function checkProvider(provider: ModelProvider, timeoutMs = CHECK_TIMEOUT_MS): Promise<ProviderCheck> {
  const model = provider.defaultModel ?? '';
  const result: ProviderCheck = {
    provider: provider.name,
    id: provider.id,
    model,
    chat: 'skip',
    toolCalling: 'skip',
    streaming: 'skip',
    embeddings: 'skip',
    notes: [],
  };

  // Chat
  try {
    const start = Date.now();
    await withTimeout(provider.complete({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: CHECK_MAX_TOKENS,
    }), timeoutMs, 'Timed out');
    result.chat = 'pass';
    result.latencyMs = Date.now() - start;
  } catch (err) {
    result.chat = 'fail';
    result.error = (err as Error).message;
    return result; // Nothing else will work either
  }

  // Tool calling
  try {
    const response = await withTimeout(provider.complete({
      model,
      messages: [{ role: 'user', content: 'What is the current time? Use the get_time tool.' }],
      tools: [{ name: 'get_time', description: 'Get the current time', parameters: { type: 'object', properties: {} } }],
      maxTokens: CHECK_MAX_TOKENS,
    }), timeoutMs, 'Timed out');
    if (response.toolCalls?.some(tc => tc.name === 'get_time')) {
      result.toolCalling = 'pass';
    } else {
      result.toolCalling = 'fail';
      result.notes.push('tools: the model answered without calling the tool');
    }
  } catch (err) {
    result.toolCalling = 'fail';
    result.notes.push(`tools: ${(err as Error).message}`);
  }

  // Streaming
  if (provider.stream) {
    try {
      const chunks = await withTimeout(collect(provider.stream({
        model,
        messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
        maxTokens: CHECK_MAX_TOKENS,
      })), timeoutMs, 'Timed out');
      if (chunks.some(c => c.done)) {
        result.streaming = 'pass';
      } else {
        result.streaming = 'fail';
        result.notes.push('stream: ended without a final chunk');
      }
    } catch (err) {
      result.streaming = 'fail';
      result.notes.push(`stream: ${(err as Error).message}`);
    }
  }

  // Embeddings
  if (provider.embed) {
    try {
      const vector = await withTimeout(provider.embed('Kernova doctor'), timeoutMs, 'Timed out');
      if (vector.length > 0) {
        result.embeddings = 'pass';
      } else {
        result.embeddings = 'fail';
        result.notes.push('embed: returned an empty vector');
      }
    } catch (err) {
      const message = (err as Error).message;
      // Providers that can't embed say so; that's not a failure
      if (/does not support embeddings/i.test(message)) {
        result.embeddings = 'skip';
      } else {
        result.embeddings = 'fail';
        result.notes.push(`embed: ${message}`);
      }
    }
  }

  return result;
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Every value given for an option: `--provider a --provider b` or `--provider=a,b` */
export function optionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name && args[i + 1] && !args[i + 1].startsWith('-')) values.push(args[++i]);
    else if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
  }
  return values.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean);
}

function icon(status: CheckStatus): string {
  switch (status) {
    case 'pass': return '✓';
    case 'fail': return '✗';
    default: return '—';
  }
}

function printResult(result: ProviderCheck, verbose: boolean): void {
  if (result.chat === 'pass') {
    success(`  ${result.provider} (${result.model || 'default model'}): working (${result.latencyMs}ms)`);
  } else {
    error(`  ${result.provider} (${result.model || 'default model'}): FAILED — ${result.error || 'unknown error'}`);
  }
  for (const note of result.notes) {
    if (verbose || result.chat === 'pass') warn(`    ${note}`);
  }
}

function loadEnv(projectRoot: string): void {
  const envFiles = ['.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = resolve(projectRoot, envFile);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        // Accept quoted values: KEY="value" or KEY='value'
        if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}
