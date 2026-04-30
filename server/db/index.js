// server/db/index.js — sql.js 数据库封装
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import config from '../config.js';

let db = null;

export async function getDb() {
  if (db) return db;

  // 确保目录存在
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (existsSync(config.dbPath)) {
    const buffer = readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 运行迁移
  runMigrations(db);

  return db;
}

function runMigrations(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_profile (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS play_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id     TEXT NOT NULL,
      song_name   TEXT,
      artist      TEXT,
      played_at   TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
}

export function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(config.dbPath, buffer);
  }
}

export function closeDb() {
  saveDb();
  if (db) {
    db.close();
    db = null;
  }
}
