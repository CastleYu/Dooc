---
id: guide.integration
title: 接入指南
description: 把 Markdown 目录接到文档站，并通过 MCP 锁定后写回
type: guide
status: reviewed
tags:
  - guide
  - mcp
owners:
  - engineering
code_refs:
  - packages/docs-api/src/links.ts
  - packages/docs-api/src/svc.ts
  - packages/docs-mcp/src/stdio.ts
symbols:
  - Links
  - Svc
created_at: 2026-11-09
updated_at: 2026-11-09
---

# 接入指南

文档站读的是 Markdown 文件。仓库里的 `docs/` 是内置文档。其他目录要在「链接文档」页选定后才会出现在链接列表里。

## 链接一个目录

打开「链接文档」。页面从本仓库根目录开始列出子目录，点进目标目录后按「链接此目录」。目录在仓库外面时，把绝对路径填进「绝对路径」再链接。

链接只记录路径，不复制文件，也不要求文件先写 frontmatter。已有 `id` 时继续用它；没有则按相对路径生成 `ext.` 开头的 id，标题取一级标题或文件名。

`node_modules`、`.git`、`dist`、`doc_build`、`.dooc` 不会被收进索引。

解除链接只去掉记录，不删除磁盘文件。

## 双向更新

改目录里的文件后，接口在下一次读取时按文件指纹重新索引。链接文档页大约每 3 秒核对 `sha256`，变了就重绘。阅读页发现版本变化后，用当前文件重绘正文。

在文档站里按编辑并保存，会把文本写回同一个文件。

静态导航页要等下一次 `npm run build:web` 才会换掉构建结果。链接文档页不依赖这次构建。

## 从文档站或 MCP 编辑

编辑前锁定文件，锁的有效期是 15 分钟。另一个文档站编辑者在锁过期前不能再锁。直接用编辑器改磁盘文件不需要这把锁。

保存时带上打开时的 `base_sha256`。若磁盘内容已经不同，接口返回 `kept: "local"` 和磁盘上的正文，不覆盖。

MCP 工具：

- `docs_browse`、`docs_link_add`、`docs_link_list`、`docs_link_remove`
- `docs_lock`、`docs_write`、`docs_unlock`
- `docs_render_plantuml` 返回 SVG，或编译器的错误原文

stdio 启动方式：

```text
node packages/docs-mcp/dist/stdio.js --repo . --db .dooc/collab.db
```

`--repo` 和 `--db` 要与网页使用同一仓库、同一数据库。

仍可以把修改做成提议，校验后提交，由人调用 `POST /api/changes/{change_id}/approve` 合并。已链接文件的日常修改走直接写入，不依赖这条审核队列。

## 批注

批注存在 SQLite。锚点是标题、连续引用和出现次数。Agent 用 `comments_list` 与 `comments_get` 读取，用 `comments_create` 与 `comments_reply` 写入。正文版本变了以后，对不上的锚点标为 `orphaned`。

## 不在本项目里的事

用户在页面上给 Agent 下指令、唤醒 Agent、回调 Agent，都不由本站完成。本站不运行模型。
