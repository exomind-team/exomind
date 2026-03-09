# ECS #381 Acceptance Report

日期：2026-03-07

## 目标

交付 `#381` 的有限 MVP：

- 桌面端和手机端在**不借助当前 PouchDB sync server** 的前提下
- 通过 ECS 风格的 `publish -> relay -> SSE projector -> local storage` 链路
- 互通：
  - `EventLog`
  - `current ActiveBlock`

## 本轮实现

### 1. EventLog over ECS

- 本地追加事件后，不再走 `syncToRemote()`，而是发布 `eventlog.replication.appended`
- 远端前端通过 `useSignalStream -> signal-handlers -> projector` 投影到本地 `EventStorage`
- `event.id` 重复时走幂等去重；相同 `event.id` 但 payload 不同会被拒绝为协议冲突

### 2. ActiveBlock over ECS

- 本地 active block 变化发布 `active_block.replication.snapshot`
- 远端前端通过 projector 写入 `ActiveBlockStorage`
- 终态 `feedback_submitted` 会收敛为“无 active block”

### 3. Legacy sync 门控

- `TaskSyncCoordinator`
- `ReminderSyncCoordinator`

旧链路现在只会在 `sync-store.status.state` 为：

- `connected`
- `syncing`

时保持 legacy sync 运行；`disconnected / connecting / error` 都会停掉旧链路，避免 ECS-only 场景误触 `:6984`。

## 验收测试

### Playwright acceptance

新增：

- `tests/e2e/playwright.issue381.config.ts`
- `tests/e2e/helpers/issue381-fake-mesh-runtime.ts`
- `tests/e2e/helpers/issue381-frontend.ts`
- `tests/e2e/eventlog-ecs-multi-device.issue381.test.ts`
- `tests/e2e/active-block-ecs-multi-device.issue381.test.ts`

验收覆盖：

- desktop -> mobile `EventLog`
- mobile -> desktop `EventLog`
- desktop -> mobile `current ActiveBlock`
- mobile -> desktop `current ActiveBlock`
- ActiveBlock 结束反馈后双方都收敛回 idle
- 全程 `0` 次请求命中 `:6984`

运行命令：

```powershell
node Scripts/test/playwright-runner.cjs test tests/e2e/eventlog-ecs-multi-device.issue381.test.ts tests/e2e/active-block-ecs-multi-device.issue381.test.ts --config tests/e2e/playwright.issue381.config.ts
```

结果：

- `2 passed`

### Unit / regression matrix

运行命令：

```powershell
npx vitest run tests/unit/ui/legacy-sync-coordinators.issue381.test.tsx tests/unit/ui/hybrid-identity-sync-coordinators.test.ts tests/unit/ui/timeblock-sync-url-wiring.issue104.test.ts tests/unit/services/timeblock.service.issue104-sync.test.ts tests/storage/active-block-storage.issue104.test.ts tests/unit/eventlog/service-pouchdb-backend.test.ts tests/unit/services/ecs-eventlog-replication.service.test.ts tests/unit/signal-pool/signal-handlers.test.ts tests/storage/event-storage.test.ts tests/components/ChatPage.test.tsx tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-manager.issue201.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
npx tsc --noEmit
```

结果：

- `13 passed`
- `130 passed`
- `tsc` 通过

## 结论

当前可以有边界地声明：

- ExoMind 前端在 `#381` MVP 范围内，已经通过 **fake runtime pair + HTTP/SSE projector** 证明桌面端和手机端可以**不经过当前 sync server** 互通 `EventLog + current ActiveBlock`
- 浏览器侧验收新增了明确的 `:6984` 负面证明
- Rust runtime 的真实 mesh relay / replay / reconnect 仍需继续依赖 runtime 集成测试，而不是把这组 Playwright 结果直接等同于“真实 runtime 端到端已全量证明”

## 边界说明

这次 Playwright acceptance 使用的是 **Node fake runtime pair（双 fake runtime + 内存 relay）**。

它验证的是：

- 前端发布链路
- runtime-like HTTP/SSE 契约
- cross-runtime style relay（跨 runtime 风格中继）
- projector 写本地存储
- 无 `:6984` 访问

它**不替代** Rust mesh 本体的集成测试，也**不单独证明**：

- `0` 次 `syncToRemote()` 调用
- `0` 次 `PouchDB.replicate()` 调用
- 真实 Rust runtime 在所有 relay / replay / reconnect 情况下都完全等价

Rust mesh / replay / reconnect / hop / dedupe 的真实性仍然应继续依赖 `#373` 相关 runtime 测试基线来保证。
