/**
 * SQLite Cache Layer for OpenCode
 *
 * Provides instant startup by caching session metadata, messages, and config
 * in a local SQLite database. Uses WAL mode for performance and durability.
 *
 * Pattern:
 * - Load from cache first (instant)
 * - Sync with filesystem storage in background
 * - Subscribe to bus events for cache invalidation
 */

import { Database } from "bun:sqlite"
import { Global } from "@/global"
import path from "path"

export namespace Cache {
  let db: Database | null = null

  const SCHEMA = `
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      projectID TEXT NOT NULL,
      parentID TEXT,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      version TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      archived_at INTEGER,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      share_url TEXT,
      worktree_path TEXT,
      worktree_branch TEXT,
      data TEXT
    );

    -- Messages table (metadata only, not full content)
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionID TEXT NOT NULL,
      parentID TEXT,
      role TEXT NOT NULL,
      agent TEXT,
      summary_title TEXT,
      summary_body TEXT,
      providerID TEXT,
      modelID TEXT,
      cost REAL DEFAULT 0,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_reasoning INTEGER DEFAULT 0,
      created_at INTEGER,
      completed_at INTEGER,
      error_name TEXT,
      error_message TEXT
    );

    -- Config cache
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT,
      loaded_at INTEGER
    );

    -- Sync metadata for background reconciliation
    CREATE TABLE IF NOT EXISTS sync_meta (
      entity_type TEXT,
      entity_id TEXT,
      file_mtime INTEGER,
      synced_at INTEGER,
      PRIMARY KEY (entity_type, entity_id)
    );

    -- Indices for common queries
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(projectID);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parentID);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionID);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
  `

  /**
   * Initialize the cache database
   * Creates tables if they don't exist
   */
  export function init(): Database {
    if (db) return db

    const cachePath = path.join(Global.Path.data, "cache.db")
    db = new Database(cachePath, { create: true })

    // Enable WAL mode for better concurrent access
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA cache_size = -64000") // 64MB cache
    db.run("PRAGMA temp_store = MEMORY")

    // Create schema
    db.run(SCHEMA)

    return db
  }

  /**
   * Get the database instance, initializing if needed
   */
  export function get(): Database {
    if (!db) return init()
    return db
  }

  /**
   * Close the database connection
   */
  export function close() {
    if (db) {
      db.close()
      db = null
    }
  }

  // ============ Session Operations ============

  export interface SessionRow {
    id: string
    projectID: string
    parentID: string | null
    title: string
    directory: string
    version: string | null
    created_at: number | null
    updated_at: number | null
    archived_at: number | null
    additions: number
    deletions: number
    files_changed: number
    share_url: string | null
    worktree_path: string | null
    worktree_branch: string | null
    data: string | null
  }

  export namespace Session {
    /**
     * Get all sessions for a project
     */
    export function list(projectID: string): SessionRow[] {
      const db = get()
      return db
        .query<SessionRow, [string]>(`SELECT * FROM sessions WHERE projectID = ? ORDER BY updated_at DESC`)
        .all(projectID)
    }

    /**
     * Get a single session by ID
     */
    export function read(id: string): SessionRow | null {
      const db = get()
      return db.query<SessionRow, [string]>(`SELECT * FROM sessions WHERE id = ?`).get(id)
    }

