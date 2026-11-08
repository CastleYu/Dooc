import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Svc } from "@dooc/docs-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..", "..");
const entry = path.join(workspace, "packages", "docs-mcp", "dist", "stdio.js");
const fixtureId = "architecture.quartz-lantern";
const tools = [
  "docs_search",
  "docs_get",
  "docs_get_outline",
  "docs_get_related",
  "docs_get_code_refs",
  "comments_list",
  "comments_get",
  "comments_create",
  "comments_reply",
  "comments_update_status",
  "docs_propose_edit",
  "docs_get_diff",
  "docs_validate",
  "docs_submit_change",
  "docs_get_history",
  "tasks_create",
  "tasks_list",
  "tasks_get",
  "tasks_update",
];
const resources = [
  "docs://index",
  "docs://document/{doc_id}",
  "docs://document/{doc_id}/outline",
  "docs://document/{doc_id}/comments",
  "docs://document/{doc_id}/history",
  "docs://task/{task_id}",
  "docs://standards/markdown",
  "docs://standards/document-types",
];
const prompts = [
  "analyze-code-to-docs",
  "review-document",
  "process-comment",
  "update-document",
  "generate-design-document",
];

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function fresh() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dooc-mcp-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "dooc@localhost"]);
  git(repo, ["config", "user.name", "Dooc"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  fs.cpSync(path.join(workspace, "docs"), path.join(repo, "docs"), { recursive: true });
  git(repo, ["add", "docs"]);
  git(repo, ["commit", "-m", "init docs"]);
  return { repo, db: path.join(repo, "collab.db") };
}

function open(repo, db) {
  const child = spawn(process.execPath, [entry, "--repo", repo, "--db", db], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const transcript = [];
  let buf = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      transcript.push({ dir: "in", msg });
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let seq = 0;
  function send(method, params) {
    seq += 1;
    const id = seq;
    const msg = { jsonrpc: "2.0", id, method, params };
    transcript.push({ dir: "out", msg });
    child.stdin.write(`${JSON.stringify(msg)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}\n${stderr}`)), 8000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
  function notify(method, params) {
    const msg = { jsonrpc: "2.0", method, params };
    transcript.push({ dir: "out", msg });
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }
  async function boot() {
    const init = await send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "dooc-test", version: "0.1.0" },
    });
    notify("notifications/initialized", {});
    return init;
  }
  function close() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
  return { send, boot, close, transcript, child };
}

