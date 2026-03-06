# SignalPool Phase 2 实施计划

> 日期: 2026-03-03
> PR: #320 (feature/signal-pool-phase2 → dev)
> 当前分支: feature/signal-pool-phase2

## Phase 1 状态 (已完成)

- Commits on dev: `3a57992` → `cd76ad2` → `9296000` → `4ae827f` → `2f8fccf` → `e7bf938`
- 198 tests, 0 clippy warnings, QA 审查 3 bug 全修复
- V1 验收通过: publish/SSE stream/history/route CRUD

## Phase 2 架构

```
用户输入 ──publish──→ RT SignalBus ──SSE──→ Classifier Agent (TS, Claude CLI)
                        │                    │ publish: input.classified
                        │                    ↓
                        │               Task Actor (Rust 进程内)
                        │                    │ publish: task.auto-created
                        │                    ↓
                        │            前端信号处理器 → TaskService.createTask()
                        │
                        ├──→ EventLog Actor (Rust 进程内)
                        │         │ publish: eventlog.appended
                        │         ↓
                        │    前端信号处理器 → EventLogService.addEvent()
                        │
                        └──SSE──→ Reviewer Agent (TS, Claude CLI)
                                   │ 监听 session.end (payload 含今日事件)
                                   │ publish: review.completed
                                   ↓
                            前端信号处理器 → 显示复盘面板
```

### 核心设计决策

- Rust Actor 只做信号转换，不做存储（TaskService/EventLogService 在前端 IndexedDB）
- 前端信号处理器监听输出信号 → 调用 Service 完成存储
- Review Agent 通过 session.end payload 获取今日事件（避免新 HTTP 端点）
- Claude CLI 调用在外部 TS Agent 中（非 Rust）

## 信号流定义

| Topic | Source | Payload | 消费者 |
|-------|--------|---------|--------|
| `user.input.text` | 前端 UI | `{ text: string }` | Classifier Agent, EventLog Actor |
| `input.classified` | Classifier Agent | `{ type: "task"\|"knowledge"\|"log", items: [...] }` | Task Actor |
| `task.auto-created` | Task Actor | `{ title, note?, source_text }` | 前端 → TaskService |
| `eventlog.appended` | EventLog Actor | `{ text, ts }` | 前端 → EventLogService |
| `session.end` | 前端 UI | `{ events: EventData[] }` | Reviewer Agent |
| `review.completed` | Reviewer Agent | `{ effective, stuck, improve, avoid }` | 前端 → 显示 |

## 团队分工

### agent-chain (Opus, worktree)

**范围**: 分类 Agent + 任务 Actor + 前端任务信号处理

**新建文件**:
- `packages/ts-agent-cli/agents/classifier/index.ts` — 分类 Agent 入口
- `packages/ts-agent-cli/agents/classifier/prompt.ts` — 分类 Prompt
- `crates/exomind-runtime/src/signal/actors/task_actor.rs` — 任务 Actor
- `crates/exomind-runtime/src/signal/actors/mod.rs` — Actor 模块注册
- `src/lib/services/signal-handlers.ts` — 前端信号处理器 (task 部分)

**修改文件**:
- `crates/exomind-runtime/src/signal/mod.rs` — 加 `pub mod actors;`
- `crates/exomind-runtime/src/lib.rs` — spawn task_actor

**分类 Agent 逻辑**:
1. `SignalClient({ agentId: "classifier" })` 连接 SSE
2. 收到 `user.input.text` → 提取 text
3. 调用 Claude CLI: "分类为 task/knowledge/log，返回 JSON"
4. publish `input.classified` 信号 (携带 trace_id)

**任务 Actor 逻辑** (Rust tokio::spawn):
1. `signal_pool.subscribe()` 获取 broadcast Receiver
2. 过滤 topic == "input.classified" && payload.type == "task"
3. 构造 task.auto-created 信号 (title, note)
4. `signal_pool.publish(event)`

**前端信号处理器** (signal-handlers.ts):
1. 监听 `task.auto-created` → TaskService.createTask({ title, note })
2. 提供 `startSignalHandlers(signalStream, taskService, eventLogService)` 入口

**验收标准**:
- 输入 "今天要 review PR #313" → Classifier → task → TaskService 创建任务
- cargo test + bun test 通过

### review-chain (Opus, worktree)

**范围**: EventLog Actor + 收工复盘 Agent + 前端复盘信号处理

**新建文件**:
- `crates/exomind-runtime/src/signal/actors/eventlog_actor.rs` — EventLog Actor
- `packages/ts-agent-cli/agents/reviewer/index.ts` — 复盘 Agent
- `packages/ts-agent-cli/agents/reviewer/prompt.ts` — 复盘 Prompt

**修改文件**:
- `crates/exomind-runtime/src/signal/actors/mod.rs` — 注册 eventlog_actor
- `crates/exomind-runtime/src/lib.rs` — spawn eventlog_actor
- `src/lib/services/signal-handlers.ts` — 加 eventlog + review 处理

**EventLog Actor 逻辑** (Rust tokio::spawn):
1. 过滤 topic == "user.input.text"
2. 提取 payload.text + 当前时间戳
3. publish `eventlog.appended` 信号

**Review Agent 逻辑**:
1. `SignalClient({ agentId: "reviewer" })` 连接 SSE
2. 收到 `session.end` → 从 payload.events 读取今日事件
3. 调用 Claude CLI: "四行复盘 (有效/卡住/改进/避免)"
4. publish `review.completed` 信号

**前端信号处理器** (signal-handlers.ts 追加):
1. 监听 `eventlog.appended` → EventLogService.addEvent()
2. 监听 `review.completed` → 存储/通知前端

**验收标准**:
- 每条输入 → EventLog 自动追加
- session.end → 四行复盘生成

### qa-reviewer (Opus, worktree)

**范围**: 多角度代码评审 + 集成测试 + E2E 冒烟

**评审角度**:
1. Rust 安全性: no unwrap(), at-most-once, 错误处理
2. TS 类型安全: no any, 类型完整
3. 信号契约一致性: topic/payload 格式两端匹配
4. 架构合规: 分层不越界 (Actor 不做存储)
5. Claude Prompt 质量: 输出格式可靠、边界处理

**新建测试文件**:
- `crates/exomind-runtime/tests/signal_actors_integration.rs`
- `tests/unit/signal-pool/signal-handlers.test.ts`
- `tests/e2e/signal-pool-classification.test.ts`
- `tests/e2e/signal-pool-review.test.ts`
- `tests/e2e/signal-pool-full-chain.test.ts`

**质量门禁**:
- cargo test + cargo clippy 全过
- bun test 全过
- E2E 冒烟测试通过
- 多角度评审报告发给 Lead

## 执行顺序

1. Lead: spawn agent-chain + review-chain + qa-reviewer (并行)
2. agent-chain 和 review-chain 并行开发
3. qa-reviewer 并行写测试骨架 + 审查产出
4. Lead: 合并两条链的 signal-handlers.ts (解决冲突)
5. qa-reviewer: 全量测试 + E2E 冒烟
6. Lead: 自动化验收 + 截图 → PR #320 评论
7. Lead: 请求人类验收

## 注意事项

- 两条链共享 signal-handlers.ts，需要 Lead 手动合并
- Rust actors 共享 actors/mod.rs 和 lib.rs，agent-chain 先建骨架，review-chain 追加
- Claude CLI 调用需要 CLAUDE_API_KEY 或 claude 命令可用
- 前端 signal-handlers.ts 需要从 signal-stream.service.ts 获取 SSE 连接
- session.end 信号需要前端 UI 触发（可能需要"收工"按钮）
