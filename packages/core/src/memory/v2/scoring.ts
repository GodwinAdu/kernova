/**
 * Memory Retrieval Scoring Algorithm
 *
 * Combines four signals into a single relevance score:
 *   1. Similarity — How semantically close is this memory to the query?
 *   2. Recency — How recently was this memory created/updated?
 *   3. Frequency — How often has this memory been accessed?
 *   4. Relevance — Base importance score assigned at storage time
 *
 * Formula:
 *   score = (similarity × w1) + (recency × w2) + (frequency × w3) + (relevance × w4)
 *
 * Where:
 *   - recency uses exponential decay: e^(-t / halfLife)
 *   - frequency uses logarithmic scaling: min(log(1 + count) / log(1 + cap), 1)
 *   - similarity comes from the adapter (cosine distance or text match)
 *   - relevance is the stored entry.relevance value
 *
 * This ensures:
 *   - Very relevant but old memories still surface (high base relevance)
 *   - Frequently accessed memories get a boost (they're important)
 *   - Recent memories get priority when similarity is close
 *   - The system doesn't degrade with scale (scored at retrieval time)
 */

import type { MemoryEntry, MemoryResult, ScoringConfig } from './types.js';
import { DEFAULT_SCORING } from './types.js';

/**
 * Score a set of raw search results using the combined scoring algorithm.
 *
 * @param results - Raw results from adapter (with similarity scores)
 * @param config - Scoring weights and parameters
 * @returns Scored and sorted results
 */
export function scoreResults(
  results: Array<{ entry: MemoryEntry; similarity: number }>,
  config: ScoringConfig = DEFAULT_SCORING,
): MemoryResult[] {
  const now = Date.now();

  const scored = results.map(({ entry, similarity }) => {
    // 1. Similarity score (already 0-1 from adapter)
    const simScore = Math.max(0, Math.min(1, similarity));

    // 2. Recency score — exponential decay
    const createdAt = new Date(entry.updatedAt || entry.createdAt).getTime();
    const ageHours = (now - createdAt) / (1000 * 60 * 60);
    const recencyScore = Math.exp(-ageHours / config.recencyHalfLife);

    // 3. Frequency score — logarithmic scaling
    const accessCount = entry.accessCount || 0;
    const frequencyScore = Math.min(
      Math.log(1 + accessCount) / Math.log(1 + config.frequencyBoostCap * 100),
      1
    );

    // 4. Base relevance score (stored on the entry)
    const relevanceScore = entry.relevance || 0.5;

    // Combined weighted score
    const score =
      (simScore * config.similarityWeight) +
      (recencyScore * config.recencyWeight) +
      (frequencyScore * config.frequencyWeight) +
      (relevanceScore * config.relevanceWeight);

    return {
      entry,
      score: Math.max(0, Math.min(1, score)),
      scoreBreakdown: {
        similarity: simScore,
        recency: recencyScore,
        frequency: frequencyScore,
        relevance: relevanceScore,
      },
    };
  });

  // Sort by combined score (highest first)
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Compute recency score for a timestamp.
 * Returns 1.0 for "just now", decays toward 0 over time.
 *
 * @param timestamp - ISO timestamp string
 * @param halfLifeHours - Hours until score = 0.5 (default: 168 = 1 week)
 */
export function recencyScore(timestamp: string, halfLifeHours: number = 168): number {
  const ageHours = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
  return Math.exp(-ageHours / halfLifeHours);
}

/**
 * Compute frequency score for an access count.
 * Uses logarithmic scaling so diminishing returns kick in.
 *
 * @param accessCount - Number of times accessed
 * @param cap - Maximum meaningful count (default: 50)
 */
export function frequencyScore(accessCount: number, cap: number = 50): number {
  return Math.min(Math.log(1 + accessCount) / Math.log(1 + cap), 1);
}

/**
 * Normalize weights so they sum to 1.0.
 * Useful when developer provides partial weights.
 */
export function normalizeWeights(config: Partial<ScoringConfig>): ScoringConfig {
  const merged = { ...DEFAULT_SCORING, ...config };
  const total = merged.similarityWeight + merged.recencyWeight +
    merged.frequencyWeight + merged.relevanceWeight;

  if (total === 0) return DEFAULT_SCORING;

  return {
    ...merged,
    similarityWeight: merged.similarityWeight / total,
    recencyWeight: merged.recencyWeight / total,
    frequencyWeight: merged.frequencyWeight / total,
    relevanceWeight: merged.relevanceWeight / total,
  };
}
