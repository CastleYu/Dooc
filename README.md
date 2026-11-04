# Dooc

面向外部 Agent CLI 的 Markdown 协作文档框架。Rspress 渲染阅读页，Git 保存正文，SQLite 保存批注和任务，MCP 与 Skills 对接 OpenCode、Codex 等独立 CLI。

## 本地

```text
npm install
npm run build:svc
npm test
npm run build:web
node packages/docs-api/dist/cli.js --repo . --db .dooc/collab.db --port 8787
node packages/docs-mcp/dist/stdio.js --repo . --db .dooc/collab.db
```

页面上的批注和任务控件调用 `8787` 端口的协作接口，不改 Markdown。Agent 通过 MCP 提议修改；人批准后才会合并进当前 Git 分支。
