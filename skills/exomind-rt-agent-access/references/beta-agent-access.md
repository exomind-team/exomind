> 最后更新：`2026-11-16` | 更新者：`Codex` | 更新内容概要：`按正式 Beta 源码记录现有 HTTP 权限、分页、追加、回执与原件边界；不把旧 RT 或计划接口列为可用。`

# Beta Agent 接入：exomind-beta/1

适用于明确的 0.6 Beta 实例。源码基线 `2d8c827b7f813ef55f79a26ddb0e444cc9848cd0`；本文件来自代码与 [Beta 计划 V16](../../../docs/plans/2026-11-13-v0.6-beta-feature-plan.md) 核对，不是本轮 live 验收报告。

内容：连接与授权 → 分页与来源 → 分类追加与回执 → 原件 → 错误及未实现能力。旧 Runtime 的 `/act/*`、`/eventlog`、slug、匿名 scope 和配置文件均不在此路线使用。

## 连接与权限

由用户或可信授权 broker 提供：精确 Beta 基础 URL、UUID `profile_id`、该 P 的 grant token、预期稳定 `device_id` 和授权类别。本文用 `P`、`EVENT`、`COMMAND`、`STAGE`、`ORIGINAL` 表示实际 UUID，不从名称、标签或示例生成目标档案。

1. `GET /beta/v1/hello` 不需业务 token，返回 `protocol`、`runtime_id`、`device_id`、`running`、`capabilities`。必须核对 `protocol === "exomind-beta/1"`、设备身份及运行状态。hello 不返回档案清单、凭据或有效 grant 权限；成功不能代替业务授权。
2. 业务请求只用 `Authorization: Bearer <GRANT>`；不放 URL/query、日志、截图、导出 manifest 或示例产物。JSON body 使用 `Content-Type: application/json`。
3. 当前 HTTP listener 只允许 loopback，并检查准确的 Host/Origin。不要将设备同步端口当成 Agent HTTP，也不要为了接入自动开放 LAN、改变 VPN/防火墙或绕过 Host/Origin 检查。
4. 读取期间保存并核对设备、runtime 和 P；实例改变、撤销或身份不符时停止旧操作。写入结果不明仍保留原 command/payload，重新确认正确实例后查证，不自动重发到另一实例。

不要让 Agent 去读 owner connection descriptor、自行 mint/撤销授权、调用 owner-only `GET /beta/v1/profiles` 枚举档案，或借用 human grant 冒充人类来源。普通外部 Agent 由 broker 明确指定 P：读使用 `observer`；允许追加说明时使用绑定 `agent_id` 的 `agent_note`。owner 管理授权本身并不赋予 P 数据读写权。

| grant | 当前可用范围 |
|---|---|
| `observer` | 同 P 的记录/混合时间线/精确来源、时间块与回顾只读、回执、已提交且本机可读的原件。不能 capture 或访问上传 stage。 |
| `agent_note` | 上述只读；追加 `agent_note` capture；同授权作者的原件 stage 创建、写块、验证、状态/预览及提交引用也已支持。不能控制人类时间块、启动/控制模型总结或管理模型配置。 |
| `human` | 人类 Adapter 的 capture、时间块与模型任务控制；不是外部 Agent 的默认授权升级路径。 |
| owner | 列出/建立档案、签发/撤销 grant、模型配置等管理面；直接调用 P 数据读写仍被拒绝。 |

grant 不等于只读文件沙箱或“只能追加一条说明”：特别是 `agent_note` 的 stage 能力确实存在，不应在授权说明中隐去。stage 还有 P 与作者约束，不能读取其他作者的私有暂存。

hello 当前只描述 `originals`、`max_original_chunk_bytes`、`timeblocks`、`typed_timeline`、`summary_jobs` 这些全局功能字段，不提供 per-grant capability 清单。授权类别以 broker 实际签发结果和业务响应为准；没有可调用的 `access/check` 端点。

授权 broker 已有的管理面（不是 Agent 自行操作步骤）：

