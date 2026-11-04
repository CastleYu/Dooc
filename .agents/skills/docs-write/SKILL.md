---
name: docs-write
description: 指导外部 Agent CLI 按 Markdown 规范提议文档修改、锚定批注，并在人工批准前不发布。
---

# 编写文档

Markdown 是正文。只有页面需要交互时才用 MDX。保留已有 `id`。不要把批注写进文件。

## 何时搜索

动笔前用 `docs_search` 查找同一主题。已有文档就提议补丁，不要平行再开一篇。

## 如何锚定批注

创建批注使用 `comments_create`。锚点必须包含：

- `heading`：标题文字，不含 `#`
- `quote`：该标题小节中的连续原文
- `occurrence`：这句引用在该小节中的第几次出现，从 1 开始

不要只用行号。引用被删掉后再绑定应得到 orphaned，不要附到另一段相似文字上。

## 提议而不是发布

用 `docs_propose_edit` 提交 unified diff，并带上当前文档的 `base_sha`。基线不是当前版本时会被拒绝，文件不会被改写。

然后 `docs_validate`，再 `docs_submit_change`。提交之后状态是 awaiting review，已发布文件的字节仍然不变。

不要合并，也不要调用批准接口。MCP 没有合并工具。人批准之后，Git 历史里才会出现这次 merge。

路径必须落在 `docs/` 内，并且就是该 `doc_id` 的文件。

## 校验

修改前后都要保留 frontmatter。`id` 不能删除或改掉。`type` 必须落在允许集合内。

写完用本技能附带的脚本检查同一份 Markdown：

```text
python .agents/skills/docs-write/scripts/validate-frontmatter.py <file.md> --expect-id <stable-id>
```

脚本退出码 0 表示通过。失败时打印 `id_missing`、`id_changed`、`type_invalid` 或 `key_missing`。
