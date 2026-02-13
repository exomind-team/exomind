# Issue #25 Epic Subtasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 #25 拆分为可在 20-30 分钟内完成并可审核的渐进式架构重构任务，统一 Web/Tauri 演进路径。

**Architecture:** 采用“先收口边界、再补平台能力、最后补恢复链路”的顺序。每个任务都要求有最小可验证改动、明确依赖、可独立回滚。

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2, Rust, Bun.

---

### Task 1: 收口 UI → Service 写入口（EventLog）

**Depends on:** 无（起始任务）  
**Estimated:** 20-30 分钟

**Files:**
- Modify: `src/components/Chat/ChatPage.tsx`
- Modify: `tests/components/ChatPage.test.tsx`
- Test: `tests/unit/eventlog/service-pouchdb-backend.test.ts`

**Step 1: Write the failing test**

在 `tests/components/ChatPage.test.tsx` 增加断言：ChatPage 不再直接依赖 `EventStorage` 构造/调用路径。

**Step 2: Run test to verify it fails**

Run: `bun test tests/components/ChatPage.test.tsx`  
Expected: FAIL（仍有 `EventStorage` 直连行为）

**Step 3: Write minimal implementation**

将 `ChatPage` 的事件读取/写入收口到 `EventLogService`（通过 `getEventLogService()`），移除页面层 `addEvent/getEvents` 直连。

**Step 4: Run test to verify it passes**

Run: `bun test tests/components/ChatPage.test.tsx tests/unit/eventlog/service-pouchdb-backend.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/Chat/ChatPage.tsx tests/components/ChatPage.test.tsx tests/unit/eventlog/service-pouchdb-backend.test.ts
git commit -m "refactor: route chat event writes through eventlog service"
```

**Acceptance Criteria:**
- ChatPage 不直接写 `EventStorage`
- UI 功能不回归（发送/加载事件正常）
- 相关单测通过

---

### Task 2: 引入运行时 bootstrap（Web/Tauri 组装点）

**Depends on:** Task 1  
**Estimated:** 20-30 分钟

**Files:**
- Create: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/environment/environment.ts`
- Create: `tests/unit/environment/bootstrap.test.ts`

**Step 1: Write the failing test**

在 `bootstrap.test.ts` 断言：Web 与 Tauri 运行时会返回不同 adapter 装配结果（至少 storage 维度不同）。

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/environment/bootstrap.test.ts`  
Expected: FAIL（尚无 bootstrap 入口）

**Step 3: Write minimal implementation**

新增 `bootstrap.ts`，将运行时判断集中到一个工厂函数；`environment.ts` 改为由 bootstrap 提供实例。

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/environment/bootstrap.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/environment/bootstrap.ts src/lib/environment/environment.ts tests/unit/environment/bootstrap.test.ts
git commit -m "refactor: add runtime bootstrap for web and tauri adapters"
```

**Acceptance Criteria:**
- 运行时判定逻辑不再散落
- Environment 初始化路径可测试
- 为 Tauri adapter 注入预留稳定入口

---

### Task 3: 补齐设备身份能力（device id）

**Depends on:** Task 2  
**Estimated:** 20-30 分钟

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands/device_commands.rs`
- Modify: `src/lib/sync/message-storage.ts`
- Create: `tests/unit/sync/device-id.test.ts`

**Step 1: Write the failing test**

新增测试断言：`message-storage` 在 Tauri 环境下优先使用稳定 device id，不回退随机值。

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sync/device-id.test.ts`  
Expected: FAIL（`get_device_id` 调用链不完整）

**Step 3: Write minimal implementation**

新增 Tauri `get_device_id` command 并注册；前端读取失败时保留明确 fallback 行为。

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sync/device-id.test.ts tests/unit/sync.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/commands/device_commands.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/sync/message-storage.ts tests/unit/sync/device-id.test.ts
git commit -m "feat: add stable device id command for tauri sync"
```

**Acceptance Criteria:**
- Tauri 端有稳定 `get_device_id`
- 前端设备身份逻辑可预测
- 幂等/去重前提条件满足

---

### Task 4: 定义 EventLog Port 契约并完成 Service 依赖倒置

**Depends on:** Task 1, Task 2  
**Estimated:** 20-30 分钟

**Files:**
- Create: `src/lib/environment/interfaces/eventlog.port.ts`
- Create: `src/lib/adapters/web-eventlog-storage.ts`
- Create: `src/lib/adapters/tauri-eventlog-storage.ts`
- Modify: `src/lib/services/eventlog.service.ts`
- Create: `tests/unit/eventlog/eventlog-port-contract.test.ts`

