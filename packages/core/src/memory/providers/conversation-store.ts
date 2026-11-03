/**
 * Conversation Store — Persistent thread & message storage.
 *
 * Stores conversations in PostgreSQL (production) or SQLite (dev).
 * Handles pagination, context window management, and thread lifecycle.
 *
 * Schema:
 *   threads: id, title, agent_name, message_count, created_at, updated_at
 *   messages: id, thread_id, role, content, metadata, created_at
 */

export interface Thread {
  id: string;
  title: string;
  agentName: string;
  messageCount: number;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationStoreConfig {
  provider: 'postgres' | 'sqlite';
  url?: string; // PostgreSQL connection URL
  path?: string; // SQLite file path
}

export interface ConversationStore {
  initialize(): Promise<void>;
  createThread(id: string, title: string, agentName?: string): Promise<Thread>;
  getThread(id: string): Promise<Thread | null>;
  listThreads(limit?: number): Promise<Thread[]>;
  deleteThread(id: string): Promise<void>;
  addMessage(threadId: string, role: string, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage>;
  getMessages(threadId: string, limit?: number, before?: string): Promise<ChatMessage[]>;
  getMessageCount(threadId: string): Promise<number>;
  close(): Promise<void>;
}

/**
 * PostgreSQL Conversation Store
 */
export class PostgresConversationStore implements ConversationStore {
  private pool: any = null;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async initialize(): Promise<void> {
    let pg: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      pg = require('pg');
    } catch {
      try {
        // @ts-ignore
        pg = await import('pg');
      } catch {
        throw new Error('PostgreSQL conversation store requires "pg" package. Install: npm install pg');
      }
    }

    const Pool = pg.default?.Pool || pg.Pool;
    this.pool = new Pool({ connectionString: this.url });

    // IMPORTANT: Execute each DDL statement separately for Neon compatibility
    // Step 1: Create threads table
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New Chat',
          agent_name TEXT NOT NULL DEFAULT 'assistant',
          message_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.error('[ConversationStore] chat_threads creation failed:', err.message);
      }
    }

    // Step 2: Create messages table
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.error('[ConversationStore] chat_messages creation failed:', err.message);
      }
    }

    // Step 3: Create indexes (each separate)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC)`,
    ];

    for (const indexSql of indexes) {
      try {
        await this.pool.query(indexSql);
      } catch {
        // Index might already exist — non-critical
      }
    }

    console.log('[ConversationStore] ✓ PostgreSQL tables ready');
  }

  async createThread(id: string, title: string, agentName?: string): Promise<Thread> {
    const { rows } = await this.pool.query(
      `INSERT INTO chat_threads (id, title, agent_name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = $2, updated_at = NOW()
       RETURNING *`,
      [id, title, agentName || 'assistant']
    );
    return this.rowToThread(rows[0]);
  }

  async getThread(id: string): Promise<Thread | null> {
    const { rows } = await this.pool.query('SELECT * FROM chat_threads WHERE id = $1', [id]);
    return rows[0] ? this.rowToThread(rows[0]) : null;
  }

  async listThreads(limit = 50): Promise<Thread[]> {
    const { rows } = await this.pool.query(
      `SELECT t.*, (SELECT content FROM chat_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_msg
       FROM chat_threads t ORDER BY t.updated_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r: any) => ({ ...this.rowToThread(r), lastMessage: r.last_msg?.slice(0, 100) }));
  }

  async deleteThread(id: string): Promise<void> {
    await this.pool.query('DELETE FROM chat_threads WHERE id = $1', [id]);
  }

  async addMessage(threadId: string, role: string, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      // Auto-create thread if not exists
      await this.pool.query(
        `INSERT INTO chat_threads (id, title, agent_name) VALUES ($1, $2, 'assistant')
         ON CONFLICT (id) DO NOTHING`,
        [threadId, content.slice(0, 60)]
      );

      // Insert message
      const { rows } = await this.pool.query(
        `INSERT INTO chat_messages (id, thread_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, threadId, role, content, JSON.stringify(metadata || {})]
      );

      // Update thread
      await this.pool.query(
        `UPDATE chat_threads SET message_count = message_count + 1, updated_at = NOW(),
         title = CASE WHEN message_count = 0 AND $2 = 'user' THEN $3 ELSE title END
         WHERE id = $1`,
        [threadId, role, content.slice(0, 60)]
      );

      return this.rowToMessage(rows[0]);
    } catch (err: any) {
      console.error(`[ConversationStore] ✗ addMessage failed:`, err.message);
      console.error(`[ConversationStore]   threadId: ${threadId}, role: ${role}, content length: ${content.length}`);
      // Return a placeholder so the flow doesn't break
      return { id, threadId, role: role as any, content, createdAt: new Date().toISOString() };
    }
  }

  async getMessages(threadId: string, limit = 50, before?: string): Promise<ChatMessage[]> {
    let sql = 'SELECT * FROM chat_messages WHERE thread_id = $1';
    const params: any[] = [threadId];

    if (before) {
      sql += ' AND created_at < $2';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const { rows } = await this.pool.query(sql, params);
    return rows.reverse().map((r: any) => this.rowToMessage(r));
  }

  async getMessageCount(threadId: string): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = $1', [threadId]);
    return parseInt(rows[0].c);
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.end(); this.pool = null; }
  }

  private rowToThread(row: any): Thread {
    return {
      id: row.id,
      title: row.title,
      agentName: row.agent_name,
      messageCount: row.message_count,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    };
  }

  private rowToMessage(row: any): ChatMessage {
    return {
      id: row.id,
      threadId: row.thread_id,
      role: row.role,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
    };
  }
}

