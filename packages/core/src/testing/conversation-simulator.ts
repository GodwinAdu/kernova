/**
 * Kernova Conversation Simulator
 *
 * Simulates multi-turn conversations with an agent for testing.
 * Sends messages sequentially (with optional delays), collects
 * responses and tool calls, and reports the conversation transcript.
 */

import type {
  NexusId,
  TestMessage,
  Intent,
} from '@kernova/types';
import type { KernovaKernel } from '../kernel.js';
import { generateId, now, sleep } from '../utils.js';

export interface SimulationResult {
  id: NexusId;
  turns: SimulationTurn[];
  totalDurationMs: number;
  messageCount: number;
  success: boolean;
  error?: string;
}

export interface SimulationTurn {
  input: TestMessage;
  response?: string;
  intent?: Intent;
  durationMs: number;
  error?: string;
}

export class ConversationSimulator {
  private readonly kernel: KernovaKernel;

  constructor(kernel: KernovaKernel) {
    this.kernel = kernel;
  }

  /**
   * Simulate a multi-turn conversation.
   * Sends each message to the kernel and collects responses.
   */
  async simulate(messages: TestMessage[], options?: { timeout?: number }): Promise<SimulationResult> {
    const simulationId = generateId('sim');
    const timeout = options?.timeout ?? 60_000;
    const startTime = Date.now();
    const turns: SimulationTurn[] = [];
    let success = true;
    let error: string | undefined;

    for (const message of messages) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        success = false;
        error = 'Simulation timed out';
        break;
      }

      // Optional delay between messages
      if (message.delay && message.delay > 0) {
        await sleep(message.delay);
      }

      const turnStart = Date.now();

      try {
        if (message.role === 'system') {
          // System messages are context, not submitted as intents
          turns.push({
            input: message,
            response: '[system message — context only]',
            durationMs: 0,
          });
          continue;
        }

        // Submit as intent
        const intent = await this.kernel.submit({
          goal: message.content,
          intentType: 'query',
          priority: 'medium',
        });

        turns.push({
          input: message,
          response: intent.result?.summary ?? '',
          intent,
          durationMs: Date.now() - turnStart,
        });

        if (!intent.result?.success) {
          // Non-fatal: continue conversation even if one turn fails
        }
      } catch (err) {
        const turnError = err instanceof Error ? err.message : String(err);
        turns.push({
          input: message,
          error: turnError,
          durationMs: Date.now() - turnStart,
        });
        success = false;
        error = turnError;
        break;
      }
    }

    return {
      id: simulationId,
      turns,
      totalDurationMs: Date.now() - startTime,
      messageCount: messages.length,
      success,
      error,
    };
  }

  /**
   * Run a conversation scenario and return just the final response.
   * Useful for quick assertion checks.
   */
  async chat(messages: string[]): Promise<string[]> {
    const testMessages: TestMessage[] = messages.map(content => ({
      role: 'user' as const,
      content,
    }));

    const result = await this.simulate(testMessages);
    return result.turns
      .map(t => t.response ?? '')
      .filter(r => r.length > 0);
  }
}
