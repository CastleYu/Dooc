import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Db {
  raw: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA busy_timeout = 4000");
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        heading TEXT NOT NULL,
        quote TEXT NOT NULL,
        occurrence INTEGER NOT NULL,
        anchor_state TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        parent_id TEXT,
        version_sha TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS changes (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        path TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        patch TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        status TEXT NOT NULL,
        merge_sha TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docs (
        doc_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT NOT NULL,
        meta_json TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        doc_id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61'
      );
    `);
  }

  close(): void {
    this.raw.close();
  }
}
