# #823 API Agent 工具来源收口与新分层设计

> 日期：2026-04-04
> 关联 Issue：#823、#830
> 当前分支基线：`dev@c8ffd54c`
> 状态：已收口，实施中

## 1. 背景

当前 `dev` 上，API Agent 已经具备以下基础：

- `AgentTurnBroker` 已可作为统一 turn 模型向上游 LLM 发起请求
- HTTP `/agent-sessions` 已可把调用方显式传入的 `tools` 转发给 broker
- 内部 Rust 调用方 `life.rs` 已迁移到 broker 模型
- 提案工具链已能在测试中通过外部 API Agent 创建真实 `ProposalStore` 草案

此前仍存在的关键歧义是：

- 新路径：`broker + 显式 tools + 调用方处理 toolCalls`
- 旧路径：`ToolRegistry + RT 内执行工具 + run_agent_session`

这会让 API Agent 的工具来源语义不稳定：

- 有时由调用方完全控制工具
- 有时由 RT 内部固定注入并自动执行工具
- “无工具调用”并不一定是真无工具

本设计的目标，是把 API Agent 的工具来源统一收口到同一套语义，并明确哪些能力属于可选装配层，哪些行为绝不能再成为默认内建能力。

## 2. 设计目标

本批改造目标固定为：

1. API Agent 默认无工具。
2. “无工具调用”严格等价于请求中没有任何工具定义。
3. 工具只能来自调用方显式提供的 `tools` 或显式选择的 `presets`。
4. HTTP 外部调用与内部 Rust 调用统一走 broker 模型。
5. Rust 侧允许提供预设工具组作为复用装配层，但它们只能在调用方显式选择时出现。
6. `proposal_tools` 可以保留为一个预设工具组，但绝不能在每次 API Agent 调用中默认出现。
7. 旧 `ToolRegistry/run_agent_session` 主路径本批正式退出 API Agent 主线。

## 3. 非目标

本批暂不处理：

1. broker 内部自动循环执行多轮工具调用
2. 所有历史工具模块的一次性彻底删除
3. 真实 OS / network / eventlog 工具的完整产品化边界设计
4. proposal / eventlog / life agent 提示词重写

## 4. 硬约束

### 4.1 Agent 默认无工具

API Agent 的所有正式调用入口，在未显式指定工具时，都必须向上游 LLM 发送无工具请求。

这包括：

- 外部 HTTP `/agent-sessions`
- 内部 Rust 调用 helper
- 后续任何新的 API Agent 封装层

因此：

- 不允许因为 runtime 中存在 registry，就自动暴露其中工具
- 不允许因为某内部场景“通常需要某工具”，就将其作为默认值

### 4.2 工具来源只能显式

Agent 可见工具只能来自以下两类显式来源：

1. 调用方直接提供的 `tools`
2. 调用方明确请求展开的 `presets`

除此之外，不允许第三种隐式来源。

尤其禁止：

- 默认工具注册表自动注入
- 按调用入口偷偷补工具
- 依据 system prompt 或 trigger 类型隐式挂工具

### 4.3 `presets` 只是装配层

`presets` 的定位是：

> Rust 侧为了复用一组稳定工具定义与可选执行 helper，而提供的显式装配能力。

每个 preset 在 Rust 内部通常对应一组工具定义，因此它也可以理解为“Rust 内部预设工具（组）”。

它不是：

- Agent 的内建能力
- provider 配置的一部分
- session 默认行为

### 4.4 HTTP 只做中转

HTTP 端口仍遵守“只中转参数，不执行功能”的原则。

因此：

- HTTP 可以接受 `presets`
- 但 `presets` 的解析、校验、展开、与 `tools` 的合并/冲突判断，都必须下沉到 Rust 功能函数层
- 路由层只负责解析 JSON、调用 Rust 函数、映射状态码、整理响应

### 4.5 HTTP 与 Rust 统一 broker 语义

HTTP 与 Rust 侧不能继续维持两套工具语义：

- HTTP 走 broker 返回 `toolCalls`
- Rust 走 registry 自动执行工具

第一批就统一到：

