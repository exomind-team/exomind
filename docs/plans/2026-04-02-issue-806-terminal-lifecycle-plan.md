# 实施计划：#806 终端 PTY Agent 会话生命周期正常化

> **For Codex:** Execute this plan task-by-task. Run tests after each task. Commit after each task passes.
> **Issue**: #806
> **分支**: `feature/issue-806-terminal-lifecycle`
> **基线**: dev `53daf0fc`
> **Codex 审阅**: 已完成 10 项发现的修正

---

## Context

终端 Agent 系统（PTY）的基础骨架已完成（新建、交互、send_message 桥接），但生命周期末端和用户体验有缺口。本次修复 2 个 bug 并做 3 项增强，让终端管理器达到日常可用标准。

**只做终端 Agent（PTY）**。API Agent（HTTP 直连 LLM）是独立系统，不在本 issue 范围内。

**优先级**：Bug P0 → 增强 P1

---

## 决策清单

| # | 决策 | 来源 |
|---|------|------|
| D1 | 已完成会话永久可见，仅手动 × 触发后端归档（`PATCH /sessions/:id` → `archived`） | 用户确认 + Codex P1#6 修正 |
| D2 | TiledGrid 新建会话时自动替换 paneOrder 中最靠前的 completed pane；所有 pane 活跃时不自动填入，留卡片列表 | 用户确认 |
| D3 | 持久化 TiledGrid 布局 + pane 顺序 + 全屏 pty ID 到 localStorage（**不含 viewMode**） | 用户确认 + Codex P1#10 去 scope creep |
| D4 | 页面刷新后 session 过期（RT 重启）→ 显示「已断开」占位符 + 原因；**抑制 activePtyId 自动清空** | 用户确认 + Codex P0#5 修正 |
| D5 | 拓扑图：**不新增 session: 节点类型**，基于已有 pty- 节点增强（加 session 状态/角色名）。最小改动。 | 用户确认 + Codex P0#2 修正 |
| D6 | pty- 节点点击：查 sessions 列表匹配 pty_id → 提取 `(pty_id, source_host_id)` → `openPtyTerminal(ptyId, hostId)` | 用户确认 + Codex P0#1 修正 |
| D7 | `useSessionStream` 全时开启（移除 viewMode 守卫），拓扑/卡片/分栏统一数据源 | 用户确认 + Codex P0#3 修正 |
| D8 | TiledGrid × 与 SessionCard × 统一语义：归档 session（`PATCH /sessions/:id` → `archived`） | 用户确认 |
| D9 | tiled view 允许 completed pane 继续存在；仅过滤 archived | 用户确认 + Codex P0#4 修正 |
| D10 | 恢复实测：Codex 尝试启动 RT + curl，失败创 follow-up issue + 追踪 log | 用户确认 |

---

## Task 1 (Bug P0): 结束后会话不消失

**问题**: `SessionsView.tsx:39-41` 过滤掉 `completed`/`archived`，终端结束后直接从列表消失。

**Files:**
- `src/ui/app/pages/agents/SessionsView.tsx` — 改过滤：仅过滤 `archived`，保留 `completed`。分组：活跃区在上，已完成区在下
- `src/ui/app/pages/agents/SessionCard.tsx` — 已完成卡片：`opacity-50` + ✓ 标记 + 隐藏 stop 按钮 + 显示 × 归档按钮。× 调用 `onArchive?(session)`
- `src/ui/app/pages/agents/TiledGrid.tsx` — 已完成 pane：stop 按钮替换为 × 按钮。× 调用 `onArchiveSession?(session)`
- `src/ui/app/pages/AgentsPage.tsx` — 新增 `handleArchiveSession(session)`：调用 `RuntimeClient.updateSession()` → `PATCH /sessions/:id` 设 `status: 'archived'`。归档后 SSE 自动推送 `session.updated`，前端自动刷新
- `src/ui/app/pages/AgentsPage.tsx:2225` — **tiled view 过滤改为仅排除 archived**（D9），completed pane 继续存在

