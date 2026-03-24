# Issue #385 Agent Runtime Orchestration Design

## 背景（Background，背景）

当前 Agent Hub 已有基础的 Runtime Agent 生命周期（lifecycle，生命周期）链路，但创建逻辑仍然建立在“持久化 Runtime host 列表”之上，无法正确表达以下真实需求：

- 桌面端 `embedded runtime（内嵌运行时）` 默认自启，但它没有稳定参与 Agent 创建候选
- 手机端 `embedded runtime` 无法假设支持 `Claude CLI / Codex CLI`
- `API Agent` 仍然运行在某个 Runtime 中，只是 provider（提供方）从 CLI 变成 API
- 用户需要在创建时区分 `Agent kind（Agent 类型）`、`Provider profile（提供方档案）` 与 `Runtime target（运行目标）`

本设计把“创建 Agent”从“找一个 host 发请求”升级为“在兼容的 Runtime target 上创建一个绑定了 provider/runtime 的 Agent 实体”。

## 目标（Goals，目标）

1. Agent Hub 可创建并停止以下三类 Runtime Agent：
   - `Claude CLI`
   - `Codex CLI`
   - `API Agent`
2. Agent Hub 节点可流式展示 Claude CLI、Codex、API Agent 的统一事件流
3. Runtime target 支持以下行为：
   - 单目标自动直达
   - 多目标强制显式选择
   - `embedded runtime` 未运行时自动拉起
4. `API Provider` 支持：
   - `OpenAI`
   - `Anthropic`
   - 历史 profile 复用
5. `#385` 明确作为 `#363 / v0.3.6` 的任务之一

## 非目标（Non-goals，非目标）

- 本轮不做 API Key 加密或密钥托管
- 本轮不做远程 Runtime 自动发现协议重构
- 本轮不做复杂权限/多用户安全模型
- 本轮不把所有旧 agent 类型统一迁移到新模型

## 核心设计（Core Design，核心设计）

### 1. 创建流（Creation Flow，创建流程）

创建 Agent 采用“内部三段式、外部按条件折叠”的设计：

1. 选择 `Agent kind`
2. 若 `kind === api`，选择或新建 `Provider profile`
3. 仅在存在多个兼容 Runtime target 时，显式选择 `Runtime target`

折叠规则如下：

- 若只有一个兼容 target，则直接选中，不额外展示 target 步骤
- 若该唯一 target 是 `embedded runtime` 且未运行，则先自动 `ensure/start runtime` 再创建 Agent
- 桌面端默认自启 `embedded runtime`，因此大多数情况下用户只会感知到：
  - 选择 `Claude CLI / Codex CLI / API Agent`
  - 若为 `API Agent` 再选择 `Provider profile`
  - 然后直接创建

### 2. 数据模型（Data Model，数据模型）

#### Agent kind

```ts
type RuntimeAgentKind = 'claude_cli' | 'codex_cli' | 'api'
```

#### Provider profile

`Provider profile` 固定绑定 `provider + model`，第一版字段最小集如下：

```ts
type ApiProviderId = 'openai' | 'anthropic'

interface ProviderProfileMeta {
  profileId: string
  name: string
  provider: ApiProviderId
  model: string
  baseUrl?: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

interface ProviderProfileSecret {
  profileId: string
  apiKey: string
  updatedAt: string
}
```

存储策略沿用仓库现有 `meta + secret（元数据 + 密钥）` 分离模式：

- index：profile id 列表
- meta：可见信息
- secret：`apiKey`

MVP 阶段允许本地保存明文 key，并在创建请求时把 `profile snapshot（档案快照）` 下发到选中的 runtime。

#### Runtime target candidate

Runtime target 不再只是 `host:port`，而是“可创建 Agent 的候选目标”：

```ts
interface RuntimeTargetCandidate {
  targetId: string
  source: 'embedded' | 'saved_host'
  displayName: string
  dialHost: string
  dialPort: number
  bindHost?: string
  bindPort?: number
  availability: 'ready' | 'startable' | 'offline' | 'error'
  capabilities: {
    agentKinds: RuntimeAgentKind[]
    apiProviders: ApiProviderId[]
  }
}
```

规则：

- `embedded runtime` 总是生成一个 `synthetic candidate（合成候选）`
- 桌面端 `embedded runtime`：
  - 运行中 => `ready`
  - 未运行但可拉起 => `startable`
- 手机端 `embedded runtime` 不应假设支持 CLI，是否支持由 capability 决定
- `saved_host` 仅在在线时进入创建流；离线 host 继续留在设备页管理