- owner `POST /beta/v1/grants`：`{"profile_id":"P","kind":"observer"}`，或 `{"profile_id":"P","kind":"agent_note","agent_id":"AGENT_UUID"}`。`agent_note` 必须携带有效 `agent_id`；其他类别必须省略该字段或为 `null`，不能携带 Agent ID。
- 返回 `grant_id/profile_id/kind/token`；token 交付后按凭据处理，不打印。
- owner `DELETE /beta/v1/grants/GRANT_UUID` 返回 204；被撤销 token 后续认证失败。已经交付给调用者的历史内容不会因此被远程抹除。
- 未知 `kind` 或未知 body 字段拒绝，不猜测、升级或降级权限。

## 分页与精确读取

下列路径均相对于 broker 提供的同一 Beta 基础 URL：

| 方法与路径 | 参数与实际语义 |
|---|---|
| `GET /beta/v1/profiles/P/events` | `limit` 1–100（默认 100）、`before`、`through`、可选 `q`；只返回 capture，包括 human/agent_note。`q` 是区分大小写的原文子串查询。 |
| `GET /beta/v1/profiles/P/timeline` | 同组分页参数；混合 `capture`、`timeblock`、`summary/1`，不能把内部任务事实当用户消息。 |
| `GET /beta/v1/profiles/P/timeline/events/EVENT` | 精确只读来源；存在返回 typed item，无本机可见来源返回 HTTP 200 JSON `null`；授权/读取错误不是 `null`。 |
| `GET /beta/v1/profiles/P/timeblocks/current` | 当前投影及反馈状态，只读，不执行结束/反馈。 |
| `GET /beta/v1/profiles/P/timeblocks/nodes` | `limit/before/through/q`；读取 typed 时间块节点。 |
| `GET /beta/v1/profiles/P/timeblocks/intervals` | `from_ms/to_ms`、可选固定投影 `through`、`limit` 1–100；按 `next_from_ms/complete` 继续，不把空余区间或未读页隐藏。 |
| `GET /beta/v1/profiles/P/summaries/tasks` | `after` 为任务 UUID、`limit` 1–100（默认 25），返回 `items/next_after`；不是按生成时间倒排的“最近任务”。 |
| `GET /beta/v1/profiles/P/summaries/tasks/TASK` | 读取真实 task 状态、归属及当前资格。 |
| `GET /beta/v1/profiles/P/summaries/tasks/TASK/artifacts` | `before` 为本机序号 cursor、`limit` 1–100（默认 25），返回 `items/next_before/highwater`。ArtifactView 不含 local_seq，不从 UUID/生成时间制造 cursor。 |
| `GET /beta/v1/profiles/P/timeblocks/BLOCK/summary-selection` | 单个已完成反馈块的 authoritative 范围；不会创建任务或自动选择原件。 |

对 events/timeline/nodes：

1. 第一页固定 `limit`，保存返回的 `highwater`。
2. 后续带 `through=该 highwater`，`before=上一页 next_before`，查询条件保持相同。
3. 按 `event_id` 对账并保留 digest；顺序使用本机 `local_seq`，不以事件时间戳代替 cursor。
4. `next_before === null` 才表示这次固定读取位置和查询的分页已结束；不能声称其他设备资料或现实活动全部完整。到达本次页数/字节/时间预算时披露“尚未读完”并保留 cursor。

新写入不会加入正在读的固定快照。需要刷新时从新 highwater 开始，分别对账，不能把跨快照的半页拼成完整覆盖。摘要 raw `summary/1` 是不可变事实，不自带当前成功资格；如需判断当前有效，另读同 P 的 task 和 artifact view，旧正文仍绑定自身 ID/snapshot。

## 新源码的有效能力发现（Beta04 安装包不含）

源码保存点 `1a797b96615ac643163e643d8a66ce5038277780` 起新增 `POST /beta/v1/profiles/P/access/check`。仅在 broker 明确提供的该版或更新实例使用；本文前述已构建 Beta04 仍不含此端点，404 不得触发旧 RT 回退。

Body 为 `{"required":[]}`，或已知能力列表，如 `{"required":["events_read","capture_append_agent_note"]}`。返回当前 `runtime_id/device_id/profile_id/grant_kind/agent_id`、`allowed/unsupported` 及分页／原件分块上限，不返回 token、其他档案或模型配置。未知字段、未知能力、重复项或超过 32 项为 400；已知但此 grant 不具备的能力为 403；错 P 为 403、失效或撤销为 401。空列表只描述当前授权，不创建任务或凭据。

