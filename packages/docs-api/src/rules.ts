import { Ann } from "./keys.js";
import { Fail } from "./err.js";
import { Code } from "./keys.js";

export class Jump {
  static next: Record<string, string[]> = {
    [Ann.open]: [Ann.progress, Ann.dismissed],
    [Ann.progress]: [Ann.resolved, Ann.dismissed],
    [Ann.resolved]: [],
    [Ann.dismissed]: [],
  };

  static ok(from: string, to: string): boolean {
    return (Jump.next[from] ?? []).includes(to);
  }

  static move(from: string, to: string): void {
    if (!Jump.ok(from, to)) {
      throw new Fail(Code.badState, `cannot move ${from} to ${to}`);
    }
  }
}

export class Anchor {
  static hide(lines: string[]): boolean[] {
    const hide = lines.map(() => false);
    let mark = "";
    for (let i = 0; i < lines.length; i++) {
      const found = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (!mark && found) {
        mark = found[1][0];
        hide[i] = true;
        continue;
      }
      if (!mark) continue;
      hide[i] = true;
      if (new RegExp(`^ {0,3}${mark}{3,}\\s*$`).test(lines[i])) mark = "";
    }
    return hide;
  }

  static section(md: string, heading: string): string | null {
    const lines = md.split(/\r?\n/);
    const hide = Anchor.hide(lines);
    const want = heading.trim();
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      if (hide[i]) continue;
      const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (!m) continue;
      if (start < 0 && m[2].trim() === want) {
        start = i;
        level = m[1].length;
        continue;
      }
      if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join("\n");
    }
    if (start >= 0) return lines.slice(start).join("\n");
    return null;
  }

  static count(section: string, quote: string): number {
    if (!quote) return 0;
    let n = 0;
    let i = 0;
    while (i <= section.length) {
      const j = section.indexOf(quote, i);
      if (j < 0) break;
      n += 1;
      i = j + quote.length;
    }
    return n;
  }

  static bind(md: string, heading: string, quote: string, occurrence: number): string {
    if (!Number.isInteger(occurrence) || occurrence < 1) return Ann.orphaned;
    const sec = Anchor.section(md, heading);
    if (sec == null) return Ann.orphaned;
    const n = Anchor.count(sec, quote);
    if (occurrence > n) return Ann.orphaned;
    return Ann.bound;
  }

  static headings(md: string): { level: number; text: string }[] {
    const lines = md.split(/\r?\n/);
    const hide = Anchor.hide(lines);
    const out: { level: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (hide[i]) continue;
      const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
  }
}

export class Paths {
  static norm(p: string): string {
    let s = p.trim().replace(/\\/g, "/");
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    if (s.startsWith("a/") || s.startsWith("b/")) s = s.slice(2);
    if (s.startsWith("./")) s = s.slice(2);
    return s;
  }

  static inside(rel: string): boolean {
    const n = Paths.norm(rel);
    if (!n || n.startsWith("/") || /^[A-Za-z]:/.test(n)) return false;
    if (n.split("/").includes("..")) return false;
    return n.startsWith("docs/") && n.length > "docs/".length;
  }
}