    /**
     * Insert or update a session
     */
    export function upsert(session: {
      id: string
      projectID: string
      parentID?: string
      title: string
      directory: string
      version?: string
      time?: { created?: number; updated?: number; archived?: number }
      summary?: { additions?: number; deletions?: number; files?: number }
      share?: { url?: string }
      worktree?: { path?: string; branch?: string }
      data?: object
    }) {
      const db = get()
      db.run(
        `INSERT OR REPLACE INTO sessions
         (id, projectID, parentID, title, directory, version,
          created_at, updated_at, archived_at,
          additions, deletions, files_changed,
          share_url, worktree_path, worktree_branch, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.projectID,
          session.parentID ?? null,
          session.title,
          session.directory,
          session.version ?? null,
          session.time?.created ?? null,
          session.time?.updated ?? null,
          session.time?.archived ?? null,
          session.summary?.additions ?? 0,
          session.summary?.deletions ?? 0,
          session.summary?.files ?? 0,
          session.share?.url ?? null,
          session.worktree?.path ?? null,
          session.worktree?.branch ?? null,
          session.data ? JSON.stringify(session.data) : null,
        ],
      )
    }

    /**
     * Delete a session
     */
    export function remove(id: string) {
      const db = get()
      const deleteSession = db.transaction(() => {
        db.run(`DELETE FROM sessions WHERE id = ?`, [id])
        db.run(`DELETE FROM messages WHERE sessionID = ?`, [id])
      })
      deleteSession()
    }

    /**
     * Update session timestamp
     */
    export function touch(id: string) {
      const db = get()
      db.run(`UPDATE sessions SET updated_at = ? WHERE id = ?`, [Date.now(), id])
    }

    /**
     * Count sessions for a project
     */
    export function count(projectID: string): number {
      const db = get()
      const result = db
        .query<{ count: number }, [string]>(`SELECT COUNT(*) as count FROM sessions WHERE projectID = ?`)
        .get(projectID)
      return result?.count ?? 0
    }

    /**
     * Get child sessions by parentID
     */
    export function children(parentID: string): SessionRow[] {
      const db = get()
      return db
        .query<SessionRow, [string]>(`SELECT * FROM sessions WHERE parentID = ? ORDER BY updated_at DESC`)
        .all(parentID)
    }

    /**
     * Delete multiple sessions and their messages in a single transaction
     * Used for cascading deletes to ensure atomicity
     */
    export function removeMany(sessionIDs: string[]) {
      if (sessionIDs.length === 0) return
      const db = get()
      const deleteAll = db.transaction(() => {
        for (const id of sessionIDs) {
          db.run(`DELETE FROM messages WHERE sessionID = ?`, [id])
          db.run(`DELETE FROM sessions WHERE id = ?`, [id])
        }
      })
      deleteAll()
    }
  }

  // ============ Message Operations ============

  export namespace Message {
    interface MessageRow {
      id: string
      sessionID: string
      parentID: string | null
      role: string
      agent: string | null
      summary_title: string | null
      summary_body: string | null
      providerID: string | null
      modelID: string | null
      cost: number
      tokens_input: number
      tokens_output: number
      tokens_reasoning: number
      created_at: number | null
      completed_at: number | null
      error_name: string | null
      error_message: string | null
    }

    /**
     * Get all messages for a session
     */
    export function list(sessionID: string): MessageRow[] {
      const db = get()
      return db
        .query<MessageRow, [string]>(`SELECT * FROM messages WHERE sessionID = ? ORDER BY created_at ASC`)
        .all(sessionID)
    }

    /**
     * Get a single message by ID
     */
    export function read(id: string): MessageRow | null {
      const db = get()
      return db.query<MessageRow, [string]>(`SELECT * FROM messages WHERE id = ?`).get(id)
    }

    /**
     * Insert or update a message
     */
    export function upsert(message: {
      id: string
      sessionID: string
      parentID?: string
      role: "user" | "assistant"
      agent?: string
      summary?: { title?: string; body?: string }
      model?: { providerID?: string; modelID?: string }
      cost?: number
      tokens?: { input?: number; output?: number; reasoning?: number }
      time?: { created?: number; completed?: number }
      error?: { name?: string; message?: string }
    }) {
      const db = get()
      db.run(
        `INSERT OR REPLACE INTO messages
         (id, sessionID, parentID, role, agent,
          summary_title, summary_body,
          providerID, modelID, cost,
          tokens_input, tokens_output, tokens_reasoning,
          created_at, completed_at,
          error_name, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.sessionID,
          message.parentID ?? null,
          message.role,
          message.agent ?? null,
          message.summary?.title ?? null,
          message.summary?.body ?? null,
          message.model?.providerID ?? null,
          message.model?.modelID ?? null,
          message.cost ?? 0,
          message.tokens?.input ?? 0,
          message.tokens?.output ?? 0,
          message.tokens?.reasoning ?? 0,
          message.time?.created ?? null,
          message.time?.completed ?? null,
          message.error?.name ?? null,
          message.error?.message ?? null,
        ],
      )
    }

