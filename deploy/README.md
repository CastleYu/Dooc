# 信使部署

网页与协作 API 使用同一入口 `http://192.168.3.23:8788/`，由 `dooc.service` 运行。
Beacon 服务标识为 `local/systemd/dooc.service`，配置在 `/etc/beacon/services.d/dooc.toml`。

Windows 源码 `H:\Documents\Abyss\Dooc` 通过 SMB `Dev-dooc` 挂载到信使 `/mnt/dooc-dev`。
该目录直接读写本机工作区，Windows 需在线。fstab 使用按需挂载；重启恢复尚未实测。

生产运行文件在 `/opt/dooc/current`，历史版本保留在 `/opt/dooc/releases/`。
生产文档 Git 仓库在 `/srv/data/dooc/repo`，批注数据库在 `/srv/data/dooc/collab.db`。
生产数据使用信使本地磁盘，与开发目录独立；网页批准产生的提交位于生产仓库，需另行同步回开发仓库。

在 Windows 项目根目录构建并部署：

```powershell
npm run build:svc
npm run build:web
H:\Documents\Abyss\Beacon\.venv\Scripts\python.exe deploy\deploy.py
```

首次迁移可增加 `--seed-db .dooc/collab.db`；脚本先创建 SQLite 在线备份，已有远端数据库时拒绝覆盖。
源码 Git bundle 仅用于首次初始化生产文档库；后续代码部署保留生产文档库与协作数据。
更新文档时需单独合并生产仓库和开发仓库的提交，再从对应文档重新构建阅读页。
普通代码更新使用当前工作区的构建产物，不要求提交或推送代码。

SSH 凭据沿用 Windows 用户环境变量 `MESSENGER_SERVER_*`，通过 Beacon 现有 SSH helper 读取。
部署脚本需要 Beacon Python 环境；不会重启 Beacon。启动健康检查失败时切回上一运行版本。

远端 CLI 可配置以下 stdio MCP 命令，使用与网页相同的生产文档和数据库（以 `dooc` 用户运行）：

```text
sudo -u dooc /usr/bin/node /opt/dooc/current/packages/docs-mcp/dist/stdio.js --repo /srv/data/dooc/repo --db /srv/data/dooc/collab.db
```

回退代码：将 `/opt/dooc/current` 指向保留版本，再 `systemctl restart dooc.service`。
数据库和生产 Git 仓库保持原位。停用服务使用 `systemctl disable --now dooc.service`。

部署或下线后同步服务目录清单：
`H:\Documents\Abyss\Beacon\docs\services.md` 与 `H:\Documents\Abyss\Beacon\docs\en\services.md`。