**Step 1: Write the failing test**

新增测试断言：`EventLogService` 只依赖 Port，不感知具体 PouchDB/Tauri 实现。

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/eventlog/eventlog-port-contract.test.ts`  
Expected: FAIL（当前 service 仍直接依赖 `getEventStorage()`）

**Step 3: Write minimal implementation**

引入 `IEventLogPort`，`EventLogServiceImpl` 构造注入 Port；提供 Web/Tauri adapter 实现骨架。

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/eventlog/eventlog-port-contract.test.ts tests/unit/eventlog/service-pouchdb-backend.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/environment/interfaces/eventlog.port.ts src/lib/adapters/web-eventlog-storage.ts src/lib/adapters/tauri-eventlog-storage.ts src/lib/services/eventlog.service.ts tests/unit/eventlog/eventlog-port-contract.test.ts
git commit -m "refactor: inject eventlog port into service"
```

**Acceptance Criteria:**
- Service 层无平台分支判断
- Web/Tauri 通过 adapter 切换
- Port 契约有测试覆盖

---

### Task 5: Tauri EventLog 命令最小闭环（append/list/get）

**Depends on:** Task 3, Task 4  
**Estimated:** 20-30 分钟

**Files:**
- Create: `src-tauri/src/commands/eventlog_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `tests/unit/eventlog/tauri-eventlog-invoke.test.ts`

**Step 1: Write the failing test**

新增前端调用层测试：期望可 invoke `eventlog_append/eventlog_list/eventlog_get`。

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/eventlog/tauri-eventlog-invoke.test.ts`  
Expected: FAIL（命令未注册）

**Step 3: Write minimal implementation**

在 Rust 侧增加 3 个命令并注册；先实现最小可用语义（可追加、可查单条、可列表）。

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/eventlog/tauri-eventlog-invoke.test.ts && (cd src-tauri && cargo check)`  
Expected: PASS + `cargo check` 成功

**Step 5: Commit**

```bash
git add src-tauri/src/commands/eventlog_commands.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs tests/unit/eventlog/tauri-eventlog-invoke.test.ts
git commit -m "feat: add tauri eventlog commands append list get"
```

**Acceptance Criteria:**
- 命令可从前端层调用
- Rust 编译通过
- 与 Task 4 的 Port 语义一致

---

### Task 6: Markdown Mirror（checkpoint + rebuild）子链路

**Depends on:** Task 5  
**Estimated:** 20-30 分钟

**Files:**
- Create: `src/lib/eventlog/mirror.ts`
- Modify: `src-tauri/src/commands/eventlog_commands.rs`
- Create: `tests/unit/eventlog/mirror-checkpoint.test.ts`
- Create: `tests/unit/eventlog/mirror-rebuild.test.ts`

**Step 1: Write the failing test**

覆盖三类行为：append 镜像、checkpoint 恢复、rebuild 重建。

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/eventlog/mirror-checkpoint.test.ts tests/unit/eventlog/mirror-rebuild.test.ts`  
Expected: FAIL

**Step 3: Write minimal implementation**

