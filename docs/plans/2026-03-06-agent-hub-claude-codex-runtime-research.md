# Agent Hub 对接 Claude CLI / Codex 调研（2026-03-06）

## 目标

用户目标（user story，用户故事）：

1. Agent Hub 的 `agent` 节点可以承载 `Claude CLI` / `Codex CLI`。
2. 节点内可以看到流式输入输出（streaming stdin/stdout，流式标准输入输出）。
3. Agent 可以被动态创建、停止（dynamic create/stop，动态创建/停止）。
4. 最终用户可以直接通过 ExoMind 操作这两个 CLI 去执行任务。

## 当前仓库现状

### 1. 已有 `runtime agent` 能力

- `exomind-runtime` 已提供 `AgentRegistry`，支持运行时注册/注销 `Agent`。
- HTTP API 已支持：
  - `GET /agents`
  - `POST /agents`
  - `DELETE /agents/:id`
  - `POST /agents/:id/chat`
  - `GET /agents/:id/sessions`
  - `DELETE /agents/:id/sessions/:sid`
- 当前 `create agent` 只支持 `kind: "echo" | "claude"`。
- 当前内置注册的 builtin agent（内置智能体）只有：
  - `claude`
  - `echo`

### 2. Claude runtime 已经接近目标

- `ClaudeAgent` 已经不是一次性调用，而是长生命周期子进程（long-lived child process，长生命周期子进程）模型。
- 每个会话持有：
  - `child`
  - `stdin`
  - `stdout`
  - `session_id`
- 当前实现通过 `claude -p --input-format stream-json --output-format stream-json` 做真实流式交互。
- `POST /agents/:id/chat` 会把返回内容转成 SSE（Server-Sent Events，服务端事件流）输出给前端。
- 会话支持复用、关闭、统计。

### 3. Agent Hub 前端已接好一半

- `AgentsPage` / `AgentConversationPage` 已能对 runtime agent 发起流式聊天。
- 前端已经可以调用：
  - `RuntimeClient.createAgent()`
  - `RuntimeClient.deleteAgent()`
  - `RuntimeClient.streamAgentConversation()`
- 但 UI 里的“添加 Agent”按钮目前只创建 `echo`，没有暴露 `claude` / `codex` 选择。
- `Agent Hub` 拓扑图当前主要由 `signal-routes + runtime agents` 拼出节点，不是“进程 I/O 面板”。

### 4. 另有一套 `ts-agent-cli` 路线

- `reviewer` / `classifier` 是独立 Bun 进程，会订阅 `SignalPool`。
- 但它们调用 Claude 的方式仍是 `execFileSync("claude", ["--print", ...])`。
- 这意味着它们是“一次信号 -> 一次阻塞调用 -> 一次结果发布”。
- 这条路不具备：
  - 持久会话（persistent session，持久会话）
  - 流式输出（streaming output，流式输出）
  - 统一动态 stop / resume

## 外部 CLI 当前能力

### Claude CLI（本机已安装）

- 本机版本：`2.1.69`
- 本机 `claude --help` 已明确支持：
  - `--input-format stream-json`
  - `--output-format stream-json`
  - `--replay-user-messages`
  - `--include-partial-messages`
  - `server` 子命令

结合官方文档可确认：

- CLI 适合直接做 stdin/stdout 流式桥接。
- 官方 Python SDK 也支持 `ClaudeSDKClient.query(...)` 的流式事件消费。
- SDK 暴露 `session.interrupt()`，说明官方已经把“会话级控制（session control，会话控制）”作为一等能力。

结论：

- **Claude 最稳的接法仍然是长生命周期 CLI 子进程 + stream-json。**
- 若后续要更强会话管理，可再评估 `Claude SDK` 或 `claude server`。

### Codex CLI（本机已安装）

- 本机版本：`codex-cli 0.111.0`
- 本机 `codex --help` 已明确支持：
  - `exec`
  - `app-server`
  - `mcp-server`
- 本机 `codex exec --help` 已明确支持：
  - `--json` JSONL 事件输出
- 本机 `codex app-server --help` 已明确支持：
  - `--listen stdio://`
  - `--listen ws://IP:PORT`

结合官方文档可确认：

- `codex exec --json` 适合一次性任务（one-shot task，一次性任务）。
- `codex app-server` 是给外部应用集成的 stateful JSON-RPC server（有状态 JSON-RPC 服务）。
- 官方协议包含：
  - `session/init`
  - `session/submit`
  - `session/configure`
  - 流式通知（turn/item 更新）

结论：

- **Codex 不应该按 Claude 那套“手写 stdout 解析”来接。**
- **Codex 最合适的接法是 `app-server` 适配器（adapter，适配器）。**

## 差距分析

### 已满足的部分

- 已有 runtime host（运行时主机）概念。
- 已有 agent registry（智能体注册表）。
- 已有 agent create/delete/chat/session HTTP 面。
- 已有 Claude runtime streaming（Claude 运行时流式对话）。
- 已有前端对 runtime agent 的基本接线。

### 尚未满足的关键点

