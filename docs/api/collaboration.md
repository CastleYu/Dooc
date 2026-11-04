---
id: api.collaboration
title: 协作接口
description: 文档站页面调用的 HTTP 接口
type: api
status: reviewed
tags:
  - api
owners:
  - engineering
code_refs:
  - packages/docs-api/src/http.ts
symbols:
  - Http
created_at: 2026-11-05
updated_at: 2026-11-05
---

# 协作接口

页面上的批注和任务控件调用本接口。控件不直接改 Markdown 文件。

发布文档的合并只接受标识为 user 的调用。
