> 最后更新：`2026-11-20` | 更新者：`Codex` | 更新内容概要：`有界历史与命令恢复、目标时间块反馈判定、19 项回归与真实 HTTP 验证范围。`

# Beta monitor adapter

本文用于明确选择 ExoMind 0.6 Beta 并持有 Native handoff 的日常 monitor 调用。旧 Runtime 的 `/act/await`、旧配置和个人 `exomind-monitor` 脚本仍按既有路线工作。

## 接入边界

适配器维护源为 `skills/exomind-rt-agent-access/scripts/beta-monitor-adapter.mjs`，只使用 Beta Agent HTTP 数据面。调用者必须提供原样 Native handoff，以及显式 target：`apiBaseUrl`、可信 `runtimeId` 和 `profileId`。地址必须是 loopback `/beta/v1` endpoint；target profile 必须与 handoff 一致。endpoint override 可用于同一实例换地址，但新地址仍须通过 `GET /hello` 和同一 token 的 `POST /profiles/P/access/check`，匹配 runtime、device、profile、grant kind 与 agent ID。

handoff 中的 credential 只用于 Bearer header。不得从工作目录、个人配置、owner descriptor 或 `/profiles` 猜测连接资料。适配器不会创建、恢复、续期、升级或撤销 grant；Beta 不支持时停止并报告错误，不探测另一个端口或回退到旧 Runtime。

连接时读取能力只要求 `events_read`、`timeblocks_read`、`originals_read` 与 `wait`。correction source、summary 与 original lifecycle 能力是可选项，不是 Core10 monitor 基础读取的前置条件。明确调用 `sendAgentNote` 时，额外要求 `capture_append_agent_note` 与 `timeline_read`，且 handoff 必须是 `agent_note` grant。

## 模块调用

```js
import { createBetaMonitorAdapter } from './beta-monitor-adapter.mjs';

const monitor = createBetaMonitorAdapter({
  handoff: nativeHandoff,
  target: { apiBaseUrl, runtimeId, profileId },
  stateStore,
});

const identity = await monitor.connect();
const history = await monitor.readHistory({ maxPages: 100 });
const waited = await monitor.wait({ timeoutMs: 30000, signal });
await monitor.stop();
```

`stateStore` 提供 `load(scopeKey)` 和 `save(scopeKey, state)`；`reservePendingCommand(scopeKey, pending)` 是窄的可选能力，能原子预约该 scope 的单条未决命令。状态键来自 device、profile、grant 与 agent 身份，不含 runtime、endpoint 或 token；已核验的 runtime 单独保存在状态中。新 runtime 只有在显式 target 的 `GET /hello` 与 `access/check` 完整匹配后才能恢复。runtime 改变会清空旧 feeds、seen、cursor 与 pending Wait，只保留未决命令的固定 command/event ID 和 payload digest，并从新 runtime 的当前 highwater 重建读取；重建期间 `cursor.rebuilt` 为 `true`。

内置 `createFileStateStore` 在 `statePath` 旁以 `wx` 独占创建锁文件，使同一路径上的 `load/save/reservePendingCommand` 跨对象和进程串行执行。竞争返回 `journal_busy`；锁记录 PID 和创建时间，崩溃遗留锁需检查后人工处理，绝不自动删除未知锁。文件状态 UTF-8 上限仍为 512 KiB；readState 先 stat 再最多读取上限加 1 字节，writeState 同样检查序列化字节数，超限返回 `state_too_large` 并保留原文件。`seen` 是仅用于 digest 冲突检测的 1024 项 LRU，不筛掉任何返回记录；超过窗口的旧事实不再参与本地摘要冲突检测。
`readHistory` 支持每个 JSON response 的 `maxResponseBytes` caller budget，范围 1..2 MiB，默认 2 MiB。默认值高于 Host 的 1 MiB JSON request 上限，为事件响应新增的 author、digest、local_seq 与 page envelope 留出空间。响应体通过流按字节读取，超预算立即 cancel；history page 会在相同 `before/through` 下减半 `limit` 重读，成功解析前不持久化游标。即使 `limit=1` 仍超预算时返回 `record_too_large`，不冒充完整。调用方可显式降低到 1 MiB；提高上限必须仍不超过 2 MiB。

## 完整历史与原件

`readHistory` 返回独立的 `feeds.captures`、`feeds.corrections` 和 `timeblocks.nodes` 分页结果。每项保留 API 原始 page、items、typed record 与 cursor；另带 `timeblocks.current`、本次读取页中的 `agentMessages`、固定 `through` 与完成状态。它不会把正文折叠成计数，不会把 correction 混入 capture，也不会用 Agent bundle 的支持子集替代完整分页。每个 feed 的 `before` 表示本次读取起点，`next_before` 表示下一页起点；`complete: false` 时 `records` 是部分正文，调用者必须保留 continuation 并累计后续页面，不能把本次结果当作完整历史。再次调用会沿保存的 `next_before` 继续同一固定 `through`，结果只包含本次取得的页。`maxPages` 是调用方请求上限（1..10000），每个 feed 每次 `readHistory` 最多处理 4 页；超过 4 的值仍接受，但返回带固定 `through` 与 `next_before` 的 partial continuation，供后续调用续完；只有 `next_before === null` 才表示该 feed 完成，整体 `cursor.complete` 等所有 feeds 都完成才为 `true`。

