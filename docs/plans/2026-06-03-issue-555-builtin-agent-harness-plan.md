# Issue #555 内置 Agent Harness 计划草案

> 状态：Plan approved v1.0（已吸收两轮审阅意见，已刊载至 [#555](https://github.com/exomind-team/exomind/issues/555)）  
> 日期：2026-06-03  
> 关联 Issue：#555、#385  
> 第一阶段功能命名：`时间块总结` / `timeblock_summary`  
> 参考 Skill：`exomind-monitor`

## 1. 目标收束

Issue #555 的目标不是再增加一个“外部 Agent 调用 HTTP 接口 + 同步循环”，也不是把 Claude Code / Codex 作为 PTY 自动接入 ExoMind。目标是：在 ExoMind Runtime 内部实现一个设备本地、跨平台、基于 HTTP/SSE 模型 API 的内置 Agent Harness，用来承接 `exomind-monitor` 已验证过的时间块开始提示、时间块结束总结、事件上下文读取与 `agent_feedback` 写回能力。

第一阶段收束为 `timeblock_summary`：

```text
Runtime timeblock 状态变化
  -> SignalPool 发布 timeblock.replication.active_upserted / timeblock.replication.completed
  -> 内置 timeblock_summary Agent 收到进程内信号
  -> 读取完成块、当前块、eventlog、block_feedback 与必要任务上下文
  -> 调用现有 LLM broker / provider profile，并只暴露白名单工具
  -> LLM 通过 submit_timeblock_summary 工具提交结构化结果
  -> Runtime 校验工具入参并生成 agent_feedback 事件
  -> 记录执行状态、工具调用轨迹、幂等游标与错误日志
```

这条链路必须是**响应式信号驱动**，而不是外部 `await`/HTTP 长轮询式监听。外部 `exomind-monitor` 的 `monitor.js wait` 只是历史验证路径；内置实现应该直接复用 Runtime 进程内 `SignalPool` 与现有信号网络。

## 2. 外部 `exomind-monitor` 现状拆解

### 2.1 外部 Agent + Skill 如何工作

`exomind-monitor` 的当前机制是：

```text
外部 Agent 读取 skill 文档
  -> 运行 scripts/monitor.js wait
  -> 并行等待 timeblock_created / timeblock_ended
  -> 命中后由 Agent 读取 snapshot / eventlog / completed block
  -> Agent 按 block-start.md 或 block-end.md 模板写报告
  -> 运行 scripts/send.js --tags agent_feedback 写入 eventlog
  -> 继续下一轮 wait
```

这个链路的价值是已经验证了产品行为：

- 时间块开始时有在场感提示。
- 时间块结束时有叙事总结。
- `block_feedback` 负责精确数据，`agent_feedback` 负责理解与洞察。
- RT 恢复或 Agent 中断后，需要检查是否有漏发总结并补发。

这个链路的问题也明确：外部 Agent 可以绕过 skill 脚本，直接 `curl` RT HTTP API，导致标签、profile、deviceName 或路由参数出错。内置 Harness 的关键改进是把软件交互面收束为**工具调用白名单**，让 Runtime 在代码层面校验与落库，而不是依赖 prompt 软约束。

### 2.2 开始提示模板

来自 `exomind-monitor/references/templates/block-start.md`，内置第一版应吸收其结构，而不是照抄为 LLM 自由输出：

当 `timeblock_created` 事件触发且 `blockType === "active"` 时使用。

**前置判断**：若 `blockType === "gap"`，表示前一个 active 块已结束，不要发开始提示，先回看 completed 列表补发上一块的总结。

`````markdown
## 时间块开始

**{块名称}** 已启动（{时间}）。

### 来源事件

```
{事件类型}：{blockType}
{blockId}
```

### 上下文回顾

{引用触发事件的内容摘要，结合近期已完成块推断用户意图}

近期参考：
- **{块名称}**（{时间}→{时间}），投入{duration}，反馈{duration}

### 本块可能事项

| 类型 | 说明 |
|------|------|
| {类型} | {说明} |
`````

开始提示采用模板化生成：Runtime 按模板填充固定字段（块名称、时间、来源事件），同时将模板中开放字段（上下文回顾、本块可能事项）交由 Agent 填写。模板化与 Agent 填写不矛盾——模板提供结构骨架，Agent 负责语义内容。

### 2.3 结束总结模板

来自 `exomind-monitor/references/templates/block-end.md`，这是第一阶段最重要的产品语义：

当 `timeblock_ended` 事件触发时使用。

**设计理念**：
- `block_feedback`（RT 自动生成）= 精确数据记录，包括时间戳、统计数字、超时分析
- `agent_feedback`（本模板生成）= 叙事洞察，包括事件串联、模式识别、主观感受
- **两者各司其职，不重复**：本模板不复制 block_feedback 的精确数据，而是做它独有的「理解」工作

`````markdown
## 时间块结束总结

**{块名称}** 已结束，feedback_submit 完成。

### 一、本次时间块内容梗概

> **目的**：用连贯的语言把该时间块内发生的事件串联起来，让读者理解「用户做了什么、事件之间有什么联系」。
> **写法**：2-3 句话，讲清楚「先做了什么，随后转向什么，中间有什么转折或亮点，最后的感受是什么」。
> **禁止**：不要列出时间戳或精确数字，这些在 block_feedback 中已有。
> **引用**：引用 1-2 条该时间块内的原始 note（「」包裹），让内容有说服力。
> **感受**：写一句主观感受或洞察，不是描述数据，而是表达「我注意到…」。

{内容梗概（叙事风格，引用原始 note）}

### 二、本次时间块成果

> **目的**：总结本次时间块的实质性产出，包括完成的事项、解决的问题、新增的里程碑。
> **写法**：每项成果尽量标注「什么状态」（✅ 完成 / ❌ 未完成 / 🔄 进行中），后跟简短说明。

| 事项 | 状态 | 说明 |
|------|------|------|
| {事项} | ✅ / ❌ / 🔄 | {说明} |

### 三、仓库侧关联事项

> **目的**：识别跨时间块、跨仓库的模式，或与之前工作的关联。
> **写法**：如无关联，写「无」。如有，描述具体关联（如「延续了上一块的 XXX 工作」「与某仓库的 XXX 配置有关联」）。

| 事项 | 状态 |
|------|------|
| {事项} | ✅ / — |

### 四、下一步建议

> **目的**：基于本次时间块的经验，主动提出建议。
> **写法**：如有建议，写 1-3 条；如无，写「无明显下一步」。

1. **{类型}**：{说明}
2. ...
`````

---

*gap 块触发回看时，若发现上一块未发总结，在此补发*

内置版必须保留“程序自动 + Agent 灵动”的边界：Runtime 负责事实、字段、标签、profile、幂等与最终事件生成；LLM 只负责叙事洞察、关联判断与建议内容。

## 3. 当前仓库实现现状

### 3.1 信号网络现状

已确认现有 Runtime 具备可复用基础：

- `crates/exomind-runtime/src/routes/timeblocks.rs` 在时间块完成时发布 `timeblock.replication.completed`，在 active 块 upsert 时发布 `timeblock.replication.active_upserted`。
- `crates/exomind-runtime/src/routes/signals.rs` 提供 `/signals/publish`、`/signals/stream/:agent_id`、`/signals/history`、`/signal-routes`。
- `crates/exomind-runtime/src/signal` 已有 `SignalPool` 的 publish / subscribe / window history 机制。
- `src/ui/app/pages/agents-signal-topology.ts` 已将 `SignalRoute` 构造成 topic -> target node 的图，且支持 `agent` 类型节点与 standalone agents。
- `crates/exomind-runtime/src/agent/mod.rs` 的 `AgentRegistry` 支持运行时 register / unregister，`/agents` 可列出 agent summary。

结论：`timeblock_summary` 应优先复用现有信号网络。第一版不需要另起 HTTP 监听，也不需要让外部 Agent 调 `/act/await`。更小改法是：注册一个内置 agent-like runtime entity，并让它订阅或直接处理 `timeblock.replication.active_upserted` / `timeblock.replication.completed`。

#### 信号类型与 `block_feedback` 时序分析

代码确认的信号类型：

| Topic | 发布位置 | 触发时机 | payload 关键字段 |
|-------|----------|----------|-----------------|
| `timeblock.replication.completed` | `routes/timeblocks.rs:239` | 用户结束时间块（提交 end）时 | `cursor.kind=timeblock_completed`, `blockId`, `completedAt`, 完整 `block` |
| `timeblock.replication.active_upserted` | `routes/timeblocks.rs:281` | 用户开始新 active 时间块时 | `cursor.kind=timeblock_active`, `startId`, `updatedAt`, 完整 `active` |

**`block_feedback` 没有信号类型。** 它的写入方式是直接写入 eventlog（tags: `["block_feedback"]`），不经过信号网络（`routes/timeblocks.rs:2103`）。这意味着 `timeblock.replication.completed` 信号到达时，`block_feedback` 可能尚未写入 eventlog。

**但对内置 Agent 而言这不是问题。** 关键设计决策（Hailaylin）：人与 Agent 的反馈没有先后顺序——`timeblock.replication.completed` 信号触发时，人填写反馈，Agent 同步根据时间块生成反馈。Agent 不需要等待 `block_feedback`，因为它不复制精确统计，只负责叙事洞察。Agent 只需读取时间块数据与 eventlog 事件，即可独立生成 `agent_feedback`。

### 3.2 仍需补的信号网络缺口

当前信号网络更偏“路由展示 + SSE 投递 + 历史窗口”，还不是完整的内置 Agent 执行状态面板。`timeblock_summary` 需要补：

- Agent 节点身份：`agent:timeblock_summary`，名称显示为 `时间块总结`。
- 路由关系：`timeblock.replication.active_upserted -> agent:timeblock_summary`、`timeblock.replication.completed -> agent:timeblock_summary`。
- 状态字段：idle / queued / collecting_context / calling_model / awaiting_tool / writing_feedback / failed。
- 明细面板：最近运行、当前处理的 timeblock id、模型 provider/model、工具调用列表、生成草稿片段、最终 `agent_feedback` event id、错误信息。
- 事件轨迹：可从 `/signals/history` 与 agent session store 回看，但 UI 需要把这些聚合到节点详情中。

### 3.3 LLM / AgentSession / 工具调用现状

已确认现有 Runtime 具备内置 LLM 调用基础：

- `crates/exomind-runtime/src/agent/api.rs` 定义 `ApiProviderProfile`，通过 `reqwest` 直接调用模型 API。
- 同文件已支持 OpenAI-compatible `/chat/completions`、Anthropic `/v1/messages` 的工具定义与工具调用解析。
- OpenAI 路径支持 JSON 响应，并能兼容 `text/event-stream` 风格响应体解析；Anthropic 路径支持 `tool_use` / `tool_result` 消息结构。
- `crates/exomind-runtime/src/agent/broker.rs` 用 `AgentTurnBroker` 统一调用 provider，并把 provider completion 转成 `Final` 或 `NeedsToolCalls`。
- `crates/exomind-runtime/src/agent/session.rs` 已有 `run_broker_agent_session_*`、`AgentTrigger::Internal`、`AgentSessionStore` 与 `ToolCallRecord`。
- `crates/exomind-runtime/src/agent/life.rs` 已有内部工具调用后继续一轮模型调用的参考路径：先调用模型，若出现工具调用则执行内部工具，再带 `ToolResult` 续跑。
- `crates/exomind-runtime/src/agent/tools/eventlog.rs` 已有 `get_recent_events` 只读工具。

结论：当前接口足够支撑第一版 `timeblock_summary`，不需要新写一套 provider client。主要工作是把现有 broker/session/tool 机制包装成 `timeblock_summary` 的受控执行循环，并新增本功能需要的工具定义与校验。

### 3.4 TS Agent CLI 是什么，为什么第一阶段不迁移

这里的旧 TS Agent CLI 主要指 `packages/ts-agent-cli` 下的外部 Node/Bun Agent 实现，以及 Runtime 启动时可选的 `spawn_ts_agents` 旧链路。典型能力包括：

- `packages/ts-agent-cli/agents/reviewer`：监听类似 `timeblock.completed` 的事件，调用 OpenAI-compatible API 生成 review，再发布结果。
- `packages/ts-agent-cli/agents/classifier`：对输入事件做分类或任务相关处理。
- 旧链路依赖外部进程、环境变量、HTTP/SSE 与脚本执行。

这不是 `/agents` 页面里的“信号网络/平铺终端”本身。信号网络与平铺终端仍是正常产品功能，不应被迁移或删除。第一阶段只是不把 reviewer/classifier 的旧能力迁移作为 `timeblock_summary` 验收前提；旧代码保持不动，后续可以在现有工作基础上继续实装或复用其中的 prompt/guard 思路。

## 4. 第一阶段已对齐决策

### 4.1 成功闭环

第一阶段成功闭环：

1. 程序自动响应时间块 active/completed 信号。
2. active 块开始时生成开始提示型 `agent_feedback`。
3. completed 块结束时读取时间块与相关事件，生成叙事总结型 `agent_feedback`。
4. `agent_feedback` 不替代、不复制 RT 自动生成的精确 `block_feedback`。
5. 同一时间块不会重复写开始提示或结束总结。
6. 未配置模型、模型失败、工具失败、写入失败时，状态可观察且日志清楚。

### 4.2 Harness 形态

第一版采用 Runtime 内部后台服务 + AgentRegistry 可见节点的混合形态：

- 后台执行逻辑放在 Runtime 内部，不依赖外部 CLI。
- 注册 `timeblock_summary` 为内置 agent-like 节点，最小化接入现有信号网络。
- 不把它设计成可自由聊天的通用 Agent；`/agents` 可以展示状态，但它的主要入口是信号触发。
- 节点详情应逐步展示运行状态、工具调用与最近 `agent_feedback`。

### 4.3 模型配置

第一阶段复用现有默认 LLM / API Agent 配置：

- 读取现有 `exomind:agentApiProvider`、`exomind:agentApiModel`、`exomind:agentApiBaseUrl`、`exomind:agentApiApiKey` 或等价默认 profile。
- 不新增专用 API key 输入。
- 设置页把内置总结开关与模型配置放在相邻区域，避免用户找不到。
- 如果没有模型配置：不崩溃、不写空总结，只记录状态与日志。

### 4.4 开始提示与结束总结均模板驱动

开始提示与结束总结均采用模板驱动：Runtime 按模板骨架填充固定字段（块名称、时间、来源事件等），模板中的开放字段（上下文回顾、本块可能事项、内容梗概、成果表、关联事项、下一步建议等）由 LLM Agent 填写。模板提供结构骨架，Agent 负责语义内容——二者不矛盾。

### 4.5 跨设备同步

默认设备本地：

- `timeblock_summary` 启用开关默认关闭，scope 为 device。
- API token 默认不跨设备同步。
- 模型名、base URL、开关是否同步，后续另行审阅；第一阶段建议全部本地，最多为非敏感项同步预留结构。

### 4.6 幂等状态存储

幂等状态第一版使用后端轻量级持久化（config store 或现有轻量 store），不引入 SQLite 表。关键是保证刷新网页或重启后状态不丢失。运行轨迹复用 `AgentSessionStore`。

### 4.7 Agent 交互入口

`timeblock_summary` 不提供 `/agents/:id/chat` 自由聊天入口——主要入口是信号触发。但必须可见：当前运行状态（idle/running/failed）、历史处理记录、最近一次工具调用与生成内容。复用 `AgentSessionStore` 的历史数据，让 `/agents` 节点详情可回看每次总结的输入上下文、LLM 工具调用轨迹与最终 `agent_feedback` 输出。

### 4.8 人与 Agent 反馈同步触发

`timeblock.replication.completed` 信号触发时，人与 Agent 同步开始各自反馈流程，没有先后顺序。这是**内置 Agent 与外接 Agent 的最大设计差异**：

| 维度 | 外接 Agent（exomind-monitor） | 内置 Agent（timeblock_summary） |
|------|-------------------------------|--------------------------------|
| 触发方式 | 外部进程轮询 `timeblock_ended` 事件 | 进程内信号 `timeblock.replication.completed` |
| 与人的时序 | 人先反馈，Agent 后补（或 Agent 先写，人后补） | 人与 Agent 同步触发，各自独立生成 |
| `block_feedback` 依赖 | Agent 通常能读到已生成的 `block_feedback`，可作为参考 | Agent 不依赖 `block_feedback`——它不复制精确统计，只做叙事洞察 |
| 反馈独立性 | Agent 可能读到人的反馈作为上下文 | Agent 完全独立，不读取人的反馈（eventlog 写入有延迟） |
| 跨设备 | 依赖外部进程可达 | 设备本地，信号驱动，无网络依赖 |

Agent 在 `timeblock.replication.completed` 信号到达后立即启动：读取时间块数据与 eventlog 事件，通过模板 + LLM 生成叙事型 `agent_feedback`。不等待 `block_feedback`，不等待人的反馈。

## 5. 工具调用设计

### 5.1 原则

内置 Agent 与外接 Agent 有两层本质差别：

1. **工具面收束**：LLM 不再能直接随意调用 RT HTTP API。LLM 只能看到 Runtime 明确提供的工具，所有副作用由 Runtime 在工具层校验并执行。
2. **信号驱动 + 同步触发**：内置 Agent 通过进程内 `SignalPool` 订阅信号，与人同步触发反馈，不依赖外部轮询或 HTTP 长连接。

第一版只给 `timeblock_summary` 提供：

- 只读上下文工具。
- 一个最终报告提交工具。
- 不提供时间块 start/stop/end、任务完成、eventlog 删除等工具。

因此，高风险动作不是靠 prompt 禁止，而是在工具面根本不存在。

### 5.2 建议工具白名单

| 工具 | 类型 | 用途 | 第一版 |
|------|------|------|--------|
| `get_timeblock_context` | 只读 | 返回当前处理块、相邻块、block_feedback 与已知幂等状态 | 必做 |
| `get_events_in_timeblock` | 只读 | 按时间块范围读取 eventlog | 必做 |
| `get_recent_events` | 只读 | 复用现有近期事件工具，补充上下文 | 可复用 |
| `get_related_tasks` | 只读 | 读取相关任务摘要，帮助判断成果与卡点 | 可后置 |
| `submit_timeblock_summary` | 受控副作用 | 提交结构化总结字段，由 Runtime 生成 `agent_feedback` | 必做 |
| `create_proposal` | 受控副作用 | 后续给 Agent 创建提案，不直接改业务状态 | 后续 |

### 5.3 `submit_timeblock_summary` 草案

LLM 不直接输出最终 Markdown 事件，而是调用工具提交结构化字段：

```typescript
{
  "blockId": string,
  "summaryKind": "start" | "end",
  "narrative": `2-3 句话，串联时间块内事件（若为时间块开始，则总结先前gap块内事件），不列精确统计`,
  "quotedNotes": [`引用 1-2 条原始 note，可为空但需说明原因`],
  "outcomes": [
    { "item": `事项`, "status": "done" | "ongoing" | "not_done" | "unknown", "note": `说明` }
  ],
  "relations": [
    { "item": `关联事项`, "status": "done" | "none" | "unknown", "note": `说明` }
  ],
  "suggestions": [
    { "kind": `建议类型`, "text": `1-3 条建议之一` }
  ],
  "confidence": "high" | "medium" | "low"
}
```

Runtime 校验：

- `blockId` 必须等于当前处理块。
- 无论 `summaryKind` 如何，都必须有 `narrative`，不得只复制 `block_feedback` 精确统计。
- 字段缺失、状态枚举不合法、引用越界、内容为空时，拒绝写入并让模型修正，最多重试有限轮次。
- 校验通过后，由 Runtime 填充标题、时间、标签、deviceName、profile/scope，并写入 `agent_feedback`。

## 6. Prompt 草案

### 6.1 系统提示词草案

```markdown
你是 ExoMind Runtime 内置的「时间块总结」Agent（timeblock_summary）。

你的职责：在 Runtime 发来时间块开始或结束信号后，读取受控工具提供的上下文，生成叙事型 agent_feedback。

边界：
- 你与用户同步触发：用户结束时间块时，你同时收到信号并开始生成反馈。你不等待任何前置反馈。
- block_feedback（如果已存在）由 Runtime 生成，负责精确时间、统计数字、超时等事实；你不要复述这些精确统计。
- agent_feedback 负责事件串联、模式识别、卡点、成果、主观洞察与下一步建议。
- 你不能直接修改时间块、任务或事件日志；你只能调用提供给你的工具。
- 最终反馈必须通过 submit_timeblock_summary 工具提交结构化字段。
- 如果上下文不足，先调用只读工具补充；不要编造事实。
- 输出会长期留在用户的 eventlog 中，语气要简短、自然、可追溯。
```

### 6.2 时间块开始提示词草案

```markdown
当前 Runtime 发来了 active 时间块开始信号。

请完成：
1. 调用 get_timeblock_context 读取新 active block 与最近 completed block。
2. 如需要，调用 get_recent_events 获取近期事件。
3. 生成一条简短开始提示，目标是提供“在场感”和上下文承接，而不是做总结。
4. 通过 submit_timeblock_summary 提交 summaryKind=start。

开始提示应包含：
- 块名称与启动事实。
- 1 段上下文回顾：结合触发事件或近期事件推断用户可能正在承接什么。
- 1-3 个本块可能事项。

不要：
- 不要列精确统计。
- 不要承诺已执行任何状态变更。
- 如果 blockType 是 gap，不要发开始提示，应让 Runtime 先处理 completed block 总结。
```

### 6.3 时间块结束总结提示词草案

```markdown
当前 Runtime 发来了 completed 时间块结束信号。

请完成：
1. 调用 get_timeblock_context 读取 completed block、相邻块与幂等状态。
2. 调用 get_events_in_timeblock 读取该时间块范围内的事件。
3. 如上下文仍不足，可调用 get_recent_events 或 get_related_tasks。
4. 基于事件内容生成叙事洞察，并通过 submit_timeblock_summary 提交 summaryKind=end。

结束总结必须包含：
- 2-3 句话串联“用户做了什么、事件之间有什么联系、是否有转折或亮点”。
- 1 句主观观察，使用“我注意到……”一类表达。
- 1-2 条原始 note 引用；如没有可引用内容，明确说明上下文不足。
- 本块成果表：完成、进行中、未完成或未知。
- 仓库侧/任务侧关联事项；没有则写“无明显关联”。
- 1-3 条下一步建议；没有则写“无明显下一步”。

禁止：
- 不要复制 block_feedback 的精确统计。
- 不要列出一堆时间戳。
- 不要编造未出现的任务、仓库状态或用户意图。
- 不要直接输出最终 Markdown；最终必须调用 submit_timeblock_summary。
```

## 7. 运行方式草案

### 7.1 响应式执行流程

```text
Runtime start
  -> 初始化 TimeblockSummaryAgentService
  -> 读取 builtin.timeblock_summary.enabled
  -> 注册 agent:timeblock_summary 到 AgentRegistry / 信号网络
  -> 订阅 SignalPool
  -> 收到 timeblock.replication.active_upserted:
       检查 enabled、blockType、幂等状态、当前 agent 状态
       读取上下文
       生成或调用模型生成开始提示
       写 agent_feedback
       标记 start_feedback_at
  -> 收到 timeblock.replication.completed:
       检查 enabled、是否已有总结、当前 agent 是否可运行
       立即读取完成块与事件（不等待 block_feedback）
       调用 broker + 工具循环
       调用 broker + 工具循环
       submit_timeblock_summary 校验通过后写 agent_feedback
       标记 end_summary_at
```

### 7.2 上下文管理

第一版采用“一次总结一轮新上下文”：

- 每个 timeblock summary run 都从空 history 开始。
- 初始 prompt 只放本次处理块的必要事实与工具说明。
- 事件日志、任务列表、相邻时间块通过只读工具按需读取。
- 不依赖外部 Claude/Codex 聊天记录保存长期上下文。
- Runtime 重启后，丢失运行中 LLM 对话可以接受；服务启动时从 timeblock store、eventlog 与幂等状态重新判断是否需要补发。

这样能避免内置 Agent 携带跨时间块旧上下文污染判断，也符合“一个时间块内专注一次总结”的目标。

### 7.3 状态存储

第一版建议把执行状态拆成两层：

1. 幂等状态：轻量持久化，保证重启后不重复写反馈。
2. 可观测状态：可短期缓存，也可写入 agent session store，供 UI 查看最近运行。

建议字段：

```text
builtin.timeblock_summary.enabled
builtin.timeblock_summary.start_feedback_enabled
builtin.timeblock_summary.end_summary_enabled

timeblock_summary.processed.<scope_key>.<timeblock_id>.start_feedback_event_id
timeblock_summary.processed.<scope_key>.<timeblock_id>.end_summary_event_id
timeblock_summary.processed.<scope_key>.<timeblock_id>.start_feedback_at
timeblock_summary.processed.<scope_key>.<timeblock_id>.end_summary_at

timeblock_summary.status
timeblock_summary.current_timeblock_id
timeblock_summary.current_run_started_at
timeblock_summary.last_run_at
timeblock_summary.last_error
timeblock_summary.last_agent_session_id
```

MVP 使用 config store 做轻量持久化（刷新网页/重启不丢失），不引入独立 SQLite 表。运行轨迹复用 `AgentSessionStore`。

### 7.4 重启与补发

重启恢复策略：

- Runtime 启动时检查当前非 gap active block 是否已有开始提示；没有则按配置补发开始提示。
- 检查最近 completed blocks 是否已有结束总结；没有则补发结束总结。
- 如果上次在模型调用中被关闭，不恢复旧 LLM history；重新从时间块与事件日志读取上下文。
- 补发顺序遵循 `exomind-monitor` 原则：先清理 completed 总结，再处理当前 active 开始提示。

## 8. 配置与设置页

### 8.1 必要配置

| 配置 | 默认 | scope | 说明 |
|------|------|-------|------|
| `builtin.timeblock_summary.enabled` | `false` | device | 是否在本设备启用内置时间块总结 |
| `builtin.timeblock_summary.start_feedback_enabled` | `true` | device | 是否生成时间块开始提示 |
| `builtin.timeblock_summary.end_summary_enabled` | `true` | device | 是否生成时间块结束总结 |

### 8.2 设置页落点

设置项应合并在同一组里，方便用户定位：

- 内置 Agent / 时间块总结开关。
- 当前使用的模型 provider/model/base URL 状态。
- API key 是否已配置，不能显示明文。
- 最近一次运行状态、最近错误。
- 跳转到信号网络中 `时间块总结` 节点。

## 9. 安全边界

第一版不提供以下工具，因此这些行为不可能由 LLM 执行：

- 创建、开始、停止、暂停、恢复、结束时间块。
- 直接创建任务或迁移任务状态。
- 清空事件日志。
- 对用户承诺、任务状态做不可追踪修改。
- 跨设备同步 API token。

未来如果需要中风险动作，只能通过 `create_proposal` 工具创建提案，再由用户或 action gate 执行；不能让总结 Agent 直接修改业务状态。

## 10. 可观测性与日志

必须能回答“总结 Agent 是否卡住”：

- 后台日志记录：未启用、未配置模型、收到信号、跳过原因、开始收集上下文、开始模型调用、工具调用、写入成功、写入失败、模型失败、重试耗尽。
- 信号网络节点状态展示：idle / running / failed 与最近错误。
- 节点详情展示：当前 timeblock、生成阶段、工具调用列表、LLM 中间文本摘要、最终 event id。
- Agent session store 记录：provider、model、prompt、assistant turn、tool calls、status、error。

日志不应包含 API key。模型输入输出中如有敏感内容，按现有 eventlog/agent session 的隐私边界处理。

## 11. 验收标准

### 11.1 功能验收

- 启用本设备内置 `timeblock_summary` 后，新 active 块产生一条开始提示型 `agent_feedback`。
- completed 块产生一条结束总结型 `agent_feedback`。
- 结束总结包含事件关联与叙事洞察，而不是复制 `block_feedback` 的精确统计。
- LLM 通过 `submit_timeblock_summary` 工具提交结构化结果，Runtime 生成最终 Markdown 与事件。
- 同一时间块不会重复生成多条开始提示或结束总结。
- Runtime 重启后能检查漏发块并补发，不恢复旧 LLM history。
- 结束总结与用户反馈同步触发，不等待 `block_feedback`。
- 旧 TS Agent CLI 链路不受影响。

### 11.2 信号网络验收

- 信号网络出现 `时间块总结` / `timeblock_summary` agent 节点。
- 时间块相关 topic 能连接到该 agent 节点。
- 点击节点能看到最近状态、当前处理块、工具调用、最终 event id 与错误信息。
- 点击节点能查看历史聊天记录：每次总结的输入上下文、LLM 工具调用轨迹与最终输出。
- Agent 卡住或失败时，用户能从节点状态或设置页看见。

### 11.3 安全验收

- `timeblock_summary` 工具白名单不包含 timeblock start/stop/end、任务完成、eventlog 删除。
- `submit_timeblock_summary` 入参校验失败时不会写入 eventlog。
- API token 默认不跨设备同步。
- 未配置 LLM、模型不可达、工具失败时不会崩溃，且日志清楚。

### 11.4 跨平台验收

- 不依赖 Bun、Node、Claude CLI、Codex CLI。
- 模型调用只依赖 Runtime 的 HTTP/SSE 能力。
- 桌面与移动端 Runtime 具备相同设计路径；若移动端暂不启用，需要明确配置与日志。

## 12. 实施阶段

### Phase 0：设计冻结与最小补查 ✅（2026-06-03 完成）

- ✅ 确认 `timeblock.replication.*` 信号 payload 足够驱动上下文收集
- ✅ 确认 AgentRegistry 注册 `timeblock_summary` 后 UI 节点自动显示
- ✅ 确认默认 LLM profile 解析路径（`resolve_provider_profile_from_runtime`）
- ✅ 固化 `submit_timeblock_summary` schema（TypeScript notation）

### Phase 1：信号驱动服务 MVP ✅（2026-06-03 完成）

- ✅ 实现 `TimeblockSummaryAgentService`（`agent/timeblock_summary/mod.rs`）
- ✅ 实现上下文自动收集（`context.rs`）— eventlog 查询、相邻块、幂等状态
- ✅ 实现出口工具 `submit_timeblock_summary`（`tools.rs`）
- ✅ 实现 prompt 模板（`templates.rs`）
- ✅ 订阅 `SignalPool`，响应 `active_upserted` / `completed`
- ✅ 修复 config 热更新 bug（AtomicBool 先读 config 再检查）
- ✅ 修复 ActiveBlockData → TimeBlockData 转换
- ✅ 修复 blockId prompt 标注（LLM round=0 即成功）
- ✅ 端到端验证通过，推送到 dev 分支

### Phase 2：设置页与用户配置（待实施）

- 复用默认 provider profile 与 `AgentTurnBroker`。
- 新增只读上下文工具与 `submit_timeblock_summary` 工具。
- 实现工具调用续跑与有限重试。
- 记录 `AgentSessionRecord` 与工具调用轨迹。

### Phase 3：设置页与用户配置（待实施）

**目标**：让普通用户无需 API 即可启用和配置时间块总结 Agent。

#### 配置架构问题

当前 Agent 读取旧版 config key（`exomind:agentApiProvider` 等），但设置页 UI 使用 AI Registry 系统。两者未打通，导致用户在设置页看到 AI Registry 但 Agent 读不到配置。

**方案选择**：

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. Agent 改读 AI Registry | 重构 Agent 的 provider 解析，从 AI Registry 读取 | 统一配置源 | 改动大，需重构 broker/provider 解析 |
| B. 设置页写旧 config key | 设置页 UI 直接写 `exomind:agentApi*` config key | Agent 零改动，快速落地 | 两套配置系统并存，用户可能困惑 |
| C. 桥接层 | 设置页写 AI Registry，Agent 通过桥接层读取 | 长期最优 | 实现复杂，Phase 3 不适合 |

**建议**：Phase 3 采用**方案 B**（设置页写旧 config key），后续再考虑方案 A 或 C 的统一。

#### 设置页 UI 设计

新增「内置 Agent」设置组，包含：

```
┌─────────────────────────────────────────┐
│  内置 Agent                              │
├─────────────────────────────────────────┤
│  ⏱ 时间块总结                            │
│  ┌─────────────────────────────────────┐│
│  │ 启用时间块总结    [开关]              ││
│  │                                     ││
│  │ 模型配置                            ││
│  │ Provider    [下拉: openai/anthropic] ││
│  │ Model       [输入: gpt-4o]          ││
│  │ Base URL    [输入: https://...]     ││
│  │ API Key     [输入: sk-...]  [👁]    ││
│  │                                     ││
│  │ 开始提示    [开关]  默认开启         ││
│  │ 结束总结    [开关]  默认开启         ││
│  │                                     ││
│  │ 最近运行状态: idle                   ││
│  │ 上次运行: 2026-06-03 20:23          ││
│  │ 上次错误: 无                         ││
│  │                                     ││
│  │ [查看信号网络节点 →]                 ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

#### 首次启用体验

用户首次打开设置页时：
1. 看到「时间块总结」开关（默认关闭）
2. 开启后，检查是否已配置 LLM provider
3. 未配置 → 显示红色提示「请先配置模型 API」，高亮模型配置区域
4. 已配置 → 显示绿色「已就绪」，Agent 开始监听信号
5. 配置变更实时生效（Agent 的 config 热更新机制已实现）

#### 错误处理

| 错误场景 | 用户看到 | Agent 行为 |
|----------|----------|------------|
| 未配置 API Key | 设置页红色提示 | 记录 `missing_provider` 到 eventlog，不崩溃 |
| API Key 无效 | 设置页显示最近错误 | 记录 `provider_error`，不崩溃 |
| 模型超时 | 设置页显示超时 | 重试后记录 `timeout`，不崩溃 |
| LLM 不调用工具 | 设置页显示 `max_rounds_exceeded` | 写入 `agent_error` 事件 |

#### 实施任务

- [ ] 在设置页组件中新增「内置 Agent」配置组
- [ ] 实现 enabled 开关（写 `builtin.timeblock_summary.enabled` config key）
- [ ] 实现模型配置表单（写 `exomind:agentApi*` config keys）
- [ ] 实现状态展示（读取 `timeblock_summary.status` config）
- [ ] 实现错误展示（读取 `timeblock_summary.last_error` config）
- [ ] 添加「查看信号网络节点」跳转链接
- [ ] 端到端测试：开启 → 配置 → 结束时间块 → 验证 agent_feedback 写入

### Phase 4：可观测性与 AI Registry 统一（后续）

- 信号网络节点详情展示状态、工具调用、最近输出与错误。
- Agent session store 回看历史运行记录。
- 考虑将 Agent 的 provider 解析统一到 AI Registry（方案 A）。
- 增加端到端测试与失败路径测试。

## 13. 已对齐决策记录

以下问题已在审阅中收束，决策已反映至对应章节：

| # | 问题 | 决策 | 落入章节 |
|---|------|------|----------|
| 1 | 开始提示和结束总结模板化还是模型？ | 均模板驱动，开放字段由 Agent 填写，二者不矛盾 | 4.4, 2.2, 2.3 |
| 2 | 幂等状态存储方案 | 后端轻量级持久化（config store），不入 SQLite 表，刷新不丢失 | 4.6, 7.3 |
| 3 | `/agents/:id/chat` 入口？ | 不做自由聊天入口，但必须可见状态 + 历史聊天记录 | 4.7, 11.2 |
| 4 | 人与 Agent 反馈时序？ | 同步触发，无先后依赖；内置 Agent 不等待 `block_feedback` 或人的反馈 | 4.8, 5.1, 6.1, 6.3, 7.1 |
| 5 | 计划通过后？ | 全文刊载到 #555 issue 正文，说明是原型 1.0 计划 | 14 |
| 6 | 配置架构（Phase 3） | 前端桥接：AI Registry 保存时自动同步 4 个 flat key 到 Runtime config store，零 Rust 改动 | 12 Phase 3 |
| 7 | Provider 推断方式 | 不从 URL 推断，直接读 AI Registry 渠道的 channel.vendor 字段 | 12 Phase 3 |

## 14. 当前结论

本计划将 #555 收束为：

> 在 ExoMind Runtime 内实现一个设备本地、信号驱动、工具受控的内置 `timeblock_summary` Agent Harness。它复用现有 `SignalPool`、信号网络、LLM broker/provider profile 与工具调用基础，在时间块开始/结束时生成 `agent_feedback`；旧外部 TS Agent CLI 保留且不迁移，Claude Code/Codex PTY 自动路由不进入第一阶段。

### 进展状态

| 阶段 | 状态 | 日期 |
|------|------|------|
| Phase 0：设计冻结 | ✅ 完成 | 2026-06-03 |
| Phase 1：信号驱动服务 MVP | ✅ 完成 | 2026-06-03 |
| Phase 2：接入 broker 与工具循环 | ✅ 合并到 Phase 1 | 2026-06-03 |
| Phase 3：AI Registry 桥接 + 设置页开关 | ✅ 完成 | 2026-06-04 |
| Phase 4：可观测性与 AI Registry 统一 | 后续 | — |

Phase 1 MVP 已推送到 dev 分支（commit `0afdcb5c`），端到端验证通过。Phase 3 桥接层（commit `578ba28c`）打通 AI Registry → Runtime flat keys，设置页新增「启用时间块自动总结」开关，mimo-v2.5 端到端验证通过。
