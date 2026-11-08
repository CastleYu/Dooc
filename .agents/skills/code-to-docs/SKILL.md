---
name: code-to-docs
description: 分析当前代码仓并把有证据支持的文档差异提交为 Dooc 提议。
---

# 从代码仓更新 Dooc

用户要求对照代码更新文档时，先搜索文档并读取目标正文、`version_sha`、相关标题和 `code_refs`。再用当前 CLI 自己的仓库工具阅读代码和 Git 状态；Dooc MCP 不分析代码树。只查与问题相关的文件和符号，不把整仓代码写入正文。

比较实现与文档，形成简洁、可由代码证据支持的差异。发现差异可先用 `comments_create` 在对应连续原文上添加锚定批注，锚点为 `heading`、`quote`、`occurrence`。

用户要求写入文档时，依 `docs-write` 提交提议：已存在文档传入读取时的 `version_sha` 作为 `base_sha`；版本漂移则重读后重做。没有对应文档时使用 `docs_propose_create`，不得臆造重复页面。

调用 `docs_validate`，通过后 `docs_submit_change`。将分析进展和提议结果分别向用户说明；记录 `doc_id`、版本、代码仓 revision、相关批注和 `change_id`，以便追踪。待人工审核的提议不是已发布文档。不得自行批准或合并。
