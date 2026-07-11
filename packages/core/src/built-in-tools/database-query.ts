/**
 * Built-in Tool: database-query
 *
 * Executes read-only SQL queries against a SQLite database using better-sqlite3.
 * Security: Only SELECT statements are allowed. INSERT, UPDATE, DELETE, DROP,
 * ALTER, CREATE, and other write operations are rejected.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

/** SQL statements that modify data — all rejected */
const WRITE_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'REPLACE',
  'TRUNCATE',
  'MERGE',
  'GRANT',
  'REVOKE',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'PRAGMA',
];

/**
 * Checks if a SQL query is read-only (SELECT only).
 * Strips comments and checks the first meaningful keyword.
 */
function isReadOnly(query: string): boolean {
  // Remove SQL comments
  const cleaned = query
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // Get the first keyword
  const firstWord = cleaned.split(/\s+/)[0]?.toUpperCase();

  if (!firstWord) return false;

  // Only allow SELECT and WITH (for CTEs that resolve to SELECT)
  if (firstWord !== 'SELECT' && firstWord !== 'WITH' && firstWord !== 'EXPLAIN') {
    return false;
  }

  // Additional check: scan for write keywords after WITH/EXPLAIN
  const upperQuery = cleaned.toUpperCase();
  for (const keyword of WRITE_KEYWORDS) {
    // Check if any write keyword appears as a standalone word (not inside quotes)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperQuery) && firstWord === 'WITH') {
      // WITH ... INSERT/UPDATE/DELETE is a write operation
      // WITH ... SELECT is fine — check if there's actually a write keyword after AS(...)
      // Simplified: reject if any write keyword found after the last closing paren of CTE
      const lastCteEnd = upperQuery.lastIndexOf(')');
      const afterCte = upperQuery.slice(lastCteEnd + 1).trim();
      const afterFirst = afterCte.split(/\s+/)[0];
      if (afterFirst && WRITE_KEYWORDS.includes(afterFirst)) {
        return false;
      }
    }
  }

  return true;
}

export function createDatabaseQueryTool(dbPath: string): ToolDefinition {
  return {
    id: 'database-query',
    name: 'Database Query',
    description:
      'Execute read-only SQL queries (SELECT only) against a SQLite database. Returns rows, column names, and row count.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute (SELECT statements only)',
        },
        params: {
          type: 'array',
          items: { type: ['string', 'number', 'boolean', 'null'] },
          description: 'Parameterized query values (for ? placeholders)',
        },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const query = params.query as string;
      const queryParams = (params.params as unknown[]) || [];

      if (!query || query.trim().length === 0) {
        return {
          error: true,
          message: 'Query cannot be empty',
        };
      }

      // Security: reject write operations
      if (!isReadOnly(query)) {
        return {
          error: true,
          message:
            'Only SELECT queries are allowed. Write operations (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE) are not permitted.',
        };
      }

      try {
        // Dynamic import of better-sqlite3 (CommonJS module)
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath, { readonly: true });

        try {
          const stmt = db.prepare(query);
          const rows = stmt.all(...queryParams) as Record<string, unknown>[];

          // Extract column names from the first row (or from statement)
          const columns = rows.length > 0
            ? Object.keys(rows[0])
            : (stmt.columns?.() || []).map((col: { name: string }) => col.name);

          return {
            rows,
            rowCount: rows.length,
            columns,
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return {
          error: true,
          message: `SQL error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
