# Codex Workbench Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Codex 成为 ExoMind 外心中的一等终端工作台对象（first-class workbench object，一等工作台对象），在 `启动 / 恢复 / 审查当前工作 / 长对话 / 性能 / 设置理解` 这几条链路上形成统一体验。

**Architecture:** 本计划不再把问题按零散 issue 切碎，而是按 4 个统一层次推进：`执行策略层（execution policy，执行策略）`、`会话身份层（session identity，会话身份）`、`传输体验层（transport + UX，传输与体验）`、`产品语义层（product semantics，产品语义）`。底层延续现有 `PTY terminal` 与 `runtime agent` 能力，但逐步抽出共享契约，减少双轨分裂。

**Tech Stack:** Rust `exomind-runtime`、React 18 + TypeScript、Tauri v2、xterm、Vitest、cargo test、Tauri MCP / raw bridge

---

## 0. 计划背景

当前 Codex 迁移到 ExoMind，已经不是“能不能接入”的问题，而是“能不能长期稳定地当工作台使用”的问题。

多代理勘察后的统一结论：

1. **底座已存在**
   - `runtime agent` 模式已有 Codex adapter。
   - `PTY terminal` 模式已有 Codex spawn / resume / history / stream。
   - `#806`、`#818` 已证明 PTY 生命周期、RT 重启恢复主线基本打通。

2. **真正未统一的是四层契约**
   - 执行策略：`runtime agent` 与 `PTY terminal` 的 Codex 参数、安全/信任策略不一致。
   - 会话身份：`session.id / inner_session_id / pty_id / source_host_id` 已经都在参与判定，但没有统一 canonical contract（规范主键契约）。
   - 传输体验：输入仍是 `POST /pty/:id/input`，输出仍是 `SSE /pty/:id/stream`，高频输入与长输出体验都不够。
   - 产品语义：设置、命名、入口、提示仍偏工程术语，用户心智不稳定。

3. **迁移目标必须改写**
   - 不是“接入 Codex”
   - 而是“让 Codex 成为外心里的长期工作台对象”

## 1. 当前问题模型（统一抽象）

### Layer A：执行策略层（Execution Policy）

症状：
- `runtime agent` 模式下，Codex 默认带 `--skip-git-repo-check` 与 `--dangerously-bypass-approvals-and-sandbox`
- `PTY terminal` 恢复链路没有统一继承这套策略
- Windows 下命令 shim、trusted directory、审批/沙箱语义都可能分裂

对应代码：
- [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)
- [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs)
- [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)

对应 issue：
- `#385`
- `#810`
- `#816`

### Layer B：会话身份层（Session Identity）

症状：
- 历史恢复依赖 `inner_session_id`
- `/resume` 后上游会话已切换，但 ExoMind 侧 `inner_session_id` 可能没同步
- 历史会话卡片命名和会话主键语义割裂

对应代码：
- [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)
- [AgentsPage.tsx](/D:/project/exomind/src/ui/app/pages/AgentsPage.tsx)
- [session.ts](/D:/project/exomind/src/lib/types/session.ts)

对应 issue：
- `#821`
- `#838`
- `#849`

### Layer C：传输体验层（Transport + UX）

症状：
- 输入仍走 HTTP POST，逐键/粘贴时卡顿明显
- 长输出回放窗口仍不够长
- 新旧 transport contract（传输契约）尚未统一

对应代码：
- [PtyTerminal.tsx](/D:/project/exomind/src/ui/app/components/PtyTerminal.tsx)
- [pty-input.ts](/D:/project/exomind/src/ui/app/components/pty-input.ts)
- [pty-terminal-preferences.ts](/D:/project/exomind/src/config/pty-terminal-preferences.ts)
- [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)

对应 issue：
- `#843`
- `#894`

### Layer D：产品语义层（Product Semantics）

症状：
- “启动终端会话”更像技术面板，不像明确任务入口
- 设置项使用 `RT / PTY / 宿主 / transcript tail` 等工程词
- 快捷键分区与终端心智割裂