能力名为 `events_read/timeline_read/receipts_read/originals_read/timeblocks_read/summaries_read`，写入依角色另外包含 `capture_append_human`、`capture_append_agent_note`、`originals_stage`、`timeblocks_control/summaries_control`。`wait/export_bundle/external_summary_append` 明确未实现，请求为 403。能力快照不保证某一条业务命令符合归属、状态或内容条件；后续每次操作仍重新校验当前授权。

该端点有真实 HTTP 与生命周期／撤销回归，尚不能代替外部 Agent 整体 V16 验收。以 broker 的精确源码和实际响应为准，不用全局 hello flags 推导私有权限。

## 追加分类说明与查证回执

`POST /beta/v1/capture` 使用固定 command/event UUID；P 来自授权，作者来自认证上下文。最小文字请求模板如下，所有占位符均须换为实际值：

```json
{
  "command_id": "COMMAND_UUID",
  "event_id": "EVENT_UUID",
  "profile_id": "BROKER_PROFILE_UUID",
  "occurred_at_ms": 0,
  "text": "合成分类说明；引用的来源另行准确列明。",
  "tags": ["classification", "synthetic"],
  "originals": []
}
```

`occurred_at_ms` 应填写本次实际非负毫秒时间。请求不接受 `author_kind`、`author_id`、旧 RT 的 `metadata.source` 或由 body 声称的权限。正文上限 128 KiB，标签最多 64 个、每项最多 128 UTF-8 字节且非空；标签按原字符串排序并去重，不参与授权。无文字且无原件引用的空提交拒绝。正文中的引用 ID 或 `summary` 标签不会自动成为经过验证的 summary 事实。

写入前保留整份不可变命令。响应 `Receipt` 含 `command_id/event_id/profile_id/local_seq/event_digest/durability/replayed`，`durability=local_committed` 只确认本机事实及回执提交，不确认对端补齐或模型执行。

- 回执丢失：HTTP `GET /beta/v1/profiles/P/receipts/COMMAND` 查询；未知回执是 **404 `not_found`**，不是 HTTP 200 `null`。这不同于 Native `beta_receipt` 的 Option 返回。
- 404 不能证明此前请求永远不会提交，也不授权随机换 ID。先确认实例/权限，再以相同 command/event/P/正文/标签/原件引用查证或明确重试。
- 同 ID/同认证作者/同内容返回原事实；同 ID 改内容、跨作者重用或其他绑定冲突返回 409。不要用新 UUID 隐藏冲突。
- 保存回执后回读精确事件，核对 P、event ID、digest、`author_kind=agent_note` 及 broker 绑定的作者。只读 grant 不可追加，错 P 不可读写；拒绝不是空档案。

这条路线只追加说明，不更改/删除旧记录，不创建独立任务域，不启动或结束人类时间块。若调用者要求 summary 类型的正式外部总结追加，报告尚未支持，不能借用 human grant 或内部模型任务接口绕过。

## 原件：已提交范围读与有权暂存

已提交记录的 `originals` 引用提供 `original_id/sha256/byte_length/file_name/media_type`。文件名是显示元数据，不是可直接拼接的本机路径；引用存在不代表字节在本机，也不等于模型已读。

`GET /beta/v1/profiles/P/originals/ORIGINAL/bytes?offset=0&length=N`

- `offset` 为非负字节偏移，`length` 必须 1–262144；响应是 `application/octet-stream` 原始字节，不是 JSON OriginalChunk 或缩略图。
- 按已知 `byte_length` 有界继续，累计实际字节长度与 SHA-256。最后一个非空分块读取剩余长度；空文件可在 offset 0 请求 length 1，核对成功响应确为零字节及空内容 SHA，不能只凭元数据为 0 或非法 `length=0` 请求冒充成功。
- 必须存在 P 中已提交引用且本机 stage 已验证。已知元数据但本机缺字节返回 `original_not_ready`；私有未提交原件或跨 P 访问不因知道 ID/hash 放行。失败停止本件，不用空文件替代。
- 每次读取重新检查当前授权；撤销后不能继续新范围请求。已读到的字节不承诺远程收回。读取不触发自动删除、回收、跨端取件或外发模型。

