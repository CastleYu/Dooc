import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function nolockUri(file: string): string {
  const abs = path.resolve(file).replaceAll("\\", "/");
  const prefixed = abs.startsWith("/") ? abs : `/${abs}`;
  return `file:${prefixed}?nolock=1`;
}

// CIFS and NFS often reject SQLite's POSIX locks. Two processes then fail with
// "locking protocol" after WAL is enabled. Those mounts share one unlocked file.
function sharedLockWorks(file: string): boolean {
  if (process.platform !== "linux") return true;
  try {
    const abs = path.resolve(file);
    let best = "";
    let kind = "";
    for (const line of fs.readFileSync("/proc/mounts", "utf8").split("\n")) {
      const [, targetRaw, fstype, options] = line.split(" ");
      if (!targetRaw || !fstype) continue;
      const target = targetRaw.replaceAll("\\040", " ");
      if (abs !== target && !abs.startsWith(`${target}/`)) continue;
      if (target.length < best.length) continue;
      best = target;
      kind = `${fstype} ${options ?? ""}`;
    }
    if (!best) return true;
    return !/\b(cifs|nfs4?|smb3?|fuse)\b/.test(kind) && !/\bnounix\b/.test(kind);
  } catch {
    return true;
  }
}

function openDatabase(file: string): DatabaseSync {
  if (sharedLockWorks(file)) {
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA busy_timeout = 4000");
    return raw;
  }
  let locked: DatabaseSync | undefined;
  try {
    locked = new DatabaseSync(file);
    locked.exec("PRAGMA busy_timeout = 4000");
    locked.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    locked.exec("PRAGMA journal_mode = DELETE");
    locked.close();
    locked = undefined;
  } catch {
    try { locked?.close(); } catch { /* the unlocked open reports the failure */ }
  }
  const raw = new DatabaseSync(nolockUri(file));
  raw.exec("PRAGMA busy_timeout = 4000");
  return raw;
}

export class Db {
  raw: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = openDatabase(file);
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
      CREATE TABLE IF NOT EXISTS file_locks (
        path TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        owner TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        expires_at TEXT NOT NULL
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
