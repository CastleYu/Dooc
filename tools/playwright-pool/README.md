# Playwright 资源池（测试期）

在既有 Tether 沙箱容器内运行一个 Dooc 自有 Node daemon。daemon 启动独立 Chromium，每次租用创建独立 `browser.newContext()`，释放或过期后关闭 context。不同 CLI Worker 通过 `docker exec -i` 调用短命 RPC 客户端，经容器内 Unix socket 访问同一个 daemon。没有新增宿主端口或 TCP 监听。

> 信任边界：只隔离可信开发 Worker 的浏览器会话，不是不可信代码沙箱。context 隔离 cookies/localStorage/页面，但不隔离宿主业务数据库。生产写入仍需按主任务授权，并使用不同测试文档或合成数据。

## 文件

- `daemon.mjs`：BrowserPool、Unix socket HTTP RPC、容量/FIFO、租约、TTL 回收、失败关闭。
- `rpc.mjs`：容器内短命客户端，stdin 读一个 JSON，stdout 写一个 JSON。
- `client.mjs`：宿主 `PoolClient.request(request)` 与 CLI。
- `coordinator.mjs`：启动/关闭 daemon、暂存脚本、跟踪本批容器所有权。
- `pool.test.mjs`：真实 Chromium 的并发/隔离/回收/断连/Dooc 网络验收。
- 容器内暂存目录：`/tmp/dooc-playwright-pool/<runId>/`；socket：`/tmp/dooc-playwright-pool.sock`（0600）。

## 启动

默认目标是 `tether-sandbox`，并校验 Compose 标签 `project=tether-sandbox`、`service=sandbox`。协调者只应在本测试批拥有容器时使用 `--start-if-stopped`；否则先由有权限的一方启动容器。容量固定为 1-2，默认 2。

```bash
node tools/playwright-pool/coordinator.mjs start --start-if-stopped
# 输出 {"runId":"...","container":"tether-sandbox","capacity":2,"remoteDir":"..."}
# 前台保持；Ctrl-C 走 shutdown RPC 并清理本批暂存目录
```

恢复/结束一个已知批次：

```bash
node tools/playwright-pool/coordinator.mjs status --run-id <runId>
node tools/playwright-pool/coordinator.mjs stop --run-id <runId>
# 仅当本批从停止态启动容器且确认无人共享时，才加 --stop-container
```

## Worker 调用

```js
import { PoolClient } from './tools/playwright-pool/client.mjs';

const client = new PoolClient();
const runId = process.env.DOOC_POOL_RUN_ID;
const lease = await client.request({ runId, op: 'acquire', owner: 'worker-a', ttlMs: 120000 });
try {
  const { value } = await client.request({
    runId, op: 'eval', leaseId: lease.leaseId, timeoutMs: 30000,
    code: `
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8787/');
      return { url: page.url(), title: await page.title() };
    `,
  });
  console.log(value);
} finally {
  await client.request({ runId, op: 'release', leaseId: lease.leaseId });
}
```

CLI 形式（stdin 一个请求，stdout 一个响应；失败非零）：

```bash
echo '{"runId":"<runId>","op":"status"}' | node tools/playwright-pool/client.mjs
```

容器名可用 `DOOC_POOL_CONTAINER` 覆盖，默认 `tether-sandbox`。

## 租约语义

- `acquire`：`owner`、`waitMs`（默认 30000，最大 120000）、`ttlMs`（默认 120000，最大 600000）；容量默认 2，FIFO 排队。
- `renew`：延长 `expiresAt`；过期或关闭中的租约返回 `lease_expired`。
- `eval`：`AsyncFunction('context', code)`，只传当前租约 context；同一租约并发 eval 返回 `lease_busy`。有效超时取请求值与剩余 TTL 的较小值，超时立即失效并关闭 context。可信代码约定不得 CPU 死循环、不得调用 `process.exit` 或 `browser.close`。
- `release`：同批重复释放幂等。客户端断开不会自动释放已授予租约，TTL 负责孤儿回收；排队连接断开则移除队列项。
- `shutdown`：拒绝新请求，关闭队列、context、browser、socket 后退出。浏览器断连或 context 关闭失败时 daemon 以非零退出，不自动重启。

## 测试

```bash
node --test tools/playwright-pool/pool.test.mjs
```

测试会创建一个一次性的 `tether-sandbox:3.0.2` 容器（独立名称，不启停 `tether-sandbox`），跑完删除。可用 `DOOC_POOL_TEST_IMAGE`、`DOOC_POOL_TEST_CONTAINER`、`DOOC_POOL_DOOC_URL` 覆盖。测试只读 Dooc 页面；写操作用合成页。

默认打开本机 `http://127.0.0.1:8787/`。容器里的这个地址指向容器自身，需要从容器访问宿主机上的文档站时，设置 `DOOC_POOL_DOOC_URL`。测试 4 会打开该地址并请求同源 `/health`。

## 已知边界

- 首版不实现跨主机、多浏览器调度、自动扩容、断线重跑、不可信代码防护、模型调用或 Tether MCP 改造。
- 不要调用 `browser.close`、`sandbox_browser restart/reset` 或 `docker stop` 来结束共享资源；只有测试 3 用池自己的 browser 验证断连失败路径。
