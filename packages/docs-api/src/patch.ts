import { Fail } from "./err.js";
import { Code } from "./keys.js";
import { Paths } from "./rules.js";

export class Hunk {
  oldStart: number;
  lines: string[];

  constructor(oldStart: number, lines: string[]) {
    this.oldStart = oldStart;
    this.lines = lines;
  }
}

export class Patch {
  static paths(diff: string): string[] {
    const found: string[] = [];
    for (const raw of diff.split(/\r?\n/)) {
      const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      if (git) {
        found.push(git[1], git[2]);
        continue;
      }
      const mark = /^(?:---|\+\+\+)\s+(.+)$/.exec(raw);
      if (mark) {
        const p = mark[1].trim();
        if (p !== "/dev/null") found.push(p.split("\t")[0]);
      }
    }
    return found;
  }

  static guard(diff: string, docRel: string): void {
    const want = Paths.norm(docRel);
    const paths = Patch.paths(diff).map((p) => Paths.norm(p)).filter((p) => p && p !== "/dev/null");
    if (paths.length === 0) return;
    for (const p of paths) {
      if (!Paths.inside(p) || p !== want) {
        throw new Fail(Code.path, `path outside document tree: ${p}`);
      }
    }
  }

  static hunks(diff: string): Hunk[] {
    const rows = diff.split(/\r?\n/);
    const hunks: Hunk[] = [];
    let cur: Hunk | null = null;
    for (const row of rows) {
      const head = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(row);
      if (head) {
        cur = new Hunk(Number(head[1]), []);
        hunks.push(cur);
        continue;
      }
      if (!cur) continue;
      if (row.startsWith("\\")) continue;
      if (row.startsWith("+") || row.startsWith("-") || row.startsWith(" ")) cur.lines.push(row);
    }
    if (hunks.length === 0) throw new Fail(Code.badPatch, "patch has no hunks");
    return hunks;
  }

  static apply(text: string, diff: string): string {
    const nl = text.endsWith("\n");
    const old = text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    const out: string[] = [];
    let cursor = 0;
    for (const hunk of Patch.hunks(diff)) {
      const start = Math.max(0, hunk.oldStart - 1);
      if (start < cursor) throw new Fail(Code.badPatch, "overlapping hunk");
      out.push(...old.slice(cursor, start));
      cursor = start;
      for (const line of hunk.lines) {
        const kind = line[0];
        const body = line.slice(1);
        if (kind === " ") {
          if (old[cursor] !== body) throw new Fail(Code.badPatch, "context mismatch");
          out.push(old[cursor]);
          cursor += 1;
        } else if (kind === "-") {
          if (old[cursor] !== body) throw new Fail(Code.badPatch, "delete mismatch");
          cursor += 1;
        } else if (kind === "+") {
          out.push(body);
        }
      }
    }
    out.push(...old.slice(cursor));
    const joined = out.join("\n");
    return nl || text === "" ? `${joined}\n` : joined;
  }
}