对应代码：
- [PtySpawnDialog.tsx](/D:/project/exomind/src/ui/app/components/PtySpawnDialog.tsx)
- [settings-registry.ts](/D:/project/exomind/src/ui/app/config/settings/settings-registry.ts)
- [SessionCard.tsx](/D:/project/exomind/src/ui/app/pages/agents/SessionCard.tsx)

对应 issue：
- `#875`
- `#876`
- `#878`

## 2. 总体策略

建议把现有 issue 重组为 4 条主工作流（workstream，工作流）：

1. **Workstream A：Codex 执行策略统一**
   - 统一 `runtime agent` 与 `PTY terminal` 的 Codex 参数来源、Windows shim、trusted directory 策略、日志与失败提示。

2. **Workstream B：Codex 会话身份统一**
   - 定义 `session.id / inner_session_id / pty_id` 的职责边界。
   - 修正 `/resume` 导致的身份漂移。
   - 统一历史会话命名、恢复、判重、唯一窗口占用。

3. **Workstream C：Codex 终端传输与性能统一**
   - 按 `#894` 把输入迁移到 WS。
   - 收口 `#843` 历史回放窗口。
   - 形成可量化的长期使用指标。

4. **Workstream D：Codex 产品入口与设置统一**
   - 重命名设置与入口。
   - 让用户面向“任务行为”理解功能，而不是面向底层实现理解功能。

## 3. 分阶段推进

### Phase 0：统一契约与验收口径

**目标**
- 先统一语言，再改实现。

**输出**
- 一份 `Codex workbench contract` 文档，明确：
  - Codex 在 ExoMind 中的两种运行模式
  - 哪些能力共享，哪些能力保留差异
  - `session.id / inner_session_id / pty_id` 的职责
  - trusted directory / sandbox / approvals 的产品策略
  - 失败态与恢复态的用户提示原则

**完成条件**
- `#385`、`#810`、`#821`、`#838`、`#849`、`#843`、`#894` 的边界被重新映射到 4 个主工作流中。
- 团队不再把“Codex 迁移”理解成零散 terminal bug 集合。

### Phase 1：执行策略与身份层收口

**目标**
- 优先解决“明明能跑，但恢复不稳定、身份会漂”的问题。

**范围**
- 对齐 `runtime agent` 与 `PTY terminal` 的 Codex 启动/恢复策略。
- 收口 `inner_session_id` 的补写、校验、漂移修复。
- 明确 trusted directory 的默认策略。
- 保证日志在目标运行形态下默认可见。

**对应 issue**
- `#810`
- `#816`
- `#821`
- `#849`

**完成条件**
- PTY 恢复和 runtime agent 在策略上不再互相矛盾。
- `/resume` 后会话身份不会长期停留旧值。
- trusted directory 不再以“偶发恢复失败”的形式暴露给用户。

### Phase 2：传输与回放体验收口

**目标**
- 解决“能用但不好用”的高频痛点。

**范围**
- 输入迁移到 WebSocket。
- 保持当前生命周期与恢复语义不回归。
- 收口长输出历史回放窗口与设置控制。

**对应 issue**
- `#894`
- `#843`

**完成条件**
- 高频输入与 4KB 粘贴场景不再明显卡顿。
- Codex 长输出后能回看足够长的历史。
- 量化指标与真实桌面章程都可复现。

### Phase 3：产品入口与设置语义收口

**目标**
- 把 Codex 从“技术功能”变成“可理解工作台”。

**范围**
- 历史会话命名与显示规则。
- 终端工作台设置分区与文案。
- “启动终端会话”入口语义收口到“审查当前工作 / 打开已有上下文 / 新建终端”。

**对应 issue**
- `#838`
- `#875`
- `#876`
- `#878`

**完成条件**
- 用户不需要先理解 `RT / PTY / transcript tail` 才能使用 Codex。
- 多个 Codex 会话可以作为“工作上下文”而不是“session_id 列表”管理。