    /**
     * Delete a message
     */
    export function remove(id: string) {
      const db = get()
      db.run(`DELETE FROM messages WHERE id = ?`, [id])
    }

    /**
     * Count messages for a session
     */
    export function count(sessionID: string): number {
      const db = get()
      const result = db
        .query<{ count: number }, [string]>(`SELECT COUNT(*) as count FROM messages WHERE sessionID = ?`)
        .get(sessionID)
      return result?.count ?? 0
    }
  }

  // ============ Config Operations ============

  export namespace Config {
    /**
     * Get cached config value
     */
    export function read(key: string): string | null {
      const db = get()
      const result = db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)
      return result?.value ?? null
    }

    /**
     * Set config value
     */
    export function write(key: string, value: object) {
      const db = get()
      db.run(`INSERT OR REPLACE INTO config (key, value, loaded_at) VALUES (?, ?, ?)`, [
        key,
        JSON.stringify(value),
        Date.now(),
      ])
    }

    /**
     * Get when config was last loaded
     */
    export function loadedAt(key: string): number | null {
      const db = get()
      const result = db.query<{ loaded_at: number }, [string]>(`SELECT loaded_at FROM config WHERE key = ?`).get(key)
      return result?.loaded_at ?? null
    }

    /**
     * Clear all config cache
     */
    export function clear() {
      const db = get()
      db.run(`DELETE FROM config`)
    }
  }

  // ============ Sync Metadata ============

  export namespace Sync {
    /**
     * Record sync metadata for an entity
     */
    export function mark(entityType: string, entityId: string, fileMtime: number) {
      const db = get()
      db.run(
        `INSERT OR REPLACE INTO sync_meta (entity_type, entity_id, file_mtime, synced_at)
         VALUES (?, ?, ?, ?)`,
        [entityType, entityId, fileMtime, Date.now()],
      )
    }

    /**
     * Get last sync time for an entity
     */
    export function lastSync(entityType: string, entityId: string): number | null {
      const db = get()
      const result = db
        .query<
          { synced_at: number },
          [string, string]
        >(`SELECT synced_at FROM sync_meta WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId)
      return result?.synced_at ?? null
    }

    /**
     * Check if entity needs sync (file is newer than cache)
     */
    export function needsSync(entityType: string, entityId: string, fileMtime: number): boolean {
      const db = get()
      const result = db
        .query<
          { file_mtime: number },
          [string, string]
        >(`SELECT file_mtime FROM sync_meta WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId)
      if (!result) return true
      return fileMtime > result.file_mtime
    }
  }

  // ============ Utility ============

  /**
   * Clear all cached data
   */
  export function clear() {
    const db = get()
    const clearAll = db.transaction(() => {
      db.run(`DELETE FROM sessions`)
      db.run(`DELETE FROM messages`)
      db.run(`DELETE FROM config`)
      db.run(`DELETE FROM sync_meta`)
    })
    clearAll()
  }

  /**
   * Get cache statistics
   */
  export function stats() {
    const db = get()
    const sessions = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM sessions`).get()
    const messages = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM messages`).get()
    const config = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM config`).get()

    return {
      sessions: sessions?.count ?? 0,
      messages: messages?.count ?? 0,
      config: config?.count ?? 0,
    }
  }
}
