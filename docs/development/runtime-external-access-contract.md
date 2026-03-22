# ExoMind RT 外部接入契约草案

> 状态：Draft
>
> 目的：
> - 收敛外心 RT 的对外功能定位
> - 统一 UI / curl / CLI / MCP / Agent 的接入语义
> - 为后续 `/act`、bootstrap、token、profile discovery 与请求箱追踪提供共同术语
>
> 相关 issue：
> - [#569](https://github.com/exomind-team/exomind/issues/569)
> - [#666](https://github.com/exomind-team/exomind/issues/666)
> - [#667](https://github.com/exomind-team/exomind/issues/667)
> - [#676](https://github.com/exomind-team/exomind/issues/676)
> - [#677](https://github.com/exomind-team/exomind/issues/677)

## 1. 目标

ExoMind RT 的长期定位不是“只服务 UI 的后端”。

它更像是：

- 业务真相源
- 对外统一能力面
- 多种客户端共享的应用契约

因此：

- UI 是客户端
- curl 是客户端
- CLI 是客户端
- MCP 是客户端
- 外部 Agent 也是客户端

这些客户端不应继续各自发明一套路由、身份、作用域与联动语义。

## 2. 当前现状与目标分层

### 当前现状

当前外部接入主要依赖 raw 资源路由，例如：

- `/eventlog`
- `/tasks`
- `/timeblocks`
- `/signals/history`

这层 raw API 已经足够让人类或 Agent 用 `curl` 做排障、读写和旁路验证。

### 目标分层

长期应明确分成两层：

#### A. feature / capability API

这是对外默认入口。

建议统一挂在新的根路径下：

```text
/act/*
```

特点：

- 表达完整动作语义
- 由 RT 自己保证联动副作用
- 外部客户端不需要自己拼底层状态机

#### B. raw resource API

这是兼容/内部/调试层。

特点：

- 保留现有资源路由
- 继续给 UI 迁移期和运维排障使用
- 不再作为未来外部客户端的首选入口

默认方向：

- 外部客户端优先走 `/act/*`
- raw API 继续保留，但部分 token 不应拥有其访问权

## 3. 核心术语

### identity

谁在发起操作。

例如：

- 人类 UI 客户端
- Codex curl
- Claude Code
- Termux Agent

### profile scope

操作落到哪个档案/数据空间。

当前实践里常通过 `user_id` 透传，但长期不应让客户端自己猜这一层。

### grant

某个外部客户端是否被允许访问某个档案。

默认粒度：

- `外部客户端 × 档案`

### session

一次具体接入会话。

外部客户端的稳定身份和某次会话不应混为一谈。

### permission scopes

当前 token 或会话被允许使用哪些 RT 能力。

## 4. token 与授权模型

推荐采用双 token 模型：

### identity token

长寿命、可记忆。

用途：

- 标识稳定的外部客户端身份
- 由人类在 UI 侧统一管理、撤销、查看
- 后续用于登记外部 Agent 的来源、名称、模型、声明能力

### session token

会话级、可过期。

用途：

- 绑定一次具体连接
- 显式绑定当前选定的档案
- 为后续“会话过期”“自动续期”“重新确认”留下空间

### 默认约束

- 外部客户端可以被批准访问多个档案
- 但执行任何 feature 前，必须显式选定目标档案或建立 scoped session
- 不采用“一个 token 无限制跨多个档案直接执行”的默认模式

## 5. bootstrap 与 discovery

RT 应提供机器可读 discovery，而不是让客户端背路由。

建议先从一个轻量 bootstrap 入口开始，例如：

```text
GET /act/bootstrap
```

它至少应能回答：

- 当前 RT 版本
- 当前 auth 模式
- 哪些入口是公开的
- 哪些入口需要授权
- 当前支持哪些 `/act/*` 能力
- 哪个入口可以继续做 profile discovery
- 哪个入口可以建立会话

### profile discovery

profile discovery 默认只暴露安全元信息，不暴露完整会话态。

建议返回字段至少包括：

- `displayName`
- `slug`
- `profileId`
- `scopeKey`
- `state`

注意：

- `displayName`
- `slug`
- `profileId`
- `scopeKey`

不是同一个东西。

当前它们在部分实现里可能恰好可相互推出，但这不是长期契约保证。

## 6. 第一批 feature 样板：时间块工作流

第一批 feature 样板建议从时间块开始。

原因：

- 它最能体现“完整动作语义”而不是单点 CRUD
- 它有明显联动副作用
- 它能验证“无 UI 的 RT 也能像有 UI 的 RT 一样跑完整工作流”

建议对外动作形态：

```text
POST /act/timeblocks/start
POST /act/timeblocks/pause
POST /act/timeblocks/resume
POST /act/timeblocks/prepare-end
POST /act/timeblocks/end
```

设计要求：

- RT 自己负责联动事件、状态变更和必要副作用
- 外部客户端不再直接改 active timeblock 原始结构来拼语义
- `prepare-end` 对应当前 UI 内部的“开始填写反馈”语义

## 7. Agent 请求箱（长期模型）

“Agent 请求箱”不只是一个页面，而是一种更高层的人机审批模型。

相关追踪：

- [#677](https://github.com/exomind-team/exomind/issues/677)

第一类请求建议是：

- 外部 Agent 请求登录某个档案

未来可扩展为：

- Agent 推荐任务
- Agent 请求执行高权限动作
- Agent 请求绑定新能力

### 本轮边界

当前只把它作为：

- 契约模型
- issue 追踪对象

不要求本轮直接实现完整 UI。

## 8. 非目标

以下内容不属于本轮直接实现目标：

- 立即迁移现有 UI 全量改走 `/act`
- 立即废弃 raw `/eventlog`、`/tasks`、`/timeblocks`
- 立即完成完整请求箱 UI 与审批流程
- 立即把 Agent 消息工作流升级成第一批样板

## 9. 设计验收标准

当后续进入实现前，至少应能满足这些设计层验收：

- 外部客户端不读源码，也能通过 RT 自描述入口知道下一步怎么接入
- `identity`、`profile scope`、`grant`、`session`、`permission scopes` 五层术语不再混用
- `/act` 与 raw API 的职责边界清晰
- 时间块 feature 样板能覆盖“完整工作流而非裸状态改写”
- profile discovery 的权限边界可解释
- 请求箱与登录审批模型被明确挂到后续 issue，而不是停留在聊天描述