## 4. 任务拆解

### Task 1：写一份统一架构说明，取代散 issue 语义

**Files:**
- Create: `docs/architecture/codex-workbench-contract.md`
- Reference: `docs/development/tauri-mcp-windows-playbook.md`
- Reference: `docs/plans/2026-03-07-issue-385-agent-runtime-orchestration-design.md`
- Reference: `docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md`

**Steps**
1. 提炼 `runtime agent` 与 `PTY terminal` 的共享概念与差异。
2. 写出 `session.id / inner_session_id / pty_id` 职责表。
3. 写出 trusted directory / approvals / sandbox 默认策略候选。
4. 写出失败态、恢复态、只读态的用户可见合同。

### Task 2：统一 Codex 执行策略来源

**Files:**
- Modify: `crates/exomind-runtime/src/agent/codex.rs`
- Modify: `crates/exomind-runtime/src/pty/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/pty.rs`
- Test: `crates/exomind-runtime/tests/pty_agent.rs`

**Steps**
1. 抽出 `CodexExecutionPolicy`（执行策略）或等价共享 builder。
2. 统一 `codex.cmd`、`--skip-git-repo-check`、审批/沙箱参数来源。
3. 补齐 PTY 恢复与 runtime agent 的策略一致性测试。
4. 明确哪些参数允许用户覆盖，哪些是系统默认。

### Task 3：收口会话身份规范

**Files:**
- Modify: `src/ui/app/pages/agents/pty-session-recovery.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/lib/types/session.ts`
- Modify: `crates/exomind-runtime/src/routes/sessions.rs`
- Modify: `crates/exomind-runtime/src/session/sqlite_store.rs`
- Test: `tests/unit/ui/agent-hub/pty-session-recovery.test.ts`

**Steps**
1. 定义 canonical historical identity（规范历史身份主键）。
2. 让 `/resume` 后的上游 session 变化可被同步或显式标脏。
3. 让判重、唯一窗口、恢复绑定都依赖统一身份层。
4. 补齐 `/resume` 场景的前端与 runtime 回归测试。

### Task 4：推进输入 WS 化并保留阶段门禁

**Files:**
- Modify: `src/ui/app/components/PtyTerminal.tsx`
- Modify: `src/ui/app/components/pty-input.ts`
- Modify: `crates/exomind-runtime/src/routes/pty.rs`
- Test: `src/ui/app/components/PtyTerminal.test.tsx`
- Test: `crates/exomind-runtime/tests/pty_agent.rs`

**Steps**
1. 先完成 `S1`：输入 WS，输出仍 SSE。
2. 保持无 fallback（无自动回退）策略。
3. 补齐 `ack / retry / reconnect` 语义。
4. 用量化测试与 Tauri MCP 验证关闭 `#894`。

### Task 5：收口终端历史回放窗口

**Files:**
- Modify: `crates/exomind-runtime/src/pty/mod.rs`
- Modify: `src/config/pty-terminal-preferences.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/components/PtyTerminal.tsx`
- Test: `crates/exomind-runtime/tests/pty_agent.rs`

**Steps**
1. 确认 runtime scrollback buffer 与 transcript tail 都受统一上限控制。
2. 核实前端 xterm scrollback 与 runtime replay limit 的换算关系。
3. 补“窗口长度足够”的专项测试，不只测“有 marker”。
4. 关掉 `#843` 的未收口项。

### Task 6：收口历史会话命名与入口语义

**Files:**
- Modify: `src/ui/app/components/PtySpawnDialog.tsx`
- Modify: `src/ui/app/pages/agents/SessionCard.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `crates/exomind-runtime/src/pty/mod.rs`
- Test: `tests/unit/ui/agent-hub/pty-spawn-dialog.test.tsx`

**Steps**
1. 历史会话标题优先显示 `/rename` 名称。
2. 回退顺序统一为：`display_title -> project_path -> short session id`。
3. 把创建入口改成用户任务语义，而不是纯技术入口。
4. 让 `#821` 的用户故事变成产品内可感知的入口流。

