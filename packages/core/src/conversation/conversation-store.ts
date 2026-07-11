/**
 * Kernova Conversation Store (SQLite)
 *
 * Persistent storage for conversation threads and messages using SQLite.
 * Follows the SchedulerStore pattern: WAL mode, auto-migration, prepared statements.
 *
 * Tables:
 * - conversation_threads: thread metadata (id, summary, window_size, status)
 * - conversation_messages: messages within threads
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ConversationStoreConfig {
  dataDir: string;
}

export interface ThreadRow {
  id: string;
  summary: string | null;
  window_size: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  position: number;
  created_at: string;
}

export class ConversationStore {
  private db: Database.Database;

  // Prepared statements
  private createThreadStmt: Database.Statement;
  private getThreadStmt: Database.Statement;
  private updateThreadSummaryStmt: Database.Statement;
  private archiveThreadStmt: Database.Statement;
  private listThreadsStmt: Database.Statement;
  private addMessageStmt: Database.Statement;
  private getMessagesStmt: Database.Statement;
  private getMessageCountStmt: Database.Statement;
  private deleteOldMessagesStmt: Database.Statement;

  constructor(config: ConversationStoreConfig) {
    const dbPath = join(config.dataDir, 'kernova.db');

    // Ensure directory exists
    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
    }

    // Open database
    this.db = new Database(dbPath);

    // Configure for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');

    // Create schema
    this.migrate();

    // Prepare statements
    this.createThreadStmt = this.db.prepare(`
      INSERT OR IGNORE INTO conversation_threads (id, summary, window_size, status, created_at, updated_at)
      VALUES (@id, @summary, @window_size, @status, @created_at, @updated_at)
    `);

    this.getThreadStmt = this.db.prepare(
      'SELECT * FROM conversation_threads WHERE id = ?'
    );

    this.updateThreadSummaryStmt = this.db.prepare(`
      UPDATE conversation_threads SET summary = @summary, updated_at = @updated_at WHERE id = @id
    `);

    this.archiveThreadStmt = this.db.prepare(`
      UPDATE conversation_threads SET status = 'archived', updated_at = @updated_at WHERE id = @id
    `);

    this.listThreadsStmt = this.db.prepare(
      "SELECT * FROM conversation_threads WHERE status = 'active' ORDER BY updated_at DESC"
    );

    this.addMessageStmt = this.db.prepare(`
      INSERT INTO conversation_messages (id, thread_id, role, content, position, created_at)
      VALUES (@id, @thread_id, @role, @content, @position, @created_at)
    `);

    this.getMessagesStmt = this.db.prepare(
      'SELECT * FROM conversation_messages WHERE thread_id = ? ORDER BY position ASC'
    );

    this.getMessageCountStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM conversation_messages WHERE thread_id = ?'
    );

    this.deleteOldMessagesStmt = this.db.prepare(`
      DELETE FROM conversation_messages
      WHERE thread_id = ? AND position < ?
    `);
  }

  /**
   * Create a new thread. If thread already exists, do nothing.
   */
  createThread(id: string, windowSize: number): void {
    const now = new Date().toISOString();
    this.createThreadStmt.run({
      id,
      summary: null,
      window_size: windowSize,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * Get thread metadata by ID.
   */
  getThread(id: string): ThreadRow | undefined {
    return this.getThreadStmt.get(id) as ThreadRow | undefined;
  }

  /**
   * Update thread summary text.
   */
  updateSummary(id: string, summary: string): void {
    this.updateThreadSummaryStmt.run({
      id,
      summary,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Archive a thread (set status to 'archived').
   */
  archiveThread(id: string): void {
    this.archiveThreadStmt.run({ id, updated_at: new Date().toISOString() });
  }

  /**
   * List all active threads.
   */
  listActiveThreads(): ThreadRow[] {
    return this.listThreadsStmt.all() as ThreadRow[];
  }

  /**
   * Add a message to a thread.
   */
  addMessage(msg: MessageRow): void {
    this.addMessageStmt.run({
      id: msg.id,
      thread_id: msg.thread_id,
      role: msg.role,
      content: msg.content,
      position: msg.position,
      created_at: msg.created_at,
    });
  }

  /**
   * Get all messages for a thread, ordered by position.
   */
  getMessages(threadId: string): MessageRow[] {
    return this.getMessagesStmt.all(threadId) as MessageRow[];
  }

  /**
   * Get message count for a thread.
   */
  getMessageCount(threadId: string): number {
    const row = this.getMessageCountStmt.get(threadId) as { count: number };
    return row.count;
  }

  /**
   * Delete messages with position < cutoff (used after summarization).
   */
  deleteOldMessages(threadId: string, positionCutoff: number): void {
    this.deleteOldMessagesStmt.run(threadId, positionCutoff);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Create the database schema.
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        summary TEXT,
        window_size INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
        ON conversation_messages(thread_id, position);
      CREATE INDEX IF NOT EXISTS idx_conversation_threads_status
        ON conversation_threads(status);
    `);
  }
}
