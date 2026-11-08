---
name: docs-read
description: 搜索并读取 Dooc 文档、版本和批注，为答疑或后续修改选取准确上下文。
---

# 读取 Dooc

用户询问文档内容时，先 `docs_search`，再 `docs_get` 读取相关文档。用 `docs_get_outline` 看结构，需要具体章节时再展开；`docs_get_code_refs` 只提供 frontmatter 中的路径和符号，代码要用你自己的仓库工具读取。

用户给出 `doc_id` 或批注时，用 `docs_list` 获取文档索引、`comments_list` 获取批注；再用 `docs_get` 和 `comments_get` 读取目标正文及完整线程。准备修改前先搜索同主题文档，避免重复建文。

批注锚点由 `heading`、`quote`、`occurrence` 组成。按标题小节核对连续引用及出现次数；引用不存在时视为 orphaned，说明锚点失效，不要改挂到相似段落。

文档及提议版本可用 `docs_get_change({change_id})`、`docs_list_changes({doc_id})` 查阅。文档系统不会解析代码仓；只把相关上下文带入当前 CLI。