**复用**:
- `SESSION_STATUS_INDICATORS.completed` (`src/lib/types/session.ts:153`) 已有 `{ color: '#6B7280', shape: '✓', label: '已完成' }`
- `RuntimeClient.updateSession()` (`src/services/runtime-client.ts:794`) 已有 `PATCH /sessions/:id`
- `useSessionStream` 的 `session.updated` SSE 事件会自动更新状态

**注意**: 接口是 `PATCH`（非 PUT）。Rust router 注册的也是 `.patch(update_session)`。

**Tests:**
- 修改 `tests/unit/ui/agent-hub/session-card.stop.test.tsx` — 已完成卡片不显示 stop，显示 × 归档按钮
- 新增 `tests/unit/ui/agent-hub/sessions-view.completed.test.tsx` — SessionsView 分组显示活跃 + 已完成；archived 被过滤
- 新增测试：× 按钮调用 onArchive 回调（不调用 onStop）

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/ui/agent-hub/session-card.stop.test.tsx tests/unit/ui/agent-hub/sessions-view.completed.test.tsx`

---

## Task 2 (Bug P0): 恢复 end-to-end 验证与修复

**问题**: resume 前后端代码已写但未实测。

**Step 2.1**: 编译并启动 RT
```bash
cargo build -p exomind-runtime 2>&1
cargo run -p exomind-runtime &
sleep 5
```
如果编译超时（>5 分钟）→ 跳到 Step 2.4 兜底。

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

**成功标准 checklist**:
- [ ] `GET /pty/sessions?agent_type=claude` 返回非空数组
- [ ] `POST /pty/resume` 返回 201 + PtyAgentInfo JSON
- [ ] resume 后 `GET /pty` 列表包含新 PTY
- [ ] resume 后 `GET /sessions` 列表包含对应 session
- [ ] resume 后 `GET /pty/:id/stream` SSE 有 output 事件
- [ ] Codex 不要求验证（scope 外）

**Step 2.4**: 按实测结果修复或兜底
- 可能改的文件：`crates/exomind-runtime/src/pty/mod.rs`、`crates/exomind-runtime/src/routes/pty.rs`
- 如果是 CLI 版本/session 过期/编译超时 → 在 Rust 后端添加 `tracing::warn` 追踪 log + 在 GitHub 创建 follow-up issue
- follow-up issue 触发条件：任何一条 checklist 失败且无法在 30 分钟内修复

**Verify:** `cargo test -p exomind-runtime pty_`

---

## Task 3 (P1): 拓扑终端节点增强

**问题**: 拓扑图的 pty- 节点只有 name 和 running/offline 状态，缺少 session 上下文。

**方案（D5）**: 不新增 session: 节点类型。基于已有 pty- 节点增强，注入 session 信息。

**Files:**
- `src/ui/app/pages/AgentsPage.tsx:1282` — `useSessionStream` 移除 `viewMode` 守卫，改为全时开启（D7）
- `src/ui/app/pages/AgentsPage.tsx:2079-2087` — `ptyGraphNodes` 计算中，查找 `dashboardSessions` 中 `pty_id === pty.id` 的 session，注入 role、agent_kind、status 到节点 label/subtitle
  ```
  label: matchingSession?.role || pty.name
  subtitle: matchingSession
    ? `${AGENT_KIND_LABELS[matchingSession.agent_kind]} · ${SESSION_STATUS_INDICATORS[matchingSession.status].label}`
    : (pty.status === 'running' ? 'Terminal · running' : 'Terminal · offline')
  ```
- `src/ui/app/pages/AgentsPage.tsx:2342-2354` — pty- 节点点击 handler 增强：如果有匹配 session，用 `(session.pty_id, session.source_host_id)` 调用 `openPtyTerminal`（D6）；无匹配 session 时保持现有行为

**不改的**:
- `agents-signal-topology.ts` — 不改（不新增 session 类型）
- `SignalFlowNode.tsx` — 不改（pty 节点仍用 'agent' 类型渲染）
- `agents-utils.ts` — 不改（无新 nodeType）
- 布局持久化 — pty- 节点 ID 不变，已保存布局不会失效

**Tests:**
- 修改 `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts` — ptyGraphNodes 有匹配 session 时，label 显示 role 而非 pty name

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`

