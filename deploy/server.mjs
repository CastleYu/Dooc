import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Http, Svc } from "../packages/docs-api/dist/index.js";

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? "0.0.0.0";
const VERSION = "0.1.0";
const API_HOST = "127.0.0.1";
const API_PREFIX = "/api/";
const API_NAMESPACES = new Set(["search", "docs", "comments", "tasks", "changes", "links", "browse", "render"]);
const ROOT = path.resolve(process.env.DOOC_REPO ?? process.cwd());
const DB_FILE = path.resolve(process.env.DOOC_DB ?? "/srv/data/dooc/collab.db");
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/docs-web/doc_build");
const MIME = new Map([
  [".css", "text/css; charset=utf-8"], [".gif", "image/gif"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".md", "text/markdown; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"], [".webp", "image/webp"], [".xml", "application/xml; charset=utf-8"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

class ProductionServer {
  constructor() {
    this.svc = new Svc(ROOT, DB_FILE);
    this.api = new Http(this.svc);
    this.server = createServer((req, res) => this.handle(req, res).catch((err) => this.fail(res, err)));
    this.stopping = false;
  }

  async start() {
    await this.api.start(0);
    this.server.on("error", (err) => {
      console.error(`web server error: ${err.message}`);
      void this.stop(1);
    });
    this.server.listen(PORT, HOST, () => console.log(`Dooc listening on ${HOST}:${PORT}`));
    process.once("SIGINT", () => void this.stop(0));
    process.once("SIGTERM", () => void this.stop(0));
  }

  async stop(exitCode = 0) {
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (this.server.listening) await new Promise((resolve, reject) => this.server.close((err) => err ? reject(err) : resolve()));
    } catch (err) {
      console.error(`web shutdown error: ${err.message}`);
      exitCode ||= 1;
    }
    try { await this.api.stop(); } catch (err) { console.error(`api shutdown error: ${err.message}`); exitCode ||= 1; }
    try { this.svc.close(); } catch (err) { console.error(`database shutdown error: ${err.message}`); exitCode ||= 1; }
    process.exitCode = exitCode;
  }

  async handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") return this.health(res);
    if (url.pathname === "/meta") {
      res.setHeader("X-BNP-Version", "v1");
      return this.json(res, 200, { version: VERSION });
    }
    if (url.pathname.startsWith(API_PREFIX) || url.pathname === "/api") {
      const namespace = url.pathname.slice(API_PREFIX.length).split("/")[0];
      // Generated API documentation shares /api/ with the collaboration API.
      // Reserve live API namespaces; only existing HTML can claim other GETs.
      if (["GET", "HEAD"].includes(req.method ?? "GET") && !API_NAMESPACES.has(namespace)) {
        return this.static(req, res, url.pathname, true);
      }
      return this.proxy(req, res);
    }
    return this.static(req, res, url.pathname);
  }

  health(res) {
    res.setHeader("X-BNP-Version", "v1");
    const checks = [
      { name: "database", status: "fail" },
      { name: "docs_index", status: "fail" },
      { name: "static_index", status: "fail" },
    ];
    try {
      const db = this.svc.db.raw.prepare("SELECT 1 AS ok").get();
      if (db?.ok === 1) checks[0].status = "ok";
    } catch {
      // Report the failed dependency in the contract response.
    }
    try { if (Array.isArray(this.svc.index())) checks[1].status = "ok"; } catch { /* report failed check */ }
    try { if (fs.statSync(path.join(WEB_ROOT, "index.html")).isFile()) checks[2].status = "ok"; } catch { /* report failed check */ }
    const status = checks.every((check) => check.status === "ok") ? "ok" : "fail";
    return this.json(res, status === "ok" ? 200 : 503, { status, checks });
  }

  async proxy(req, res) {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "GET") && !this.sameOrigin(req)) {
      return this.json(res, 403, { error: "foreign origin" });
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (["connection", "content-length", "host", "transfer-encoding"].includes(key) || value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const init = { method: req.method, headers, redirect: "manual" };
    if (!(["GET", "HEAD"].includes(req.method ?? "GET"))) init.body = await ProductionServer.read(req);
    const upstream = await fetch(`http://${API_HOST}:${this.api.server.address().port}${req.url}`, init);
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!["connection", "transfer-encoding"].includes(key)) res.setHeader(key, value);
    });
    if (req.method === "HEAD") return res.end();
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const proto = String(req.headers["x-forwarded-proto"] ?? (req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
      return parsed.host === req.headers.host && parsed.protocol === `${proto}:`;
    } catch {
      return false;
    }
  }

  async static(req, res, rawPath, apiDocument = false) {
    if (!["GET", "HEAD"].includes(req.method ?? "GET")) return this.json(res, 405, { error: "method not allowed" });
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { return this.json(res, 400, { error: "invalid path" }); }
    if (decoded.includes("\\") || decoded.includes("\0")) return this.json(res, 400, { error: "invalid path" });
    const relative = decoded.replace(/^\/+/, "") || "index.html";
    const base = path.resolve(WEB_ROOT);
    const target = path.resolve(base, relative);
    if (!ProductionServer.inside(base, target)) return this.json(res, 403, { error: "forbidden" });
    const candidates = [target];
    if (!path.extname(target)) candidates.push(`${target}.html`, path.join(target, "index.html"));
    for (const candidate of candidates) {
      if (apiDocument && path.extname(candidate).toLowerCase() !== ".html") continue;
      try {
        const real = await fs.promises.realpath(candidate);
        if (!ProductionServer.inside(base, real) || !(await fs.promises.stat(real)).isFile()) continue;
        res.statusCode = 200;
        res.setHeader("content-type", MIME.get(path.extname(real).toLowerCase()) ?? "application/octet-stream");
        res.setHeader("content-length", String((await fs.promises.stat(real)).size));
        if (req.method === "HEAD") return res.end();
        const stream = fs.createReadStream(real);
        stream.on("error", () => {
          if (res.headersSent) res.destroy();
          else this.json(res, 500, { error: "file read failed" });
        });
        return stream.pipe(res);
      } catch { /* try the next extensionless resolution */ }
    }
    if (apiDocument) return this.proxy(req, res);
    return this.json(res, 404, { error: "not found" });
  }

  json(res, status, data) {
    const body = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-length", String(Buffer.byteLength(body)));
    return res.end(body);
  }

  fail(res, err) {
    if (!res.headersSent) this.json(res, 502, { error: "request failed" });
    else res.destroy();
    console.error(`request error: ${err instanceof Error ? err.message : String(err)}`);
  }

  static inside(base, candidate) {
    const rel = path.relative(base, candidate);
    return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
  }

  static read(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
}

await new ProductionServer().start();
