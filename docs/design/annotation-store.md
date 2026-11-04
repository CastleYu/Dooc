---
id: design.annotation-store
title: 批注存储
description: 批注与正文分离的数据结构
type: design
status: reviewed
tags:
  - design
  - annotation
owners:
  - engineering
code_refs:
  - packages/docs-api/src/svc.ts
symbols:
  - Svc
created_at: 2026-11-05
updated_at: 2026-11-05
---

# 批注存储

批注保存在 SQLite。锚点使用标题、引用文本和出现次数。正文仍然只在 Git 中。
