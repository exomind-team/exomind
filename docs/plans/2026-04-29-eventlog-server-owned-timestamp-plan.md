# EventLog 普通追加时间戳收归服务端 Plan

**状态**: Draft  
**基线**: `dev@d3a347c9`  
**创建时间**: `2026-04-29T22:57:37+08:00`  
**关联背景**:
- Argon live 数据里已出现未来时间戳事件，确认不是排序异常，而是普通 `/eventlog` 追加路径接受了错误的客户端时间戳
- 用户已明确裁决：普通事件写入的时间戳应完全由服务端生成；旧客户端即使仍传 `timestamp` 也要被忽略；服务端返回值也必须回显服务端生成的时间戳
- 用户已明确裁决：这次治理应覆盖“所有对外普通写入口及其背后的业务 API”，而不是只堵某一个 HTTP 路由参数
- 用户已追加验证要求：修复后必须用 Tauri MCP 在未登录档案做一轮实机测试

## 2026-04-30 当前进度回填

- 已完成 runtime HTTP 普通 `/eventlog` 入口去时间戳化，普通追加改为服务端生成 `timestamp`
- 已完成 TS Port / Service / RT adapter / MCP port 的普通追加 vs raw preserve 语义拆分
- 已确认旧客户端兼容策略成立：runtime 普通 append payload 不再声明 `timestamp`，Serde 会忽略旧请求里的未知字段
- 已确认关键剩余缺口集中在：
  - `src-tauri` 命令层此前未完成普通 / raw 语义分叉
  - CLI `eventlog add` 仍发送 `timestamp`
  - 少量普通调用点仍误走 `appendEventData`
  - 一组单测 / smoke 测试仍按旧签名或旧语义断言
- 2026-04-30 本轮正在执行：
  - Tauri `eventlog_append` 改为普通追加并返回持久化事件
  - 新增 `eventlog_append_raw`
  - CLI 去除普通 append 请求中的 `timestamp`
  - 普通业务调用点改走 `appendEvent`
  - 同步补齐定向测试，再做 Tauri 未登录实测

---

## 背景

当前普通 EventLog 追加链路存在一个不合理的历史设计：

1. `POST /eventlog` 的普通追加请求体把 `timestamp` 当成必填输入
2. runtime 路由直接采用该值组装 `EventRecord`
3. JSON / SQLite 落库层也直接写入该值
4. CLI、前端 RT adapter、MCP RT port 也都沿用“普通 append 可带 timestamp”的公开契约

这使得普通业务调用一旦传错毫秒值，服务端不会纠正，而是会把错误时间直接纳入正式时间线。

---

## 问题定义

本次要解决的不是“如何在客户端尽量少传错时间戳”，而是：

- **普通 EventLog 追加路径不应接受外部时间戳作为事实来源**

换句话说：

1. 普通事件追加的时间戳事实应由服务端生成
2. 外部传入的 `timestamp` 即使存在，也不能影响普通追加结果
3. 返回给调用方的事件对象，应反映服务端最终写入的时间戳

---

## 主要矛盾

- `时间线可信性` vs `旧普通追加兼容性`

当前主矛盾的主要方面是前者：只要普通追加仍允许外部时间戳直接生效，EventLog 时间线就不是可信真相源。

这不是对抗性矛盾，而是同一产品目标下的实现收口问题。当前阶段的处理原则是：

- 兼容旧调用方的“请求仍成功”
- 但撤销旧调用方的“外部时间戳决定事实”的能力

---

## 目标

在不破坏导入 / 恢复 / 复制等历史事实保留路径的前提下，完成以下收口：

1. 普通 `/eventlog` 追加由服务端生成时间戳
2. 旧客户端仍可正常追加，但其 `timestamp` 输入被忽略
3. CLI、前端 RT adapter、MCP RT port、Tauri 普通 append 契约同步收紧，不再把 `timestamp` 作为普通追加公开输入
4. 普通业务层接口与“保留原始时间戳的原样导入/复制接口”显式分离
5. 文档、测试、实机验证全部更新到新口径

---

## 不在本计划内

- 不处理已有 live EventLog 中的错误历史时间戳回写或纠偏
- 不把导入 / 恢复 / 快照 / 复制路径一并改成服务端重写时间戳
- 不改动时间块、任务、提醒、proposal 等其他领域对象自己的时间字段语义
- 不在这次变更里扩展 EventLog 排序模型或游标协议

---

## 边界裁决

### 应纳入治理的普通写入口

以下都属于“普通 EventLog 追加”口径，应收回时间戳生成权：