- 都走 broker
- 都以 `ToolDef` 作为 Agent 可见工具定义
- 都由调用方处理 `toolCalls`
- 都由调用方决定是否续跑

## 5. 目标分层

### 5.1 Broker 层

`AgentTurnBroker` 是唯一的 turn 编排内核。

它只负责：

- 验证 turn 输入
- 构造 provider 请求
- 调用上游模型
- 解析最终回答或 `toolCalls`

它不负责：

- `presets` 解析
- 作用域解析
- 工具执行
- 自动续跑

broker 的输入仍固定为最终展开后的工具列表：

```rust
pub struct AgentTurnRequest {
    pub provider: ApiProviderProfile,
    pub system_prompt: Option<String>,
    pub tools: Vec<ToolDef>,
    pub history: Vec<TurnItem>,
    pub new_user_message: Option<String>,
}
```

### 5.2 Final-tools runner 层

在 broker 之上保留一个底层统一函数，只接受最终展开后的 `Vec<ToolDef>`。

这层是所有正式 API Agent 调用路径的共同收敛点。

它负责：

- 调用 broker
- 生成 / 持久化 `AgentSessionRecord`
- 统一错误映射

它不负责：

- 解析 `presets`
- 处理 preset 与作用域规则

### 5.3 Source-aware runner 层

在 `final-tools runner` 之上新增一层显式工具来源解析函数。

这一层接受：

- `tools`
- `presets`
- `scopeKey`

并负责：

- 校验未知 `preset`
- 校验重复 `preset`
- 校验重复 `tool.name`
- 校验依赖本地数据的 preset 是否具备 `scopeKey`
- 将 `presets` 展开为最终 `Vec<ToolDef>`
- 将展开后的 preset 工具与显式 `tools` 合并
- 再调用 `final-tools runner`

这层是：

- HTTP `/agent-sessions` 路由的 Rust 承接函数
- 内部 Rust 调用方在需要 `presets` / `scopeKey` 时的默认高层入口

### 5.4 Session / HTTP wrapper 层

`/agent-sessions` 路由层只做：

- JSON 解析
- 调用 Rust `source-aware runner`
- 状态码映射
- 响应序列化

它不负责：

- preset 解析与合并
- 工具执行
- 自动继续下一轮

## 6. HTTP 与 Rust 的接口约束

### 6.1 HTTP 请求模型

`/agent-sessions` 对外支持以下字段：

- `tools?: ToolDef[]`
- `presets?: string[]`
- `scopeKey?: string`

同时保留既有：

- `providerProfile`
- `systemPrompt`
- `history`
- `newUserMessage`

### 6.2 HTTP 请求语义

固定规则如下：

1. 省略 `tools` 等价于空数组
2. 省略 `presets` 等价于空数组
3. `tools` 与 `presets` 允许同时非空
4. `presets` 在 HTTP 上保持 `string[]`
5. HTTP 路由不回显 `resolvedTools`
6. 若调用方仍传历史字段 `toolGroups`，仅作为兼容别名映射到 `presets`

### 6.3 Rust 高层工具来源模型

内部 Rust 高层 helper 的正式语义是：

- `tools=[] + presets=[]` => 无工具
- `tools` only => 显式自定义工具
- `presets` only => Rust 内部预设工具
- `tools + presets` => 允许，Rust 侧展开并合并

内部调用方如果已经有最终 `Vec<ToolDef>`，则直接调用底层 `final-tools runner`。

内部调用方如果需要 `presets` / `scopeKey`，则调用 `source-aware runner`。

合并规则固定为：

- duplicate preset key => 报错
- merge 后 duplicate tool name => 报错
- 不做静默覆盖
- 不引入“显式 tools 覆盖 preset tools”的特殊优先级

## 7. 预设工具组约束

### 7.1 首批正式支持的 presets

本批首批正式纳入 `presets` 体系的只有两组：

- `proposal_tools`
- `recent_events`

命名规则：

- HTTP 与 Rust 使用相同的稳定字符串 key
- key 由 Rust 常量统一管理

### 7.2 preset bundle 形态

每个 preset 在 Rust 侧应暴露为：

- 一组 `ToolDef`
- 一组可选本地执行 helper

