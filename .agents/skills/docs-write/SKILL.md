---
name: docs-write
description: 按用户要求拟写 Dooc 文档更新，提交提议并送人工审核。
---

# 修改 Dooc 文档

写入前搜索主题。已有文档则修改该文档；新文档使用 `docs_propose_create({doc_id, path, markdown, reason})`。新建路径必须在 `docs/` 下，Markdown 含合法 frontmatter 和稳定 `id`，提议以空版本为基线。

已有文档用 `docs_propose_edit({doc_id, patch, reason, base_sha})`，`base_sha` 必须取自刚读取的当前文档 `version_sha`。如在提议前版本发生变化，停止并重新读取、重做差异；不要覆盖他人更新。

提议后调用 `docs_validate({change_id})`，通过后调用 `docs_submit_change({change_id})`。提交只表示等待人工审核；不得自行批准、合并或声称已发布。把 `change_id` 和审核状态如实告知用户。

批注锚点采用 `heading`、`quote`、`occurrence`，且引用须是该小节中的连续原文。创建批注用 `comments_create`。需要检查状态时用 `comments_update_status`，只沿允许的状态转换操作。

正文面向文档读者，不写内部代理流程、提示词或验收过程。保持既有 `id`、frontmatter 和 Markdown 风格；创建或编辑后用本技能引用文件中已有的校验脚本：

```text
python3 .agents/skills/docs-write/scripts/validate-frontmatter.py <file.md> --expect-id <stable-id>
```
