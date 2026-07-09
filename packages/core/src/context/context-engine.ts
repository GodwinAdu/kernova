/**
 * Nexus Context Engine
 * 
 * Decision #67: Context is Computed.
 * We never store one giant context. Instead we calculate it.
 * 
 * User + Intent + Permissions + Knowledge + Memory + Policies = Context
 * 
 * This keeps prompts smaller, improves relevance, and respects permissions.
 */

import type {
  ComputedContext,
  MemoryEntry,
  NexusId,
} from '@nexus/types';
import { MemoryEngine } from '../memory/memory-engine.js';
import { now } from '../utils.js';

export interface ContextRequest {
  intentId: NexusId;
  ownerId: NexusId;
  goal: string;
  sessionId?: NexusId;
}

export class ContextEngine {
  private memory: MemoryEngine;

  constructor(memory: MemoryEngine) {
    this.memory = memory;
  }

  /**
   * Compute context for a specific intent
   * This assembles the right information from all memory layers
   */
  async compute(request: ContextRequest): Promise<ComputedContext> {
    // Pull relevant memories from each layer
    const workingMemory = await this.memory.query({
      layers: ['working'],
      ownerId: request.ownerId,
      limit: 10,
    });

    const sessionMemory = await this.memory.query({
      layers: ['session'],
      ownerId: request.ownerId,
      limit: 20,
    });

    const relevantLongTerm = await this.memory.query({
      layers: ['longterm'],
      query: request.goal,
      ownerId: request.ownerId,
      limit: 10,
    });

    const orgKnowledge = await this.memory.query({
      layers: ['organizational'],
      query: request.goal,
      limit: 5,
    });

    // Combine memories (priority: working > session > long-term > org)
    const allMemories = [
      ...workingMemory,
      ...sessionMemory,
      ...relevantLongTerm,
      ...orgKnowledge,
    ];

    // Estimate token usage (rough: ~4 chars per token)
    const estimatedTokens = allMemories.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );

    const context: ComputedContext = {
      intentId: request.intentId,
      memories: allMemories,
      user: {
        userId: request.ownerId,
        role: 'user', // In production: resolve from identity system
        preferences: {},
      },
      permissions: ['*'], // In production: resolve from identity system
      policies: [], // In production: resolve from governance system
      knowledge: relevantLongTerm,
      estimatedTokens,
      computedAt: now(),
    };

    return context;
  }
}