/**
 * SQLite Conversation Store (for development)
 */
export class SqliteConversationStore implements ConversationStore {
  private db: any = null;
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async initialize(): Promise<void> {
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(this.path);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        agent_name TEXT NOT NULL DEFAULT 'assistant',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);
    `);
  }

  async createThread(id: string, title: string, agentName?: string): Promise<Thread> {
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT OR REPLACE INTO chat_threads (id, title, agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, title, agentName || 'assistant', now, now);
    return { id, title, agentName: agentName || 'assistant', messageCount: 0, createdAt: now, updatedAt: now };
  }

  async getThread(id: string): Promise<Thread | null> {
    const row = this.db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id);
    return row ? { id: row.id, title: row.title, agentName: row.agent_name, messageCount: row.message_count, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  async listThreads(limit = 50): Promise<Thread[]> {
    const rows = this.db.prepare('SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT ?').all(limit);
    return rows.map((r: any) => ({ id: r.id, title: r.title, agentName: r.agent_name, messageCount: r.message_count, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async deleteThread(id: string): Promise<void> {
    this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
  }

  async addMessage(threadId: string, role: string, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // Auto-create thread
    this.db.prepare(
      'INSERT OR IGNORE INTO chat_threads (id, title, agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(threadId, content.slice(0, 60), 'assistant', now, now);

    // Insert message
    this.db.prepare(
      'INSERT INTO chat_messages (id, thread_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, threadId, role, content, JSON.stringify(metadata || {}), now);

    // Update thread
    this.db.prepare(
      'UPDATE chat_threads SET message_count = message_count + 1, updated_at = ? WHERE id = ?'
    ).run(now, threadId);

    // Update title from first user message
    const count = this.db.prepare('SELECT message_count FROM chat_threads WHERE id = ?').get(threadId);
    if (count?.message_count === 1 && role === 'user') {
      this.db.prepare('UPDATE chat_threads SET title = ? WHERE id = ?').run(content.slice(0, 60), threadId);
    }

    return { id, threadId, role: role as any, content, metadata, createdAt: now };
  }

  async getMessages(threadId: string, limit = 50, before?: string): Promise<ChatMessage[]> {
    let sql = 'SELECT * FROM chat_messages WHERE thread_id = ?';
    const params: any[] = [threadId];

    if (before) {
      sql += ' AND created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.reverse().map((r: any) => ({
      id: r.id, threadId: r.thread_id, role: r.role, content: r.content,
      metadata: JSON.parse(r.metadata || '{}'), createdAt: r.created_at,
    }));
  }

  async getMessageCount(threadId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ?').get(threadId);
    return row?.c || 0;
  }

  async close(): Promise<void> {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

/**
 * Factory — create the right conversation store based on config.
 */
export async function createConversationStore(config: ConversationStoreConfig): Promise<ConversationStore> {
  let store: ConversationStore;

  if (config.provider === 'postgres' && config.url) {
    store = new PostgresConversationStore(config.url);
  } else {
    store = new SqliteConversationStore(config.path || './kernova-data/conversations.db');
  }

  await store.initialize();
  return store;
}
