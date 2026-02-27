# [GH#205] Desktop Agent Runtime 方案更新（P0）

## 本轮范围（按你最新口径）
本 PR 聚焦 **Desktop 设备视图数据 + 本地环境探测 + Agent Runtime 启停接入**：
1. Hope 设备视图 UI 已就绪，先补齐真实数据来源与交互。
2. **不实现 LLM Port / Claude 适配**（本轮明确排除）。
3. 本地环境可探测（IP/Port），本机 Agent Runtime 可启动并接入桌面端（Tauri）。

---

## P0 验收标准（必须全过）

### AC-1 设备页真实数据（Device Data）
- `/agents` 设备视图可展示本地 RuntimeHost 列表（非静态 fixture）。
- 可手动新增 RuntimeHost（`IP + Port + Name`），保存后立即显示卡片。
- 自动化证据：Unit（service 持久化与读取）+ UI 测试（新增后即展示）。

### AC-2 本地探测可跑（Local Probe）
- 可对单个 RuntimeHost 执行探测（HTTP health check / 本地接口探测）。
- 状态可见：`online | offline | warning`，包含最近探测时间与错误信息（如连接失败）。
- 自动化证据：Unit（成功/失败/超时）+ UI 测试（状态徽标变化）。

### AC-3 Agent Runtime 启停接入桌面端（Tauri Runtime Control）
- Tauri 端新增命令：`runtime_service_start / runtime_service_stop / runtime_service_status`。
- 前端可调用命令并在设备页看到运行状态更新。
- 自动化证据：Rust 命令契约测试（或 TS 调用层测试）+ 手工验证记录。

### AC-4 发布门槛（Release Gate）
- `bun vitest`（本轮新增用例）通过。
- `bun run test:e2e:issue205`（新增设备探测流程）通过。
- `bun run build` 通过。

---

## 实施清单（TDD + 每步 commit）

### Task 1: RuntimeHost 类型与服务（先测试）
- 新增类型：`RuntimeHost`、`RuntimeHostProbeResult`、`RuntimeServiceStatus`。
- 新增 `runtime-host.service.ts`：
  - `listHosts/addHost/removeHost`
  - `probeHost/probeAllHosts`
  - 本地持久化存储键（`*_v1`）

### Task 2: 设备页接入真实服务（先测试）
- 设备页新增最小交互：添加 Host、触发探测、展示状态。
- 保持当前 UI 视觉结构（Pencil Hope 设备视图）不破坏。

### Task 3: Tauri 命令接入 runtime 启停（先测试）
- 新增 `runtime_commands.rs` 并注册到 `mod.rs` 与 `lib.rs`。
- 落地 start/stop/status 命令，状态返回前端可消费。

### Task 4: E2E 验收（先失败再修）
- 覆盖：新增 Host -> 探测 -> 状态变化 -> 本地 runtime 启停。

### Task 5: 评审与证据
- 更新进度评论与评审评论（命令 + 结果 + 风险）。
- 同步 Issue #205 与 PR #251。

---

## 不在本轮（明确排除）
1. LLM Port / Claude Adapter。
2. 真实对话流式能力（chat runtime 链路）。
3. 多 RuntimeHost 调度/故障转移（已在 P1 跟踪）。

---

## 风险与控制
1. **本地探测误判**：加超时与错误类型映射，避免状态卡死。
2. **Tauri 子进程泄漏**：维护 child handle，stop 与应用退出时统一回收。
3. **跨端差异**：Web 走探测与数据管理，runtime 启停仅在 Tauri 启用。
