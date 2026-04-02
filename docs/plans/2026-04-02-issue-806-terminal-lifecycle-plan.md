# 实施计划：#806 终端 PTY Agent 会话生命周期正常化

> **For Codex:** Execute this plan task-by-task. Run tests after each task. Commit after each task passes.
> **Issue**: #806
> **分支**: `feature/issue-806-terminal-lifecycle`
> **基线**: dev `53daf0fc`

---

## Context

终端 Agent 系统（PTY）的基础骨架已完成（新建、交互、send_message 桥接），但生命周期末端和用户体验有缺口。本次修复 2 个 bug 并做 3 项增强，让终端管理器达到日常可用标准。

**只做终端 Agent（PTY）**。API Agent（HTTP 直连 LLM）是独立系统，不在本 issue 范围内。

**优先级**：Bug P0 → 增强 P1

---

## 决策清单

| # | 决策 | 来源 |
|---|------|------|
| D1 | 已完成会话永久可见，仅手动 × 触发后端归档（`PUT /sessions/:id` → `archived`） | 用户确认 |
| D2 | TiledGrid 新建会话时自动替换最旧已完成 pane；所有 pane 活跃时不自动填入，留卡片列表 | 用户确认 |
| D3 | 持久化 TiledGrid 布局 + pane 顺序 + 全屏 pty ID 到 localStorage | 用户确认 |
| D4 | 页面刷新后 session 过期（RT 重启）→ 显示「已断开」占位符 + 原因 | 用户确认 |
| D5 | 拓扑节点类型名 `'session'`，第一版不做连线 | 用户确认 |
| D6 | 节点点击打开全屏终端（活跃/已完成均可，已完成可回看 scrollback） | 用户确认 |
| D7 | 恢复实测：Codex 尝试启动 RT + curl，失败创 follow-up issue + 追踪 log | 用户确认 |

---

## Task 1 (Bug P0): 结束后会话不消失

**问题**: `SessionsView.tsx:39-41` 过滤掉 `completed`/`archived`，终端结束后直接从列表消失。

**Files:**
- `src/ui/app/pages/agents/SessionsView.tsx` — 移除 completed 硬过滤，改为分组：活跃区在上，已完成区在下（仍过滤 archived）
- `src/ui/app/pages/agents/SessionCard.tsx` — 已完成卡片：`opacity-50` + ✓ 标记 + 隐藏 stop 按钮 + 显示 × 归档按钮
- `src/ui/app/pages/agents/TiledGrid.tsx` — 已完成 pane：stop 按钮替换为 × remove 按钮
- `src/ui/app/pages/AgentsPage.tsx` — 新增 `handleArchiveSession(sessionId)` → `PUT /sessions/:id` 设 `status: 'archived'`

**复用**: `SESSION_STATUS_INDICATORS.completed` (`src/lib/types/session.ts:153`) 已有 `{ color: '#6B7280', shape: '✓', label: '已完成' }`

**Tests:**
- 修改 `tests/unit/ui/agent-hub/session-card.stop.test.tsx` — 已完成卡片不显示 stop，显示 × 归档按钮
- 新增 `tests/unit/ui/agent-hub/sessions-view.completed.test.tsx` — SessionsView 分组显示活跃 + 已完成

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/ui/agent-hub/session-card.stop.test.tsx tests/unit/ui/agent-hub/sessions-view.completed.test.tsx`

---

## Task 2 (Bug P0): 恢复 end-to-end 验证与修复

**问题**: resume 前后端代码已写但未实测。

**Step 2.1**: 编译并启动 RT
```bash
cargo build -p exomind-runtime && cargo run -p exomind-runtime &
sleep 5
```

**Step 2.2**: 实测历史会话扫描
```bash
curl -s http://127.0.0.1:1949/pty/sessions?agent_type=claude | head -200
curl -s http://127.0.0.1:1949/pty/sessions?agent_type=codex | head -200
```

**Step 2.3**: 实测恢复（用 2.2 返回的 session_id）
```bash
curl -X POST http://127.0.0.1:1949/pty/resume \
  -H 'Content-Type: application/json' \
  -d '{"agent_type":"claude","session_id":"<id>","rows":24,"cols":80}'
