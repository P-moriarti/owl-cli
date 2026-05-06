import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigManager } from "../config.js";

const CACHE_DIR_NAME = "cache";

export function getLocalDbPath(
  config: ConfigManager,
  projectSlug: string
): string {
  const cacheDir = join(config.getOwlDir(), CACHE_DIR_NAME);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { mode: 0o700, recursive: true });
  }
  const safeSlug = projectSlug.replace(/[^a-zA-Z0-9-_]/g, "_");
  return join(cacheDir, `${safeSlug}.sqlite`);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug TEXT NOT NULL UNIQUE,
  tables_json TEXT NOT NULL,
  introspected_at TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_session
  ON conversations (session_id, created_at);
`;

export function openLocalDb(
  config: ConfigManager,
  projectSlug: string
): Database.Database {
  const path = getLocalDbPath(config, projectSlug);
  const db = new Database(path);
  db.exec(SCHEMA_SQL);
  return db;
}
