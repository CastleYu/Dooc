import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Fail } from "./err.js";
import { Code } from "./keys.js";

export class Rev {
  sha: string;
  parents: string[];
  subject: string;

  constructor(sha: string, parents: string[], subject: string) {
    this.sha = sha;
    this.parents = parents;
    this.subject = subject;
  }
}

export class Git {
  root: string;

  constructor(root: string) {
    this.root = root;
  }

  run(args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  abs(rel: string): string {
    const full = path.resolve(this.root, rel);
    const root = path.resolve(this.root);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Fail(Code.path, "path escapes repository");
    }
    return full;
  }

  read(rel: string): string {
    return fs.readFileSync(this.abs(rel), "utf8");
  }

  sha256(rel: string): string {
    const buf = fs.readFileSync(this.abs(rel));
    return createHash("sha256").update(buf).digest("hex");
  }

  blob(rel: string): string {
    return this.run(["hash-object", "--", rel]).trim();
  }

  branch(): string {
    const name = this.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (!name || name === "HEAD") throw new Fail(Code.badState, "published branch is detached");
    return name;
  }

  ident(): void {
    try {
      const email = this.run(["config", "user.email"]).trim();
      if (!email) throw new Error("missing");
    } catch {
      this.run(["config", "user.email", "dooc@localhost"]);
      this.run(["config", "user.name", "Dooc"]);
    }
  }

  log(rel: string): Rev[] {
    const out = this.run(["log", "--full-history", "--format=%H%x1f%P%x1f%s", "--", rel]);
    const rows: Rev[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [sha, parents, subject] = line.split("\x1f");
      rows.push(new Rev(sha, parents ? parents.split(" ").filter(Boolean) : [], subject ?? ""));
    }
    return rows;
  }

  merge(rel: string, content: string, changeId: string, docId: string): string {
    if (this.run(["status", "--porcelain", "--untracked-files=no"]).trim()) {
      throw new Fail(Code.badState, "document repository has uncommitted tracked changes");
    }
    this.ident();
    const published = this.branch();
    const branch = `dooc/chg-${changeId}`;
    const before = fs.existsSync(this.abs(rel)) ? fs.readFileSync(this.abs(rel)) : null;
    try {
      this.run(["switch", "-C", branch]);
      fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true });
      fs.writeFileSync(this.abs(rel), content);
      this.run(["add", "--", rel]);
      this.run(["commit", "-m", `docs: update ${docId}`]);
      this.run(["switch", published]);
      this.run(["merge", "--no-ff", "-m", `Merge change ${changeId} for ${docId}`, branch]);
      return this.run(["rev-parse", "HEAD"]).trim();
    } catch (err) {
      try {
        if (before === null) fs.rmSync(this.abs(rel), { force: true });
        else fs.writeFileSync(this.abs(rel), before);
      } catch {
        /* restore best effort */
      }
      try {
        this.run(["switch", published]);
      } catch {
        /* stay */
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Fail(Code.badState, message);
    }
  }
}
