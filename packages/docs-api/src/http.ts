import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Fail } from "./err.js";
import { Actor, Code, Hdr } from "./keys.js";
import { Svc } from "./svc.js";

export class Http {
  svc: Svc;
  server: Server | null = null;

  constructor(svc: Svc) {
    this.svc = svc;
  }

  start(port = 0): Promise<number> {
    this.server = createServer((req, res) => {
      this.on(req, res).catch((err) => this.fail(res, err));
    });
    return new Promise((resolve) => {
      this.server?.listen(port, "127.0.0.1", () => {
        const addr = this.server?.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async on(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-actor-type, x-actor-id");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await Http.body(req);
    const who = Http.actor(req, body);
    const data = await this.route(req.method ?? "GET", url, body, who);
    this.send(res, 200, data);
  }

  private async route(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    who: { type: string; id: string },
  ): Promise<unknown> {
    const path = url.pathname;
    if (method === "GET" && path === "/api/search") {
      return {
        hits: this.svc.search(url.searchParams.get("q") ?? "", {
          type: url.searchParams.get("type") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          tag: url.searchParams.get("tag") ?? undefined,
        }),
      };
    }
    if (method === "GET" && path === "/api/docs") return { documents: this.svc.index() };
    const doc = /^\/api\/docs\/([^/]+)$/.exec(path);
    if (doc && method === "GET") return this.svc.get(decodeURIComponent(doc[1]));
    const outline = /^\/api\/docs\/([^/]+)\/outline$/.exec(path);
    if (outline && method === "GET") return this.svc.outline(decodeURIComponent(outline[1]));
    const related = /^\/api\/docs\/([^/]+)\/related$/.exec(path);
    if (related && method === "GET") return { documents: this.svc.related(decodeURIComponent(related[1])) };
    const refs = /^\/api\/docs\/([^/]+)\/code-refs$/.exec(path);
    if (refs && method === "GET") return this.svc.refs(decodeURIComponent(refs[1]));
    const hist = /^\/api\/docs\/([^/]+)\/history$/.exec(path);
    if (hist && method === "GET") return this.svc.history(decodeURIComponent(hist[1]));
    const docCheck = /^\/api\/docs\/([^/]+)\/validate$/.exec(path);
    if (docCheck && method === "POST") return this.svc.check({ docId: decodeURIComponent(docCheck[1]) });
    if (method === "POST" && path === "/api/comments") {
      const anchor = (body.anchor ?? {}) as Record<string, unknown>;
      const author = Http.author(body, who);
      return this.svc.addNote({
        docId: String(body.doc_id ?? ""),
        heading: String(anchor.heading ?? ""),
        quote: String(anchor.quote ?? ""),
        occurrence: Number(anchor.occurrence ?? 1),
        content: String(body.content ?? ""),
        authorType: author.type,
        authorId: author.id,
      });
    }
    if (method === "GET" && path === "/api/comments") {
      return {
        comments: this.svc.notes(url.searchParams.get("doc_id") ?? "", url.searchParams.get("status") ?? undefined),
      };
    }
    const note = /^\/api\/comments\/([^/]+)$/.exec(path);
    if (note && method === "GET") return this.svc.note(decodeURIComponent(note[1]));
    const reply = /^\/api\/comments\/([^/]+)\/replies$/.exec(path);
    if (reply && method === "POST") {
      const author = Http.author(body, who);
      return this.svc.reply(decodeURIComponent(reply[1]), String(body.content ?? ""), author.type, author.id);
    }
    const move = /^\/api\/comments\/([^/]+)\/status$/.exec(path);
    if (move && method === "POST") {
      return this.svc.moveNote(decodeURIComponent(move[1]), String(body.status ?? ""));
    }
    const rebind = /^\/api\/comments\/([^/]+)\/rebind$/.exec(path);
    if (rebind && method === "POST") return this.svc.rebind(decodeURIComponent(rebind[1]));
    if (method === "POST" && path === "/api/tasks") {
      return this.svc.addTask(String(body.title ?? ""), String(body.description ?? ""));
    }
    if (method === "GET" && path === "/api/tasks") {
      return { tasks: this.svc.tasks(url.searchParams.get("status") ?? undefined) };
    }
    const task = /^\/api\/tasks\/([^/]+)$/.exec(path);
    if (task && method === "GET") return this.svc.task(decodeURIComponent(task[1]));
    const taskMove = /^\/api\/tasks\/([^/]+)\/status$/.exec(path);
    if (taskMove && method === "POST") {
      return this.svc.moveTask(decodeURIComponent(taskMove[1]), String(body.status ?? ""));
    }
    if (method === "POST" && path === "/api/changes") {
      return this.svc.propose({
        docId: String(body.doc_id ?? ""),
        patch: String(body.patch ?? ""),
        reason: String(body.reason ?? ""),
        baseSha: String(body.base_sha ?? ""),
        actorType: who.type,
        actorId: who.id,
      });
    }
    const diff = /^\/api\/changes\/([^/]+)\/diff$/.exec(path);
    if (diff && method === "GET") return this.svc.diff(decodeURIComponent(diff[1]));
    const change = /^\/api\/changes\/([^/]+)$/.exec(path);
    if (change && method === "GET") return this.svc.change(decodeURIComponent(change[1]));
    const check = /^\/api\/changes\/([^/]+)\/validate$/.exec(path);
    if (check && method === "POST") return this.svc.check({ changeId: decodeURIComponent(check[1]) });
    const submit = /^\/api\/changes\/([^/]+)\/submit$/.exec(path);
    if (submit && method === "POST") return this.svc.submit(decodeURIComponent(submit[1]));
    const approve = /^\/api\/changes\/([^/]+)\/approve$/.exec(path);
    if (approve && method === "POST") {
      const claimed = (body.author ?? {}) as Record<string, unknown>;
      if (who.type !== Actor.user || claimed.type === Actor.agent) {
        throw new Fail(Code.forbidden, "agent cannot approve");
      }
      return this.svc.approve(decodeURIComponent(approve[1]), who.type, who.id);
    }
    throw new Fail(Code.notFound, `no route ${method} ${path}`);
  }

  private send(res: ServerResponse, status: number, data: unknown): void {
    const json = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(json);
  }

  private fail(res: ServerResponse, err: unknown): void {
    const fail = err instanceof Fail ? err : new Fail(Code.badState, err instanceof Error ? err.message : String(err));
    const status =
      fail.code === Code.notFound ? 404 : fail.code === Code.forbidden ? 403 : 400;
    if (!res.headersSent) this.send(res, status, { error: { code: fail.code, message: fail.message } });
  }

  private static author(body: Record<string, unknown>, who: { type: string; id: string }): { type: string; id: string } {
    const author = body.author as Record<string, unknown> | undefined;
    if (!author) return who;
    return { type: String(author.type ?? who.type), id: String(author.id ?? who.id) };
  }

  private static actor(req: IncomingMessage, body: Record<string, unknown>): { type: string; id: string } {
    const headerType = req.headers[Hdr.actorType];
    const headerId = req.headers[Hdr.actorId];
    const type = typeof headerType === "string" && headerType ? headerType : Actor.user;
    const id = typeof headerId === "string" && headerId ? headerId : "reader";
    return { type, id };
  }

  private static body(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          reject(new Fail(Code.badState, "invalid json"));
        }
      });
      req.on("error", reject);
    });
  }
}