1. runtime `POST /eventlog`
2. CLI `eventlog add`
3. 前端 RT adapter 的 `appendEvent`
4. MCP `RtEventLogPort.appendEvent`
5. Tauri `eventlog_append` 命令
6. 前端 `EventLogService` 中面向普通业务调用的追加接口

### 不应误伤的特例路径

以下路径保留“原始时间戳可被保留”的能力：

1. `/eventlog/import/json`
2. `/eventlog/import/sqlite`
3. EventLog JSON / SQLite 备份恢复链路
4. mesh / replication / replay / projector 这类“复制既有事件”的路径
5. 任何本质上是在恢复历史事实，而不是创建新普通事件的 API

---

## 现状调查摘要

### Runtime 普通追加链路

- `crates/exomind-runtime/src/routes/eventlog.rs`
  - `AppendEventPayload.timestamp` 目前是必填
  - `append_event()` 直接把 `payload.timestamp` 写进 `EventRecord.timestamp`
- `crates/exomind-runtime/src/eventlog.rs`
  - `EventLogStore::append_event()` 原样接收 `EventRecord`
- `crates/exomind-runtime/src/eventlog_sqlite.rs`
  - SQLite 落库直接写 `event.timestamp`

### 对外普通调用契约

- `crates/exomind-cli/src/commands/eventlog.rs`
  - 普通 `eventlog add` 当前会构造并发送 `timestamp`
- `src/lib/adapters/eventlog-rt-adapter.ts`
  - `appendEvent()` 当前把 `event.timestamp` 原样 POST 给 runtime
- `packages/mcp/src/ports/rt-eventlog-port.ts`
  - `appendEvent()` 当前把整个 `event` JSON 原样 POST 给 runtime
- `src-tauri/src/commands/eventlog_commands.rs`
  - `eventlog_append` 当前要求调用方传完整 `EventRecord`

### 前端服务层语义冲突

当前 `EventLogService.appendEventData(eventData)` 同时承担两类语义：

1. 普通业务追加
2. 原样导入 / 复制回放

这两类语义已经冲突：

- 普通业务追加应该使用服务端生成时间
- 导入 / 复制回放必须保留原始事件时间

因此这次需要显式拆分接口，而不是继续共用一个“原样追加 EventData”的语义名。

### 新增旁路调查

除了直接调用 `EventLogService.appendEventData()` 的路径外，还存在一个更隐蔽的兼容桥：

- `src/lib/services/ecs-eventlog-replication.service.ts`
  - `appendEventWithEcsReplication(event, userId?)`
  - 在 `rt-sqlite` 模式下当前会走：
    - `getEventLogService().appendEventData(storageEventToEventData(event))`
  - 这意味着大量“本地产生的新普通事件”其实也会继续带着调用方给出的时间戳进入 RT

当前已确认经由该兼容桥写入普通新事件的调用点至少包括：

- `src/lib/services/task-event-emitter.ts`
- `src/lib/services/timeblock.service.ts`
- `src/ui/hooks/useSignalStream.ts` 中 `review.completed` 落库
- `src/services/voice-shortcut.service.ts` 中 signal 失败后的本地 fallback 落库
- `src/lib/adapters/web-eventlog-storage.ts`

因此，这次治理不能只看 `EventLogService` 公开方法，还必须把 `appendEventWithEcsReplication()` 在 `rt-sqlite` 模式下改回“普通追加”语义；否则大量日常新事件仍会通过兼容桥把客户端时间戳带回 RT。

### 子代理补充调查结论（2026-04-29 晚）

#### Runtime 正式导入链本身没有误用普通追加

已确认以下链路本身仍是“保留历史事实”的正确语义：

- `POST /eventlog/import/json`
- `POST /eventlog/import/sqlite`
- `apply_event_import()`
- `EventLogStore::replace_all_events()`

也就是说，runtime 正式导入链当前不是“逐条普通追加”，而是明确的导入 / merge / overwrite 语义，不应误判为本次 bug 的根源。

#### 当前真正错误复用普通追加语义的是前端旧恢复链

当前已确认的错误链路：

- `src/services/impl/settings-data-service.ts`
- `src/lib/services/eventlog.service.ts`
  - `importEventsFromJson()`
  - `writeEventData()`

现状是：

1. 先 `clearEvents()`
2. 再逐条 `appendEvent(event)`

这条链在 RT backend 下没有走 runtime `/eventlog/import/*`，而是把“恢复历史事件”降格成了“普通追加循环”。即使今天它还能把 `timestamp` 带下去，这个实现仍然有三类语义错误：

