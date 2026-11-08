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
    const starts = [0];
    for (const match of md.matchAll(/\r?\n/g)) starts.push(match.index! + match[0].length);
    const want = heading.trim();
    const matches = lines.flatMap((line, index) => {
      if (hide[index]) return [];
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      return m && m[2].trim() === want ? [index] : [];
    });
    if (matches.length !== 1) return null;
    const start = matches[0];
    const level = /^(#+)/.exec(lines[start])![1].length;
    for (let i = start + 1; i < lines.length; i++) {
      if (hide[i]) continue;
      const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (m && m[1].length <= level) return md.slice(starts[start], starts[i]).replace(/\r?\n$/, "");
    }
    return md.slice(starts[start]);
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

export type TextBlock = {
  index: number;
  heading: string;
  section_start: number;
  text: string;
  starts: number[];
  ends: number[];
};

// Character ranges let readers keep source anchors when Markdown hides inline syntax.
export class Selection {
  static tableDelimiter(header: string, divider: string): boolean {
    const cells = (line: string) => {
      const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
      return value.split("|").map((cell) => cell.trim());
    };
    const head = cells(header);
    const rule = cells(divider);
    return header.includes("|") && head.length === rule.length && rule.length > 0 &&
      rule.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  static blocks(md: string): TextBlock[] {
    const rows = [...md.matchAll(/([^\n]*)(?:\n|$)/g)].filter((m) => m[0]);
    const hidden = Anchor.hide(rows.map((m) => m[1].replace(/\r$/, "")));
    const out: TextBlock[] = [];
    let heading = "";
    let section = 0;
    let front = md.replace(/^\uFEFF/, "").startsWith("---\n") || md.startsWith("---\r\n");
    let chunks: { text: string; start: number }[] = [];
    const flush = () => {
      if (chunks.length && heading && Anchor.section(md, heading) !== null) {
        const chars: { text: string; start: number; end: number }[] = [];
        for (let i = 0; i < chunks.length; i++) {
          if (i) chars.push({ text: " ", start: chunks[i - 1].start + chunks[i - 1].text.length, end: chunks[i].start });
          chars.push(...Selection.inline(chunks[i].text, chunks[i].start));
        }
        const block: TextBlock = { index: out.length, heading, section_start: section, text: "", starts: [], ends: [] };
        for (const char of chars) {
          for (let j = 0; j < char.text.length; j++) {
            const ch = /\s/.test(char.text[j]) ? " " : char.text[j];
            if (ch === " " && (!block.text || block.text.endsWith(" "))) {
              if (block.text) block.ends[block.ends.length - 1] = char.end;
              continue;
            }
            block.text += ch;
            block.starts.push(char.start);
            block.ends.push(char.end);
          }
        }
        if (block.text.endsWith(" ")) {
          block.text = block.text.slice(0, -1);
          block.starts.pop(); block.ends.pop();
        }
        if (block.text) out.push(block);
      }
      chunks = [];
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = row[1].replace(/\r$/, "");
      if (front) {
        if (i > 0 && /^---\s*$/.test(line)) front = false;
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h && !hidden[i]) {
        flush(); heading = h[2].trim(); section = row.index!; continue;
      }
      if (hidden[i] || !line.trim() || /^ {0,3}(?:[-*_]\s*){3,}$/.test(line) || /^ {4}|^\t/.test(line)) {
        flush(); continue;
      }
      if (i + 1 < rows.length && Selection.tableDelimiter(line, rows[i + 1][1].replace(/\r$/, ""))) {
        flush();
        i++;
        while (i + 1 < rows.length) {
          const next = rows[i + 1][1].replace(/\r$/, "");
          if (!next.trim() || !next.includes("|")) break;
          i++;
        }
        continue;
      }
      const prefix = /^(?: {0,3}>\s*)*(?: {0,3}(?:[-+*]|\d+[.)])\s+)?/.exec(line)![0];
      if (/^(?: {0,3}>\s*)* {0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) flush();
      // HTML/MDX and image-only content need their own renderer mapping.
      if (/[<>]|!\[/.test(line)) { flush(); continue; }
      chunks.push({ text: line.slice(prefix.length), start: row.index! + prefix.length });
    }
    flush();
    return out;
  }

  static inline(text: string, base: number): { text: string; start: number; end: number }[] {
    const out: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < text.length;) {
      if (text[i] === "\\" && i + 1 < text.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(text[i + 1])) {
        out.push({ text: text[i + 1], start: base + i, end: base + i + 2 }); i += 2; continue;
      }
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(text.slice(i));
      if (code) {
        const pad = code[2].startsWith(" ") && code[2].endsWith(" ") && /[^ ]/.test(code[2]) ? 1 : 0;
        for (let j = pad; j < code[2].length - pad; j++) out.push({ text: code[2][j], start: base + i + code[1].length + j, end: base + i + code[1].length + j + 1 });
        i += code[0].length; continue;
      }
      const link = /^\[([^\]]+)\]\((?:[^()\\]|\\.|\([^()]*\))*\)/.exec(text.slice(i));
      if (link) {
        out.push(...Selection.inline(link[1], base + i + 1)); i += link[0].length; continue;
      }
      const mark = /^(\*{1,3}|_{1,3}|~~)/.exec(text.slice(i));
      if (mark && (i === 0 || mark[1][0] !== "_" || !/\w/.test(text[i - 1]))) {
        const end = text.indexOf(mark[1], i + mark[1].length);
        if (end > i + mark[1].length) {
          out.push(...Selection.inline(text.slice(i + mark[1].length, end), base + i + mark[1].length));
          i = end + mark[1].length; continue;
        }
      }
      const entity = /^&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/i.exec(text.slice(i));
      if (entity) {
        const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
        const n = entity[1].startsWith("#") ? Number.parseInt(entity[1].slice(entity[1][1].toLowerCase() === "x" ? 2 : 1), entity[1][1].toLowerCase() === "x" ? 16 : 10) : 0;
        const value = entity[1].startsWith("#") ? (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�") : named[entity[1].toLowerCase()];
        out.push({ text: value, start: base + i, end: base + i + entity[0].length }); i += entity[0].length; continue;
      }
      out.push({ text: text[i], start: base + i, end: base + i + 1 }); i++;
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