### Task 7：收口设置命名与分区

**Files:**
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/config/settings/desktop-tab-config.ts`
- Test: `tests/unit/settings/runtime-target-mode.setting.test.tsx`
- Test: `tests/unit/settings/settings-layouts.test.tsx`

**Steps**
1. 把 `tiled-workbench-*` 快捷键移入 `terminal-agent` 分区。
2. 把 `RT / PTY / 宿主 / transcript tail` 改写成用户任务语义。
3. 统一 success / helper / dialog 文案。
4. 用测试固化新的可见名称和分区。

## 5. issue 重组建议

建议保留现有 issue 编号，但在执行时按以下主题聚合：

1. **Theme A：Codex 执行与恢复底座**
   - `#385`
   - `#806`
   - `#818`
   - `#810`
   - `#816`

2. **Theme B：Codex 会话身份与连续性**
   - `#821`
   - `#838`
   - `#849`

3. **Theme C：Codex 终端传输与性能**
   - `#843`
   - `#894`

4. **Theme D：Codex 产品化可理解性**
   - `#875`
   - `#876`
   - `#878`

## 6. 风险与门禁

### 技术风险

1. `runtime agent` 与 `PTY terminal` 共用策略时，可能误伤现有 Claude 行为。
2. 输入 WS 化后，如果恢复/重连语义没跟上，会引入新型“连接在但不可输入”假活跃态。
3. `inner_session_id` 规范化时，如果历史数据迁移处理不好，会影响既有恢复链路。

### 产品风险

1. trusted directory 是否默认跳过，本质是安全立场，不只是 bug 修复。
2. `dangerously-bypass-approvals-and-sandbox` 是否在 PTY 模式对齐，也是产品策略问题。
3. 如果入口语义不改，底层都做好了，用户仍会把它当“技术终端”，而不是“Codex 工作台”。

### 验收门禁

1. 必须保留真实桌面验收，不接受只跑单测。
2. 所有与 `#821` 相关的改动，都应在 [tauri-mcp-windows-playbook.md](/D:/project/exomind/docs/development/tauri-mcp-windows-playbook.md) 留下证据。
3. `#894` 的关闭口径继续以 [2026-04-09-pty-websocket-latency-remediation-plan.md](/D:/project/exomind/docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md) 为准。

## 7. 推荐执行顺序

1. 先做 **Task 1 + Task 2 + Task 3**
   - 先把“策略分裂”和“身份漂移”收口，否则后面体验优化容易建立在不稳底座上。

2. 再做 **Task 4 + Task 5**
   - 输入性能与长输出回放是长期使用的主要体感差异。

3. 最后做 **Task 6 + Task 7**
   - 当底层稳定后，再收口命名、入口、设置语义，避免文案频繁返工。

## 8. 结束判断

只有满足以下条件，才能说“Codex 已经真正迁移到外心上使用”：

1. Codex 在 `runtime agent` 与 `PTY terminal` 两条链路上，不再表现为两套策略。
2. RT 重启、历史恢复、`/resume` 切换后，会话身份仍连续可解释。
3. 高频输入、长输出、历史回放能支撑代码审查与长对话。
4. 用户不需要先理解工程术语，才能启动、恢复、管理 Codex 会话。
5. `#821` 能以真实桌面用户故事收口，而不是长期挂着作为“最后总 issue”。

Plan complete and saved to `docs/plans/2026-04-09-codex-workbench-unification-plan.md`。

两种后续执行方式：

**1. Subagent-Driven（本会话内）**
- 我继续留在这个会话里，按主题逐项推进。
- 适合先做 `Task 1-3`，把统一契约和策略底座收口。

**2. Parallel Session（独立会话）**
- 开新会话按这份计划逐项执行。
- 适合做成一个长期分阶段项目。