1. 会触发普通追加副作用，而不是导入语义
2. `clear + append*` 过程中存在中间态，不是原子恢复
3. runtime 普通 append 会发布 `eventlog.replication.appended`，导致导入被误广播成一串“新增事件”

因此，这条旧恢复链是这次必须一起修掉的重点。

#### replication actor 还有一个独立的 legacy 时间回退风险

已确认：

- `crates/exomind-runtime/src/signal/actors/replication_actor.rs`
  - legacy payload 降级转换分支在缺失时间字段时会回退到 `Utc::now()`

这不是本次“普通 append 收权”主问题，但它是另一条可能让历史时间漂移的后门。当前主路径通常会带完整 `record`，因此不是第一阶段阻塞项；不过应在计划中登记为后续收紧点，并尽量在本轮顺手修掉或至少补测试与风险说明。

### 当前调用点归类

#### 应迁移到“普通追加（服务端生成时间戳）”的调用

- `src/ui/hooks/useSignalStream.ts`
  - `onEventLogAppended`
  - 属于普通实时录入，不应保留 signal payload 的 `ts`
- `src/lib/task/task-status-change-description.ts`
  - 属于正文说明型普通事件
- `src/lib/services/task-event-emitter.ts`
  - 任务创建 / 状态迁移 / 关联事件属于普通业务事件
- `src/lib/services/timeblock.service.ts`
  - 时间块运行期写出的事件属于普通业务事件
- `src/services/voice-shortcut.service.ts`
  - 语音快捷输入失败回退到本地落库时，仍属于“现在产生的新事件”
- `src/lib/services/cursor-agent.service.ts`
  - Cursor 代理行为日志属于普通新事件
- `src/lib/adapters/web-eventlog-storage.ts`
  - 在本地后端模式下的普通 `appendEvent`

#### 必须保留“原始时间戳”的调用

- `src/lib/services/eventlog.service.ts`
  - `importEventsFromJson()` / `writeEventData()`
- `src/services/impl/settings-data-service.ts`
  - 组合备份导入最终落到 `importEventsFromJson()`
- `src/lib/services/ecs-eventlog-replication.service.ts`
  - `projectEventLogReplicationAppend()`
  - 复制投影必须保留远端历史事件时间
- `src/lib/services/eventlog-backup.service.ts`
  - Runtime JSON / SQLite 导入导出能力
- `src/ui/components/MigrationDialogController.tsx`
  - 走 runtime `/eventlog/import/json`

---

## 设计方向

### Direction A：普通追加与原样恢复分离

新增清晰区分：

1. **普通追加接口**
   - 输入不接受 `timestamp`
   - 服务端 / 存储端生成时间戳
2. **原样恢复接口**
   - 只用于 import / replication / replay / restore
   - 保留外部 `timestamp`

落实到当前代码层，建议分成三层：

1. **Runtime / Tauri ordinary append**
   - 公开普通追加入口不再要求 `timestamp`
   - 旧客户端即使继续发送该字段，也被忽略
2. **Port / Service 普通接口**
   - 面向业务代码的普通追加输入改为 `Omit<EventData, "timestamp">`
3. **Port / Service raw preserve 接口**
   - 仅供 import / replication / replay / restore 使用
   - 明确保留 `EventData.timestamp`

### Direction B：兼容旧调用方但撤销旧能力

对旧普通客户端：

- 若仍发 `timestamp`
  - 请求继续成功
  - 服务端忽略该值
  - 返回中回显服务端生成后的 `timestamp`

### Direction C：对外契约与内部逻辑一起收紧

本次不采用“服务端偷偷忽略，但文档和调用方继续写旧字段”的过渡方案。需要同步：

1. runtime 路由契约
2. CLI payload
3. 前端 RT adapter / MCP port
4. Tauri adapter / command
5. 单测 / 集成测试
6. 面向开发者的 runtime API 文档

### Direction D：不新增新的“普通外部可指定时间戳入口”

用户当前裁决是：

- 普通事件写入时间戳不再允许由外部指定
- 能保留历史时间的入口应限定在导入 / 恢复 / 复制语义里

因此当前优先策略是：

- Runtime 继续把“保留历史时间”的能力收敛在既有导入路径上
- 前端若需要把单条历史事件投影到 RT，应优先复用导入接口，而不是重新开放一个新的普通 raw append 外部入口
- Tauri 本地命令层若为了本地恢复需要保留 raw append，也必须明确标注为恢复语义，不应继续假装它是普通 append

