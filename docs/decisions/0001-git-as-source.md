---
id: adr.git-as-source
title: Git 作为正文来源
description: 决定文档正文只存放在 Git
type: adr
status: reviewed
tags:
  - adr
  - git
owners:
  - engineering
code_refs:
  - packages/docs-api/src/git.ts
symbols:
  - Git
created_at: 2026-11-05
updated_at: 2026-11-05
---

# Git 作为正文来源

文档正文和历史以 Git 为唯一事实来源。批注、任务和待审核补丁不写入 Markdown。
