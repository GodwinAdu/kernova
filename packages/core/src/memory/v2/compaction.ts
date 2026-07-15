/**
 * Conversation Compaction — Auto-summarize long conversations.
 *
 * When a thread exceeds the configured threshold, older messages are
 * summarized into a compact representation. This:
 *   - Reduces token usage per request
 *   - Preserves important context without bloat
 *   - Extracts key facts into long-term memory
 *
 * Algorithm:
 *   1. Count messages in thread
 *   2. If count > threshold, take the oldest (count - keepRecent) messages
 *   3. Generate a summary via the LLM
 *   4. Extract key facts and store them as long-term memories
 *   5. Replace the compacted messages with the summary entry
 *   6. Keep the most recent N messages intact
 *
 * The developer can hook into this via `hooks.onCompaction` to:
 *   - Modify the summary
 *   - Extract additional structured data
 *   - Prevent compaction for certain threads
 */

import type { CompactionConfig, ConversationSummary, MemoryHooks } from './types.js';
import { DEFAULT_COMPACTION } from './types.js';

export interface CompactionContext {
  threadId: string;
  messages: Array<{ role: string; content: string; createdAt: string }>;
  config: CompactionConfig;
  hooks?: MemoryHooks;
  /** Function to call the LLM for summarization */
  summarize: (prompt: string) => Promise<string>;
}

/**
 * Check if a thread needs compaction.
 */
export function needsCompaction(messageCount: number, config: CompactionConfig = DEFAULT_COMPACTION): boolean {
  if (!config.enabled) return false;
  return messageCount > config.threshold;
}

/**
 * Perform compaction on a set of messages.
 * Returns the summary and extracted facts.
 */
export async function compact(ctx: CompactionContext): Promise<{
  summary: ConversationSummary;
  factsExtracted: Array<{ content: string; tags: string[] }>;
  messagesToRemove: number;
} | null> {
  const { threadId, messages, config, hooks, summarize } = ctx;

  if (!needsCompaction(messages.length, config)) {
    return null;
  }

  // Split: messages to compact vs messages to keep
  const compactCount = messages.length - config.keepRecent;
  if (compactCount <= 0) return null;

  const toCompact = messages.slice(0, compactCount);
  const conversationText = toCompact
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  // Generate summary via LLM
  const prompt = `Summarize this conversation concisely. Extract:
1. A brief summary (2-3 sentences max)
2. Key topics discussed
3. Important facts about the user (preferences, personal info, decisions made)

Conversation:
${conversationText.slice(0, 6000)}

Respond in this JSON format:
{
  "summary": "...",
  "topics": ["topic1", "topic2"],
  "keyFacts": ["User's name is X", "User prefers Y", "User works at Z"]
}`;

  try {
    const response = await summarize(prompt);

    // Parse the JSON response
    let parsed: { summary: string; topics: string[]; keyFacts: string[] };
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = { summary: response.slice(0, 500), topics: [], keyFacts: [] };
      }
    } catch {
      parsed = { summary: response.slice(0, 500), topics: [], keyFacts: [] };
    }

    const conversationSummary: ConversationSummary = {
      threadId,
      summary: parsed.summary,
      messagesCompacted: compactCount,
      topics: parsed.topics || [],
      keyFacts: parsed.keyFacts || [],
      createdAt: new Date().toISOString(),
    };

    // Let developer hook modify/reject
    if (hooks?.onCompaction) {
      const modified = await hooks.onCompaction(conversationSummary, toCompact);
      if (modified === null) return null; // Developer rejected compaction
      Object.assign(conversationSummary, modified);
    }

    // Extract facts as long-term memory entries
    const factsExtracted = (conversationSummary.keyFacts || []).map(fact => ({
      content: fact,
      tags: ['compaction', 'auto-extracted', ...conversationSummary.topics.slice(0, 3)],
    }));

    return {
      summary: conversationSummary,
      factsExtracted,
      messagesToRemove: compactCount,
    };
  } catch (err) {
    // Compaction failed — non-critical, try again later
    return null;
  }
}

/**
 * Format a summary for injection into the conversation context.
 * This replaces the compacted messages in the prompt.
 */
export function formatSummaryForPrompt(summary: ConversationSummary): string {
  let output = `[Previous conversation summary — ${summary.messagesCompacted} messages compacted]\n`;
  output += summary.summary;

  if (summary.keyFacts.length > 0) {
    output += '\n\nKey facts from earlier:\n';
    output += summary.keyFacts.map(f => `• ${f}`).join('\n');
  }

  return output;
}
