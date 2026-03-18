# Agent Session Terminal Control Design

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Agent Hub 中的 PTY 会话启动、恢复、终止、消息桥接

---

## 1. 背景 / Background（背景）

当前 Agent Hub 已经具备 PTY 会话的基础能力，但关键闭环仍缺失：

1. `POST /sessions/:id/messages` 只记录消息，不桥接到 PTY stdin。
2. PTY 恢复逻辑只支持 Claude，不支持 `codex exec resume <session-id>`。
3. `PtySpawnDialog` 只能“启动新会话 / 恢复 Claude 会话”，不能配置 `agent type（Agent 类型）`、`model（模型）`、`reasoning effort（推理强度）`、`extra args（额外参数）`。
4. `SessionCard` 列表卡片没有 PTY 级“停止 / Stop（停止）”按钮。

---

## 2. 目标 / Goals（目标）

本次改动只补齐当前确认过的真实缺口：

1. 用户可以从 Agent Hub 启动 `Claude / Codex / Custom（自定义命令）` PTY 会话。
2. 用户可以按 `agent type（Agent 类型）` 恢复 `Claude / Codex` 历史会话。
3. 用户可以通过 `POST /sessions/:id/messages` 把消息写入目标 PTY stdin。
4. 用户可以在列表卡片、平铺终端、终端详情页三处统一停止 PTY 会话。
5. 参数配置最小支持：`agent type`、`model`、`reasoning effort`、`workdir`、`extra args`。

---

## 3. 非目标 / Non-goals（本次不做）

1. 不做通用 Agent provider 抽象。
2. 不做 Custom 命令历史恢复。
3. 不做参数模板保存、最近使用参数、Profile 配置档。
4. 不做 PTY 进程级 pause / resume 控制。
5. 不做跨类型历史会话混排、全文搜索、分页。

---

## 4. 核心决策 / Key Decisions（关键决策）

### 4.1 消息桥接策略

`send_message` 的主职责仍是“记录消息（record message，记录消息）”。  
如果目标 session 带有 `pty_id`，则额外尝试将 `content + "\n"` 写入 PTY stdin。

处理原则：

1. session 不存在：返回 `404`
2. session 存在但没有 `pty_id`：只记录消息，返回 `201`
3. session 存在且有 `pty_id`，但 PTY 写入失败：记录 warning 日志，仍返回 `201`

这样可以保证“会话消息”与“终端桥接”解耦，避免 PTY 抖动直接破坏消息链路。

### 4.2 恢复接口显式带 `agent_type`

`PtyResumeRequest` 增加 `agent_type: "claude" | "codex"`。  
恢复命令映射如下：

1. `claude` -> `claude --resume <session-id>`
2. `codex` -> `codex exec resume <session-id>`

Custom 不支持恢复，因此不出现在 `resume` 的请求契约内。

### 4.3 历史会话接口统一化

新增统一接口：

`GET /pty/sessions?agent_type=claude|codex`

返回统一结构：

1. `agent_type`
2. `session_id`
3. `project_path`
4. `last_modified`

不再继续扩展 `/pty/claude-sessions` 这种单类型端点。

### 4.4 启动弹窗单一入口

`PtySpawnDialog` 保持单一弹窗，顶部先选 `agent type`，随后显示：

1. `Start New Session（启动新会话）`
2. `Resume History（恢复历史会话）`

`Custom` 只显示“启动新会话”，不显示恢复列表。

---

## 5. 后端设计 / Backend Design（后端设计）

### 5.1 `send_message` -> PTY stdin

涉及文件：

1. `crates/exomind-runtime/src/routes/sessions.rs`

实现方式：

1. 保留现有 session existence check（存在性检查），但把 session 实例保存到局部变量。
2. 构建 `SessionMessage` 后，若 `session.pty_id` 存在，则调用 `state.pty_manager.write_input(pty_id, bytes)`。
3. 输入内容按 `"{content}\n"` 写入，匹配终端交互习惯。

### 5.2 PTY 历史会话发现

涉及文件：

1. `crates/exomind-runtime/src/pty/mod.rs`
2. `crates/exomind-runtime/src/routes/pty.rs`

新增统一数据结构：

`PtyHistoricalSessionInfo`

