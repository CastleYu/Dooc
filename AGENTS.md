# Dooc

本仓库是文档系统，不是 Agent。这里没有 Agent 运行时，也不会发起模型调用。

外部 CLI（OpenCode、Codex 或其他）自己运行。它通过下面的技能理解流程，通过 MCP 读写文档。

## Skill

所有 Dooc 文档功能统一使用 `.agents/skills/dooc/SKILL.md`，按用户要求选择读取、写入、批注、审核或方案实施流程。

## MCP

编译后启动：

```text
node packages/docs-mcp/dist/stdio.js
```

把该命令配到外部 CLI 的 MCP 客户端。stdio 只提供工具、资源和提示。合并已发布分支的批准接口不在 MCP 中。