这样可保证：

- broker 只消费工具定义
- Rust 本地场景在需要时可复用执行逻辑
- 若没有本地执行 helper，也不会阻塞该 preset 作为纯 broker 工具定义被使用

### 7.3 `proposal_tools`

`proposal_tools` 的定位固定为：

- proposal 相关工具定义与执行 helper 的复用装配组

它只能在以下情况下出现：

- 调用方显式请求 `proposal_tools`

它不得成为：

- API Agent 默认工具
- 所有 session 自动注入的工具

### 7.4 `recent_events`

`recent_events` preset 负责暴露 `get_recent_events`。

其合同固定为：

- 工具入参支持可选 `limit`
- 默认 `limit = 10`

### 7.5 作用域规则

对依赖本地数据的 preset：

- 缺少必需 `scopeKey` 时直接报错
- 若本次不会使用本地作用域工具组，但调用方额外传了 `scopeKey`，则忽略

不引入默认 profile / 默认 scope 回退。

## 8. 旧路径迁移策略

本批正式移除 API Agent 主线中的旧路径：

- `ToolRegistry`
- `build_tool_registry*`
- `run_agent_session*`

至少要求：

- HTTP 路由不再依赖它们
- 内部 Rust 正式入口不再依赖它们
- 测试不再把它们当作 API Agent 主路径

若 `agent/tools` 模块仍有其他非 API Agent 用途，可以暂时保留，但它不再承担 API Agent 工具注入的主语义。

## 9. 需要改动的模块

### 9.1 `crates/exomind-runtime/src/agent/session.rs`

这是本批最核心的收口点。

需要将其收口为：

- provider profile 解析
- session store / runtime
- `final-tools runner`
- `source-aware runner`

并移除旧 registry 自动执行路径。

### 9.2 `crates/exomind-runtime/src/routes/agent_sessions.rs`

需要把 HTTP 请求契约更新为支持：

- `tools`
- `presets`
- `scopeKey`

同时严格保持 route 只做 transport adapter。

### 9.3 `crates/exomind-runtime/src/agent/life.rs`

需要将内部调用方统一接到新分层：

- 需要 preset 时走 `source-aware runner`
- 已有最终工具列表时走 `final-tools runner`

不再保留独立于 HTTP 语义之外的旧工具注入逻辑。

### 9.4 `crates/exomind-runtime/src/agent/proposal_tools.rs`

继续保留并复用。

但其角色明确为：

- `proposal_tools` preset 的定义与执行 helper 来源

### 9.5 `crates/exomind-runtime/src/agent/tools/mod.rs`

该模块不再承担 API Agent 主接口语义。

## 10. 测试与验收

本批测试要覆盖四类问题：

### 10.1 工具来源校验

- 无 `tools` / 无 `presets` 时是真无工具
- `tools + presets` 可同时存在
- 未知 `preset` 报错
- 重复 `preset` 报错
- 重复 `tool.name` 报错
- 缺少必需 `scopeKey` 报错

### 10.2 preset 展开

- `proposal_tools` 正确展开为 proposal 相关 `ToolDef`
- `recent_events` 正确展开为 `get_recent_events`
- `get_recent_events(limit)` 的默认值为 10

### 10.3 主路径统一

- HTTP `/agent-sessions` 经由 `source-aware runner` 进入主线
- 内部 Rust 调用方最终也落到底层 `final-tools runner`
- 旧 `ToolRegistry/run_agent_session` 不再被正式入口引用

### 10.4 真实上游回归

继续保留真实上游测试原则：

- 本地有 provider env 时执行
- 无 token 时自动 skip
- 至少覆盖一条 `proposal_tools` 故事
- 至少覆盖一条 `recent_events` 或内部 Rust 调用故事

## 11. 当前结论

这轮改造不是给 API Agent 增加更多默认能力，而是在收紧边界：

- Agent 默认无工具
- 工具永远显式接入
- HTTP 只做中转
- preset 解析与合并下沉到 Rust 函数层
- Rust 内外调用统一落到底层 broker 主线

在这套约束下，后续 proposal、eventlog、文件搜索、提案系统等能力的接入方式都能保持一致。
