# [GH#245f] M2 Follow-up 修复进度（暗色 + MiniMap + 回退链路）

## 本轮完成

1. 拓扑画布 UI 修复
- 默认移除 MiniMap（右下角缩略图不再遮挡）
- React Flow 边、标签背景、网格点位按深浅主题切换

2. 数据回退链路修复
- `useMockData=true` 时：启用 mock 信号路由 + mock agent 回退（不再空白）
- `useMockData=false` 且无 host 时：自动尝试 runtime 直连回退
  - 默认候选端口：`1950 -> 1949`
  - 支持 localStorage 覆盖：`exomind:agentHubRuntimePorts`（JSON 数组）

3. 自动化测试补齐
- MiniMap 默认关闭断言
- 暗色可见性断言
- mock 回退断言
- 直连回退断言

## 关键文件

- `src/ui/app/pages/AgentsPage.tsx`
- `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`
- `docs/plans/2026-03-04-issue-245f-m2-agent-hub-followup-fix-plan.md`

## 验收运行指令（PowerShell）

### A. 运行 Runtime（1950）

```powershell
cd D:\project\.vibe-kanban-workspaces\245f-m2-agent-hub-rea\exomind
$env:EXOMIND_RT_PORT="1950"
$env:EXOMIND_RT_BIND="127.0.0.1"
cargo run --manifest-path crates/exomind-runtime/Cargo.toml --bin exomind-rt
```

### B. 验证 Runtime API

```powershell
Invoke-RestMethod http://127.0.0.1:1950/health
Invoke-RestMethod http://127.0.0.1:1950/signal-routes
Invoke-RestMethod http://127.0.0.1:1950/agents
```

### C. 启动 agents（独立终端）

```powershell
$env:EXOMIND_RT_URL="http://127.0.0.1:1950"
bun run .\packages\ts-agent-cli\agents\classifier\index.ts
```

```powershell
$env:EXOMIND_RT_URL="http://127.0.0.1:1950"
bun run .\packages\ts-agent-cli\agents\reviewer\index.ts
```

### D. 前端自动化验收

```powershell
bun run test:e2e:issue245f
bunx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
bunx tsc --noEmit --pretty false
bun run build
```

## 本地验证结果（本次执行）

- `bun run test:e2e:issue245f`: 10 passed
- `bunx vitest ...`: 3 files, 9 tests passed
- `bunx tsc --noEmit --pretty false`: pass
- `bun run build`: pass

## 本轮提交

- `d0e38ac` docs(plan): add follow-up fix plan for issue245f agent hub
- `8535e40` fix+test(agent-hub): dark canvas, hide minimap, and add runtime/mock fallback

## 当前状态

- PR 保持 Draft（按要求不合并，等待人工复测确认）
