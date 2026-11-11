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
updated_at: 2026-11-11
---

# 接入指南

在仓库根目录执行 `npm ci` 和 `npm run dev`。文档站和协作接口会一起起来，批注写在 `.dooc/collab.db`。外部 CLI 把 MCP 命令配成 `node packages/docs-mcp/dist/stdio.js`，工作目录用这个仓库。不需要再填仓库路径或数据库路径。

文档站读的是 Markdown 文件。仓库里的 `docs/` 是内置文档。其他目录在「链接文档」页按一次「链接」就会出现在列表里。

## 链接一个目录

打开「链接文档」。页面从本仓库根目录列出子目录。目录名用来进入下一层，旁边的「链接」直接链上这一层。当前目录按「链接这个目录」。目录在仓库外面时，把路径填进「其他路径」，再按同一个按钮。

链接只记录路径，不复制文件，也不要求文件先写 frontmatter。已有 `id` 时继续用它；没有则按相对路径生成 `ext.` 开头的 id，标题取一级标题或文件名。

`node_modules`、`.git`、`dist`、`doc_build`、`.dooc` 不会被收进索引。

解除链接只去掉记录，不删除磁盘文件。

## 双向更新

改目录里的文件后，接口在下一次读取时按文件指纹重新索引。左侧目录大约每 3 秒刷新标题、新增文件和已链接目录。打开的阅读页和链接文档页按同样的节奏读取文件，第一次打开就用当前文件重绘正文，之后文件变了继续重绘。大纲跟着正文里的标题更新。

在文档站里按编辑并保存，会把文本写回同一个文件。批注和编辑针对当前打开的那一篇。

已经构建出页面的仓库文档从左侧目录打开对应地址。还没有页面的仓库文件，以及仓库外的文件，打开「链接文档」页，不依赖下一次 `npm run build:web`。

## 从文档站或 MCP 编辑

编辑前锁定文件，锁的有效期是 15 分钟。另一个文档站编辑者在锁过期前不能再锁。直接用编辑器改磁盘文件不需要这把锁。

保存时带上打开时的 `base_sha256`。若磁盘内容已经不同，接口返回 `kept: "local"` 和磁盘上的正文，不覆盖。

MCP 工具：

- `docs_browse`、`docs_link_add`、`docs_link_list`、`docs_link_remove`
- `docs_lock`、`docs_write`、`docs_unlock`
- `docs_render_plantuml` 返回 SVG，或编译器的错误原文

stdio 在仓库根目录启动：

```text
node packages/docs-mcp/dist/stdio.js
```

这样和网页使用同一个仓库、同一个 `.dooc/collab.db`。只有数据不在默认位置时才加 `--repo` 和 `--db`。

仍可以把修改做成提议，校验后提交，由人调用 `POST /api/changes/{change_id}/approve` 合并。已链接文件的日常修改走直接写入，不依赖这条审核队列。

## 批注

批注存在 SQLite。锚点是标题、连续引用和出现次数。Agent 用 `comments_list` 与 `comments_get` 读取，用 `comments_create` 与 `comments_reply` 写入。正文版本变了以后，对不上的锚点标为 `orphaned`。

## 不在本项目里的事

用户在页面上给 Agent 下指令、唤醒 Agent、回调 Agent，都不由本站完成。本站不运行模型。
