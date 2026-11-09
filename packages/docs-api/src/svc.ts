import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Db } from "./db.js";
import { Fail } from "./err.js";
import { Fm } from "./fm.js";
import { FmRules } from "./fm.js";
import { Git } from "./git.js";
import { Actor, Ann, Chg, Code, Need, TaskSt } from "./keys.js";
import { Patch } from "./patch.js";
import { Links } from "./links.js";
import { plantuml } from "./render.js";
import { Anchor, Jump, Paths, Selection } from "./rules.js";

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
  abs: string;
  inside: boolean;
};

export class Svc {
  git: Git;
  db: Db;
  docs = new Map<string, Doc>();
  stamp = "";

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
    this.db.raw.exec("DELETE FROM docs");
    this.db.raw.exec("DELETE FROM docs_fts");
    const put = this.db.raw.prepare(
      `INSERT INTO docs (doc_id, title, description, type, status, path, body, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const fts = this.db.raw.prepare(`INSERT INTO docs_fts (doc_id, title, body) VALUES (?, ?, ?)`);
    for (const file of this.sources()) {
      const markdown = fs.readFileSync(file.abs, "utf8");
      const meta = Fm.read(markdown);
      const id = Svc.docId(meta, file);
      if (this.docs.has(id)) throw new Fail(Code.badState, `duplicate id ${id}`);
      const title = meta?.str(Need.title) || Svc.headingTitle(markdown) || path.basename(file.abs).replace(/\.mdx?$/i, "");
      const doc: Doc = {
        id,
        path: file.rel ?? file.abs,
        markdown,
        title,
        description: meta?.str(Need.description) ?? "",
        type: meta?.str(Need.type) || "guide",
        status: meta?.str(Need.status) || "reviewed",
        tags: meta?.list(Need.tags) ?? [],
        owners: meta?.list(Need.owners) ?? [],
        codeRefs: meta?.list(Need.codeRefs) ?? [],
        symbols: meta?.list(Need.symbols) ?? [],
        abs: file.abs,
        inside: file.rel !== null,
      };
      this.docs.set(id, doc);
      const body = meta?.body ?? markdown;
      put.run(id, doc.title, doc.description, doc.type, doc.status, doc.path, body, JSON.stringify(meta?.data ?? {}));
      fts.run(id, doc.title, body);
    }
    this.stamp = this.fingerprint();
  }

  sync(): void {
    const next = this.fingerprint();
    if (next !== this.stamp) this.reindex();
  }

  fingerprint(): string {
    const rows = this.sources().map((file) => {
      const digest = createHash("sha256").update(fs.readFileSync(file.abs)).digest("hex");
      return `${file.rel ?? file.abs} ${digest}`;
    });
    rows.sort();
    return rows.join("\n");
  }

  sources(): { abs: string; rel: string | null }[] {
    const out: { abs: string; rel: string | null }[] = [];
    const seen = new Set<string>();
    const addTree = (root: string) => {
      if (!fs.existsSync(root)) return;
      let real: string;
      try {
        real = fs.realpathSync(root);
      } catch {
        return;
      }
      if (seen.has(real)) return;
      seen.add(real);
      const files: string[] = [];
      this.walk(real, files);
      const repo = fs.realpathSync(this.git.root);
      for (const abs of files) {
        let fileReal = abs;
        try {
          fileReal = fs.realpathSync(abs);
        } catch {
          /* use the path we walked */
        }
        const inside = fileReal === repo || fileReal.startsWith(repo + path.sep);
        const rel = inside ? path.relative(this.git.root, abs).split(path.sep).join("/") : null;
        out.push({ abs, rel });
      }
    };
    addTree(path.join(this.git.root, "docs"));
    for (const dir of Links.read(this.git.root)) addTree(dir);
    return out;
  }

  walk(dir: string, out: string[]): void {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules" || name === ".git" || name === "dist" || name === "doc_build" || name === ".dooc") continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) this.walk(abs, out);
      else if (name.endsWith(".md") || name.endsWith(".mdx")) out.push(abs);
    }
  }

  doc(id: string): Doc {
    this.sync();
    const found = this.docs.get(id);
    if (!found) throw new Fail(Code.notFound, `document ${id} not found`);
    return found;
  }

  search(query: string, filters?: { type?: string; status?: string; tag?: string }): Record<string, unknown>[] {
    this.sync();
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
      version_sha: this.revision(doc),
      sha256: this.fileSha(doc),
    };
  }

  anchors(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    return { doc_id: id, version_sha: this.revision(doc), markdown: doc.markdown, blocks: Selection.blocks(doc.markdown) };
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
    this.sync();
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
    versionSha?: string;
    content: string;
    authorType: string;
    authorId: string;
  }): Record<string, unknown> {
    const doc = this.doc(input.docId);
    if (input.authorType !== Actor.user && input.authorType !== Actor.agent) {
      throw new Fail(Code.badAnchor, "author type must be user or agent");
    }
    if (input.versionSha !== undefined && input.versionSha !== this.revision(doc)) {
      throw new Fail(Code.stale, "document changed since the selection was read");
    }
    const occurrence = input.occurrence ?? 1;
    if (!input.heading || !input.quote || !input.content.trim()) {
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
        this.revision(doc),
        now,
        now,
      );
    return this.note(id);
  }

  reply(id: string, content: string, authorType: string, authorId: string): Record<string, unknown> {
    let parent = this.noteRow(id);
    const seen = new Set<string>();
    while (parent.parent_id) {
      if (seen.has(parent.id)) break;
      seen.add(parent.id);
      parent = this.noteRow(parent.parent_id);
    }
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
        parent.id,
        parent.version_sha,
        now,
        now,
      );
    return this.note(parent.id);
  }

  moveNote(id: string, status: string): Record<string, unknown> {
    const row = this.noteRow(id);
    Jump.move(row.status, status);
    const now = new Date().toISOString();
    this.db.raw.prepare(`UPDATE comments SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
    return this.note(id);
  }

