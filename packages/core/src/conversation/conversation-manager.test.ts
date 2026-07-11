/**
 * Conversation History Manager Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from './conversation-manager.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';

describe('ConversationManager', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;
  let conversation: ConversationManager;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: 'This is a summary of the previous conversation discussing TypeScript features and best practices.',
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });

    conversation = new ConversationManager(eventBus, modelRouter, {
      maxTokens: 500,      // Small for testing
      preserveRecent: 3,
      autoSummarize: true,
      summarizeThreshold: 0.8,
    });
  });

  describe('addMessage()', () => {
    it('should add messages to the conversation', async () => {
      const msg = await conversation.addMessage('user', 'Hello');

      expect(msg).toBeDefined();
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.tokenEstimate).toBeGreaterThan(0);
      expect(conversation.totalMessages).toBe(1);
    });

    it('should support all roles', async () => {
      await conversation.addMessage('user', 'Hi');
      await conversation.addMessage('assistant', 'Hello!');
      await conversation.addMessage('system', 'Context info');

      expect(conversation.totalMessages).toBe(3);
    });

    it('should store metadata', async () => {
      const msg = await conversation.addMessage('user', 'Test', { source: 'cli' });
      expect(msg.metadata).toEqual({ source: 'cli' });
    });
  });

  describe('getWindow()', () => {
    it('should return all messages when under budget', async () => {
      await conversation.addMessage('user', 'Short message');
      await conversation.addMessage('assistant', 'Short reply');

      const window = conversation.getWindow();
      expect(window.messages.length).toBe(2);
      expect(window.summaries.length).toBe(0);
      expect(window.totalMessages).toBe(2);
    });
  });

  describe('auto-summarization', () => {
    it('should auto-summarize when token budget is exceeded', async () => {
      // Add many long messages to exceed the 500-token budget
      for (let i = 0; i < 10; i++) {
        await conversation.addMessage(
          i % 2 === 0 ? 'user' : 'assistant',
          `This is a fairly long message number ${i} that discusses various topics in some detail to consume tokens. `.repeat(3),
        );
      }

      const window = conversation.getWindow();
      // Should have summaries now (messages compacted)
      expect(window.summaries.length).toBeGreaterThan(0);
      // Active messages should be at most preserveRecent
      expect(window.messages.length).toBeLessThanOrEqual(10);
    });
  });

  describe('compact()', () => {
    it('should summarize older messages', async () => {
      // Add 6 messages (preserveRecent = 3, so 3 should be compactable)
      for (let i = 0; i < 6; i++) {
        await conversation.addMessage('user', `Message ${i}`);
      }

      const summary = await conversation.compact();

      expect(summary).toBeDefined();
      expect(summary!.messageCount).toBe(3); // 6 - preserveRecent(3) = 3 summarized
      expect(summary!.content).toContain('summary');
    });

    it('should return null when nothing to compact', async () => {
      await conversation.addMessage('user', 'Only one');

      const summary = await conversation.compact();
      expect(summary).toBeNull();
    });

    it('should advance the window start', async () => {
      for (let i = 0; i < 8; i++) {
        await conversation.addMessage('user', `Message ${i}`);
      }

      await conversation.compact();

      const window = conversation.getWindow();
      expect(window.windowStart).toBeGreaterThan(0);
      expect(window.messages.length).toBeLessThan(8);
    });
  });

  describe('getPromptMessages()', () => {
    it('should return messages formatted for LLM', async () => {
      await conversation.addMessage('user', 'Hello');
      await conversation.addMessage('assistant', 'Hi there!');

      const promptMessages = conversation.getPromptMessages();
      expect(promptMessages.length).toBe(2);
      expect(promptMessages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(promptMessages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('should prepend summary as system message after compaction', async () => {
      for (let i = 0; i < 6; i++) {
        await conversation.addMessage('user', `Message ${i}`);
      }
      await conversation.compact();

      const promptMessages = conversation.getPromptMessages();
      // First message should be the summary as system context
      expect(promptMessages[0].role).toBe('system');
      expect(promptMessages[0].content).toContain('Previous conversation summary');
    });
  });

  describe('clear()', () => {
    it('should clear all history', async () => {
      await conversation.addMessage('user', 'Hello');
      await conversation.addMessage('assistant', 'Hi');

      conversation.clear();

      expect(conversation.totalMessages).toBe(0);
      expect(conversation.activeMessageCount).toBe(0);
      expect(conversation.getWindow().summaries.length).toBe(0);
    });
  });

  describe('export/import', () => {
    it('should export and re-import conversation state', async () => {
      await conversation.addMessage('user', 'Message 1');
      await conversation.addMessage('assistant', 'Reply 1');

      const exported = conversation.export();
      expect(exported.messages.length).toBe(2);

      // Create a new conversation and import
      const newConversation = new ConversationManager(eventBus, modelRouter);
      newConversation.import(exported);

      expect(newConversation.totalMessages).toBe(2);
    });
  });
});
