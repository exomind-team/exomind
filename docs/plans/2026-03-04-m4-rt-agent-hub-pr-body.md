# M4: RT 内嵌 + Agent Hub + 信号链路整合

## 背景

M1（PR #328）与 M2（PR #327）已合并，本 PR 负责整合精调并完成发版前验收：

- RT 内嵌启动与健康检查
- Agent 自动启动与信号链路打通
- Agent Hub 真实数据接入与拓扑可视化
- 桌面/移动端 UI 精调与回归

## 目前完成（持续更新）

- [x] 文档化执行计划与审批评论草稿
- [x] Tauri setup 固定启动 embedded RT 到 `127.0.0.1:4077`
- [x] 前端 runtime 默认端口统一到 `4077`
- [x] `timeblock.completed` 发布目标端口统一到 `4077`
- [x] `useSignalStream` SSE 默认端口统一到 `4077`

## 验收清单（持续更新）

### 1) RT 内嵌验证
- [x] `setup()` 自动启动 runtime
- [ ] `http://127.0.0.1:4077/health` 返回 OK
- [ ] `http://127.0.0.1:4077/signal-routes` 返回路由列表

### 2) Agent 自动启动
- [ ] 启动后自动 spawn classifier + reviewer
- [ ] Agent 存活并已建立 SSE

### 3) 信号链路端到端
- [x] 端口链路统一到 4077（timeblock / SSE / Agent Hub）
- [ ] `timeblock.completed -> review.completed -> EventStorage` 验证
- [ ] ChatPage 紫色 AI 气泡渲染验证

### 4) Agent Hub 前端整合
- [x] 非 mock 链路默认优先尝试本地 runtime（含 4077）
- [ ] 路由列表显示完整
- [ ] React Flow 拓扑拖拽/缩放/fitView 验证

### 5) UI 精调
- [ ] 桌面布局验收
- [ ] 移动端可用性验收
- [ ] 无 console.error / 警告

## 测试证据（持续更新）

- `npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts`
- `npx vitest run tests/unit/ui/use-signal-stream.m4.test.ts tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`

## 风险与说明

- 现有 `timeblock.service` 其他测试用例仍会输出已知 warning（`storage.getEvents is not a function`），后续会在本 PR 中一并清理，保证验收目标“无警告”。