  rebind(id: string): Record<string, unknown> {
    this.sync();
    const row = this.noteRow(id);
    const doc = this.docs.get(row.doc_id);
    const state = doc && row.version_sha === this.revision(doc)
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
    this.sync();
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
    const blob = this.revision(doc);
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

  proposeCreate(input: { docId: string; path: string; markdown: string; reason: string; actorId: string }): Record<string, unknown> {
    this.sync();
    this.creationPath(input.path);
    if (!input.docId || this.docs.has(input.docId) || fs.existsSync(this.git.abs(input.path))) {
      throw new Fail(Code.stale, "document id or path already exists");
    }
    const checked = FmRules.check(input.markdown, input.docId);
    if (!checked.ok) throw new Fail(Code.badState, checked.errors.join(","));
    if (!input.markdown.endsWith("\n")) throw new Fail(Code.badPatch, "markdown must end with newline");
    const lines = input.markdown.slice(0, -1).split("\n");
    const patch = `--- /dev/null\n+++ b/${input.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join("\n")}\n`;
    const now = new Date().toISOString();
    const id = `chg_${randomBytes(8).toString("hex")}`;
    this.db.raw.prepare(`INSERT INTO changes
      (id, doc_id, path, base_sha, patch, reason, actor_type, actor_id, status, merge_sha, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
        id, input.docId, input.path, "", patch, input.reason, Actor.agent, input.actorId, Chg.proposed, now, now);
    return this.change(id);
  }

  private creationPath(rel: string): void {
    if (!Paths.inside(rel) || Paths.norm(rel) !== rel || path.posix.normalize(rel) !== rel || !/\.mdx?$/.test(rel)) {
      throw new Fail(Code.path, "new document must be a Markdown path inside docs/");
    }
    let parent = path.dirname(this.git.abs(rel));
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const real = fs.realpathSync(parent);
    const root = fs.realpathSync(this.git.root);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Fail(Code.path, "symlink escapes repository");
  }

  changes(docId?: string, status?: string): Record<string, unknown>[] {
    const rows = this.db.raw.prepare("SELECT id, doc_id, status FROM changes ORDER BY created_at").all() as { id: string; doc_id: string; status: string }[];
    return rows.filter(row => (!docId || row.doc_id === docId) && (!status || row.status === status)).map(row => {
      const { patch: _patch, ...summary } = this.change(row.id);
      return summary;
    });
  }

  private changeBase(row: ChangeRow): string {
    if (row.base_sha !== "") {
      const doc = this.doc(row.doc_id);
      if (this.revision(doc) !== row.base_sha) throw new Fail(Code.stale, "document changed since the proposal");
      return doc.markdown;
    }
    this.sync();
    this.creationPath(row.path);
    if (this.docs.has(row.doc_id) || fs.existsSync(this.git.abs(row.path))) throw new Fail(Code.stale, "document id or path already exists");
    return "";
  }

  diff(id: string): Record<string, unknown> {
    const row = this.changeRow(id);
    return { change_id: row.id, doc_id: row.doc_id, patch: row.patch };
  }

  check(target: { docId?: string; changeId?: string }): { ok: boolean; errors: string[] } {
    if (target.changeId) {
      const row = this.changeRow(target.changeId);
      const next = Patch.apply(this.changeBase(row), row.patch);
      return FmRules.check(next, row.doc_id);
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
    const checked = this.check({ changeId: id });
    if (!checked.ok) throw new Fail(Code.badState, checked.errors.join(","));
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
    const next = Patch.apply(this.changeBase(row), row.patch);
    const checked = FmRules.check(next, row.doc_id);
    if (!checked.ok) throw new Fail(Code.badState, checked.errors.join(","));
    const mergeSha = this.git.merge(row.path, next, row.id, row.doc_id);
    const now = new Date().toISOString();
    this.db.raw
      .prepare(`UPDATE changes SET status = ?, merge_sha = ?, updated_at = ? WHERE id = ?`)
      .run(Chg.merged, mergeSha, now, id);
    this.reindex();
    return { ...this.change(id), actor_id: actorId };
  }

  history(id: string): Record<string, unknown> {
    const doc = this.doc(id);
    if (!doc.inside) return { doc_id: id, history: [] };
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
    const doc = this.docs.get(row.doc_id);
    const state = doc && row.version_sha === this.revision(doc)
      ? Anchor.bind(doc.markdown, row.heading, row.quote, row.occurrence)
      : Ann.orphaned;
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
        state,
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

  listLinks(): { directories: { path: string; documents: { doc_id: string; title: string; path: string }[] }[] } {
    this.sync();
    const directories = Links.read(this.git.root).map((dir) => ({
      path: dir,
      documents: [...this.docs.values()]
        .filter((doc) => doc.abs === dir || doc.abs.startsWith(dir + path.sep))
        .map((doc) => ({ doc_id: doc.id, title: doc.title, path: doc.path })),
    }));
    return { directories };
  }

  addLink(dir: string): { directories: { path: string; documents: { doc_id: string; title: string; path: string }[] }[] } {
    Links.add(this.git.root, dir);
    this.reindex();
    return this.listLinks();
  }

  removeLink(dir: string): { directories: { path: string; documents: { doc_id: string; title: string; path: string }[] }[] } {
    Links.remove(this.git.root, dir);
    this.reindex();
    return this.listLinks();
  }

  browse(dir?: string): { path: string; parent: string | null; directories: { name: string; path: string; markdown: number }[] } {
    return Links.browse(this.git.root, dir);
  }

  lockDoc(id: string, owner: string): Record<string, unknown> {
    const doc = this.doc(id);
    this.expireLocks();
    const now = Date.now();
    const row = this.lockRow(doc.abs);
    if (row && row.owner !== owner && Date.parse(row.expires_at) > now) {
      throw new Fail(Code.locked, "file is locked by another editor");
    }
    const token = randomBytes(16).toString("hex");
    const base = this.fileSha(doc);
    const expires = new Date(now + 15 * 60 * 1000).toISOString();
    this.db.raw
      .prepare(
        `INSERT INTO file_locks (path, token, owner, base_sha, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET token = excluded.token, owner = excluded.owner, base_sha = excluded.base_sha, expires_at = excluded.expires_at`,
      )
      .run(doc.abs, token, owner, base, expires);
    return { doc_id: doc.id, path: doc.abs, lock_token: token, base_sha256: base, expires_at: expires };
  }

  unlockDoc(id: string, token: string): Record<string, unknown> {
    const doc = this.doc(id);
    const row = this.lockRow(doc.abs);
    if (!row || row.token !== token) throw new Fail(Code.locked, "lock token does not match");
    this.db.raw.prepare(`DELETE FROM file_locks WHERE path = ?`).run(doc.abs);
    return { doc_id: doc.id, locked: false };
  }

  writeDoc(id: string, markdown: string, baseSha: string, token: string): Record<string, unknown> {
    const doc = this.doc(id);
    this.expireLocks();
    const row = this.lockRow(doc.abs);
    if (!row || row.token !== token || Date.parse(row.expires_at) <= Date.now()) {
      throw new Fail(Code.locked, "edit requires a current file lock");
    }
    const current = this.fileSha(doc);
    const disk = fs.readFileSync(doc.abs, "utf8");
    if (current !== baseSha) {
      return { ok: false, kept: "local", doc_id: doc.id, path: doc.abs, sha256: current, markdown: disk };
    }
    fs.mkdirSync(path.dirname(doc.abs), { recursive: true });
    fs.writeFileSync(doc.abs, markdown);
    this.db.raw.prepare(`DELETE FROM file_locks WHERE path = ?`).run(doc.abs);
    this.reindex();
    return { ok: true, kept: "site", ...this.get(id) };
  }

  renderPlant(source: string): { ok: boolean; svg?: string; error?: string } {
    return plantuml(source);
  }

  private revision(doc: Doc): string {
    if (doc.inside) return this.git.blob(doc.path);
    return this.fileSha(doc);
  }

  private fileSha(doc: Doc): string {
    return createHash("sha256").update(fs.readFileSync(doc.abs)).digest("hex");
  }

  private expireLocks(): void {
    this.db.raw.prepare(`DELETE FROM file_locks WHERE expires_at <= ?`).run(new Date().toISOString());
  }

  private lockRow(abs: string): { token: string; owner: string; base_sha: string; expires_at: string } | undefined {
    return this.db.raw.prepare(`SELECT token, owner, base_sha, expires_at FROM file_locks WHERE path = ?`).get(abs) as
      | { token: string; owner: string; base_sha: string; expires_at: string }
      | undefined;
  }

  private static docId(meta: ReturnType<typeof Fm.read>, file: { abs: string; rel: string | null }): string {
    const stated = meta?.str(Need.id) ?? "";
    if (stated) return stated;
    const base = (file.rel ?? file.abs).replace(/\\/g, "/").replace(/\.mdx?$/i, "");
    const slug = base
      .split("/")
      .filter(Boolean)
      .join(".")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^\.+|\.+$/g, "");
    return `ext.${slug || "doc"}`;
  }

  private static headingTitle(markdown: string): string {
    const body = markdown.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const found = /^#{1,6}\s+(.+)$/m.exec(body);
    return found ? found[1].trim() : "";
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
