/**
 * @nexus/sdk
 * 
 * High-level SDK for building intelligent applications with Nexus.
 * 
 * This package provides a simplified, opinionated API on top of @nexus/core.
 * It's what most developers will use day-to-day.
 * 
 * Quick start:
 *   import { Nexus } from '@nexus/sdk';
 *   
 *   const app = await Nexus.create();
 *   app.agent('assistant', { instructions: 'You are helpful.' });
 *   app.tool('search', { ... });
 *   const answer = await app.ask('What is the weather in London?');
 */

export { Nexus } from './nexus.js';
export type { NexusConfig, AskOptions, AskResult } from './nexus.js';
export { agent } from './helpers/agent.js';
export { tool } from './helpers/tool.js';
export { workflow } from './helpers/workflow.js';

// Re-export commonly used types
export type {
  Intent,
  IntentResult,
  MemoryLayer,
  MemoryEntry,
  AgentDefinition,
  NexusEvent,
} from '@nexus/types';
