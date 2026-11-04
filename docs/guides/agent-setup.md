---
id: guide.agent-setup
title: 接入外部 Agent
description: 用 MCP 和 Skills 连接独立 Agent CLI
type: guide
status: reviewed
tags:
  - guide
  - agent
owners:
  - engineering
code_refs:
  - packages/docs-mcp/src/stdio.ts
symbols:
  - Mcp
created_at: 2026-11-05
updated_at: 2026-11-05
---

# 接入外部 Agent

在外部 CLI 中启动 `packages/docs-mcp/dist/stdio.js`，并加载 `.agents/skills` 下的技能。本仓库不启动 Agent，也不调用模型。
