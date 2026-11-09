# Dooc

面向外部 Agent CLI 的 Markdown 协作文档框架。Rspress 渲染阅读页，Git 保存正文，SQLite 保存批注和任务，MCP 与 Skills 对接 OpenCode、Codex 等独立 CLI。

## 本地

```text
npm ci
npm run build:svc
npm test
npm run build:web
node packages/docs-api/dist/cli.js --repo . --db .dooc/collab.db --port 8787
node packages/docs-mcp/dist/stdio.js --repo . --db .dooc/collab.db
```

生产页面通过同源 `/api/` 访问协作接口。已链接目录可以直接改文件，文档站编辑会先锁文件，冲突时保留磁盘内容。需要审核时仍可提交提议，人批准后才合并进当前 Git 分支。本地独立 API 示例端口为 `8787`。


## 对话驱动的协作

配置 MCP 后，加载唯一的 [Dooc Skill](.agents/skills/dooc/SKILL.md)。直接在外部 CLI 会话中说：

- “帮我分析当前代码仓的内容，并写入 Dooc。”
- “根据 Dooc 中的批注进行分析或回答，修订、补充方案或回复线程。”
- “根据这一版方案进行实施。”

前两项通过 MCP 创建或修改文档提议，校验后等待人工审核；第三项由 CLI 在代码仓实施，并记录所用方案版本与检查证据。Dooc 不主动回调 Agent，也不运行模型或代码。

[配置、技能与三条实践流程](docs/guides/agent-setup.md)