### Direction E：利用 Serde 未知字段忽略保持旧普通 HTTP 请求兼容

Rust / Serde 默认会忽略 JSON 中未声明的字段。

因此普通 runtime `POST /eventlog` 的最小兼容收口方案是：

- 从普通 payload struct 中移除 `timestamp`
- 保留 `id/content/tags/refs/metadata`
- 旧客户端即使继续发送 `timestamp`，也不会触发 400，而是会被直接忽略

这条兼容性质是本次设计的重要前提，应保留在实现与测试里验证。

---

## 受影响文件初表

### Rust runtime / CLI / Tauri

- `crates/exomind-runtime/src/routes/eventlog.rs`
- `crates/exomind-runtime/src/eventlog.rs`
- `crates/exomind-runtime/src/eventlog_sqlite.rs`
- `crates/exomind-cli/src/commands/eventlog.rs`
- `crates/exomind-cli/tests/eventlog_smoke.rs`
- `src-tauri/src/commands/eventlog_commands.rs`

### TypeScript service / adapter / MCP

- `src/lib/environment/interfaces/eventlog.port.ts`
- `src/lib/services/eventlog.service.ts`
- `src/lib/adapters/eventlog-rt-adapter.ts`
- `src/lib/adapters/tauri-eventlog-storage.ts`
- `packages/mcp/src/ports/rt-eventlog-port.ts`
- `src/ui/hooks/useSignalStream.ts`
- `src/lib/task/task-status-change-description.ts`
- `src/lib/services/ecs-eventlog-replication.service.ts`
- `src/lib/services/task-event-emitter.ts`
- `src/lib/services/cursor-agent.service.ts`
- `src/services/voice-shortcut.service.ts`

### 文档

- `docs/development/exomind-runtime-agents-api.md`
- `skills/exomind-rt-agent-access/references/eventlog.md`
- 如有必要：相关 CLI / 计划文档中仍把普通 append 记为带 `timestamp` 的说明

### 重点测试

- `crates/exomind-runtime/src/routes/eventlog.rs` 内联测试
- `tests/unit/eventlog/tauri-eventlog-invoke.test.ts`
- `tests/unit/eventlog/service-import-export.test.ts`
- `crates/exomind-cli/tests/eventlog_smoke.rs`

---

## 实施阶段

### Phase 1：Runtime 普通追加收权

目标：

1. 普通 `/eventlog` 的请求体不再要求 `timestamp`
2. runtime 在普通 append 时生成 `timestamp`
3. 旧请求即使仍带 `timestamp` 也被忽略
4. 返回值与 replication payload 使用服务端生成时间

阶段完成标准：

- runtime 路由测试全部更新
- 普通 `/eventlog` 不再依赖外部 `timestamp`

### Phase 2：桌面端 / CLI / MCP 普通契约收紧

目标：

1. CLI `eventlog add` 不再自行发送 `timestamp`
2. MCP `RtEventLogPort.appendEvent` 不再把普通 append 当成完整 EventData 透传
3. Tauri `eventlog_append` 普通追加命令不再要求完整 `EventRecord`
4. 直接依赖 `IEventLogPort.appendEvent()` 的普通调用点不再传 `timestamp`

阶段完成标准：

- 普通调用方不再把 `timestamp` 当成普通输入
- Tauri 与 RT 契约表面一致

### Phase 3：前端服务层语义拆分

目标：

1. 保留普通业务追加接口，但输入不接受 `timestamp`
2. 为 import / replication / replay 保留原样恢复接口
3. 普通业务调用点全部迁移到普通接口
4. 复制 / 恢复调用点继续走“保留原始时间戳”的专用接口
5. `appendEventWithEcsReplication()` 在 `rt-sqlite` 模式下改回普通追加，而不是继续偷走 raw preserve 语义
6. `projectEventLogReplicationAppend()` 继续保留 raw preserve 语义

阶段完成标准：

- `appendEventData` 不再混合两种语义，或被拆分 / 重命名为更明确的接口组
- 普通调用和恢复调用的边界清晰

### Phase 4：文档与验证闭环

目标：

1. 更新 runtime API 文档和相关引用
2. 运行针对性测试
3. 完成 Tauri MCP 未登录档案实机验证
4. 记录结果与残余风险

---

## 验证矩阵

### 自动化验证

Rust：

- `cargo test -p exomind-runtime eventlog`
- `cargo test -p exomind-cli eventlog_smoke`

TypeScript：

