/**
 * Kernova RAG Pipeline
 *
 * Retrieval-Augmented Generation pipeline:
 * 1. Ingest documents → chunk them
 * 2. Generate embeddings for each chunk
 * 3. On query, embed the query → find similar chunks → return context
 *
 * Chunking strategies:
 * - fixed: Split at fixed token boundaries
 * - recursive: Split by paragraph → sentence → word (preserving structure)
 * - sentence: Split at sentence boundaries
 * - paragraph: Split at paragraph boundaries
 *
 * Storage is in-memory with optional embedding via ModelRouter.
 */

import type {
  NexusId,
  NexusEvent,
  Document,
  DocumentChunk,
  RetrievalResult,
  RAGConfig,
  ChunkStrategy,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface RAGPipelineConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  scoreThreshold: number;
  chunkStrategy: ChunkStrategy;
}

const DEFAULT_CONFIG: RAGPipelineConfig = {
  chunkSize: 512,
  chunkOverlap: 50,
  topK: 5,
  scoreThreshold: 0.7,
  chunkStrategy: 'recursive',
};

/**
 * Rough token estimation for chunking purposes.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export class RAGPipeline {
  private readonly eventBus: EventBus;
  private readonly modelRouter: ModelRouter;
  private readonly config: RAGPipelineConfig;

  /** All ingested documents */
  private documents: Map<NexusId, Document> = new Map();

  /** All chunks indexed by chunk ID */
  private chunks: Map<NexusId, DocumentChunk> = new Map();

  /** Document ID → chunk IDs mapping */
  private documentChunks: Map<NexusId, NexusId[]> = new Map();

  constructor(eventBus: EventBus, modelRouter: ModelRouter, config?: Partial<RAGConfig>) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest a document: chunk it and generate embeddings.
   */
  async ingest(content: string, source: string, metadata?: Record<string, unknown>): Promise<Document> {
    if (!content || content.trim().length === 0) {
      throw new ValidationError('content', 'Document content must not be empty');
    }

    const doc: Document = {
      id: generateId('doc'),
      content,
      source,
      metadata,
      createdAt: now(),
    };

    this.documents.set(doc.id, doc);

    // Chunk the document
    const textChunks = this.chunkText(content);
    const chunkIds: NexusId[] = [];

    this.emitEvent('rag.ingesting', doc.id, {
      source,
      contentLength: content.length,
      chunkCount: textChunks.length,
    });

    // Create chunks and generate embeddings
    for (let i = 0; i < textChunks.length; i++) {
      const chunk: DocumentChunk = {
        id: generateId('chunk'),
        documentId: doc.id,
        content: textChunks[i],
        index: i,
        tokenEstimate: estimateTokens(textChunks[i]),
        metadata,
      };

      // Generate embedding
      try {
        chunk.embedding = await this.modelRouter.embed(textChunks[i]);
      } catch {
        // Embedding generation failed — chunk is still usable for keyword search
      }

      this.chunks.set(chunk.id, chunk);
      chunkIds.push(chunk.id);
    }

    this.documentChunks.set(doc.id, chunkIds);

    this.emitEvent('rag.ingested', doc.id, {
      source,
      chunkCount: chunkIds.length,
      hasEmbeddings: chunkIds.some(id => this.chunks.get(id)?.embedding !== undefined),
    });

    return doc;
  }

  /**
   * Retrieve relevant chunks for a query.
   * Uses semantic similarity (embeddings) with keyword fallback.
   */
  async retrieve(query: string, options?: { topK?: number; scoreThreshold?: number }): Promise<RetrievalResult[]> {
    const topK = options?.topK ?? this.config.topK;
    const scoreThreshold = options?.scoreThreshold ?? this.config.scoreThreshold;

    if (!query || query.trim().length === 0) {
      return [];
    }

    this.emitEvent('rag.retrieving', generateId('query'), {
      queryLength: query.length,
      topK,
      totalChunks: this.chunks.size,
    });

    // Try semantic search first
    let results: RetrievalResult[] = [];

    try {
      const queryEmbedding = await this.modelRouter.embed(query);
      results = this.semanticSearch(queryEmbedding, topK, scoreThreshold);
    } catch {
      // Embedding failed — fall back to keyword search
      results = this.keywordSearch(query, topK);
    }

    this.emitEvent('rag.retrieved', generateId('query'), {
      resultCount: results.length,
      topScore: results.length > 0 ? results[0].score : 0,
    });

    return results;
  }

  /**
   * Retrieve and format context for a query.
   * Returns a single string suitable for injection into an LLM prompt.
   */
  async getContext(query: string, options?: { topK?: number; maxTokens?: number }): Promise<string> {
    const results = await this.retrieve(query, { topK: options?.topK });

    if (results.length === 0) {
      return '';
    }

    const maxTokens = options?.maxTokens ?? this.config.chunkSize * (options?.topK ?? this.config.topK);
    let totalTokens = 0;
    const contextParts: string[] = [];

    for (const result of results) {
      const tokens = estimateTokens(result.chunk.content);
      if (totalTokens + tokens > maxTokens) break;
      contextParts.push(`[Source: ${result.document.source}]\n${result.chunk.content}`);
      totalTokens += tokens;
    }

    return contextParts.join('\n\n---\n\n');
  }

  /**
   * Remove a document and all its chunks.
   */
  remove(documentId: NexusId): boolean {
    const doc = this.documents.get(documentId);
    if (!doc) return false;

    // Remove all chunks
    const chunkIds = this.documentChunks.get(documentId) || [];
    for (const chunkId of chunkIds) {
      this.chunks.delete(chunkId);
    }

    this.documentChunks.delete(documentId);
    this.documents.delete(documentId);

    this.emitEvent('rag.removed', documentId, {
      source: doc.source,
      chunksRemoved: chunkIds.length,
    });

    return true;
  }

  /**
   * Get statistics about the pipeline.
   */
  stats(): { documents: number; chunks: number; embeddedChunks: number } {
    let embeddedChunks = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding) embeddedChunks++;
    }

    return {
      documents: this.documents.size,
      chunks: this.chunks.size,
      embeddedChunks,
    };
  }

  /**
   * List all ingested documents.
   */
  listDocuments(): Document[] {
    return Array.from(this.documents.values());
  }

  /**
   * Clear all documents and chunks.
   */
  clear(): void {
    this.documents.clear();
    this.chunks.clear();
    this.documentChunks.clear();
  }

  // ─── Chunking Strategies ───────────────────────────────────

  /**
   * Chunk text based on the configured strategy.
   */
  private chunkText(text: string): string[] {
    switch (this.config.chunkStrategy) {
      case 'fixed':
        return this.chunkFixed(text);
      case 'sentence':
        return this.chunkBySentence(text);
      case 'paragraph':
        return this.chunkByParagraph(text);
      case 'recursive':
      default:
        return this.chunkRecursive(text);
    }
  }

  /**
   * Fixed-size chunking with overlap.
   */
  private chunkFixed(text: string): string[] {
    const chunks: string[] = [];
    const charSize = this.config.chunkSize * 4; // Approximate chars from tokens
    const charOverlap = this.config.chunkOverlap * 4;
    const step = charSize - charOverlap;

    for (let i = 0; i < text.length; i += step) {
      const chunk = text.slice(i, i + charSize).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Sentence-based chunking: group sentences until chunk size is reached.
   */
  private chunkBySentence(text: string): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
    return this.groupByTokenBudget(sentences);
  }

  /**
   * Paragraph-based chunking: group paragraphs until chunk size is reached.
   */
  private chunkByParagraph(text: string): string[] {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    return this.groupByTokenBudget(paragraphs);
  }

  /**
   * Recursive chunking: try paragraph → sentence → fixed.
   * Splits by largest unit first; if a unit exceeds the budget, splits finer.
   */
  private chunkRecursive(text: string): string[] {
    const charBudget = this.config.chunkSize * 4;

    // If text fits in one chunk, return it
    if (text.length <= charBudget) {
      return [text.trim()].filter(t => t.length > 0);
    }

    // Try splitting by paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 1) {
      const chunks: string[] = [];
      for (const para of paragraphs) {
        if (para.length <= charBudget) {
          chunks.push(para.trim());
        } else {
          // Paragraph too large — split by sentences
          chunks.push(...this.chunkBySentence(para));
        }
      }
      return this.groupByTokenBudget(chunks);
    }

    // Single paragraph — try sentences
    const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
    if (sentences && sentences.length > 1) {
      return this.groupByTokenBudget(sentences);
    }

    // Fall back to fixed chunking
    return this.chunkFixed(text);
  }

  /**
   * Group text segments together until they reach the chunk token budget.
   */
  private groupByTokenBudget(segments: string[]): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const segment of segments) {
      const segmentTokens = estimateTokens(segment);

      if (currentTokens + segmentTokens > this.config.chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Overlap: keep the last segment
        if (this.config.chunkOverlap > 0) {
          const overlapText = currentChunk.slice(-(this.config.chunkOverlap * 4));
          currentChunk = overlapText + segment;
          currentTokens = estimateTokens(currentChunk);
        } else {
          currentChunk = segment;
          currentTokens = segmentTokens;
        }
      } else {
        currentChunk += (currentChunk ? '\n' : '') + segment;
        currentTokens += segmentTokens;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : segments.filter(s => s.trim().length > 0);
  }

  // ─── Search ────────────────────────────────────────────────

  /**
   * Semantic search using cosine similarity on embeddings.
   */
  private semanticSearch(queryEmbedding: number[], topK: number, threshold: number): RetrievalResult[] {
    const scored: RetrievalResult[] = [];

    for (const chunk of this.chunks.values()) {
      if (!chunk.embedding) continue;

      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= threshold) {
        const doc = this.documents.get(chunk.documentId);
        if (doc) {
          scored.push({ chunk, score, document: doc });
        }
      }
    }

    // Sort by score descending, return top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Keyword search fallback using simple term matching.
   */
  private keywordSearch(query: string, topK: number): RetrievalResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scored: RetrievalResult[] = [];

    for (const chunk of this.chunks.values()) {
      const content = chunk.content.toLowerCase();
      let matchCount = 0;

      for (const term of queryTerms) {
        if (content.includes(term)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = matchCount / queryTerms.length;
        const doc = this.documents.get(chunk.documentId);
        if (doc) {
          scored.push({ chunk, score, document: doc });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // ─── Events ────────────────────────────────────────────────

  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'rag',
      actorId: 'rag-pipeline',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'rag-pipeline',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