```

**Step 2.4**: 按实测结果修复
- 可能改的文件：`crates/exomind-runtime/src/pty/mod.rs`、`crates/exomind-runtime/src/routes/pty.rs`
- 如果是 CLI 版本/session 过期等不可控因素 → 在 Rust 后端添加 `tracing::warn` 追踪 log + 创建 follow-up issue
- 如果 RT 编译超时 → 跳过实测，创建 follow-up issue

**Verify:** `cargo test -p exomind-runtime pty_`

---

## Task 3 (P1): 拓扑节点收敛

**问题**: `buildSignalGraph()` 不消费 `SessionInfo[]`，PTY 会话不在拓扑图中。

**Files:**
- `src/ui/app/pages/agents-signal-topology.ts` — `SignalGraphNodeType` 新增 `'session'`；`buildSignalGraph` 加第三参数 `sessions?: SessionInfo[]`；为 `interaction_mode === 'terminal'` 且 `status !== 'archived'` 的 session 生成节点
- `src/ui/app/pages/agents/SignalFlowNode.tsx` — `SIGNAL_NODE_TYPES` 注册 `session`（复用 `SignalFlowNode` 渲染）
- `src/ui/app/pages/agents/agents-utils.ts` — `nodeTypeTint('session')` → `'#C75B3A'`；`signalNodeTypeBadgeLabel('session')` → `'终端会话'`
- `src/ui/app/pages/AgentsPage.tsx:2059` — `buildSignalGraph(signalRoutes, graphAgents)` → `buildSignalGraph(signalRoutes, graphAgents, sessions)`
- `src/ui/app/pages/AgentsPage.tsx` — `onSelectNode` 中识别 `session:` 前缀 → `openPtyTerminal(sessionId)`（活跃和已完成均可打开）

**节点设计:**
```
ID:       session:<session.id>
Type:     'session'
Label:    session.role || '终端'
Subtitle: AGENT_KIND_LABELS[agent_kind] · SESSION_STATUS_INDICATORS[status].label
Position: 列 2（与 agent 同列），行在 agent 之后
Shape:    圆角矩形（rounded-md），色调 #C75B3A
```

**不做**: 连线（远景追踪在 #806）

**Tests:**
- 修改 `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts` — 传入含 terminal session 的数据，断言 graph.nodes 包含 `session:xxx`

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`

---

## Task 4 (P1): TiledGrid 自动替换已完成 pane

**问题**: 新建会话时已完成 pane 不自动让位。

**Files:**
- `src/ui/app/pages/agents/TiledGrid.tsx` — `orderedPanes` 计算逻辑：新 session 进来时，如果 paneOrder 中有 completed session，替换最旧那个
- `src/ui/app/pages/AgentsPage.tsx` — spawn 成功后更新 `tiledPaneOrder`：如有 completed pane 则替换，否则追加（不超过 maxPanes 则自动填入）

**边缘处理**: 所有 pane 活跃时，新会话不进入 TiledGrid，只在 SessionsView 卡片列表中显示。

**Tests:**
- 新增 `tests/unit/ui/agent-hub/tiled-grid.auto-replace.test.tsx`

**Verify:** `npx vitest run tests/unit/ui/agent-hub/tiled-grid.auto-replace.test.tsx`

---

## Task 5 (P1): 持久会话自动恢复

**问题**: 页面刷新后 TiledGrid 布局和打开的终端全部丢失。

**Files:**
- 新增 `src/ui/app/pages/agents/agents-tiled-persistence.ts` — 读写 localStorage，结构：
  ```ts
  interface TiledPersistState {
    layout: TiledLayout;       // '1x1' | '1x2' | '2x2' | '2x4'
    paneOrder: string[];       // session IDs
    fullscreenPtyId?: string;  // 全屏终端 pty ID
    viewMode?: AgentHubViewMode;
  }
  ```
- `src/ui/app/pages/AgentsPage.tsx` — 初始化时从 localStorage 恢复 `tiledLayout`、`tiledPaneOrder`、`activePtyId`、`viewMode`；变更时写入
- `src/ui/app/pages/agents/TiledGrid.tsx` — session 过期（ID 在 sessions 列表中不存在）时渲染「已断开」占位符：灰色背景 + 文案「会话已断开（RT 可能已重启）」+ × 关闭按钮

**复用**: `topology-layout.ts` 的 localStorage 读写模式（`readTopologyLayoutStore`/`writeTopologyLayoutStore`）

**Tests:**
- 新增 `tests/unit/ui/agent-hub/agents-tiled-persistence.test.ts`

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/ui/agent-hub/agents-tiled-persistence.test.ts`

---

## Task 6: 全量验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/agent-hub/
cargo test -p exomind-runtime pty_
bun run build
```

---

## 执行顺序

```
Task 1 (结束不消失, Bug P0) → Task 2 (恢复实测, Bug P0) → Task 3 (拓扑节点, P1) → Task 4 (pane 自动替换, P1) → Task 5 (持久恢复, P1) → Task 6 (全量验证)
```

Bug 优先，依次推进。Task 3/4/5 之间无硬依赖但按复杂度递增排列。
