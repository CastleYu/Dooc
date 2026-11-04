import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Db } from "./db.js";
import { Fail } from "./err.js";
import { Fm } from "./fm.js";
import { FmRules } from "./fm.js";
import { Git } from "./git.js";
import { Actor, Ann, Chg, Code, Need, TaskSt } from "./keys.js";
import { Patch } from "./patch.js";
import { Anchor, Jump } from "./rules.js";

type Doc = {
  id: string;
  path: string;
  markdown: string;
  title: string;
  description: string;
  type: string;
  status: string;
  tags: string[];
  owners: string[];
  codeRefs: string[];
  symbols: string[];
};

export class Svc {
  git: Git;
  db: Db;
  docs = new Map<string, Doc>();

  constructor(repo: string, dbFile: string) {
    this.git = new Git(path.resolve(repo));
    this.db = new Db(dbFile);
    this.reindex();
  }

  close(): void {
    this.db.close();
  }

  reindex(): void {
    this.docs.clear();
    const root = path.join(this.git.root, "docs");
    const files: string[] = [];
    if (fs.existsSync(root)) this.walk(root, files);
    this.db.raw.exec("DELETE FROM docs");
    this.db.raw.exec("DELETE FROM docs_fts");
    const put = this.db.raw.prepare(
      `INSERT INTO docs (doc_id, title, description, type, status, path, body, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const fts = this.db.raw.prepare(`INSERT INTO docs_fts (doc_id, title, body) VALUES (?, ?, ?)`);
    for (const abs of files) {
      const rel = path.relative(this.git.root, abs).split(path.sep).join("/");
      const markdown = fs.readFileSync(abs, "utf8");
      const meta = Fm.read(markdown);
      if (!meta) continue;
      const id = meta.str(Need.id);
      if (!id) continue;
      if (this.docs.has(id)) throw new Fail(Code.badState, `duplicate id ${id}`);
      const doc: Doc = {
        id,
        path: rel,
        markdown,
        title: meta.str(Need.title),
        description: meta.str(Need.description),
        type: meta.str(Need.type),
        status: meta.str(Need.status),
        tags: meta.list(Need.tags),
        owners: meta.list(Need.owners),
        codeRefs: meta.list(Need.codeRefs),
        symbols: meta.list(Need.symbols),
      };
      this.docs.set(id, doc);
      const body = meta.body;
      put.run(id, doc.title, doc.description, doc.type, doc.status, rel, body, JSON.stringify(meta.data));
      fts.run(id, doc.title, body);
    }
  }

  walk(dir: string, out: string[]): void {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) this.walk(abs, out);
      else if (name.endsWith(".md") || name.endsWith(".mdx")) out.push(abs);
    }
  }

  doc(id: string): Doc {
    const found = this.docs.get(id);
    if (!found) throw new Fail(Code.notFound, `document ${id} not found`);
    return found;
  }

  search(query: string, filters?: { type?: string; status?: string; tag?: string }): Record<string, unknown>[] {
    const q = query.trim();
    if (!q) return [];
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = this.db.raw
      .prepare(
        `SELECT doc_id, title, type, path FROM docs
         WHERE (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
         ORDER BY title`,
      )
      .all(like, like, like) as { doc_id: string; title: string; type: string; path: string }[];
    const ids = new Set(rows.map((row) => row.doc_id));
    try {
      const ftsRows = this.db.raw
        .prepare(`SELECT doc_id FROM docs_fts WHERE docs_fts MATCH ?`)
        .all(q) as { doc_id: string }[];
      for (const row of ftsRows) ids.add(row.doc_id);
    } catch {
      /* punctuation can make MATCH fail; LIKE already ran */
    }
    const hits: Record<string, unknown>[] = [];
    for (const id of ids) {
      const doc = this.docs.get(id);
      if (!doc) continue;
      if (filters?.type && doc.type !== filters.type) continue;
      if (filters?.status && doc.status !== filters.status) continue;
      if (filters?.tag && !doc.tags.includes(filters.tag)) continue;
      hits.push({ doc_id: doc.id, title: doc.title, type: doc.type, status: doc.status, path: doc.path });
    }
    return hits;
  }

  get(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    return {
      doc_id: doc.id,
      title: doc.title,
      description: doc.description,
      type: doc.type,
      status: doc.status,
      path: doc.path,
      tags: doc.tags,
      owners: doc.owners,
      code_refs: doc.codeRefs,
      symbols: doc.symbols,
      markdown: doc.markdown,
      version_sha: this.git.blob(doc.path),
      sha256: this.git.sha256(doc.path),
    };
  }

  outline(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    return { doc_id: id, headings: Anchor.headings(doc.markdown) };
  }

  related(id: string): Record<string, unknown>[] {
    const doc = this.doc(id);
    const hits: Record<string, unknown>[] = [];
    for (const other of this.docs.values()) {
      if (other.id === id) continue;
      const tag = other.tags.some((item) => doc.tags.includes(item));
      const ref = other.codeRefs.some((item) => doc.codeRefs.includes(item));
      if (tag || ref) {
        hits.push({ doc_id: other.id, title: other.title, type: other.type, path: other.path });
      }
    }
    return hits;
  }

  refs(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    return { doc_id: doc.id, code_refs: doc.codeRefs, symbols: doc.symbols };
  }

  index(): Record<string, unknown>[] {
    return [...this.docs.values()].map((doc) => ({
      doc_id: doc.id,
      title: doc.title,
      description: doc.description,
      type: doc.type,
      status: doc.status,
      path: doc.path,
    }));
  }

  addNote(input: {
    docId: string;
    heading: string;
    quote: string;
    occurrence?: number;
    content: string;
    authorType: string;
    authorId: string;
  }): Record<string, unknown> {
    const doc = this.doc(input.docId);
    if (input.authorType !== Actor.user && input.authorType !== Actor.agent) {
      throw new Fail(Code.badAnchor, "author type must be user or agent");
    }
    const occurrence = input.occurrence ?? 1;
    if (!input.heading || !input.quote || !input.content) {
      throw new Fail(Code.badAnchor, "heading, quote, and content are required");
    }
    const state = Anchor.bind(doc.markdown, input.heading, input.quote, occurrence);
    if (state !== Ann.bound) throw new Fail(Code.badAnchor, "anchor does not match the document");
    const now = new Date().toISOString();
    const id = `cmt_${randomBytes(8).toString("hex")}`;
    this.db.raw
      .prepare(
        `INSERT INTO comments (
          id, doc_id, heading, quote, occurrence, anchor_state, author_type, author_id,
          content, status, parent_id, version_sha, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        doc.id,
        input.heading,
        input.quote,
        occurrence,
        state,
        input.authorType,
        input.authorId,
        input.content,
        Ann.open,
        this.git.blob(doc.path),
        now,
        now,
      );
    return this.note(id);
  }

  reply(id: string, content: string, authorType: string, authorId: string): Record<string, unknown> {
    const parent = this.noteRow(id);
    if (!content.trim()) throw new Fail(Code.badAnchor, "reply is empty");
    if (authorType !== Actor.user && authorType !== Actor.agent) {
      throw new Fail(Code.badAnchor, "author type must be user or agent");
    }
    const now = new Date().toISOString();
    const rid = `cmt_${randomBytes(8).toString("hex")}`;
    this.db.raw
      .prepare(
        `INSERT INTO comments (
          id, doc_id, heading, quote, occurrence, anchor_state, author_type, author_id,
          content, status, parent_id, version_sha, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rid,
        parent.doc_id,
        parent.heading,
        parent.quote,
        parent.occurrence,
        parent.anchor_state,
        authorType,
        authorId,
        content,
        Ann.open,
        id,
        parent.version_sha,
        now,
        now,
      );
    return this.note(id);
  }

  moveNote(id: string, status: string): Record<string, unknown> {
    const row = this.noteRow(id);
    Jump.move(row.status, status);
    const now = new Date().toISOString();
    this.db.raw.prepare(`UPDATE comments SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
    return this.note(id);
  }

  rebind(id: string): Record<string, unknown> {
    const row = this.noteRow(id);
    const doc = this.docs.get(row.doc_id);
    const state = doc
      ? Anchor.bind(doc.markdown, row.heading, row.quote, row.occurrence)
      : Ann.orphaned;
    const now = new Date().toISOString();
    this.db.raw
      .prepare(`UPDATE comments SET anchor_state = ?, updated_at = ? WHERE id = ?`)
      .run(state, now, id);
    return this.note(id);
  }

  notes(docId: string, status?: string): Record<string, unknown>[] {
    this.doc(docId);
    const rows = status
      ? (this.db.raw
          .prepare(
            `SELECT * FROM comments WHERE doc_id = ? AND parent_id IS NULL AND status = ? ORDER BY created_at`,
          )
          .all(docId, status) as NoteRow[])
      : (this.db.raw
          .prepare(`SELECT * FROM comments WHERE doc_id = ? AND parent_id IS NULL ORDER BY created_at`)
          .all(docId) as NoteRow[]);
    return rows.map((row) => this.view(row));
  }

  note(id: string): Record<string, unknown> {
    return this.view(this.noteRow(id));
  }

  propose(input: {
    docId: string;
    patch: string;
    reason: string;
    baseSha: string;
    actorType: string;
    actorId: string;
  }): Record<string, unknown> {
    const doc = this.doc(input.docId);
    const blob = this.git.blob(doc.path);
    if (input.baseSha !== blob) throw new Fail(Code.stale, "base sha is not the current document version");
    Patch.guard(input.patch, doc.path);
    Patch.apply(doc.markdown, input.patch);
    const now = new Date().toISOString();
    const id = `chg_${randomBytes(8).toString("hex")}`;
    this.db.raw
      .prepare(
        `INSERT INTO changes (
          id, doc_id, path, base_sha, patch, reason, actor_type, actor_id, status, merge_sha, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        doc.id,
        doc.path,
        blob,
        input.patch,
        input.reason,
        input.actorType,
        input.actorId,
        Chg.proposed,
        now,
        now,
      );
    return this.change(id);
  }

  diff(id: string): Record<string, unknown> {
    const row = this.changeRow(id);
    return { change_id: row.id, doc_id: row.doc_id, patch: row.patch };
  }

  check(target: { docId?: string; changeId?: string }): { ok: boolean; errors: string[] } {
    if (target.changeId) {
      const row = this.changeRow(target.changeId);
      const doc = this.doc(row.doc_id);
      const next = Patch.apply(doc.markdown, row.patch);
      return FmRules.check(next, doc.id);
    }
    if (target.docId) {
      const doc = this.doc(target.docId);
      return FmRules.check(doc.markdown, doc.id);
    }
    throw new Fail(Code.badState, "doc_id or change_id is required");
  }

  submit(id: string): Record<string, unknown> {
    const row = this.changeRow(id);
    if (row.status !== Chg.proposed) throw new Fail(Code.badState, "change is not proposed");
    const now = new Date().toISOString();
    this.db.raw
      .prepare(`UPDATE changes SET status = ?, updated_at = ? WHERE id = ?`)
      .run(Chg.review, now, id);
    return this.change(id);
  }

  approve(id: string, actorType: string, actorId: string): Record<string, unknown> {
    if (actorType !== Actor.user) throw new Fail(Code.forbidden, "agent cannot approve");
    const row = this.changeRow(id);
    if (row.status !== Chg.review) throw new Fail(Code.badState, "change is not awaiting review");
    const doc = this.doc(row.doc_id);
    const blob = this.git.blob(doc.path);
    if (blob !== row.base_sha) throw new Fail(Code.stale, "document changed since the proposal");
    const next = Patch.apply(doc.markdown, row.patch);
    const checked = FmRules.check(next, doc.id);
    if (!checked.ok) throw new Fail(Code.badState, checked.errors.join(","));
    const mergeSha = this.git.merge(doc.path, next, row.id, doc.id);
    const now = new Date().toISOString();
    this.db.raw
      .prepare(`UPDATE changes SET status = ?, merge_sha = ?, updated_at = ? WHERE id = ?`)
      .run(Chg.merged, mergeSha, now, id);
    this.reindex();
    return { ...this.change(id), actor_id: actorId };
  }

  history(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    const rows = this.git.log(doc.path).map((rev) => ({
      sha: rev.sha,
      parents: rev.parents,
      subject: rev.subject,
      merge: rev.parents.length > 1,
    }));
    return { doc_id: id, history: rows };
  }

  addTask(title: string, description: string): Record<string, unknown> {
    if (!title.trim()) throw new Fail(Code.badState, "title is required");
    const now = new Date().toISOString();
    const id = `task_${randomBytes(8).toString("hex")}`;
    this.db.raw
      .prepare(
        `INSERT INTO tasks (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, title, description ?? "", TaskSt.open, now, now);
    return this.task(id);
  }

  tasks(status?: string): Record<string, unknown>[] {
    const rows = status
      ? (this.db.raw.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at`).all(status) as TaskRow[])
      : (this.db.raw.prepare(`SELECT * FROM tasks ORDER BY created_at`).all() as TaskRow[]);
    return rows.map((row) => Svc.taskView(row));
  }

  task(id: string): Record<string, unknown> {
    const row = this.db.raw.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
    if (!row) throw new Fail(Code.notFound, `task ${id} not found`);
    return Svc.taskView(row);
  }

  moveTask(id: string, status: string): Record<string, unknown> {
    this.task(id);
    if (!TaskSt.all.includes(status)) throw new Fail(Code.badState, "unknown task status");
    const now = new Date().toISOString();
    this.db.raw.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
    return this.task(id);
  }

  change(id: string): Record<string, unknown> {
    const row = this.changeRow(id);
    return {
      change_id: row.id,
      doc_id: row.doc_id,
      path: row.path,
      base_sha: row.base_sha,
      patch: row.patch,
      reason: row.reason,
      status: row.status,
      merge_sha: row.merge_sha,
      author: { type: row.actor_type, id: row.actor_id },
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private noteRow(id: string): NoteRow {
    const row = this.db.raw.prepare(`SELECT * FROM comments WHERE id = ?`).get(id) as NoteRow | undefined;
    if (!row) throw new Fail(Code.notFound, `comment ${id} not found`);
    return row;
  }

  private view(row: NoteRow): Record<string, unknown> {
    const replies = this.db.raw
      .prepare(`SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at`)
      .all(row.id) as NoteRow[];
    return {
      id: row.id,
      doc_id: row.doc_id,
      anchor: {
        heading: row.heading,
        quote: row.quote,
        occurrence: row.occurrence,
        state: row.anchor_state,
      },
      author: { type: row.author_type, id: row.author_id },
      content: row.content,
      status: row.status,
      replies: replies.map((item) => ({
        id: item.id,
        content: item.content,
        status: item.status,
        author: { type: item.author_type, id: item.author_id },
        created_at: item.created_at,
      })),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private changeRow(id: string): ChangeRow {
    const row = this.db.raw.prepare(`SELECT * FROM changes WHERE id = ?`).get(id) as ChangeRow | undefined;
    if (!row) throw new Fail(Code.notFound, `change ${id} not found`);
    return row;
  }

  private static taskView(row: TaskRow): Record<string, unknown> {
    return {
      task_id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

type NoteRow = {
  id: string;
  doc_id: string;
  heading: string;
  quote: string;
  occurrence: number;
  anchor_state: string;
  author_type: string;
  author_id: string;
  content: string;
  status: string;
  parent_id: string | null;
  version_sha: string | null;
  created_at: string;
  updated_at: string;
};

type ChangeRow = {
  id: string;
  doc_id: string;
  path: string;
  base_sha: string;
  patch: string;
  reason: string;
  actor_type: string;
  actor_id: string;
  status: string;
  merge_sha: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
};