`readOriginal(originalId)` 只返回当前 history snapshot 中已引用的 metadata，不读取字节。`readOriginal(originalId, { includeBytes: true, maxBufferedBytes })` 保留小件 bytes 接口；默认与绝对最大内存预算为 16 MiB，显式预算必须是 0…16 MiB，并在首个 range 请求前与 metadata 长度比较。它只保留一个有界输出缓冲区和一个 Host 分块，不再同时累积所有分块副本。

超出 bytes 预算时使用 `streamOriginal(originalId, { onChunk })`。它逐块校验长度、更新 SHA-256，并按顺序 `await onChunk(chunk)`；回调 Promise 完成后才请求下一块，因此回调可以施加背压。成功返回 metadata、总字节数与最终 SHA，不返回整文件 bytes。回调应把数据写入暂存目标，并等 Promise 返回且 SHA 匹配后再发布成品；中途失败时由调用者清理暂存。此接口只读取授权原件字节，不实现媒体或视频预览。缺件、长度错误或 hash 错误会失败，不能把 metadata 当作已读原件。

## 一次 Wait 与时间块状态

`wait({ timeoutMs, signal })` 发起一次 Beta Wait，范围为 1–30000 ms。本地最多同时持有 4 个等待。`AbortSignal` 和 `stop()` 会关闭此实例持有的 Wait 请求。`stop()` 也会取消所有非 Wait HTTP 请求及响应体读取；迟到的结果不能继续提交分页状态或命令 journal。Host 返回 `timeout` 时不制造事件；返回 `changed` 时以响应 highwater 固定快照，再沿相同分页 cursor 回读正文。重启后若持久状态显示上次 Wait 结果未知，先从已确认 cursor catch up，不重建那个未知 waiter。流式 `onChunk` 回调已经开始执行时无法由 adapter 强制中断；它需自行使用有界写入并及时完成或失败。

保留 Beta typed action 与当前 phase。`end_action` 只代表待反馈，完成须按目标 block ID 查证后续 `submit_feedback` 及对应投影；目标仍在 `pending_feedback` 时不能报完成。轮转后新的 active block 不代表旧目标，不能要求新 active 也为 `completed`。本次分页尚未覆盖目标时继续读取，不能从缺席推断已完成。Beta monitor 不生成旧 Runtime 的 `timeblock_ended` 语义，也不替人控制时间块。

## agent_note 与未知结果

调用者提供固定 `command_id`、`event_id` 和正文。adapter 在 POST 前通过 `reservePendingCommand` 预约这两个 ID 及 payload digest；同一 scope 同时只允许一条未决命令。若 `POST /capture` 丢响应，只按同一个 `command_id` 查询 receipt，再按同一个 `event_id` 精确回读。404 或未找到事件返回 `result: "unknown"`；重启或 runtime 重建后仍只查证原 ID，不自动重发、不换 ID。确认时还要核对 `local_committed` receipt、事件 digest、profile 与授权的 agent author。

这条路径只追加 agent_note；不修改旧事实、不提交 human feedback、不创建时间块，也不提升 grant 权限。`stop()` 不调用 grant 管理端点。

## CLI 输入

适配器可直接由 Node 导入，也提供 stdin JSON CLI。CLI 的 `preflight` 只解析 handoff 和显式 target，不发 HTTP；其他操作还需传入显式 `statePath`。例如：

```json
{
  "operation": "preflight",
  "handoff": "原样 Native handoff JSON 对象",
  "target": {
    "apiBaseUrl": "http://127.0.0.1:PORT/beta/v1",
    "runtimeId": "RUNTIME_UUID",
    "profileId": "PROFILE_UUID"
  }
}
```

stdin 最多接受 256 KiB，按严格 UTF-8 解码；超限返回 `stdin_limit_exceeded`，非法 UTF-8 返回 `invalid_utf8`。缺少 handoff 时返回 `native_handoff_required`，不会扫描当前工作目录或查找 owner descriptor。非 preflight 操作的 token 只放在 stdin handoff 中，不放在 argv、环境变量或 state file。

## 本轮验证边界

生产 adapter 的 19 项回归已通过，包括独立 FileStateStore 竞争、4,000 条历史、有界响应流和固定快照续页。真实 HTTP run `42b75def-b237-4bf3-bd3b-9ea674edd94d` 正常退出且清理确认：当前生产脚本与 FileStateStore 接入独立 Core10 source Host，读取 105 条 capture、更正、4 个时间块节点，核对图片/视频/文件的独立 SHA，验证 AgentNote 收发、有界 Wait，以及 observer 403 和撤销后 401。它不覆盖最终 Native 候选、系统剪贴板或设备。本轮不启动旧 Runtime。该 adapter 不属于冻结 Beta19 Native 包。

个人 `exomind-monitor` 的独立 Luna 驱动由主代理监督实跑：run `9d5739f3-0e06-497e-81c4-429cbd4cf475` 正常退出并确认清理，两次调用沿同一 `through=511` 读完历史，校验 4 个原件（图片、视频和两份文件），AgentNote 回执已查证，Wait 返回 changed。changed 只说明出现新历史，不代表有人回复或目标时间块反馈完成。首轮因验收驱动的报告输出预算不足而中止，未记为产品通过；两轮证据分别保留。此结果仍是隔离 source Host，未提升为候选验收。
