## M4 进展更新（阶段 1）

已完成：

1. **RT 固定端口启动**
   - `src-tauri/src/lib.rs`：`setup()` 中 `ensure_runtime_started(runtime_state, None, Some(4077))`
   - 通过单测：`runtime-embedded.m1`（新增 4077 断言）

2. **默认端口统一到 4077（信号链路）**
   - `src/ui/hooks/useSignalStream.ts` 默认 SSE 端口改为 `4077`
   - `src/lib/services/timeblock.service.ts` 发布 `timeblock.completed` 目标改为 `4077`
   - `src/ui/app/pages/AgentsPage.tsx` 的 runtime 启停、默认地址、展示端口改为 `4077`

3. **测试（TDD）**
   - RED 阶段先新增/修改失败测试，再改实现转绿
   - 已通过命令：
     - `npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts`
     - `npx vitest run tests/unit/ui/use-signal-stream.m4.test.ts tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`

提交记录：

- `c0ba41a` feat(m4): pin embedded runtime startup and defaults to port 4077
- `51e8b24` feat(m4): align signal chain defaults to embedded runtime port 4077

下一步：

- 验证 `http://127.0.0.1:4077/health` 与 `/signal-routes`
- 验证 Agent 自动启动（classifier/reviewer）与 SSE 链路
- Playwright 端到端验收（含 Agent Hub 与信号链路）
