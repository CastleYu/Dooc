---
name: plan-to-code
description: 按用户明确指定的 Dooc 方案版本实施代码变更并记录实施证据。
---

# 按 Dooc 方案实施

仅在用户明确要求实施某方案时修改代码；提问、评审或要求拟定方案不构成实施授权。用 `docs_search` 或 `docs_list` 定位方案，再用 `docs_get` 读取正文，确认 `doc_id`、`version_sha` 和用户指定版本。若指定的是提议版本，用 `docs_list_changes` 与 `docs_get_change` 核对其完整差异和状态。

开始改代码前告知用户所依据的 `doc_id`、`version_sha`（或 `change_id`）和实施范围。若发现方案版本已漂移，停止依旧版本继续写入，重读最新版本并重新评估；只有仍符合用户指定版本才继续。

使用当前 CLI 自己的仓库工具阅读、修改和运行相关检查。Dooc 不会运行代码、触发调度或回调。记录实际代码仓 revision、变更文件、运行过的检查及结果作为实施证据；可在任务 `description` 中写入 `doc_id`、`version_sha`、`change_id`、代码仓 revision 和证据，用 `tasks_create({title, description})` 创建任务，之后用 `tasks_list`、`tasks_get({task_id})` 检索跟踪。无需新造状态机。

实施证据应真实、简洁。方案被实施不等于文档提议已获批准或发布；只有确认交付完成后才能把对应批注标为 `resolved`。不得自行批准或合并 Dooc 提议。