---

## Task 4 (P1): TiledGrid 自动替换已完成 pane

**问题**: 新建会话时已完成 pane 不自动让位。

**前置变更（在 Task 1 中完成）**: AgentsPage:2225 的 tiled view 过滤改为仅排除 archived（D9）。

**Files:**
- `src/ui/app/pages/AgentsPage.tsx` — spawn 成功后更新 `tiledPaneOrder`：
  1. 查找 paneOrder 中第一个 `status === 'completed'` 的 session ID（按 paneOrder 位置，最靠前的）
  2. 如有 → 替换为新 session ID
  3. 如无 → 检查是否有空位（paneOrder.length < maxPanes）→ 追加
  4. 如果全满且全活跃 → 不改 paneOrder（新会话只在 SessionsView 卡片列表中显示）

**边缘处理**: "最旧 completed" = paneOrder 中最靠前的 completed session。

**Tests:**
- 新增 `tests/unit/ui/agent-hub/tiled-grid.auto-replace.test.tsx`
  - 有 completed pane → 新 session 替换它
  - 全活跃 → 新 session 不进入 TiledGrid
  - 有空位 → 新 session 追加

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
    fullscreenPtyId?: string;  // 全屏终端 pty ID（persisted，不被轮询清空）
  }
  // 注意：不含 viewMode（D3 明确不持久化）
  ```
  使用 `topology-layout.ts` 的 localStorage 模式（直接用 `window.localStorage`，不用 runtime-backed storage，因为 topology-layout 实际也是裸 localStorage）。

- `src/ui/app/pages/AgentsPage.tsx` — 初始化时从 localStorage 恢复 `tiledLayout`、`tiledPaneOrder`、`activePtyId`；变更时写入
  - **关键修正（D4）**：抑制现有 `activePtyId` 自动清空逻辑。当 PTY 不存在但 persisted fullscreenPtyId 存在时，不清空，而是保留给断开态渲染

- `src/ui/app/pages/agents/TiledGrid.tsx` — session 过期处理：
  - paneOrder 中的 session ID 不在 sessions 列表中 → 渲染「已断开」占位符
  - 占位符样式：灰色背景 + 文案「会话已断开（RT 可能已重启）」+ × 关闭按钮
  - × 点击：从 paneOrder 移除（不归档，因为 session 已不存在）

- `src/ui/app/pages/agents/PtyTerminalPage.tsx` — fullscreen 断开态：
  - 如果 persisted ptyId 对应的 SSE stream 连接失败 → 显示「终端已断开」提示 + 返回按钮

**ID 映射规则（D4 + Codex P0#5 修正）**:
- `paneOrder` 存 `session.id`（与 useSessionStream 对齐）
- `fullscreenPtyId` 存 `pty_id`（与 openPtyTerminal 对齐）
- 恢复时：session.id 匹配 sessions → 正常显示；不匹配 → 「已断开」占位
- fullscreen 恢复时：ptyId 匹配 pty 列表 → 正常打开；不匹配 → 「已断开」提示

**Tests:**
- 新增 `tests/unit/ui/agent-hub/agents-tiled-persistence.test.ts`
  - 写入后读取一致性
  - session 过期时渲染断开占位符

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
Task 1 (结束不消失, Bug P0)
  → Task 2 (恢复实测, Bug P0)
  → Task 3 (拓扑节点增强, P1)
  → Task 4 (pane 自动替换, P1)  [依赖 Task 1 的过滤变更]
  → Task 5 (持久恢复, P1)
  → Task 6 (全量验证)
```

Bug 优先，依次推进。Task 4 依赖 Task 1 完成的过滤变更。
