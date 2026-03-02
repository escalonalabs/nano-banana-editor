const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function nowIso() {
  return new Date().toISOString();
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDb(dbPath) {
  ensureParent(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      current_snapshot_id TEXT,
      redo_stack_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      cas_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      ext TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_assets_project_hash_mime
      ON assets(project_id, hash, mime);
    CREATE INDEX IF NOT EXISTS ix_assets_project ON assets(project_id);

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_snapshot_id TEXT,
      operation_type TEXT NOT NULL,
      asset_ids_json TEXT NOT NULL,
      preview_asset_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(parent_snapshot_id) REFERENCES snapshots(id)
    );

    CREATE INDEX IF NOT EXISTS ix_snapshots_project_created
      ON snapshots(project_id, created_at);

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      snapshot_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
    );

    CREATE INDEX IF NOT EXISTS ix_operations_project_created
      ON operations(project_id, created_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      input_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS ix_jobs_status_available
      ON jobs(status, available_at);
  `);
}

module.exports = {
  createDb,
  nowIso,
};
