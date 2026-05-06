#!/usr/bin/env node
/**
 * TESTING ONLY: seeds a minimal local demo project/schema so `owl ask`
 * can be exercised without a live Postgres database.
 * Do NOT use this in production workflows.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const owlDir = path.join(os.homedir(), ".owl");
const cacheDir = path.join(owlDir, "cache");
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

const configPath = path.join(owlDir, "config.json");
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

config.activeProjectSlug = "demo";
config.projects = config.projects || {};
config.projects.demo = {
  slug: "demo",
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

const schema = {
  projectSlug: "demo",
  tables: [
    {
      name: "posts",
      schema: "public",
      columns: [
        { name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", isPrimaryKey: true, isForeignKey: false },
        { name: "user_id", type: "uuid", nullable: false, default: null, isPrimaryKey: false, isForeignKey: true },
        { name: "title", type: "text", nullable: false, default: null, isPrimaryKey: false, isForeignKey: false },
        { name: "content", type: "text", nullable: true, default: null, isPrimaryKey: false, isForeignKey: false },
        { name: "created_at", type: "timestamptz", nullable: false, default: "now()", isPrimaryKey: false, isForeignKey: false }
      ],
      rlsEnabled: false
    }
  ],
  rlsPolicies: [],
  indexes: [],
  foreignKeys: [],
  introspectedAt: new Date().toISOString(),
  checksum: "demo"
};

const dbPath = path.join(cacheDir, "demo.sqlite");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_slug TEXT NOT NULL UNIQUE,
    tables_json TEXT NOT NULL,
    introspected_at TEXT NOT NULL,
    checksum TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.prepare(`
  INSERT OR REPLACE INTO schema_cache (project_slug, tables_json, introspected_at, checksum)
  VALUES (?, ?, ?, ?)
`).run("demo", JSON.stringify(schema), schema.introspectedAt, schema.checksum);

db.close();

console.log("Seeded demo project for TESTING (no real DB required).");
console.log("Active project set to: demo");
console.log("Run: node dist/index.js ask \"How do I enable RLS on a table?\"");
