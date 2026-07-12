import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config";

export type Db = Database;

export function openDb(config: Config): Db {
  mkdirSync(config.DATA_DIR, { recursive: true });
  const db = new Database(join(config.DATA_DIR, "nightqueue.sqlite"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      voice_channel_id TEXT,
      text_channel_id TEXT,
      volume INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      encoded TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      uri TEXT,
      requested_by TEXT NOT NULL,
      low_confidence INTEGER NOT NULL DEFAULT 0,
      request_json TEXT
    );

    CREATE TABLE IF NOT EXISTS account_links (
      discord_user_id TEXT PRIMARY KEY,
      spotify_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_tokens (
      token_hash TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pairing_sessions (
      pairing_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      display_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      discord_user_id TEXT,
      spotify_account_id TEXT,
      pkce_verifier TEXT,
      oauth_state TEXT,
      token_claimed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resolution_cache (
      cache_key TEXT PRIMARY KEY,
      resolved_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enqueue_idempotency (
      request_id TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      seen_at TEXT NOT NULL
    );
  `);
}
