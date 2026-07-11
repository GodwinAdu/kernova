/**
 * Built-in Tool: web-search
 *
 * Web search with configurable provider using stub/adapter pattern.
 * Ships with a default stub provider that returns no results with a
 * "No search provider configured" message.
 *
 * Developers can supply a custom WebSearchProvider via the factory function:
 *   createWebSearchTool(myProvider)
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * A single search result returned by a WebSearchProvider.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Adapter interface for pluggable web search backends.
 *
 * Implement this interface to connect any search API (Google, Bing, Brave, etc.)
 * and pass it to `createWebSearchTool(provider)`.
 */
export interface WebSearchProvider {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Default stub provider
// ---------------------------------------------------------------------------

/**
 * Default stub provider that returns an empty result set.
 * Allows agents to attempt searches without crashing — they simply get a
 * "no provider" message in the response.
 */
export class StubSearchProvider implements WebSearchProvider {
  async search(_query: string, _maxResults: number): Promise<SearchResult[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Creates a `web-search` ToolDefinition with the given search provider.
 * If no provider is supplied, uses the default StubSearchProvider which
 * returns empty results with a "No search provider configured" message.
 */
export function createWebSearchTool(provider?: WebSearchProvider): ToolDefinition {
  const searchProvider: WebSearchProvider = provider ?? new StubSearchProvider();

  return {
    id: 'web-search',
    name: 'Web Search',
    description: 'Perform web searches using a configurable search provider.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const query = params.query as string;
      const maxResults = (params.maxResults as number) ?? 5;

      try {
        const results = await searchProvider.search(query, maxResults);

        // When using the stub provider the results array is empty.
        // Signal to the agent that no real search was performed.
        if (results.length === 0 && searchProvider instanceof StubSearchProvider) {
          return {
            query,
            results: [],
            resultCount: 0,
            message: 'No search provider configured',
          };
        }

        return {
          query,
          results,
          resultCount: results.length,
        };
      } catch (error) {
        return {
          error: true,
          query,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
