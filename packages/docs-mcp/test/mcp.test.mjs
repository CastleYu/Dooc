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
