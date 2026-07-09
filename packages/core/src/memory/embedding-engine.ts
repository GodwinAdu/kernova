/**
 * Nexus Embedding Engine
 * 
 * Generates vector embeddings for semantic memory search.
 * Uses the ModelRouter to access any embedding-capable provider.
 * 
 * Features:
 * - Provider-agnostic (OpenAI, Gemini, Ollama, etc.)
 * - Cosine similarity search
 * - Hybrid scoring (FTS keyword + vector semantic)
 * - Graceful degradation when no embedding provider available
 */

import { ModelRouter } from '../models/model-router.js';

export interface EmbeddingEngineConfig {
  /** Embedding dimension (default: auto-detect from first embedding) */
  dimension?: number;
}

export class EmbeddingEngine {
  private modelRouter: ModelRouter | null;
  private dimension: number | null;
  private available: boolean | null = null;

  constructor(modelRouter: ModelRouter | null, config: EmbeddingEngineConfig = {}) {
    this.modelRouter = modelRouter;
    this.dimension = config.dimension || null;
  }

  /**
   * Check if embedding is available (at least one provider supports it)
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    if (!this.modelRouter) {
      this.available = false;
      return false;
    }

    try {
      const testEmbedding = await this.modelRouter.embed('test');
      this.available = testEmbedding.length > 0;
      if (this.available && !this.dimension) {
        this.dimension = testEmbedding.length;
      }
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Generate an embedding vector for text
   */
  async embed(text: string): Promise<number[] | null> {
    if (!this.modelRouter) return null;

    try {
      const vector = await this.modelRouter.embed(text);
      if (!this.dimension) {
        this.dimension = vector.length;
      }
      return vector;
    } catch {
      return null;
    }
  }

  /**
   * Compute cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Find the top-k most similar vectors from a set of candidates
   */
  findSimilar(
    queryVector: number[],
    candidates: Array<{ id: string; vector: number[] }>,
    topK: number = 10,
    minSimilarity: number = 0.5,
  ): Array<{ id: string; similarity: number }> {
    const scored = candidates
      .map(c => ({
        id: c.id,
        similarity: this.cosineSimilarity(queryVector, c.vector),
      }))
      .filter(s => s.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return scored;
  }

  /**
   * Serialize a vector to a Buffer for SQLite BLOB storage
   */
  static serialize(vector: number[]): Buffer {
    const buffer = Buffer.alloc(vector.length * 4); // Float32
    for (let i = 0; i < vector.length; i++) {
      buffer.writeFloatLE(vector[i], i * 4);
    }
    return buffer;
  }

  /**
   * Deserialize a Buffer back to a vector
   */
  static deserialize(buffer: Buffer): number[] {
    const vector: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      vector.push(buffer.readFloatLE(i));
    }
    return vector;
  }

  /**
   * Get the embedding dimension
   */
  getDimension(): number | null {
    return this.dimension;
  }
}
