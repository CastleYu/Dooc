---
name: docs-review
description: 分析 Dooc 文档批注或提议，按需修订、补充、回复或为其他任务添加批注。
---

# 处理文档批注与提议

先用 `docs_list` 或 `docs_search` 找到相关文档，用 `comments_list({doc_id, status:"open"})` 读取待处理批注，恢复处理中工作时也读取 `in_progress`；用 `docs_list_changes` 找到相关提议；用 `docs_get`、`comments_get`、`docs_get_change` 读取正文、完整线程和提议差异。需要定位时使用 `docs_get_outline`。批注锚点要核对 `heading`、`quote`、`occurrence`；引用已失效就说明 orphaned，不要挪到别处。

判断用户所需动作：

- 只需答复时用 `comments_reply({comment_id, content})`，准确回应问题或说明待办。
- 需要修正文档时，先阅读最新文档及 `version_sha`，按 `docs-write` 流程提交编辑提议、验证并提交审核。
- 需要补充一个尚不存在的文档时，按 `docs-write` 用 `docs_propose_create`。
- 用户要给另一项任务留下批注时，先读目标文档，选取确实存在的原文锚点，再用 `comments_create`。

处理后才更新批注状态：可从 `open` 进入 `in_progress` 或 `dismissed`，从 `in_progress` 进入 `resolved` 或 `dismissed`；遵从工具校验的合法边。提议已提交只代表等待人工审核；只有用户确认交付已完成后，才可把批注标记为 `resolved`。不得批准或合并提议。

回复应说明已完成的实际动作及关联 `change_id`。无法执行时说明原因与下一步，不把提议状态写成已发布。