字段：

1. `agent_type`
2. `session_id`
3. `project_path`
4. `last_modified`

发现逻辑：

1. Claude：沿用当前 `~/.claude/projects/.../*.jsonl` 扫描逻辑。
2. Codex：新增 `codex` 本地历史会话目录扫描逻辑。
   - 目录与文件匹配规则以当前本机 `codex exec resume` 实际缓存布局为准。
   - 若本地未发现目录，则接口返回空数组，而不是报错。

### 5.3 PTY 恢复

`PtyManager::resume()` 改成根据 `agent_type` 分支构建 `PtySpawnRequest`。

默认会话名规则：

1. Claude：`Claude-<session-id-prefix>`
2. Codex：`Codex-<session-id-prefix>`

恢复成功后仍把原始 `session_id` 写回 `PtyAgentInfo.session_id`，保证 session 注册链路不变。

### 5.4 PTY 路由

涉及文件：

1. `crates/exomind-runtime/src/routes/pty.rs`

改动：

1. `GET /pty/sessions?agent_type=...`
2. `POST /pty/resume` 接收新的 `agent_type`
3. 保留现有 `/pty/spawn`、`/pty/:id/stop`、`/pty/:id/input`

---

## 6. 前端设计 / Frontend Design（前端设计）

### 6.1 `PtySpawnDialog`

涉及文件：

1. `src/ui/app/components/PtySpawnDialog.tsx`

新增状态：

1. `agentType`
2. `model`
3. `reasoningEffort`
4. `customCommand`
5. `extraArgs`
6. `historySessions`
7. `historyLoading`

交互规则：

1. 切换 `agentType` 时，如果是 `claude / codex`，请求对应历史会话。
2. `Claude / Codex` 都支持：
   - `name`
   - `workdir`
   - `model`
   - `extraArgs`
3. `Codex` 额外支持 `reasoningEffort`
4. `Custom` 额外支持 `customCommand`
5. 点击“启动新会话”时，前端把配置拼成 `command + args`
6. 点击“恢复历史会话”时，前端发送 `agent_type + session_id + name/workdir`

### 6.2 `SessionCard`

涉及文件：

1. `src/ui/app/pages/agents/SessionCard.tsx`
2. `src/ui/app/pages/agents/SessionsView.tsx`
3. `src/ui/app/pages/AgentsPage.tsx`

新增卡片级 `Stop（停止）` 小按钮，显示规则与 tiled grid 对齐：

1. 仅 `interaction_mode === "terminal"` 且有 `pty_id` 时显示并可用
2. 点击停止时阻止卡片主点击事件冒泡
3. 最终仍复用 `AgentsPage` 现有的 `handleStopPtyAgent(...)`

---

## 7. 测试设计 / Test Strategy（测试策略）

### 7.1 Rust

1. `sessions.rs`
   - `send_message` 在普通 session 上只返回消息
   - `send_message` 在 PTY session 上会调用 PTY stdin 写入
2. `pty/mod.rs`
   - `resume` 对 Claude / Codex 生成不同 command / args
   - 历史会话发现结果按 `agent_type` 正确返回
3. `routes/pty.rs`
   - `GET /pty/sessions` 参数校验与返回结构正确

### 7.2 前端

1. `PtySpawnDialog`
   - 切换 `agentType` 后字段与历史会话列表变化正确
   - `Codex` 启动请求包含 `model` 与 `reasoning effort`
   - `resume` 请求带 `agent_type`
2. `SessionCard / SessionsView`
   - PTY session 显示 stop 按钮
   - 点击 stop 触发回调，不触发卡片导航主点击

### 7.3 页面集成

1. Agents 页从列表卡片停止 PTY 会话
2. 启动弹窗切到 `Codex` 后能看到历史会话并发起恢复

---

## 8. 验收标准 / Acceptance Criteria（验收）

1. `POST /sessions/:id/messages` 可以桥接到 PTY stdin。
2. `Claude / Codex` 都能按 `agent type` 恢复历史会话。
3. `PtySpawnDialog` 支持 `agent type / model / reasoning effort / extra args`。
4. `SessionCard` 具备卡片级 stop 按钮。
5. 类型检查、相关单测、相关运行时测试全部通过。

