import type Database from "better-sqlite3";
import type { ConversationMessage } from "../types/index.js";

/**
 * Returns a stable session ID for the current day and project.
 * All `owl ask` calls on the same day share one session, giving
 * the assistant short-term memory across invocations.
 */
export function getOrCreateSessionId(projectSlug: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${projectSlug}-${date}`;
}

/**
 * Persist a single message to the local conversations table.
 */
export function saveMessage(
  db: Database.Database,
  sessionId: string,
  role: "user" | "assistant",
  content: string
): void {
  db.prepare(
    `INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)`
  ).run(sessionId, role, content);
}

/**
 * Load the most recent `limit` messages for a session, oldest first.
 */
export function getRecentHistory(
  db: Database.Database,
  sessionId: string,
  limit = 10
): ConversationMessage[] {
  const rows = db
    .prepare(
      `SELECT role, content, created_at
       FROM conversations
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as {
    role: string;
    content: string;
    created_at: string;
  }[];

  // Reverse so oldest message comes first (natural conversation order)
  return rows.reverse().map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
    timestamp: r.created_at,
  }));
}

/**
 * Fetch the most recent `limit` messages from past sessions (not today's),
 * within `keepDays` days. Returns oldest-first so they slot naturally before
 * the current session in a merged history array.
 */
export function getCrossSessionHistory(
  db: Database.Database,
  currentSessionId: string,
  limit = 6,
  keepDays = 7
): ConversationMessage[] {
  const rows = db
    .prepare(
      `SELECT role, content, created_at
       FROM conversations
       WHERE session_id != ?
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(currentSessionId, `-${keepDays} days`, limit) as {
    role: string;
    content: string;
    created_at: string;
  }[];

  return rows.reverse().map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
    timestamp: r.created_at,
  }));
}

/**
 * List distinct sessions with message counts, ordered by most recent first.
 */
export function listSessions(
  db: Database.Database,
  keepDays = 7
): { session_id: string; message_count: number; last_activity: string }[] {
  return db
    .prepare(
      `SELECT session_id, COUNT(*) AS message_count, MAX(created_at) AS last_activity
       FROM conversations
       WHERE created_at >= datetime('now', ?)
       GROUP BY session_id
       ORDER BY last_activity DESC`
    )
    .all(`-${keepDays} days`) as {
    session_id: string;
    message_count: number;
    last_activity: string;
  }[];
}

/**
 * Fetch all messages for a specific session, oldest first.
 */
export function getSessionMessages(
  db: Database.Database,
  sessionId: string
): (ConversationMessage & { created_at: string })[] {
  return (
    db
      .prepare(
        `SELECT role, content, created_at
         FROM conversations
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId) as { role: string; content: string; created_at: string }[]
  ).map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
    timestamp: r.created_at,
    created_at: r.created_at,
  }));
}

/**
 * Remove conversation rows older than `keepDays` days to keep the DB small.
 */
export function pruneOldSessions(
  db: Database.Database,
  keepDays = 7
): void {
  db.prepare(
    `DELETE FROM conversations WHERE created_at < datetime('now', ?)`
  ).run(`-${keepDays} days`);
}