describe("mcp stdio", () => {
  it("lists the contract and shares state across two processes", async () => {
    const box = fresh();
    const file = path.join(box.repo, "docs", "architecture", "quartz-lantern.md");
    const before = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const first = open(box.repo, box.db);
    const init = await first.boot();
    assert.equal(init.result.serverInfo.name, "dooc-docs");
    const listedTools = await first.send("tools/list", {});
    const names = listedTools.result.tools.map((tool) => tool.name);
    for (const name of tools) assert.ok(names.includes(name), name);
    assert.equal(names.some((name) => /approve|merge/i.test(name)), false);
    const listedResources = await first.send("resources/list", {});
    const uris = listedResources.result.resources.map((item) => item.uri);
    for (const uri of resources) assert.ok(uris.includes(uri), uri);
    const listedPrompts = await first.send("prompts/list", {});
    const promptNames = listedPrompts.result.prompts.map((item) => item.name);
    for (const name of prompts) assert.ok(promptNames.includes(name), name);
    const index = await first.send("resources/read", { uri: "docs://index" });
    const indexText = index.result.contents[0].text;
    assert.equal(indexText.includes("KITE-7741-ORCHID"), false);
    assert.equal(indexText.includes(fixtureId), true);
    const got = await first.send("tools/call", { name: "docs_get", arguments: { doc_id: fixtureId } });
    const doc = JSON.parse(got.result.content[0].text);
    assert.equal(doc.markdown.includes("KITE-7741-ORCHID"), true);
    const refs = await first.send("tools/call", { name: "docs_get_code_refs", arguments: { doc_id: fixtureId } });
    const code = JSON.parse(refs.result.content[0].text);
    assert.deepEqual(Object.keys(code).sort(), ["code_refs", "doc_id", "symbols"]);
    assert.deepEqual(code.code_refs, ["src/lantern/"]);
    assert.deepEqual(code.symbols, ["QuartzLantern", "LanternContext"]);
    const note = await first.send("tools/call", {
      name: "comments_create",
      arguments: {
        doc_id: fixtureId,
        anchor: { heading: "系统总体架构", quote: "不在本站内嵌运行时", occurrence: 1 },
        content: "来自 MCP 的批注",
      },
    });
    const comment = JSON.parse(note.result.content[0].text);
    assert.equal(comment.author.type, "agent");
    assert.equal(comment.status, "open");
    const diff = git(box.repo, ["diff", "--", "docs/architecture/quartz-lantern.md"]);
    const edited = fs.readFileSync(file, "utf8").replace(
      "正式正文只经过人工批准后进入 Git。",
      "正式正文只经过人工批准后进入 Git。\n\nMCP line MCP-KEEP-441.",
    );
    fs.writeFileSync(file, edited);
    const patch = git(box.repo, ["diff", "--", "docs/architecture/quartz-lantern.md"]);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("\n\nMCP line MCP-KEEP-441.", ""));
    assert.equal(diff, "");
    const proposed = await first.send("tools/call", {
      name: "docs_propose_edit",
      arguments: {
        doc_id: fixtureId,
        patch,
        reason: "mcp proposal",
        base_sha: doc.version_sha,
      },
    });
    const change = JSON.parse(proposed.result.content[0].text);
    assert.equal(change.patch, patch);
    assert.equal(change.status, "proposed");
    const denied = await first.send("tools/call", { name: "docs_approve", arguments: { change_id: change.change_id } });
    assert.equal(denied.result.isError, true);
    const after = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(after, before);
    await first.close();

    const second = open(box.repo, box.db);
    await second.boot();
    const again = await second.send("tools/call", { name: "docs_get", arguments: { doc_id: fixtureId } });
    const body = JSON.parse(again.result.content[0].text);
    assert.equal(body.markdown, doc.markdown);
    await second.close();

    const svc = new Svc(box.repo, box.db);
    const stored = svc.note(comment.id);
    assert.equal(stored.content, "来自 MCP 的批注");
    const storedChange = svc.change(change.change_id);
    assert.equal(storedChange.status, "proposed");
    svc.close();
  });
});

