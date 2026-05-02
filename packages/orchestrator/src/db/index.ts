import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env['DB_PATH'] ?? '/data/registry.db'

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// Run migrations inline (simple enough for this project)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    svg_icon TEXT NOT NULL,
    role_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen INTEGER,
    opencode_url TEXT,
    session_id TEXT,
    is_coordinator INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL,
    PRIMARY KEY (bot_id, topic_id)
  );

  CREATE TABLE IF NOT EXISTS spawn_log (
    id TEXT PRIMARY KEY,
    requested_by TEXT NOT NULL,
    bot_name TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    container_id TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// Incremental migrations
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN host_port INTEGER`) } catch { /* already exists */ }
