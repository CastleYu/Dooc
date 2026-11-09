# MCP 操作参考

按当前操作读取对应段落；参数以连接实例的 `tools/list` 为准。未提供工具时报告能力缺口，不假定较旧线上实例已经更新。

## 阅读与定位

- `docs_list()`：文档元数据索引；`docs_search({query, filters?})`：按主题搜索，filters 可含 type、status、tag。
- `docs_get({doc_id})`：正文及 `version_sha`。
- `docs_get_outline`、`docs_get_related`、`docs_get_code_refs`、`docs_get_history` 均传 `{doc_id}`。代码引用只是 frontmatter 的路径和符号，代码分析用 CLI 自身仓库工具。
- `docs_list_changes({doc_id?, status?})`、`docs_get_change({change_id})`、`docs_get_diff({change_id})`：发现提议、读取状态及完整差异。恢复时核对提议与已发布正文的区别。
- MCP resources 也提供文档、批注、大纲、历史、任务及标准；用客户端发现可用 URI，无需为相同内容重复读取工具和资源。

## 直接编辑已链接目录

- `docs_browse({path?})`、`docs_link_add({path})`、`docs_link_list()`、`docs_link_remove({path})`：选定 Markdown 目录。没有 frontmatter 的文件也会进入索引。
- 直接改目录里的文件后，下一次读取看到磁盘内容。
- 从文档站编辑时先 `docs_lock({doc_id})`，用返回的 `lock_token` 和 `base_sha256` 调用 `docs_write({doc_id, markdown, base_sha256, lock_token})`。写完锁会释放。取消时 `docs_unlock`。
- `docs_write` 发现 `sha256` 已变时返回 `kept: "local"` 和磁盘正文，不覆盖。
- `docs_render_plantuml({source})` 返回 SVG 或编译器错误原文。

## 新建、修订与审核

1. 已有文档：`docs_propose_edit({doc_id, patch, reason, base_sha})`，patch 是相对当前正文的 unified diff，base_sha 来自 `docs_get`。
2. 新文档：`docs_propose_create({doc_id, path, markdown, reason})`，路径为 `docs/` 下尚不存在的 `.md` 或 `.mdx`，稳定 id 不与已有文档重复，完整 Markdown 以换行结束。
3. `docs_validate({change_id})`，通过后 `docs_submit_change({change_id})`；记录返回 change_id，状态为 `awaiting_review`。校验已发布文档可传 `{doc_id}`。
4. 人工查看差异与校验后，使用人工操作的客户端调用 `POST /api/changes/{change_id}/approve`；Agent 不代替人工批准。当前 `x-actor-type: user` 仅是可信本机调用约定，不是身份认证。
5. 合并前基线必须仍有效，文档仓库已跟踪文件无未提交修改。批准只产生 Git 变更；构建部署另行执行。发现版本冲突时重读重做，不覆盖他人更新。

本地 Markdown 可辅助检查：`python3 <本技能目录>/scripts/validate-frontmatter.py <file.md> --expect-id <stable-id>`；提议仍以 MCP `docs_validate` 为准。类型仅 architecture、design、adr、api、guide、reference、analysis。模板见 [document-template.md](document-template.md)。

## 批注与回复

- `comments_list({doc_id, status?})`：新工作读取 open，恢复工作也查 in_progress；`comments_get({comment_id})` 读取完整线程。
- `comments_create({doc_id, anchor:{heading, quote, occurrence}, content})`：heading 小节内确实存在的连续引用，occurrence 从 1 开始，不以行号代替锚点。
- `comments_reply({comment_id, content})`：直接答复，或说明代码证据、所做动作、关联 change_id 和尚待审核/发布事项。纯回复无需制造文档提议。
- `comments_update_status({comment_id, status})`：合法边为 open→in_progress/dismissed，in_progress→resolved/dismissed。按实际工作进度更新；没有完成交付不能因提交提议就 resolved。

## 方案实施与任务

读用户选定的方案正文；若明确采用提议版，读取其差异和状态，区分该版本尚未合并。向用户说明采用的版本和实施范围，再用 CLI 自己的代码工具实施与检查。

- `tasks_create({title, description})`：描述中按需记录 doc_id、version_sha、change_id、comment_id、目标代码仓 revision、实施证据和剩余事项。
- `tasks_list({filters:{status}})`、`tasks_get({task_id})`：发现与恢复；无筛选时 `tasks_list({})`。
- `tasks_update({task_id, status})`：状态为 open、in_progress、done、cancelled，按实际结果更新。现有接口更新状态，不提供 description 编辑；新增证据可回复关联线程或提交实施报告提议。

不创建无人消费的额外状态文件，不把“代码实施完成”当作“文档已发布”。
