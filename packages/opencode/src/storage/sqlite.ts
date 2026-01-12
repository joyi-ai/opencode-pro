import { Database } from "bun:sqlite"
import path from "path"
import { Global } from "../global"
import { lazy } from "../util/lazy"

export namespace StorageSqlite {
  export type SessionRecord = {
    id: string
    projectID: string
    parentID?: string
    time?: { created?: number; updated?: number }
  } & Record<string, unknown>

  export type MessageRecord = {
    info: {
      id: string
      sessionID: string
      time?: { created?: number }
    }
  } & Record<string, unknown>

  export type PartRecord = {
    id: string
  } & Record<string, unknown>

  export type MessageListInput = {
    sessionID: string
    limit?: number
    afterID?: string
  }

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      projectID TEXT NOT NULL,
      parentID TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project_updated ON sessions(projectID, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parentID);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionID TEXT NOT NULL,
      created_at INTEGER,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(sessionID, id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(sessionID, created_at);

    CREATE TABLE IF NOT EXISTS message_parts (
      sessionID TEXT NOT NULL,
      messageID TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (sessionID, messageID, id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(sessionID, messageID, id);

    CREATE TABLE IF NOT EXISTS session_diff (
      sessionID TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `

  const state = lazy(() => {
    const file = path.join(Global.Path.data, "storage-v2.db")
    const db = new Database(file, { create: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA temp_store = MEMORY")
    db.run(SCHEMA)
    return db
  })

  function db() {
    return state()
  }

  export function metaGet(key: string) {
    const row = db().query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)
    if (!row) return
    return row.value
  }

  export function metaSet(key: string, value: string) {
    db().run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value])
  }

  export function readSession(id: string) {
    const row = db().query<{ data: string }, [string]>("SELECT data FROM sessions WHERE id = ?").get(id)
    if (!row) return
    return JSON.parse(row.data)
  }

  export function writeSession(input: SessionRecord) {
    const created = input.time?.created ?? null
    const updated = input.time?.updated ?? null
    db().run(
      "INSERT OR REPLACE INTO sessions (id, projectID, parentID, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)",
      [input.id, input.projectID, input.parentID ?? null, created, updated, JSON.stringify(input)],
    )
  }

  export function listSessions(projectID: string) {
    const rows = db()
      .query<{ id: string }, [string]>("SELECT id FROM sessions WHERE projectID = ? ORDER BY id ASC")
      .all(projectID)
    return rows.map((row) => row.id)
  }

  export function removeSession(id: string) {
    db().run("DELETE FROM sessions WHERE id = ?", [id])
  }

  export function readMessage(sessionID: string, messageID: string) {
    const row = db()
      .query<{ data: string }, [string, string]>("SELECT data FROM messages WHERE sessionID = ? AND id = ?")
      .get(sessionID, messageID)
    if (!row) return
    return JSON.parse(row.data)
  }

  export function writeMessage(input: MessageRecord) {
    const info = input.info
    if (!info) return
    const created = info.time?.created ?? null
    db().run("INSERT OR REPLACE INTO messages (id, sessionID, created_at, data) VALUES (?, ?, ?, ?)", [
      info.id,
      info.sessionID,
      created,
      JSON.stringify({ info }),
    ])
  }

  export function listMessages(sessionID: string) {
    const rows = db()
      .query<{ id: string }, [string]>("SELECT id FROM messages WHERE sessionID = ? ORDER BY id ASC")
      .all(sessionID)
    return rows.map((row) => row.id)
  }

  export function readParts(sessionID: string, messageID: string) {
    const rows = db()
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM message_parts WHERE sessionID = ? AND messageID = ? ORDER BY id ASC",
      )
      .all(sessionID, messageID)
    return rows.map((row) => JSON.parse(row.data))
  }

  export function writeParts(sessionID: string, messageID: string, parts: PartRecord[]) {
    if (parts.length === 0) return
    const tx = db().transaction((rows: PartRecord[]) => {
      for (const part of rows) {
        db().run("INSERT OR REPLACE INTO message_parts (sessionID, messageID, id, data) VALUES (?, ?, ?, ?)", [
          sessionID,
          messageID,
          part.id,
          JSON.stringify(part),
        ])
      }
    })
    tx(parts)
  }

  export function removeParts(sessionID: string, messageID: string, partIDs: string[]) {
    if (partIDs.length === 0) return
    const tx = db().transaction((ids: string[]) => {
      for (const id of ids) {
        db().run("DELETE FROM message_parts WHERE sessionID = ? AND messageID = ? AND id = ?", [
          sessionID,
          messageID,
          id,
        ])
      }
    })
    tx(partIDs)
  }

  export function removeMessageParts(sessionID: string, messageID: string) {
    db().run("DELETE FROM message_parts WHERE sessionID = ? AND messageID = ?", [sessionID, messageID])
  }

  export function listMessagesPage(input: MessageListInput) {
    const limit = input.limit
    const afterID = input.afterID
    if (afterID && limit !== undefined) {
      const rows = db()
        .query<
          { id: string },
          [string, string, number]
        >("SELECT id FROM messages WHERE sessionID = ? AND id < ? ORDER BY id DESC LIMIT ?")
        .all(input.sessionID, afterID, limit)
      return rows.map((row) => row.id)
    }
    if (afterID) {
      const rows = db()
        .query<
          { id: string },
          [string, string]
        >("SELECT id FROM messages WHERE sessionID = ? AND id < ? ORDER BY id DESC")
        .all(input.sessionID, afterID)
      return rows.map((row) => row.id)
    }
    if (limit !== undefined) {
      const rows = db()
        .query<{ id: string }, [string, number]>("SELECT id FROM messages WHERE sessionID = ? ORDER BY id DESC LIMIT ?")
        .all(input.sessionID, limit)
      return rows.map((row) => row.id)
    }
    const rows = db()
      .query<{ id: string }, [string]>("SELECT id FROM messages WHERE sessionID = ? ORDER BY id DESC")
      .all(input.sessionID)
    return rows.map((row) => row.id)
  }

  export function removeMessage(sessionID: string, messageID: string) {
    db().run("DELETE FROM messages WHERE sessionID = ? AND id = ?", [sessionID, messageID])
    removeMessageParts(sessionID, messageID)
  }

  export function removeMessages(sessionID: string) {
    db().run("DELETE FROM messages WHERE sessionID = ?", [sessionID])
    db().run("DELETE FROM message_parts WHERE sessionID = ?", [sessionID])
  }

  export function countMessages(sessionID: string) {
    const row = db()
      .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM messages WHERE sessionID = ?")
      .get(sessionID)
    return row?.count ?? 0
  }

  export function readDiff(sessionID: string) {
    const row = db()
      .query<{ data: string }, [string]>("SELECT data FROM session_diff WHERE sessionID = ?")
      .get(sessionID)
    if (!row) return
    return JSON.parse(row.data)
  }

  export function writeDiff(sessionID: string, value: unknown) {
    db().run("INSERT OR REPLACE INTO session_diff (sessionID, data) VALUES (?, ?)", [sessionID, JSON.stringify(value)])
  }

  export function removeDiff(sessionID: string) {
    db().run("DELETE FROM session_diff WHERE sessionID = ?", [sessionID])
  }
}
