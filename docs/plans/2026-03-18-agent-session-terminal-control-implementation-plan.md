# Agent Session Terminal Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Agent Hub 补齐 PTY 消息桥接、按 Agent 类型恢复历史会话、启动参数配置与卡片级停止操作。

**Architecture:** 保持现有 PTY/session 主链路不变，在运行时侧补 `send_message -> PTY stdin`、统一历史会话发现接口与 `agent_type` 恢复分支；前端侧扩展 `PtySpawnDialog` 和 `SessionCard`，并复用现有 stop API 与 session 注册流程。

**Tech Stack:** Rust (axum, tokio, portable-pty), React 18 + TypeScript, Vitest, Bun

---

### Task 1: 文档定稿与基线确认

**Files:**
- Create: `docs/plans/2026-03-18-agent-session-terminal-control-design.md`
- Create: `docs/plans/2026-03-18-agent-session-terminal-control-implementation-plan.md`

**Step 1: 写入设计定稿**

将已确认设计落盘，覆盖目标、接口、边界、测试范围。

**Step 2: 写入实施计划**

把运行时、前端、测试任务拆成独立可执行步骤。

**Step 3: 运行基线校验**

Run: `bunx tsc --noEmit`
Expected: PASS

Run: `bunx vitest run tests/unit/ui/agent-hub/pty-terminal-page.stop.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add docs/plans/2026-03-18-agent-session-terminal-control-design.md docs/plans/2026-03-18-agent-session-terminal-control-implementation-plan.md
git commit -m "docs(plans): define agent session terminal control design"
```

### Task 2: 运行时测试先行 - `send_message` 桥接 PTY stdin

**Files:**
- Modify: `crates/exomind-runtime/src/routes/sessions.rs`
- Test: `crates/exomind-runtime/src/routes/sessions.rs`

**Step 1: 写失败测试**

新增测试覆盖：

1. 普通 session 发消息时只返回 `SessionMessage`
2. 带 `pty_id` 的 session 发消息时会把 `content + "\\n"` 写入 PTY stdin

**Step 2: 运行失败测试**

Run: `cargo test -p exomind-runtime send_message_`
Expected: FAIL，原因是当前不会写入 PTY stdin

**Step 3: 写最小实现**

在 `send_message` 中：

1. 保留并保存 session 实例
2. 构建 `SessionMessage`
3. 如果有 `pty_id`，调用 `state.pty_manager.write_input(...)`
4. PTY 写入失败时记录 warning，不改变 HTTP `201`

**Step 4: 运行测试确认通过**

Run: `cargo test -p exomind-runtime send_message_`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/sessions.rs
git commit -m "feat(rt): bridge session messages to PTY stdin"
```

### Task 3: 运行时测试先行 - 历史会话发现与 resume 按 Agent 类型分支

**Files:**
- Modify: `crates/exomind-runtime/src/pty/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/pty.rs`
- Test: `crates/exomind-runtime/src/pty/mod.rs`
- Test: `crates/exomind-runtime/src/routes/pty.rs`

**Step 1: 写失败测试**

新增测试覆盖：

1. `PtyResumeRequest` 反序列化需要 `agent_type`
2. `resume` 对 `claude / codex` 生成不同 command / args
3. 历史会话发现返回统一结构，并带 `agent_type`
4. `GET /pty/sessions?agent_type=...` 返回对应类型列表

**Step 2: 运行失败测试**

Run: `cargo test -p exomind-runtime pty_`
Expected: FAIL，原因是当前只支持 Claude resume / Claude sessions

**Step 3: 写最小实现**

实现：

1. 新增统一历史会话结构 `PtyHistoricalSessionInfo`
2. `PtyResumeRequest` 增加 `agent_type`
3. `PtyManager::resume()` 根据类型分支构建 `PtySpawnRequest`
4. `routes/pty.rs` 新增统一 `GET /pty/sessions`
5. 兼容 Claude，新增 Codex 历史发现逻辑

**Step 4: 运行测试确认通过**

Run: `cargo test -p exomind-runtime pty_`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/pty/mod.rs crates/exomind-runtime/src/routes/pty.rs
git commit -m "feat(rt): add agent-typed PTY history and resume"
```

### Task 4: 前端测试先行 - `PtySpawnDialog` 参数与恢复 UI

**Files:**
- Modify: `src/ui/app/components/PtySpawnDialog.tsx`
- Create: `tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx`

**Step 1: 写失败测试**

覆盖：

