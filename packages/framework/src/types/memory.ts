/**
 * Memory schema definition types.
 */

export type MemoryFieldType = 'text' | 'embedding' | 'json' | 'number' | 'boolean' | 'date';

export interface MemoryField {
  type: MemoryFieldType;
  description?: string;
  indexed?: boolean;
  required?: boolean;
}

export type MemorySchema = Record<string, MemoryField>;

export interface MemoryDefinition {
  /** Memory namespace name */
  name: string;
  /** Schema for structured memory entries */
  schema: MemorySchema;
  /** Time-to-live for entries */
  ttl?: string;
  /** Maximum entries to keep */
  maxEntries?: number;
  /** Whether to auto-summarize old entries */
  autoSummarize?: boolean;
  /** Embedding model for vector search */
  embeddingModel?: string;
}
