import fs from "node:fs";
import path from "node:path";
import { Fail } from "./err.js";
import { Code } from "./keys.js";

const skip = new Set(["node_modules", ".git", "dist", "doc_build", ".dooc"]);

export class Links {
  static file(repo: string): string {
    return path.join(repo, ".dooc", "links.json");
  }

  static read(repo: string): string[] {
    const file = Links.file(repo);
    if (!fs.existsSync(file)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { directories?: unknown };
      const dirs = Array.isArray(data.directories) ? data.directories : [];
      return dirs.filter((item): item is string => typeof item === "string" && item.length > 0);
    } catch {
      return [];
    }
  }

  static write(repo: string, directories: string[]): void {
    const file = Links.file(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ directories }, null, 2)}\n`, "utf8");
  }

  static resolveDir(input: string): string {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) throw new Fail(Code.notFound, `directory ${abs} not found`);
    const st = fs.statSync(abs);
    if (!st.isDirectory()) throw new Fail(Code.path, "link target must be a directory");
    return fs.realpathSync(abs);
  }

  static add(repo: string, input: string): string[] {
    const real = Links.resolveDir(input);
    const dirs = Links.read(repo);
    if (!dirs.includes(real)) dirs.push(real);
    Links.write(repo, dirs);
    return dirs;
  }

  static remove(repo: string, input: string): string[] {
    const real = fs.existsSync(input) ? Links.resolveDir(input) : path.resolve(input);
    const dirs = Links.read(repo).filter((item) => item !== real);
    Links.write(repo, dirs);
    return dirs;
  }

  static browse(repo: string, input?: string): { path: string; parent: string | null; directories: { name: string; path: string; markdown: number }[] } {
    const start = input && input.trim() ? path.resolve(input) : path.resolve(repo);
    if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) {
      throw new Fail(Code.notFound, `directory ${start} not found`);
    }
    const current = fs.realpathSync(start);
    const parent = path.dirname(current);
    const directories: { name: string; path: string; markdown: number }[] = [];
    for (const name of fs.readdirSync(current)) {
      if (skip.has(name) || name.startsWith(".")) continue;
      const abs = path.join(current, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      directories.push({ name, path: abs, markdown: Links.countMarkdown(abs) });
    }
    directories.sort((a, b) => a.name.localeCompare(b.name));
    return { path: current, parent: parent === current ? null : parent, directories };
  }

  static countMarkdown(dir: string): number {
    let n = 0;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return 0;
    }
    for (const name of entries) {
      if (skip.has(name) || name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) n += Links.countMarkdown(abs);
      else if (name.endsWith(".md") || name.endsWith(".mdx")) n += 1;
    }
    return n;
  }
}