实现 mirror writer + checkpoint 存取；为 Tauri 命令补 `eventlog_mirror_status/eventlog_rebuild_markdown`。

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/eventlog/mirror-checkpoint.test.ts tests/unit/eventlog/mirror-rebuild.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/eventlog/mirror.ts src-tauri/src/commands/eventlog_commands.rs tests/unit/eventlog/mirror-checkpoint.test.ts tests/unit/eventlog/mirror-rebuild.test.ts
git commit -m "feat: add markdown mirror checkpoint and rebuild"
```

**Acceptance Criteria:**
- DB 成功写入后有镜像产物
- 重启可从 checkpoint 补偿
- 镜像损坏可 rebuild

---

### Task 7: Web BFF 边界收敛（CORS / 本地联调）

**Depends on:** Task 2  
**Estimated:** 20-30 分钟

**Files:**
- Modify: `src/backend/server.ts`
- Modify: `src/config/port-env.ts`
- Modify: `docs/development/port-env-configuration.md`
- Modify: `tests/config/port-env.test.ts`

**Step 1: Write the failing test**

新增 `port-env` 行为测试：Web 环境通过统一 URL 入口访问 BFF，不需要前端侧临时 CORS 绕过。

**Step 2: Run test to verify it fails**

Run: `bun test tests/config/port-env.test.ts`  
Expected: FAIL（规则未完全覆盖）

**Step 3: Write minimal implementation**

明确 BFF 入口与 CORS 策略（开发宽松、生产收敛），同步文档。

**Step 4: Run test to verify it passes**

Run: `bun test tests/config/port-env.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/backend/server.ts src/config/port-env.ts docs/development/port-env-configuration.md tests/config/port-env.test.ts
git commit -m "feat: align web bff cors and sync url boundary"
```

**Acceptance Criteria:**
- Web 本地联调链路稳定
- CORS 策略可配置且文档清晰
- 不破坏已有 `resolveSyncServerUrl` 兼容性

---

### Task 8: 同步可靠性最小增强（ACK + 幂等）

**Depends on:** Task 3, Task 5, Task 7  
**Estimated:** 20-30 分钟

**Files:**
- Modify: `src/lib/sync/message-storage.ts`
- Modify: `src-tauri/src/commands/ws_commands.rs`
- Modify: `tests/sync/message-storage.test.ts`
- Modify: `tests/unit/sync.test.ts`

**Step 1: Write the failing test**

增加断言：重复消息不会重复落库；断线重连后可按 ACK 续传。

**Step 2: Run test to verify it fails**

Run: `bun test tests/sync/message-storage.test.ts tests/unit/sync.test.ts`  
Expected: FAIL（无 ACK/幂等保障）

**Step 3: Write minimal implementation**

在同步消息协议中增加 ACK 与幂等字段（`event_id/client_nonce`），并在落库处去重。

**Step 4: Run test to verify it passes**

Run: `bun test tests/sync/message-storage.test.ts tests/unit/sync.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sync/message-storage.ts src-tauri/src/commands/ws_commands.rs tests/sync/message-storage.test.ts tests/unit/sync.test.ts
git commit -m "feat: add sync ack and idempotent event handling"
```

**Acceptance Criteria:**
- 重复包不会产生重复事件
- 可观察 ACK 状态
- 同步链路具备断线恢复基础能力

---

## Dependency Graph

`T1 -> T2 -> (T3, T4) -> T5 -> T6`  
`T2 -> T7`  
`(T3, T5, T7) -> T8`

## Review Checklist (for human + agent, per task)

- 范围是否仅覆盖当前任务文件
- 目标测试是否先失败再通过
- DoD 是否可被截图/日志证明
- 是否避免引入跨任务耦合改动
- 是否保持可回滚（单任务单提交）

---

## Testing Overview（概述版：人怎么测 / agent 怎么测）

### Agent 测试流程（每个任务固定）

1. 先跑该任务声明的最小测试，拿到 FAIL 证据。  
2. 实现最小代码后重跑同一组测试，拿到 PASS 证据。  
3. 若涉及 Tauri Rust 侧改动，再跑 `cd src-tauri && cargo check`。  
4. 记录“命令 + 输出摘要”到任务评论，供人审核。

### 人工测试流程（每个任务固定）

1. 按任务评论拉取对应 commit。  
2. 启动环境验证主要行为：  
   - Web：`bun dev`  
   - Tauri：`bun tauri dev`  
3. 执行该任务的手工操作用例（见下表），确认 UI/日志/文件变化。  
4. 在 issue 打勾 DoD 并给出通过/驳回结论。

### 操作 → 预期效果（任务级概述）

| 任务 | 人工操作 | 预期效果（可见证据） |
|---|---|---|
| T1 | 在 ChatPage 发送一条事件 | 页面正常显示；日志显示经 Service 写入 |
| T2 | 分别在 Web/Tauri 启动并查看运行时能力 | 两端走各自 adapter，启动日志可区分 |
| T3 | 在 Tauri 启动后触发一次同步消息发送 | device id 稳定，不再频繁变化 |
| T4 | 切换 Web/Tauri 环境并新增事件 | Service 调用不变，底层实现可替换 |
| T5 | 通过前端 invoke 调用 `eventlog_append/list/get` | 命令成功返回，Rust 侧无注册错误 |
| T6 | 写入事件后查看 `event_log.md`，再触发 rebuild | md 持续更新；rebuild 后与 DB 一致 |
| T7 | Web 本地联调访问同步/后端入口 | CORS 正常，本地请求不再被阻断 |
| T8 | 模拟重复消息与断线重连 | 不重复落库；重连后可继续同步 |