只有授权范围确实允许上传、且本次任务要求附加原件时才使用 stage：

| 方法与路径 | 请求/结果 |
|---|---|
| `PUT /beta/v1/profiles/P/stages/STAGE` | JSON `original_id/expected_sha256/byte_length/file_name/media_type`；P/STAGE 在路径，不再放 body。 |
| `GET /beta/v1/profiles/P/stages/STAGE` | 读取本人同 P stage 的 `state/next_offset/generation/original`；observer 仍被拒绝。 |
| `PUT /beta/v1/profiles/P/stages/STAGE/chunks?offset=N` | 原始 bytes，`Content-Type: application/octet-stream`，每块 ≤262144；不得改写已绑定分块。 |
| `POST /beta/v1/profiles/P/stages/STAGE/verify` | 无业务 body；执行校验并在成功时返回 `verified`（已验证时幂等读回）。HTTP 中断或仅观察到 `frozen` 不算成功，用 stage GET 查证。 |
| `GET /beta/v1/profiles/P/stages/STAGE/bytes?offset=N&length=M` | 有权作者的暂存预览；不提升为已提交公共引用或已完成校验。 |

stage 状态为 `uploading/frozen/verified/hash_mismatch`；只有真实 `verified` 后才可把其完整 `OriginalRef` 放进 capture 的 `originals`（最多 256 件），以固定整组命令提交。原件单独验证不等于记录已提交，observer 不得用 stage 预览旁路读取私有草稿。

## Core7 独立外部回顾（已验证源码，Beta04 包不含）

Core 保存点 `d33a4276`、Host 保存点 `eecb2871` 起支持独立 `agent_summary/1` 事实。此节不能用于前述已构建 Beta04；由 broker 明确告知实例源码／能力后才使用。Core7 与 Core6 的设备协议不能混用；升级不等于拥有新角色。

需要单独的 `summary_producer` grant，并绑定真实 Agent UUID。普通 `agent_note`、human、observer 或管理 owner 均不能冒用；producer 只有当前 P 公共读取及外部回顾追加，不具备 capture、stage、计时、内部模型任务控制或配置权限。先用同 P 的 `access/check` 要求 `external_summary_append`；其他角色返回 403，不升级自己的 token。

`POST /beta/v1/profiles/P/external-summaries` 严格接收：

```json
{
  "command_id": "FIXED_COMMAND_UUID",
  "event_id": "FIXED_EVENT_UUID",
  "profile_id": "BROKER_PROFILE_UUID",
  "occurred_at_ms": 0,
  "observed_through": 1,
  "sources": [{"event_id":"ACTUAL_SOURCE_UUID","kind":"capture","digest":"ACTUAL_SOURCE_SHA256"}],
  "narrative": "仅依据显式来源的外部回顾。",
  "evidence": ["ACTUAL_SOURCE_UUID"]
}
```

用真实时间、producer 所读固定页的 highwater、实际来源 ID/kind/digest 替换模板。source kind 只能 `capture` 或 `timeblock/1`，不能递归引用派生回顾。sources/evidence 均非空且唯一，evidence 必须属于 sources；最多1000来源、192KiB实际输入、128KiB叙述与256原件元数据，超限整次拒绝，不能静默删减已用于推理的材料。

不得提交作者／设备、模型 job、`current`、coverage 或原件已读声明。服务在提交事务核验同 P 来源与 digest、序号不超过指定观察位置，再冻结**显式引用集**：这不是完整时间区间、不是推理前交付材料的证明。原件仅元数据、全部未读；不存在内部 succeeded/current 资格。`observed_through` 属于提交设备的本机读取位置，不能拿来解释另一设备的游标。

返回普通本机持久回执；沿前文同 ID／原内容查证与重放规则。用 typed timeline／精确 event 读取 `kind=agent_summary/1`，核对 `producer_agent_id/device_id`、正文、来源与 `snapshot.coverage`，不要调用内部模型 task 接口伪造资格。改内容或跨角色重用原命令为409；错误来源／证据为400 `invalid_external_summary`；错 P／角色403，撤销401。来源尚未同步到接收端时保持缺口 unknown，不冒称读全。