#### Agent runtime binding

创建成功后，前端需要把 Agent 与其 Runtime target 绑定关系保存为快照，避免后续聊天/停止仍靠“当前活动 host”猜测：

```ts
interface AgentRuntimeBinding {
  source: 'embedded' | 'saved_host'
  targetId: string
  hostId?: string
  dialHost: string
  dialPort: number
  label: string
}
```

### 3. Runtime capability（运行时能力）声明

`/topology` 需要扩展为包含 capability，前端只消费 runtime 自报信息，不按平台硬编码推断：

```ts
interface RuntimeTopologyResponse {
  host_id?: string
  hostname: string
  os: string
  arch: string
  uptime_secs: number
  version: string
  port: number
  total_memory_mb?: number
  used_memory_mb?: number
  capabilities: {
    agentKinds: RuntimeAgentKind[]
    apiProviders: ApiProviderId[]
  }
}
```

第一版 capability 判定建议：

- `claude_cli`：runtime 自检 `claude` 命令是否可用
- `codex_cli`：runtime 自检 `codex` 命令是否可用
- `api`：默认支持
- `apiProviders`：默认 `openai + anthropic`

这直接支持你的目标场景：

- 手机 embedded runtime 只出现在 `API Agent` 候选中
- Termux runtime 才会出现在 `Claude CLI / Codex CLI` 候选中

### 4. Create agent contract（创建 Agent 契约）

前后端统一使用一份创建请求：

```ts
type RuntimeCreateAgentRequest =
  | {
      kind: 'claude_cli'
      id?: string
      name?: string
      description?: string
    }
  | {
      kind: 'codex_cli'
      id?: string
      name?: string
      description?: string
    }
  | {
      kind: 'api'
      id?: string
      name?: string
      description?: string
      profile: {
        profileId: string
        name: string
        provider: 'openai' | 'anthropic'
        model: string
        baseUrl?: string
        apiKey: string
      }
    }
```

注意：

- `API Agent` 下发的是 `profile snapshot`，不是单独 `profileId`
- Runtime 内部如何保存/重用该 profile 不要求前端感知

### 5. Stream event contract（流式事件契约）

Runtime 聊天流统一升级为 typed event（带类型事件）：

```ts
type RuntimeAgentEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'output.delta'; content: string }
  | { type: 'thinking.delta'; content: string }
  | { type: 'tool.call'; callId: string; toolName: string; argsText?: string }
  | { type: 'tool.result'; callId: string; toolName: string; status: 'ok' | 'error'; content?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'error'; code?: string; message: string }
  | { type: 'done'; finishReason?: string }
```

前端渲染规则：

- 聊天正文只消费 `output.delta`
- `thinking.delta` 进入可折叠思考轨
- `tool.call / tool.result` 进入节点详情时间线
- `error` 独立显示，不混进正文
- `done` 驱动当前轮结束状态

兼容策略：

- 新前端优先解析 typed event
- 若后端仍返回旧 `{ content, session_id }`
  - 客户端自动降级映射为 `session.started + output.delta`

### 6. 错误模型（Error Model，错误模型）

Runtime 创建错误至少区分以下 code：

```ts
type RuntimeCreateAgentErrorCode =
  | 'runtime_unreachable'
  | 'agent_kind_unsupported'
  | 'provider_unsupported'
  | 'cli_not_installed'
  | 'provider_profile_invalid'
  | 'agent_conflict'
```

前端据此给出更精确文案，例如：

- 当前 Runtime 不支持 `Claude CLI`
- 所选 Runtime 未安装 `codex`
- Provider profile 缺少 `apiKey`

### 7. 测试与验收（Testing & Acceptance，测试与验收）

至少覆盖以下链路：

- TypeScript 单测：
  - Provider profile 存储
  - Runtime capability 解析
  - Runtime target candidate 过滤
  - 创建流状态机
  - typed event 客户端解析
- Rust 单测 / 集成测试：
  - `/topology` capability 输出
  - `claude_cli / codex_cli / api` 创建分支
  - typed event SSE 输出
- Playwright：
  - 单目标自动直达
  - 多目标显式选择
  - 手机/不支持 CLI 的 runtime 不出现在 CLI 候选中
  - 创建 Claude / Codex / API Agent 并看到流式输出

## 版本与 Issue 关联（Release / Issues，版本与 Issue）

- 主功能 issue：`#385`
- 发布挂靠：`#363 (v0.3.6)`
- 本设计要求在 `#385` issue 评论中同步：
  - 设计文档路径
  - 实现计划路径
  - 核心决策摘要
