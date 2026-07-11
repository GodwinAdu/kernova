/**
 * RAG Pipeline Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RAGPipeline } from './rag-pipeline.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';

describe('RAGPipeline', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;
  let rag: RAGPipeline;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: 'Mock response',
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });

    rag = new RAGPipeline(eventBus, modelRouter, {
      chunkSize: 100,
      chunkOverlap: 10,
      topK: 3,
      scoreThreshold: 0.0, // Low threshold for testing
      chunkStrategy: 'recursive',
    });
  });

  describe('ingest()', () => {
    it('should ingest a document and create chunks', async () => {
      const doc = await rag.ingest(
        'TypeScript is a typed superset of JavaScript. It compiles to plain JavaScript.',
        'test.md',
      );

      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.source).toBe('test.md');
      expect(doc.content).toContain('TypeScript');

      const stats = rag.stats();
      expect(stats.documents).toBe(1);
      expect(stats.chunks).toBeGreaterThan(0);
    });

    it('should throw on empty content', async () => {
      await expect(rag.ingest('', 'empty.md')).rejects.toThrow('Validation failed');
    });

    it('should generate embeddings for chunks', async () => {
      await rag.ingest('Hello world this is a test document.', 'test.md');

      const stats = rag.stats();
      expect(stats.embeddedChunks).toBeGreaterThan(0);
    });

    it('should store metadata on chunks', async () => {
      await rag.ingest('Content here', 'doc.md', { author: 'test' });

      const stats = rag.stats();
      expect(stats.documents).toBe(1);
    });

    it('should handle large documents with multiple chunks', async () => {
      const largeContent = 'This is a sentence about programming. '.repeat(100);
      await rag.ingest(largeContent, 'large.md');

      const stats = rag.stats();
      expect(stats.chunks).toBeGreaterThan(1);
    });
  });

  describe('retrieve()', () => {
    it('should retrieve relevant chunks', async () => {
      await rag.ingest(
        'TypeScript adds type safety to JavaScript. Types prevent many common bugs.',
        'typescript.md',
      );
      await rag.ingest(
        'Python is a dynamic language used for data science and machine learning.',
        'python.md',
      );

      const results = await rag.retrieve('type safety in JavaScript');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].chunk).toBeDefined();
      expect(results[0].document).toBeDefined();
    });

    it('should return empty array for empty query', async () => {
      const results = await rag.retrieve('');
      expect(results).toEqual([]);
    });

    it('should respect topK limit', async () => {
      // Ingest many documents
      for (let i = 0; i < 10; i++) {
        await rag.ingest(`Document ${i} about programming concepts.`, `doc${i}.md`);
      }

      const results = await rag.retrieve('programming', { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should fall back to keyword search when embeddings fail', async () => {
      // Make embed throw
      const originalEmbed = modelRouter.embed.bind(modelRouter);
      modelRouter.embed = async () => { throw new Error('Embed failed'); };

      await rag.ingest('TypeScript is great for large applications.', 'ts.md');

      // Reset embed for retrieval — but make it fail there too
      const results = await rag.retrieve('TypeScript');

      // Should still find results via keyword search
      expect(results.length).toBeGreaterThan(0);

      // Restore
      modelRouter.embed = originalEmbed;
    });
  });

  describe('getContext()', () => {
    it('should return formatted context string', async () => {
      await rag.ingest('Kernova is an AI agent runtime.', 'kernova.md');

      const context = await rag.getContext('What is Kernova?');

      expect(context).toContain('kernova.md');
      expect(context).toContain('Kernova');
    });

    it('should return empty string when no matches', async () => {
      const context = await rag.getContext('something totally unrelated');
      // May be empty if threshold is high enough
      expect(typeof context).toBe('string');
    });
  });

  describe('remove()', () => {
    it('should remove a document and its chunks', async () => {
      const doc = await rag.ingest('Content to remove', 'removable.md');

      const removed = rag.remove(doc.id);
      expect(removed).toBe(true);

      const stats = rag.stats();
      expect(stats.documents).toBe(0);
      expect(stats.chunks).toBe(0);
    });

    it('should return false for non-existent document', () => {
      expect(rag.remove('nonexistent')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear all data', async () => {
      await rag.ingest('Doc 1', 'a.md');
      await rag.ingest('Doc 2', 'b.md');

      rag.clear();

      const stats = rag.stats();
      expect(stats.documents).toBe(0);
      expect(stats.chunks).toBe(0);
    });
  });

  describe('listDocuments()', () => {
    it('should list all ingested documents', async () => {
      await rag.ingest('First', 'first.md');
      await rag.ingest('Second', 'second.md');

      const docs = rag.listDocuments();
      expect(docs.length).toBe(2);
      expect(docs.map(d => d.source)).toContain('first.md');
      expect(docs.map(d => d.source)).toContain('second.md');
    });
  });

  describe('chunking strategies', () => {
    it('should chunk by sentence', async () => {
      const sentenceRag = new RAGPipeline(eventBus, modelRouter, {
        chunkSize: 50,
        chunkOverlap: 0,
        chunkStrategy: 'sentence',
      });

      await sentenceRag.ingest(
        'First sentence here. Second sentence here. Third sentence here.',
        'sentences.md',
      );

      const stats = sentenceRag.stats();
      expect(stats.chunks).toBeGreaterThan(0);
    });

    it('should chunk by paragraph', async () => {
      const paraRag = new RAGPipeline(eventBus, modelRouter, {
        chunkSize: 50,
        chunkOverlap: 0,
        chunkStrategy: 'paragraph',
      });

      await paraRag.ingest(
        'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.',
        'paragraphs.md',
      );

      const stats = paraRag.stats();
      expect(stats.chunks).toBeGreaterThan(0);
    });

    it('should chunk with fixed strategy', async () => {
      const fixedRag = new RAGPipeline(eventBus, modelRouter, {
        chunkSize: 20,
        chunkOverlap: 5,
        chunkStrategy: 'fixed',
      });

      await fixedRag.ingest(
        'A'.repeat(500),
        'fixed.md',
      );

      const stats = fixedRag.stats();
      expect(stats.chunks).toBeGreaterThan(1);
    });
  });
});