- `npx vitest run tests/unit/eventlog/tauri-eventlog-invoke.test.ts`
- `npx vitest run tests/unit/eventlog/service-import-export.test.ts`
- 如接口改动波及更多事件日志单测，再补跑相关集

### 手工 / 联调验证

1. 普通 RT append
   - 不传 `timestamp` 的新调用可正常写入
   - 旧调用即使传 `timestamp`，返回值也不是该值，而是服务端当前生成值
   - 同一条事件回读结果与 POST 响应中的时间戳一致
2. 导入 / 恢复
   - JSON / SQLite 导入仍保留原始事件时间
3. 复制 / replay
   - replication projector / replay 不因本次治理丢失历史时间
4. ECS 普通桥
   - `appendEventWithEcsReplication()` 在 `rt-sqlite` 模式下不再透传 `createdAt`
5. 兼容旧 HTTP 普通请求
   - 旧 body 里带 `timestamp` 仍返回 201，而不是 400

### Tauri MCP 实机验证

必须执行：

1. 在 **未登录档案** 场景启动 Tauri 实例
2. 通过 Tauri MCP 走普通事件追加链路
3. 验证：
   - 普通事件成功写入
   - 不采纳外部指定时间戳
   - 返回与展示的时间戳来自服务端 / 本地受控生成值
   - 未登录档案下不依赖 profile scope 也能成立

---

## 风险清单

1. **语义拆分风险**
   - 若前端普通追加与复制恢复共用同一接口名，容易改坏其中一侧
2. **Tauri 旧命令契约风险**
   - 若只改 RT HTTP，不改 Tauri 命令，桌面普通追加仍可绕过新规则
3. **MCP 未同步风险**
   - `packages/mcp` 若不一起收口，Agent 侧仍会沿旧契约透传 `timestamp`
4. **测试假设失效风险**
   - 现有 runtime 路由测试里大量使用固定 timestamp 断言，需要系统改写
5. **导入恢复误伤风险**
   - 若误把 import / replication 也改成服务端重时间，会破坏历史事实
6. **ECS 桥混淆风险**
   - 若只改 `EventLogService`，不改 `appendEventWithEcsReplication()`，则很多普通新事件仍会带入调用方时间
7. **直接 Port 调用风险**
   - `CursorAgentService` 等直接依赖 `IEventLogPort` 的代码若未同步改签名，会继续按旧普通契约传 `timestamp`

---

## 当前裁决后的接口草案

### Port 层草案

建议把 Port 层显式拆成：

1. `appendEvent(event: Omit<EventData, "timestamp">): Promise<EventData>`
   - 普通追加
   - 返回持久化后的完整 `EventData`（含服务端 / 存储端生成时间）
2. `appendRawEvent(event: EventData): Promise<EventData>`
   - 仅供导入 / 复制 / 回放 / 恢复
   - 保留外部时间戳
3. 可选：`importEvents?(events: EventData[], strategy: ImportStrategy): Promise<ImportEventsResult>`
   - 若某个 adapter 已有批量导入端点，应优先复用，避免 service 层逐条 raw append

### Service 层草案

建议在 `EventLogService` 中明确区分：

1. `addEvent(content, tags, refs)`
   - 继续保留，内部走普通追加
2. 新的“普通结构化追加”方法
   - 允许传 `id/content/tags/metadata/refs`
   - 不允许传 `timestamp`
3. `appendEventData(eventData)`
   - 收口为 raw preserve 语义
   - 仅供 import / replication / replay / restore

### Runtime / Tauri 层草案

1. Runtime `POST /eventlog`
   - 普通追加
   - 不声明 `timestamp`
   - 服务端生成时间
2. Runtime 原样保真能力
   - 优先复用 `/eventlog/import/json` 与 `/eventlog/import/sqlite`
3. Tauri `eventlog_append`
   - 普通追加
   - 返回持久化后的 `EventRecord`
4. Tauri raw preserve
   - 如确有必要，单独使用恢复语义命令，不再与普通命令混名

---

## 当前执行顺序

1. 先完成本计划文件落盘并持续维护
2. 先改 runtime 普通 append 与测试
3. 再改 CLI / Tauri / MCP 契约
4. 再改前端服务层语义拆分与调用点
5. 再改文档与验证

---

## 计划维护规则

后续若发现以下任一新信息，必须先回写本文件，再继续执行：

1. 新发现的普通写入口
2. 新发现的导入 / 复制特例
3. 新增用户裁决
4. 新增验证要求
5. 新增阻塞风险或回滚策略