1. 没有 `CodexAgent`。
2. 没有统一的 `AgentProcessAdapter` / `AgentProviderAdapter` 抽象。
3. Agent Hub 节点没有承载“实时 stdin/stdout/thinking/tool events（实时输入输出/思考/工具事件）”。
4. `ts-agent-cli` 体系和 `runtime agent` 体系没有统一。
5. 前端创建 Agent 的入口没有 provider/kind 选择器。
6. 当前 `chat` 只传 `message -> content chunk`，没有 richer event stream（更丰富的事件流）。

## 推荐架构

### 推荐统一模型：`Agent Runtime Adapter`（智能体运行时适配器）

建议把 Claude / Codex 都收敛到同一抽象：

```ts
interface AgentRuntimeAdapter {
  kind: "claude-cli" | "codex-app-server";
  start(config: AgentStartConfig): Promise<AgentHandle>;
  submit(handle: AgentHandle, input: AgentInput): AsyncIterable<AgentEvent>;
  interrupt(handle: AgentHandle): Promise<void>;
  stop(handle: AgentHandle): Promise<void>;
  listSessions?(handle: AgentHandle): Promise<AgentSessionInfo[]>;
}
```

其中 `AgentEvent` 不要只保留文本，应至少包含：

- `session.started`
- `input.accepted`
- `output.delta`
- `thinking.delta`
- `tool.call`
- `tool.result`
- `status`
- `error`
- `done`

### Claude 适配器

- 实现名建议：`ClaudeCliAdapter`
- 运行方式：`tokio::process::Command` / `stdin` / `stdout`
- 协议：`stream-json`
- stop 策略：
  - 优先中断会话（如后续采用 SDK/server）
  - 当前阶段直接 kill child process（终止子进程）

### Codex 适配器

- 实现名建议：`CodexAppServerAdapter`
- 运行方式：spawn `codex app-server --listen stdio://`
- 协议：JSON-RPC over stdio（基于标准输入输出的 JSON-RPC）
- 前端只看统一 `AgentEvent`，不感知 Codex 原始协议

## 对 Agent Hub 的具体改造建议

### P0. 不改 UI 模型，先把能力接通

- 在 runtime backend 新增 `kind: "codex"`。
- 前端“添加 Agent”弹层改成 provider 选择：
  - `Claude CLI`
  - `Codex`
  - `Echo`
- `RuntimeClient.createAgent()` 类型扩展为：
  - `echo`
  - `claude`
  - `codex`

### P1. 把聊天流升级为统一事件流

- 当前 `/agents/:id/chat` SSE 只返回 `{ content, session_id }`。
- 建议升级为：

```json
{
  "type": "output.delta",
  "content": "..."
}
```

并支持：

```json
{
  "type": "thinking.delta",
  "content": "..."
}
```

```json
{
  "type": "tool.call",
  "name": "shell"
}
```

这样 Agent Hub 节点详情页就能显示“模型在做什么”，而不是只显示最终文本。

### P2. 节点级控制

- 在 Agent Hub 右侧栏加入：
  - `Start`
  - `Stop`
  - `Interrupt`
  - `Open Session`
  - `View Logs`
- 节点状态来源统一为 runtime：
  - `starting`
  - `running`
  - `idle`
  - `busy`
  - `stopped`
  - `error`

### P3. 统一 `signal agent` 和 `chat agent`

- 后续 `reviewer` / `classifier` 不应继续直接 `execFileSync("claude")`。
- 更合理的是：
  - 由 runtime 创建 `reviewer` / `classifier` agent 实例
  - 订阅 SignalPool 后调用统一 `ClaudeCliAdapter` / `CodexAppServerAdapter`

这样外心里所有 agent 才是“一类对象（single runtime model，单一运行时模型）”。

## 最小落地路径（推荐）

### 方案 A：先 Claude，后 Codex

优点：

- 利用现有 `ClaudeAgent`，改动最小。
- 能最快打通“Agent Hub 创建 Claude 节点 -> 流式执行 -> 停止”的闭环。

缺点：

- Codex 要第二阶段接入。

### 方案 B：先抽象适配器，再一起接 Claude + Codex

优点：

- 架构更干净。
- 不会后面再返工 Claude。

缺点：

- 首次开发量更大。

### 我的建议

**推荐 B 的结构，但按 A 的节奏交付。**

也就是：

1. 先抽 `AgentRuntimeAdapter`
2. 先把现有 `ClaudeAgent` 迁到新抽象
3. 再实现 `CodexAppServerAdapter`
4. 最后把 `reviewer/classifier` 迁入统一 runtime

## 结论

结论非常明确：

- **你的目标是可达的，而且这个仓库已经做到了 50%-60%。**
- 离目标最近的现有基座不是 `ts-agent-cli`，而是 `exomind-runtime + AgentRegistry + SSE chat route`。
- **Claude 应继续沿用长生命周期 CLI + stream-json。**
- **Codex 应直接走官方 `app-server` 协议，不建议手搓 stdout 解析。**
- 真正缺的不是“有没有 agent”，而是：
  - 统一 provider adapter（统一提供方适配层）
  - richer event stream（更丰富的事件流）
  - Agent Hub 节点级控制面板
  - 把 signal agent 和 chat agent 统一成同一类 runtime entity（运行时实体）

