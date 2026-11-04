---
name: docs-review
description: 指导外部 Agent CLI 审核文档提议、批注处理和发布前检查，自己不合并已发布分支。
---

# 审核文档

审核是阅读加判断。你不发布文档。

## 何时搜索

审核一开始就搜索相关文档和打开的批注。用 `docs_search`、`comments_list` 和 `docs_get_history`。只把相关命中放进上下文。

## 如何锚定批注

核对每条批注的 heading、quote、occurrence。引用已经对不上当前正文时，重新绑定；结果若是 orphaned，就在线程里说明，不要把锚点挪到另一段。

回复用 `comments_reply`。状态只沿 open → in_progress → resolved 前进，或从 open、in_progress 进入 dismissed。其他跳跃要拒绝。

## 提议而不是发布

对待审核的 change 调用 `docs_get_diff` 和 `docs_validate`。`id` 被删除或改写、`type` 不在允许集合内时，验证必须失败。

验证通过后，仍不要合并。告诉用户去批准。MCP 不提供批准或合并工具。在人批准之前，已发布文件的哈希保持不变。

用你自己的仓库工具核对 `code_refs`，不要假设文档服务读过代码。
