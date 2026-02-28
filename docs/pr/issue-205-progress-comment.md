# [GH#205] Agent Hub Desktop Runtime 进度更新（P0）

## 已完成范围（本轮落地）
1. RuntimeHost 数据模型与服务：
   - 新增持久化服务 `runtime-host.service.ts`，提供 `list/add/remove/probe/probeAll`。
   - 存储键：`agent_runtime_hosts_v1`。
2. 设备页接入真实数据与交互：
   - `AgentsPage` 设备视图新增 RuntimeHost 面板。
   - 支持手动输入 `Name/IP/Port` 新增主机并展示状态。
   - 支持单主机“探测”并显示 `online/offline/warning`、`lastCheckedAt`、`lastError`。
3. 桌面端 Runtime 启停命令接入：
   - Tauri 命令：`runtime_service_start` / `runtime_service_stop` / `runtime_service_status`。
   - 前端 `runtime-control.service.ts` 已接入命令调用与状态显示。
4. 最小 runtime 服务：
   - `server/agent-runtime-server.js` 提供 `/health`、`/runtime/status`。
   - 增加 CORS 与 `OPTIONS` 预检响应，保证浏览器探测可用。

## 关键文件
- `src/lib/services/runtime-host.service.ts`
- `src/lib/services/runtime-control.service.ts`
- `src/ui/new/pages/AgentsPage.tsx`
- `src-tauri/src/commands/runtime_commands.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `server/agent-runtime-server.js`

## 自动化测试证据
### 1) Unit（issue205 相关）
```bash
bunx vitest run tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/tauri/runtime-commands.issue205.test.ts
```
结果：`4 files, 11 tests passed`

### 2) Playwright E2E（issue205 专项）
```bash
bun run test:e2e:issue205
```
结果：`1 passed`  
覆盖流程：设备页新增 RuntimeHost -> 点击探测 -> 状态变更为 `online`。

### 3) Build 验证
```bash
bun run build
```
结果：通过（存在既有 chunk/动态导入 warning，无阻断错误）。

## 本轮提交记录（按步骤）
- `7a099f4` docs(issue-205): update scope to desktop runtime probe and startup
- `39b440a` feat(agent-hub): add runtime host service and probe persistence
- `b3a9d90` feat(agent-hub): wire device runtime host panel and local runtime controls
- `f1b77c5` feat(tauri): add runtime service start stop status commands
- `79f7d5a` test(issue-205): add runtime host e2e and harden probe compatibility

## P0 状态
- AC-1 设备页真实数据：完成
- AC-2 本地探测可跑：完成
- AC-3 Runtime 启停接入桌面端：完成
- AC-4 测试与构建门槛：完成
