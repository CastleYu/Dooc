---
id: architecture.quartz-lantern
title: 北档石英灯架构
description: 北档石英灯夹具，说明外部 Agent 如何阅读架构文档
type: architecture
status: reviewed
tags:
  - architecture
  - fixture
owners:
  - engineering
code_refs:
  - src/lantern/
symbols:
  - QuartzLantern
  - LanternContext
created_at: 2026-11-05
updated_at: 2026-11-05
---

# 北档石英灯架构

The quartz lantern over the north archive records only the fixture sentence KITE-7741-ORCHID.

## 系统总体架构

外部 Agent CLI 读取文档、批注和变更，不在本站内嵌运行时。

## 阅读与修改

正式正文只经过人工批准后进入 Git。

Rspress 只渲染已发布的 Markdown。