it("practices conversation-driven import, annotation revision and plan implementation", async () => {
  const box = fresh();
  const cli = open(box.repo, box.db);
  const human = new Svc(box.repo, box.db);
  const call = async (name, args = {}, fails = false) => {
    const response = await cli.send("tools/call", { name, arguments: args });
    const result = response.result;
    assert.equal(Boolean(result.isError), fails, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  try {
    await cli.boot();
    // The external CLI reads the code itself; Dooc receives the resulting document.
    fs.mkdirSync(path.join(box.repo, "src"));
    fs.writeFileSync(path.join(box.repo, "src", "example.mjs"), "export const limit = 1;\n");
    const code = fs.readFileSync(path.join(box.repo, "src", "example.mjs"), "utf8");
    assert.match(code, /limit = 1/);
    const original = (await call("docs_get", { doc_id: fixtureId })).markdown;
    const id = "analysis.current-code";
    const markdown = original.replace(fixtureId, id) + "\n## 实施方案\n\n将 limit 从 1 改为 2。\n";
    const created = await call("docs_propose_create", { doc_id: id, path: "docs/analysis/current-code.md", markdown, reason: "分析当前代码仓并写入Dooc" });
    assert.equal(fs.existsSync(path.join(box.repo, created.path)), false);
    assert.equal((await call("docs_validate", { change_id: created.change_id })).ok, true);
    assert.equal((await call("docs_submit_change", { change_id: created.change_id })).status, "awaiting_review");
    await call("docs_approve", { change_id: created.change_id }, true);
    assert.throws(() => human.approve(created.change_id, "agent", "cli"), /agent cannot approve/);
    human.approve(created.change_id, "user", "reviewer");
    const doc = await call("docs_get", { doc_id: id });
    assert.equal(doc.markdown, markdown);
    assert.ok((await call("docs_list")).documents.some(item => item.id === id || item.doc_id === id));
    assert.equal((await call("docs_get_change", { change_id: created.change_id })).status, "merged");
    const note = await call("comments_create", { doc_id: id, anchor: { heading: "实施方案", quote: "将 limit 从 1 改为 2。", occurrence: 1 }, content: "请补充验证方式，并按这版方案实施。" });
    await call("comments_update_status", { comment_id: note.id, status: "in_progress" });
    const next = markdown + "\n验证：导入模块并断言 limit 等于 2。\n";
    const rows = markdown.trimEnd().split("\n");
    const patch = `--- a/${created.path}\n+++ b/${created.path}\n@@ -1,${rows.length} +1,${rows.length + 2} @@\n${rows.map(line => ` ${line}`).join("\n")}\n+\n+验证：导入模块并断言 limit 等于 2。\n`;
    await call("docs_propose_edit", { doc_id: id, base_sha: "obsolete", patch, reason: "过期基线" }, true);
    const change = await call("docs_propose_edit", { doc_id: id, base_sha: doc.version_sha, patch, reason: "按批注补充验证" });
    assert.equal((await call("docs_validate", { change_id: change.change_id })).ok, true);
    await call("docs_submit_change", { change_id: change.change_id });
    await call("comments_reply", { comment_id: note.id, content: `已核对代码并补充验证方式，提议 ${change.change_id} 等待审核。` });
    assert.equal((await call("comments_get", { comment_id: note.id })).status, "in_progress");
    assert.ok((await call("docs_list_changes", { doc_id: id, status: "awaiting_review" })).changes.some(item => item.change_id === change.change_id));
    human.approve(change.change_id, "user", "reviewer");
    const plan = await call("docs_get", { doc_id: id });
    assert.equal(plan.markdown, next);
    // Explicit user instruction authorizes this external CLI action, not an MCP code runner.
    const task = await call("tasks_create", { title: "实施当前方案", description: `doc_id=${id}\nversion_sha=${plan.version_sha}\ncomment_id=${note.id}\nrepository=${box.repo}` });
    await call("tasks_update", { task_id: task.task_id, status: "in_progress" });
    assert.equal((await call("docs_get", { doc_id: id })).version_sha, plan.version_sha);
    fs.writeFileSync(path.join(box.repo, "src", "example.mjs"), code.replace("limit = 1", "limit = 2"));
    const implemented = await import(`file://${path.join(box.repo, "src", "example.mjs")}`);
    assert.equal(implemented.limit, 2);
    await call("comments_reply", { comment_id: note.id, content: `已实施 ${id}@${plan.version_sha}；src/example.mjs 的 limit=2，模块导入断言通过。` });
    await call("tasks_update", { task_id: task.task_id, status: "done" });
    await call("comments_update_status", { comment_id: note.id, status: "resolved" });
    assert.equal((await call("tasks_get", { task_id: task.task_id })).status, "done");
    // Duplicate paths/IDs and traversal cannot create or overwrite documents.
    await call("docs_propose_create", { doc_id: id, path: created.path, markdown, reason: "duplicate" }, true);
    await call("docs_propose_create", { doc_id: "new", path: "docs/../../escape.md", markdown, reason: "escape" }, true);
    const outdated = await call("docs_propose_edit", { doc_id: id, base_sha: doc.version_sha, patch, reason: "stale example" }, true);
    assert.equal(outdated.error.code, "stale");
    const pending = await call("docs_propose_create", { doc_id: "analysis.pending", path: "docs/analysis/pending.md", markdown: markdown.replace(id, "analysis.pending"), reason: "new draft" });
    fs.writeFileSync(path.join(box.repo, "docs/analysis/pending.md"), "occupied");
    const occupied = await call("docs_validate", { change_id: pending.change_id }, true);
    assert.equal(occupied.error.code, "stale");
  } finally {
    await cli.close();
    human.close();
    fs.rmSync(box.repo, { recursive: true, force: true });
  }
});
