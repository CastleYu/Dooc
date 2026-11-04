import { Code, DocType, Need } from "./keys.js";

export class Meta {
  data: Record<string, string | string[]>;
  body: string;

  constructor(data: Record<string, string | string[]>, body: string) {
    this.data = data;
    this.body = body;
  }

  str(key: string): string {
    const v = this.data[key];
    return typeof v === "string" ? v : "";
  }

  list(key: string): string[] {
    const v = this.data[key];
    return Array.isArray(v) ? v.slice() : [];
  }
}

export class Fm {
  static read(text: string): Meta | null {
    const src = text.replace(/^\uFEFF/, "");
    if (!src.startsWith("---")) return null;
    const end = src.indexOf("\n---", 3);
    if (end < 0) return null;
    const raw = src.slice(4, end).replace(/^\r?\n/, "");
    const rest = src.slice(end + 4).replace(/^\r?\n/, "");
    return new Meta(Fm.block(raw), rest);
  }

  static block(raw: string): Record<string, string | string[]> {
    const data: Record<string, string | string[]> = {};
    let key = "";
    let mode = "";
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const item = /^\s+-\s+(.*)$/.exec(line);
      if (item && key && mode === "list") {
        (data[key] as string[]).push(Fm.scalar(item[1]));
        continue;
      }
      const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (!pair) continue;
      key = pair[1];
      const val = pair[2].trim();
      if (!val) {
        data[key] = [];
        mode = "list";
      } else {
        data[key] = Fm.scalar(val);
        mode = "scalar";
      }
    }
    return data;
  }

  static scalar(v: string): string {
    const t = v.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  }
}

export class FmRules {
  static check(text: string, expectId?: string): { ok: boolean; errors: string[] } {
    const meta = Fm.read(text);
    if (!meta) return { ok: false, errors: [Code.fmMissing] };
    const errors: string[] = [];
    const id = meta.data[Need.id];
    if (typeof id !== "string" || id.length === 0) errors.push(Code.idMissing);
    else if (expectId && id !== expectId) errors.push(Code.idChanged);
    const type = meta.data[Need.type];
    if (typeof type !== "string" || !DocType.all.includes(type)) errors.push(Code.typeInvalid);
    for (const key of Need.rest) {
      if (!(key in meta.data)) {
        errors.push(`${Code.keyMissing}:${key}`);
        continue;
      }
      const val = meta.data[key];
      if (Need.lists.includes(key)) {
        if (!Array.isArray(val)) errors.push(`${Code.keyMissing}:${key}`);
      } else if (typeof val !== "string" || val.length === 0) {
        errors.push(`${Code.keyMissing}:${key}`);
      }
    }
    errors.sort();
    return { ok: errors.length === 0, errors };
  }
}
