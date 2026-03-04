# M4: RT 内嵌 + Agent Hub + 信号链路整合（可发版验收）

## 背景

M1（PR #328）+ M2（PR #327）已合并，本 PR 完成整合精调，覆盖：

- RT 内嵌启动与默认路由加载
- Agent 自动启动与信号链路打通
- Agent Hub 真路由接入与拓扑可视化
- UI 精调（含 ChatPage agent_feedback 紫色气泡）

## 关键改动

- `src-tauri/src/lib.rs`
  - `setup()` 固定 `ensure_runtime_started(..., Some(4077))`
- `crates/exomind-runtime/src/lib.rs`
  - 默认 `signal-routes.default.json` 路径解析增加 workspace fallback
  - TS Agent `project_root` 解析增加 workspace fallback，修复 Tauri 启动时 `Module not found` 问题
  - 新增路径回退单测
- `src/ui/hooks/useSignalStream.ts`
  - SSE 默认端口统一为 `4077`
- `src/lib/services/timeblock.service.ts`
  - `timeblock.completed` 发布目标统一为 `4077`
- `src/ui/app/pages/AgentsPage.tsx`
  - runtime host 默认地址/端口与直连回退候选统一为 `4077`
- `src/components/Chat/ChatPage.tsx`
  - `new-mobile` 下 `agent_feedback` 消息气泡改为紫色视觉样式（并加测试点）

## 验收清单

### 1) RT 内嵌验证
- [x] `cargo tauri dev` 启动后 RT 自动运行（`setup()`）
- [x] `http://127.0.0.1:4077/health` 返回 OK
- [x] `http://127.0.0.1:4077/signal-routes` 返回路由列表（实测 `ROUTES_COUNT=6`）

### 2) Agent 自动启动
- [x] Tauri 启动后自动 spawn classifier + reviewer
- [x] Agent 进程可用并可通过 SSE 参与链路（由真实链路用例证明）

### 3) 信号链路端到端
- [x] `timeblock.completed` 发布/接收链路打通
- [x] Reviewer 收到信号并生成 `review.completed`（真实链路 E2E）
- [x] `review.completed` 进入前端处理链（`useSignalStream -> EventStorage`）
- [x] ChatPage `agent_feedback` 紫色气泡样式落地并有单测锁定

### 4) Agent Hub 前端整合
- [x] Agent Hub 走真实路由数据链路（非 mock 优先本地 runtime）
- [x] 路由列表显示完整
- [x] React Flow 拓扑节点/边渲染正确
- [x] 拓扑图拖拽、缩放、fitView 验证通过

### 5) UI 精调
- [x] 桌面端布局验收通过
- [x] 移动端基础可用通过
- [x] 样式一致性（含 AI 反馈色彩语义）通过
- [x] 未发现阻塞性的前端 console.error（已跑核心 E2E；非阻塞开发端口占用提示见下）

## 测试证据（命令）

### Rust / Tauri / Runtime
- `cargo test -p exomind-runtime resolve_default_signal_routes_path_falls_back_to_workspace_config -- --nocapture`
- `cargo test -p exomind-runtime resolve_project_root_falls_back_to_workspace_when_cwd_has_no_agent_entries -- --nocapture`
- `cargo test -p exomind-runtime runtime_spawns_reviewer_and_classifier_with_rt_url -- --nocapture`
- `cargo tauri dev --no-watch` + `Invoke-RestMethod` 验证 `/health` 与 `/signal-routes`

### TypeScript / Unit
- `bunx tsc --noEmit`
- `npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/ui/use-signal-stream.m4.test.ts tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- `npx vitest run tests/components/ChatPage.test.tsx tests/unit/ui/chat-agent-feedback-bubble.m4.test.ts`

### Playwright
- `npx playwright test -c tests/e2e/playwright.signal-pool.config.ts`
- `npx playwright test -c tests/e2e/playwright.issue245f.config.ts`
- `EXOMIND_RT_URL=http://127.0.0.1:4077 npx playwright test tests/e2e/signal-timeblock-feedback.test.ts --reporter=list`

## 非阻塞说明

- 本地多实例并行调试时偶发 `WebSocket server error: Port 1421 is already in use`，属于开发环境端口占用提示，不影响本 PR 的功能验收链路。