1. 切换到 `Codex` 时显示 `model / reasoning effort / extra args`
2. 切换到 `Custom` 时显示 `command`，不显示历史恢复区
3. 恢复历史会话请求带 `agent_type`
4. 启动新会话请求按所选类型拼出正确 `command + args`

**Step 2: 运行失败测试**

Run: `bunx vitest run tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx`
Expected: FAIL，原因是当前 UI 与请求体字段不支持这些行为

**Step 3: 写最小实现**

实现：

1. 扩展表单状态与字段
2. 切换 `agentType` 时拉取 `GET /pty/sessions?agent_type=...`
3. 构建 `spawn` 与 `resume` 请求体
4. 为关键交互加 `data-testid`

**Step 4: 运行测试确认通过**

Run: `bunx vitest run tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/components/PtySpawnDialog.tsx tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx
git commit -m "feat(ui): add agent-aware PTY spawn and resume controls"
```

### Task 5: 前端测试先行 - `SessionCard` 卡片级停止

**Files:**
- Modify: `src/ui/app/pages/agents/SessionCard.tsx`
- Modify: `src/ui/app/pages/agents/SessionsView.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Create: `tests/unit/ui/agent-hub/session-card.stop.test.tsx`

**Step 1: 写失败测试**

覆盖：

1. PTY session 显示 stop 按钮
2. 非 PTY session 不显示或不可用
3. 点击 stop 触发 stop callback
4. 点击 stop 不触发卡片主点击

**Step 2: 运行失败测试**

Run: `bunx vitest run tests/unit/ui/agent-hub/session-card.stop.test.tsx`
Expected: FAIL

**Step 3: 写最小实现**

实现：

1. `SessionCard` 增加 `onStop`
2. `SessionsView` 透传 `onStopSession`
3. `AgentsPage` 列表视图复用 `handleStopPtyAgent(...)`

**Step 4: 运行测试确认通过**

Run: `bunx vitest run tests/unit/ui/agent-hub/session-card.stop.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/agents/SessionCard.tsx src/ui/app/pages/agents/SessionsView.tsx src/ui/app/pages/AgentsPage.tsx tests/unit/ui/agent-hub/session-card.stop.test.tsx
git commit -m "feat(ui): add list-card stop action for PTY sessions"
```

### Task 6: 页面级集成测试

**Files:**
- Create or Modify: `tests/unit/ui/agent-hub/agents-page.pty-session-controls.test.tsx`

**Step 1: 写失败测试**

覆盖：

1. Agents 页列表卡片 stop 会调用 `/pty/:id/stop`
2. `PtySpawnDialog` 切到 `Codex` 后展示历史会话并发起恢复

**Step 2: 运行失败测试**

Run: `bunx vitest run tests/unit/ui/agent-hub/agents-page.pty-session-controls.test.tsx`
Expected: FAIL

**Step 3: 写最小实现或补测试夹具**

只补为让页面流通过所需的最小实现或 mock。

**Step 4: 运行测试确认通过**

Run: `bunx vitest run tests/unit/ui/agent-hub/agents-page.pty-session-controls.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/ui/agent-hub/agents-page.pty-session-controls.test.tsx
git commit -m "test(ui): cover agent session terminal control flows"
```

### Task 7: 全量相关验证

**Files:**
- Modify: only if verification exposes regressions

**Step 1: 运行 Rust 相关测试**

Run: `cargo test -p exomind-runtime send_message_ pty_`
Expected: PASS

**Step 2: 运行前端相关单测**

Run: `bunx vitest run tests/unit/ui/agent-hub/pty-terminal-page.stop.test.tsx tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx tests/unit/ui/agent-hub/session-card.stop.test.tsx tests/unit/ui/agent-hub/agents-page.pty-session-controls.test.tsx`
Expected: PASS

**Step 3: 运行类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

**Step 4: 运行构建**

Run: `bun run build`
Expected: PASS

**Step 5: Commit verification fixes**

如果验证阶段发现回归，修复后单独提交。

### Task 8: PR 准备

**Files:**
- Modify: PR 描述草稿或 issue 注释材料（若仓库内维护）

**Step 1: 汇总变更**

整理：

1. 运行时改动
2. 前端改动
3. 测试命令与结果

**Step 2: 准备 PR 文案**

包含：

1. 问题背景
2. 变更点
3. 验证命令
4. 风险与未做项

**Step 3: Push / PR**

```bash
git push -u origin feature/agent-session-terminal-control
```

随后创建 PR 指向 `dev`。
