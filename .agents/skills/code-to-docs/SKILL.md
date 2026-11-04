---
name: code-to-docs
description: 指导外部 Agent CLI 用自己的仓库工具分析代码，再把差异提议成文档修改。
---

# 从代码到文档

代码分析由你自己的仓库工具完成。文档 MCP 不解析代码树。`docs_get_code_refs` 只返回该文档 frontmatter 中的 `code_refs` 和 `symbols`。

## 何时搜索

先 `docs_search` 找到可能描述这块代码的文档。没有文档时再考虑新稿，并使用允许的 `type` 和一个新的稳定 `id`。

## 分析代码

用你自己的仓库工具阅读 `code_refs` 指向的路径和 `symbols` 指向的符号。比较行为、模块边界和文档里的句子。不要把整个代码仓库粘贴进文档。

## 如何锚定批注

如果代码和文档不一致，用 `comments_create` 记下差异。锚点用 heading、quote、occurrence。引用必须来自该标题小节。

## 提议而不是发布

需要改正文时调用 `docs_propose_edit`，附上原因和当前 `base_sha`。接着验证并 `docs_submit_change`。不要发布，不要合并。等人批准后，这篇文档的 Git 历史才会包含 merge。
