/**
 * Property-Based Tests for Conversation Threads
 * 
 * Tests correctness properties of the ConversationManager:
 * - Property 5: Sliding window invariant — active messages never exceed window size
 * - Property 6: Conversation persistence round-trip — threads and messages survive restart
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ConversationManager } from './conversation-manager.js';
import { ConversationStore } from './conversation-store.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ─── Test Helpers ───────────────────────────────────────────

function createTestDir(): string {
  const dir = join(tmpdir(), `kernova-convo-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function createTestDeps(options?: { dataDir?: string }) {
  const eventBus = new EventBus({ persistent: false });
  await eventBus.start();

  const mockProvider = new MockModelProvider({
    defaultResponse: 'Summary of the conversation so far.',
  });

  const modelRouter = new ModelRouter({
    routing: { default: { provider: 'mock', model: 'mock-model' } },
    providers: [mockProvider],
    eventBus,
  });

  return { eventBus, modelRouter, mockProvider };
}

// ─── Arbitraries ────────────────────────────────────────────

/** Generate a valid role */
const roleArb = fc.constantFrom('user' as const, 'assistant' as const, 'system' as const);

/** Generate a valid message content (non-empty string) */
const contentArb = fc.string({ minLength: 1, maxLength: 200 });

/** Generate a message tuple (role, content) */
const messageArb = fc.tuple(roleArb, contentArb);

/** Generate a sequence of messages */
const messagesArb = fc.array(messageArb, { minLength: 1, maxLength: 120 });

/** Generate a window size (small enough to trigger sliding window) */
const windowSizeArb = fc.integer({ min: 3, max: 30 });

/** Generate a valid thread ID */
const threadIdArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,20}$/);

// ─── Property 5: Sliding Window Invariant ───────────────────
// **Validates: Requirements 6.1**
//
// For any sequence of addMessage calls, the number of active messages
// in a thread never exceeds the configured windowSize.

describe('Property 5: Sliding Window Invariant', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;

  beforeEach(async () => {
    const deps = await createTestDeps();
    eventBus = deps.eventBus;
    modelRouter = deps.modelRouter;
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  it('active messages never exceed window size for any sequence of addMessage calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        windowSizeArb,
        messagesArb,
        async (windowSize, messages) => {
          const manager = new ConversationManager(eventBus, modelRouter, {
            windowSize,
            autoSummarize: true,
            maxTokens: 100000,
            preserveRecent: windowSize,
            summarizeThreshold: 0.8,
          });

          const threadId = `test-window-${randomUUID()}`;
          manager.create(threadId, windowSize);

          for (const [role, content] of messages) {
            await manager.addMessageToThread(threadId, role, content);

            // INVARIANT: Active messages must never exceed windowSize
            const activeCount = manager.getActiveMessageCount(threadId);
            expect(activeCount).toBeLessThanOrEqual(windowSize);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('sliding window invariant holds with model failure (truncation fallback)', async () => {
    const failingProvider = new MockModelProvider({
      shouldFail: true,
      failureMessage: 'Model unavailable',
    });

    const failingRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [failingProvider],
      eventBus,
    });

    await fc.assert(
      fc.asyncProperty(
        windowSizeArb,
        messagesArb,
        async (windowSize, messages) => {
          const manager = new ConversationManager(eventBus, failingRouter, {
            windowSize,
            autoSummarize: true,
            maxTokens: 100000,
            preserveRecent: windowSize,
            summarizeThreshold: 0.8,
          });

          const threadId = `test-fallback-${randomUUID()}`;
          manager.create(threadId, windowSize);

          for (const [role, content] of messages) {
            await manager.addMessageToThread(threadId, role, content);

            // INVARIANT: Even when model fails, active messages must not exceed windowSize
            const activeCount = manager.getActiveMessageCount(threadId);
            expect(activeCount).toBeLessThanOrEqual(windowSize);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 6: Conversation Persistence Round-Trip ────────
// **Validates: Requirements 6.6**
//
// For all conversation threads, stopping and restarting the conversation
// manager SHALL preserve all messages and thread metadata.

describe('Property 6: Conversation Persistence Round-Trip', () => {
  let testDir: string;
  let eventBus: EventBus;
  let modelRouter: ModelRouter;

  beforeEach(async () => {
    testDir = createTestDir();
    const deps = await createTestDeps({ dataDir: testDir });
    eventBus = deps.eventBus;
    modelRouter = deps.modelRouter;
  });

  afterEach(async () => {
    await eventBus.stop();
    cleanupTestDir(testDir);
  });

  it('threads and messages survive restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        threadIdArb,
        fc.array(messageArb, { minLength: 1, maxLength: 20 }),
        async (threadId, messages) => {
          // Phase 1: Create a manager, add messages, then close
          const manager1 = new ConversationManager(eventBus, modelRouter, {
            windowSize: 50,
            dataDir: testDir,
            autoSummarize: false, // Disable summarization for clean round-trip
            maxTokens: 100000,
            preserveRecent: 50,
            summarizeThreshold: 1.0, // Never auto-summarize
          });

          manager1.create(threadId, 50);

          for (const [role, content] of messages) {
            await manager1.addMessageToThread(threadId, role, content);
          }

          // Close the first manager
          manager1.close();

          // Phase 2: Create a new manager pointing to the same data dir
          const manager2 = new ConversationManager(eventBus, modelRouter, {
            windowSize: 50,
            dataDir: testDir,
            autoSummarize: false,
            maxTokens: 100000,
            preserveRecent: 50,
            summarizeThreshold: 1.0,
          });

          // Retrieve the thread
          const retrieved = manager2.retrieve(threadId);
          expect(retrieved).toBeDefined();
          expect(retrieved!.id).toBe(threadId);
          expect(retrieved!.status).toBe('active');

          // Verify messages are preserved
          const ctx = manager2.getThreadContext(threadId);
          expect(ctx.messages.length).toBe(messages.length);

          for (let i = 0; i < messages.length; i++) {
            const [expectedRole, expectedContent] = messages[i];
            expect(ctx.messages[i].role).toBe(expectedRole);
            expect(ctx.messages[i].content).toBe(expectedContent);
          }

          manager2.close();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('archived threads persist their status across restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        threadIdArb,
        fc.array(messageArb, { minLength: 1, maxLength: 5 }),
        async (threadId, messages) => {
          // Phase 1: Create, add messages, archive
          const manager1 = new ConversationManager(eventBus, modelRouter, {
            windowSize: 50,
            dataDir: testDir,
            autoSummarize: false,
            maxTokens: 100000,
            preserveRecent: 50,
            summarizeThreshold: 1.0,
          });

          manager1.create(threadId, 50);
          for (const [role, content] of messages) {
            await manager1.addMessageToThread(threadId, role, content);
          }
          manager1.archive(threadId);
          manager1.close();

          // Phase 2: Reopen and verify archived status
          const manager2 = new ConversationManager(eventBus, modelRouter, {
            windowSize: 50,
            dataDir: testDir,
            autoSummarize: false,
            maxTokens: 100000,
            preserveRecent: 50,
            summarizeThreshold: 1.0,
          });

          const retrieved = manager2.retrieve(threadId);
          expect(retrieved).toBeDefined();
          expect(retrieved!.status).toBe('archived');

          manager2.close();
        },
      ),
      { numRuns: 20 },
    );
  });
});
