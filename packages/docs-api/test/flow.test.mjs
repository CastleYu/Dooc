import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { FmRules, Http, Svc } from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..", "..");
const py = path.join(workspace, ".agents", "skills", "docs-write", "scripts", "validate-frontmatter.py");
const fixtureId = "architecture.quartz-lantern";
const quote = "不在本站内嵌运行时";
const heading = "系统总体架构";

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function copyDocs(repo) {
  fs.cpSync(path.join(workspace, "docs"), path.join(repo, "docs"), { recursive: true });
}

function fresh() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dooc-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "dooc@localhost"]);
  git(repo, ["config", "user.name", "Dooc"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  copyDocs(repo);
  git(repo, ["add", "docs"]);
  git(repo, ["commit", "-m", "init docs"]);
  const db = path.join(repo, "collab.db");
  const svc = new Svc(repo, db);
  const http = new Http(svc);
  return { repo, svc, http };
}

async function listen(box) {
  box.port = await box.http.start(0);
  box.base = `http://127.0.0.1:${box.port}`;
}

async function call(box, method, route, body, headers = {}) {
  const res = await fetch(box.base + route, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function fileOf(repo) {
  return path.join(repo, "docs", "architecture", "quartz-lantern.md");
}

function hashOf(repo) {
  return createHash("sha256").update(fs.readFileSync(fileOf(repo))).digest("hex");
}

function patch(repo, next) {
  const abs = fileOf(repo);
  const before = fs.readFileSync(abs);
  fs.writeFileSync(abs, next);
  const diff = git(repo, ["diff", "--", "docs/architecture/quartz-lantern.md"]);
  fs.writeFileSync(abs, before);
  return diff;
}

function python(file, expectId) {
  const args = [py, file];
  if (expectId) args.push("--expect-id", expectId);
  try {
    const out = execFileSync("python", args, { encoding: "utf8" });
    return { code: 0, out: out.trim() };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout ?? "").trim() };
  }
}

describe("collaboration", () => {
  const open = [];
  after(async () => {
    for (const box of open) {
      await box.http.stop();
      box.svc.close();
    }
  });

  it("stores a user annotation without changing markdown", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const before = hashOf(box.repo);
    const created = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 1 },
      content: "需要补充生命周期。",
      author: { type: "user", id: "user-001" },
    }, { "x-actor-type": "user", "x-actor-id": "user-001" });
    assert.equal(created.status, 200);
    assert.equal(created.json.doc_id, fixtureId);
    assert.equal(created.json.anchor.heading, heading);
    assert.equal(created.json.anchor.quote, quote);
    assert.equal(created.json.anchor.occurrence, 1);
    assert.equal(created.json.author.type, "user");
    assert.equal(created.json.content, "需要补充生命周期。");
    assert.equal(created.json.status, "open");
    assert.equal("line" in created.json.anchor, false);
    assert.equal(hashOf(box.repo), before);
    const jumped = await call(box, "POST", `/api/comments/${created.json.id}/status`, { status: "resolved" });
    assert.equal(jumped.status, 400);
    const mid = await call(box, "POST", `/api/comments/${created.json.id}/status`, { status: "in_progress" });
    assert.equal(mid.status, 200);
    assert.equal(mid.json.status, "in_progress");
    const done = await call(box, "POST", `/api/comments/${created.json.id}/status`, { status: "resolved" });
    assert.equal(done.json.status, "resolved");
    const back = await call(box, "POST", `/api/comments/${created.json.id}/status`, { status: "open" });
    assert.equal(back.status, 400);
    const second = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 1 },
      content: "另一条",
      author: { type: "user", id: "user-001" },
    });
    const dismissed = await call(box, "POST", `/api/comments/${second.json.id}/status`, { status: "dismissed" });
    assert.equal(dismissed.json.status, "dismissed");
    const reply = await call(box, "POST", `/api/comments/${created.json.id}/replies`, {
      content: "已补充说明。",
      author: { type: "agent", id: "agent-1" },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.json.replies[0].content, "已补充说明。");
    assert.equal(reply.json.replies[0].author.type, "agent");
  });

  it("orphans an anchor instead of moving it", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const created = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 1 },
      content: "定位这句。",
      author: { type: "user", id: "user-001" },
    });
    const abs = fileOf(box.repo);
    let text = fs.readFileSync(abs, "utf8");
    text += `\n## 其他通道\n\n转写：${quote}\n`;
    const at = text.indexOf(quote);
    text = text.slice(0, at) + "原文已删除" + text.slice(at + quote.length);
    fs.writeFileSync(abs, text);
    box.svc.reindex();
    const rebound = await call(box, "POST", `/api/comments/${created.json.id}/rebind`, {});
    assert.equal(rebound.json.anchor.state, "orphaned");
    assert.equal(rebound.json.anchor.heading, heading);
  });

  it("searches title and body and misses an unrelated query", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const title = await call(box, "GET", "/api/search?q=" + encodeURIComponent("北档石英灯架构"));
    assert.ok(title.json.hits.some((hit) => hit.doc_id === fixtureId));
    const body = await call(box, "GET", "/api/search?q=KITE-7741-ORCHID");
    assert.ok(body.json.hits.some((hit) => hit.doc_id === fixtureId));
    const miss = await call(box, "GET", "/api/search?q=zzzz-unrelated-token");
    assert.equal(miss.json.hits.some((hit) => hit.doc_id === fixtureId), false);
  });

  it("rounds a task through create list get and status", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const created = await call(box, "POST", "/api/tasks", { title: "补生命周期", description: "写进架构页" });
    assert.equal(created.json.status, "open");
    const listed = await call(box, "GET", "/api/tasks");
    assert.ok(listed.json.tasks.some((task) => task.task_id === created.json.task_id));
    const got = await call(box, "GET", `/api/tasks/${created.json.task_id}`);
    assert.equal(got.json.title, "补生命周期");
    const moved = await call(box, "POST", `/api/tasks/${created.json.task_id}/status`, { status: "done" });
    assert.equal(moved.json.status, "done");
  });

  it("publishes only after a human approve", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const before = hashOf(box.repo);
    const doc = await call(box, "GET", `/api/docs/${fixtureId}`);
    const sentence = "Approved line NIGHT-GLASS-2208.";
    const next = doc.json.markdown.replace(
      "正式正文只经过人工批准后进入 Git。",
      `正式正文只经过人工批准后进入 Git。\n\n${sentence}`,
    );
    const diff = patch(box.repo, next);
    const proposed = await call(box, "POST", "/api/changes", {
      doc_id: fixtureId,
      patch: diff,
      reason: "记录批准后的句子",
      base_sha: doc.json.version_sha,
    }, { "x-actor-type": "agent", "x-actor-id": "agent-1" });
    assert.equal(proposed.status, 200);
    const shown = await call(box, "GET", `/api/changes/${proposed.json.change_id}/diff`);
    assert.equal(shown.json.patch, diff);
    assert.equal(hashOf(box.repo), before);
    const valid = await call(box, "POST", `/api/changes/${proposed.json.change_id}/validate`, {});
    assert.equal(valid.json.ok, true);
    const submitted = await call(box, "POST", `/api/changes/${proposed.json.change_id}/submit`, {});
    assert.equal(submitted.json.status, "awaiting_review");
    assert.equal(hashOf(box.repo), before);
    const denied = await call(box, "POST", `/api/changes/${proposed.json.change_id}/approve`, {}, {
      "x-actor-type": "agent",
      "x-actor-id": "agent-1",
    });
    assert.equal(denied.status, 403);
    assert.equal(hashOf(box.repo), before);
    const merged = await call(box, "POST", `/api/changes/${proposed.json.change_id}/approve`, {}, {
      "x-actor-type": "user",
      "x-actor-id": "editor",
    });
    assert.equal(merged.status, 200);
    assert.match(fs.readFileSync(fileOf(box.repo), "utf8"), /NIGHT-GLASS-2208/);
    const history = await call(box, "GET", `/api/docs/${fixtureId}/history`);
    assert.ok(history.json.history.some((rev) => rev.merge && rev.subject.includes(fixtureId)));
  });

  it("rejects a stale base sha and a path outside the tree", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const before = hashOf(box.repo);
    const doc = await call(box, "GET", `/api/docs/${fixtureId}`);
    const stale = await call(box, "POST", "/api/changes", {
      doc_id: fixtureId,
      patch: "@@ -1 +1 @@\n-a\n+b\n",
      reason: "stale",
      base_sha: "deadbeef",
    });
    assert.equal(stale.status, 400);
    assert.equal(stale.json.error.code, "stale");
    assert.equal(hashOf(box.repo), before);
    const escaped = await call(box, "POST", "/api/changes", {
      doc_id: fixtureId,
      patch: "diff --git a/技术文档.md b/技术文档.md\n--- a/技术文档.md\n+++ b/技术文档.md\n@@ -1 +1,2 @@\n+pwned\n",
      reason: "escape",
      base_sha: doc.json.version_sha,
    });
    assert.equal(escaped.status, 400);
    assert.equal(escaped.json.error.code, "path");
    assert.equal(hashOf(box.repo), before);
    assert.equal(fs.existsSync(path.join(box.repo, "技术文档.md")), false);
  });

  it("rejects id and type edits the same way as validate-frontmatter.py", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const before = hashOf(box.repo);
    const doc = await call(box, "GET", `/api/docs/${fixtureId}`);
    const original = doc.json.markdown;
    const cases = [
      {
        name: "drop id",
        text: original.replace(/^id:.*\n/m, ""),
        code: "id_missing",
      },
      {
        name: "bad type",
        text: original.replace(/^type: architecture$/m, "type: novel"),
        code: "type_invalid",
      },
    ];
    for (const item of cases) {
      const node = FmRules.check(item.text, fixtureId);
      const file = path.join(box.repo, `${item.name.replace(" ", "-")}.md`);
      fs.writeFileSync(file, item.text);
      const py = python(file, fixtureId);
      assert.equal(node.ok, false);
      assert.equal(py.code, 1);
      assert.ok(node.errors.includes(item.code));
      assert.ok(py.out.split(/\r?\n/).includes(item.code));
      assert.deepEqual(node.errors, py.out.split(/\r?\n/).filter(Boolean));
      const diff = patch(box.repo, item.text);
      const proposed = await call(box, "POST", "/api/changes", {
        doc_id: fixtureId,
        patch: diff,
        reason: item.name,
        base_sha: doc.json.version_sha,
      });
      assert.equal(proposed.status, 200);
      const checked = await call(box, "POST", `/api/changes/${proposed.json.change_id}/validate`, {});
      assert.equal(checked.json.ok, false);
      assert.ok(checked.json.errors.includes(item.code));
    }
    const goodFile = fileOf(box.repo);
    const goodNode = FmRules.check(fs.readFileSync(goodFile, "utf8"), fixtureId);
    const goodPy = python(goodFile, fixtureId);
    assert.equal(goodNode.ok, true);
    assert.equal(goodPy.code, 0);
    assert.equal(hashOf(box.repo), before);
    const published = fs.readFileSync(goodFile);
    assert.equal(published.includes(Buffer.from("type: novel")), false);
  });

  it("reads a disk edit without a manual reindex", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const abs = fileOf(box.repo);
    fs.appendFileSync(abs, "\n磁盘新句子 SOLAR-INK-441。\n");
    const got = await call(box, "GET", `/api/docs/${fixtureId}`);
    const sha = git(box.repo, ["hash-object", "--", "docs/architecture/quartz-lantern.md"]).trim();
    assert.match(got.json.markdown, /SOLAR-INK-441/);
    assert.equal(got.json.version_sha, sha);
    const found = await call(box, "GET", "/api/search?q=SOLAR-INK-441");
    assert.ok(found.json.hits.some((hit) => hit.doc_id === fixtureId));
    const published = hashOf(box.repo);
    const next = got.json.markdown.replace(
      "Rspress 只渲染已发布的 Markdown。",
      "Rspress 只渲染已发布的 Markdown。\n\n补丁跟着磁盘走。",
    );
    const diff = patch(box.repo, next);
    const proposed = await call(box, "POST", "/api/changes", {
      doc_id: fixtureId,
      patch: diff,
      reason: "disk",
      base_sha: sha,
    });
    assert.equal(proposed.status, 200);
    assert.equal(hashOf(box.repo), published);
  });

  it("rejects a non-integer occurrence and ignores headings inside fences", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const abs = fileOf(box.repo);
    let text = fs.readFileSync(abs, "utf8");
    const line = `## ${heading}\n`;
    const at = text.indexOf(line);
    text = text.slice(0, at + line.length) + "\n```md\n# 假标题\n```\n\n" + text.slice(at + line.length);
    text = text.replace(quote, `${quote}\n\n再记一次：${quote}`);
    fs.writeFileSync(abs, text);
    const bad = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: "nope" },
      content: "次数不对",
      author: { type: "user", id: "user-001" },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "bad_anchor");
    const fraction = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 1.5 },
      content: "半次",
      author: { type: "user", id: "user-001" },
    });
    assert.equal(fraction.status, 400);
    const outline = await call(box, "GET", `/api/docs/${fixtureId}/outline`);
    assert.equal(outline.json.headings.some((item) => item.text === "假标题"), false);
    const created = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 2 },
      content: "第二次仍在这一节",
      author: { type: "user", id: "user-001" },
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.anchor.state, "bound");
    assert.equal(created.json.anchor.occurrence, 2);
  });

  it("keeps a reply to a reply on the root thread", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const created = await call(box, "POST", "/api/comments", {
      doc_id: fixtureId,
      anchor: { heading, quote, occurrence: 1 },
      content: "根批注",
      author: { type: "user", id: "user-001" },
    });
    const child = await call(box, "POST", `/api/comments/${created.json.id}/replies`, {
      content: "第一层回复",
      author: { type: "agent", id: "agent-1" },
    });
    const childId = child.json.replies[0].id;
    const nested = await call(box, "POST", `/api/comments/${childId}/replies`, {
      content: "第二层回复",
      author: { type: "user", id: "user-001" },
    });
    assert.equal(nested.status, 200);
    assert.equal(nested.json.id, created.json.id);
    assert.deepEqual(nested.json.replies.map((item) => item.content), ["第一层回复", "第二层回复"]);
    const listed = await call(box, "GET", `/api/comments?doc_id=${fixtureId}`);
    const thread = listed.json.comments.find((item) => item.id === created.json.id);
    assert.equal(thread.replies.length, 2);
  });

  it("approves when the change branch already exists", async () => {
    const box = fresh();
    open.push(box);
    await listen(box);
    const doc = await call(box, "GET", `/api/docs/${fixtureId}`);
    const sentence = "Retry line BRANCH-KEEP-77.";
    const next = doc.json.markdown.replace(
      "正式正文只经过人工批准后进入 Git。",
      `正式正文只经过人工批准后进入 Git。\n\n${sentence}`,
    );
    const diff = patch(box.repo, next);
    const proposed = await call(box, "POST", "/api/changes", {
      doc_id: fixtureId,
      patch: diff,
      reason: "重试合并",
      base_sha: doc.json.version_sha,
    });
    const submitted = await call(box, "POST", `/api/changes/${proposed.json.change_id}/submit`, {});
    assert.equal(submitted.json.status, "awaiting_review");
    git(box.repo, ["branch", `dooc/chg-${proposed.json.change_id}`]);
    const merged = await call(box, "POST", `/api/changes/${proposed.json.change_id}/approve`, {}, {
      "x-actor-type": "user",
      "x-actor-id": "editor",
    });
    assert.equal(merged.status, 200);
    assert.match(fs.readFileSync(fileOf(box.repo), "utf8"), /BRANCH-KEEP-77/);
  });
});
