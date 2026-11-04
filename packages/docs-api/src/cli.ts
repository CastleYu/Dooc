import path from "node:path";
import { Http } from "./http.js";
import { Svc } from "./svc.js";

class Cli {
  static arg(flag: string, fallback: string): string {
    const i = process.argv.indexOf(flag);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    return fallback;
  }

  static async main(): Promise<void> {
    const repo = path.resolve(Cli.arg("--repo", process.cwd()));
    const db = path.resolve(Cli.arg("--db", path.join(repo, ".dooc", "collab.db")));
    const port = Number(Cli.arg("--port", "8787"));
    const svc = new Svc(repo, db);
    const http = new Http(svc);
    const got = await http.start(port);
    process.stderr.write(`dooc-api ${got}\n`);
  }
}

Cli.main();