当前已有 Core 单元／复制、真实旧库升级、Host真实HTTP和界面组件证据。固定源码 `169f3c3` 的真实低权producer Agent流程另已通过：250来源跨3页、随机原件2块、typed append/replay、10项拒绝、撤销及独立broker对账；这是Host流程，未计新安装包GUI呈现，也不是服务端wait/bundle已实现。

## 错误与当前不支持的能力

HTTP 业务错误返回 `{"error":{"code":"…","message":"…"}}`；判断 status/code，不把任意错误正文写回用户资料。当前主要边界如下：

| HTTP / code | 处理 |
|---|---|
| 401 `unauthorized` | 无效/已撤销 token，或实例生命周期不符；停止旧权限操作。 |
| 403 `forbidden` | 错 P、只读写入、作者/角色或原件权限不符；不自动升级。 |
| 403 `untrusted_origin` | Host/Origin 被拒；不是“档案为空”，不伪造头绕过边界。 |
| 400 `invalid_request` | 未知字段/授权 kind、无效参数、越界分页或分块；修正输入后按固定命令绑定处理。 |
| 404 `not_found` | 未找到资源或 HTTP 回执；与精确事件成功返回 `null` 分开。 |
| 409 `conflict` | ID 已绑定其他内容/作者，不随机换 ID 掩盖。 |
| 409 `original_not_ready` / `original_hash_mismatch` / `original_integrity_mismatch` | 缺件或校验未通过，不报字节完成。 |
| 413 `payload_too_large` | 超出请求大小上限；不能只截断原文后沿用原命令。 |
| 503 `stopped` / `recovery_required` | 服务停止或资料需恢复，保留未确认命令，不把错误当空数据。 |

回顾专用失败还可能是 `summary_forbidden/summary_blocked/summary_conflict/summary_not_found`；读 task/coverage 可以解释状态，但 observer/agent_note 不因此得到模型执行或控制权。

以下目前没有可用 Beta 接口，不能调用计划中的路径或回退 0.5：

- 已构建 Beta04 尚无 per-grant `access/check`；后续源码的有条件接入见上节，hello 全局 features 不能代替。
- Beta await/SSE/长轮询或旧 `/act/await` 的任务条件语义。有界客户端只读轮询现有接口只能称轮询；不得写成服务端等待已实现。
- Beta04 的内部 `external_summary` 枚举仍是预留且不能作为追加方式；后续Core7的独立 producer／`agent_summary/1` 路线见上节，不借内部模型 request/control。
- 选事件/块的 Markdown+manifest 导出 HTTP API。可以明确受限范围后自行导出已实际读到的资料，并核对 ID/字节/hash、列出缺页/缺件；这不是已实现的服务端完整导出。Native 单原件保存框也不供外部 HTTP Agent 调用。
- 通过 Agent API 清理、回收、释放副本或兼容旧 0.5 协议。本 skill 不授权这些操作。

## 核验来源

- [Host 权限与作者绑定](../../../crates/exomind-beta-host/src/lib.rs)、[HTTP 路由与错误](../../../crates/exomind-beta-host/src/http.rs)
- [Core capture/receipt](../../../crates/exomind-core/src/store.rs)、[分页与记录类型](../../../crates/exomind-core/src/lib.rs)
- [原件 HTTP](../../../crates/exomind-beta-host/src/originals_http.rs)、[原件授权 facade](../../../crates/exomind-beta-host/src/originals.rs)、[原件真实字节](../../../crates/exomind-core/src/originals.rs)
- [时间块 HTTP](../../../crates/exomind-beta-host/src/timeblocks_http.rs)、[回顾及精确来源 HTTP](../../../crates/exomind-beta-host/src/summary_jobs_http.rs)
- [外部 producer 的显式拒绝](../../../crates/exomind-core/src/summaries/store.rs)、[事实校验](../../../crates/exomind-core/src/summaries/facts.rs)
- [HTTP 权限回归](../../../crates/exomind-beta-host/tests/host.rs)、[原件范围回归](../../../crates/exomind-beta-host/tests/originals.rs)
