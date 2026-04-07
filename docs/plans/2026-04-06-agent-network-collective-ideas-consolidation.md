# 2026-04-06 灵感与讨论归档：Agent 网络、集体档案与集体记账

> 更新说明：
>
> - 已定主线计划已拆到：[2026-04-06-multi-archive-and-collective-collaboration-outline.md](./2026-04-06-multi-archive-and-collective-collaboration-outline.md)
> - 已落实主题与稳定决策已拆到：[2026-04-06-multi-archive-and-collective-settled-decisions.md](./2026-04-06-multi-archive-and-collective-settled-decisions.md)
> - “如何找到被邀请者”子题已拆到：[2026-04-06-invitee-discovery-public-identifier-and-known-archives-plan.md](./2026-04-06-invitee-discovery-public-identifier-and-known-archives-plan.md)
> - 近期全局阶段顺序已拆到：[2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md](./2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md)
> - 信号网络 `v1` 与单 Agent 时间块闭环已拆到：[2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](./2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md)
> - 多 Agent 第一阶段边界已拆到：[2026-04-06-multi-agent-task-governance-phase1-plan.md](./2026-04-06-multi-agent-task-governance-phase1-plan.md)
> - Agent 能量双计量第一阶段已拆到：[2026-04-06-agent-energy-and-dual-metering-phase1-plan.md](./2026-04-06-agent-energy-and-dual-metering-phase1-plan.md)
> - 独立集体记账系统第一阶段已拆到：[2026-04-06-independent-collective-bookkeeping-system-plan.md](./2026-04-06-independent-collective-bookkeeping-system-plan.md)
> - 未充分讨论主题的第二轮收口计划已拆到：[2026-04-06-remaining-themes-second-round-settled-plan.md](./2026-04-06-remaining-themes-second-round-settled-plan.md)
> - `blackboard` Phase 1 与当前扩大讨论问题簇已拆到：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](./2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md)
> - `ArchiveSession / UiSession` 第一阶段澄清已拆到：[2026-04-07-archive-session-and-ui-session-clarifications.md](./2026-04-07-archive-session-and-ui-session-clarifications.md)
> - `archive` 术语、默认档案、档案切换器与 OS 层入口补充已拆到：[2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md](./2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md)
> - 主线 epic [#837](https://github.com/exomind-team/exomind/issues/837) 已同步修订，吸收了上述子计划与最新已定决策
> - 本文继续作为原始灵感、未决项和任务池的总索引，不再承担“已定决策主文档”职责

> 目的：把一组零散聊天记录系统整理为可追溯的设计资产，确保灵感、判断和讨论结果不丢失。
>
> 范围：只做归档、归一、映射和任务化，不在本文内直接定稿所有架构答案。

---

## 1. 这份文档要解决什么问题

这批记录包含：

- 一部分是已经反复讨论过、但尚未落到正式 issue 或设计文档里的产品想法
- 一部分是已经在代码或 GitHub 中有近邻实现的方向，但原始表达比较口语化
- 一部分是未来可能分叉成多个 issue 的架构判断，如果不先整理，很容易重复讨论或遗失

因此本文做四件事：

1. 保留原始灵感的语义，不把它们压扁成过早的实现细节
2. 把重复表达收敛成少量统一主题
3. 映射到当前仓库代码和 GitHub 现状
4. 输出后续可继续拆分的任务池

---

## 1.1 当前主题状态快照（2026-04-06）

按当前已落盘文档与已同步的 `#837`，九大主题可暂时分为四档：

### 已收口并已同步主线

- **G. 集体档案 / 组织档案模型**
  - 主线计划已落盘
  - 已定决策快照已拆出
  - “找被邀请者”已拆出独立子计划
  - `ArchiveSession / UiSession` 会话语义补充澄清已拆出
  - 主线 epic `#837` 已完成修订同步

### 已收口并已拆出子计划

- **A. 信号网络语义与节点模型**
- **B. API Agent 记忆、总结与提案闭环**
- **E. 多端同步与验证链**
- **H. 集体记账 / Labor Ledger（独立系统第一阶段）**

这些主题已经形成足够稳定的阶段判断，并已拆出独立 Markdown 子计划。

### 部分收口，适合继续细化

- **C. 多 Agent 协作与服务员体系**
- **D. Agent 能量与资源双计量**
- **F. 对外文档与宣传生成**

### 明确后置

- **I. 复杂跨层组织协作**

### 当前明确按“扩大讨论问题簇”处理

以下主题当前不继续硬收口，而是只记录问题，后续 GitHub 追踪需提及 `@HailayLin`：

- `集体档案的Agent`
- `档案防伪 / 公开标识轮换`
- `审计界面`

### 当前建议的下一轮优先级

上一轮追问的高影响主题已经形成第二轮收口计划，并已回写到相关子计划：

- 见：[2026-04-06-remaining-themes-second-round-settled-plan.md](./2026-04-06-remaining-themes-second-round-settled-plan.md)

后续更适合优先做：

1. 围绕仍未收口的主题继续追问，例如集体 Agent 运行落点、防伪、公开发现等
2. 将相应状态与边界继续同步到 GitHub issue

---

## 2. 原始灵感主题清单

本次归档覆盖以下原始主题：

1. 集体记账系统，先前讨论过，应在 GitHub 检索
2. Agent 生成外心软件文档，用于宣传与对外描述
3. 多端同步功能，需要经过 Tauri manager 验证
4. 描述性概念可由 actor / Agent 区分；方法论概念可由 节点 / actor 区分
5. 资源消耗的计量方式不同：时空（算力 / 存储） + token（能量）
6. MVP：演员模型“固定邮箱”，网络模型“先天连边”
7. 在演员模型之上，说“输出 / 发消息”就可广而告之给别的节点
8. 连边不应表达“节点可达”，而应表达“输出后发给谁”
9. 工作流例子：RSS → 总结 → 汇报
10. 连边语义定义在“会话 / 通道”层次，而非 actor 本体
11. Agent 潜力上可向任何节点发消息，但仍需建立“以后可能发消息”的连接
12. 测试：信号网络的增删改查
13. MVP DoD：API Agent 有记忆，输入外心数据，输出提案、时间块总结等
14. 单 Agent：时间块结束后总结、推荐任务、形成提案
15. 多 Agent：任务治理、面向人的多模态服务员
16. Agent 能量系统：定时唤醒、心跳、电池 / 额度
17. 网络可变：动态生成节点与连边，引入 subAgent / teammate
18. 网络实际接入：事件日志、时间块、任务、提案、目标都在网络中工作
19. Agent 公共记忆 → actor“黑板”节点
20. 组织 as 档案：不可登录、可多端同步的集体档案
21. 技术上避免个人直接读写，强调集体决议
22. 底层是共享档案，包含集体事件日志、时间块、任务、目标、知识
23. 个人或集体档案都可以加入系统
24. 集体套集体，形成层次组织与分布式认知 / 计算
25. 更复杂的跨级组织协作暂不进入第一阶段

---

## 3. 归一后的主题结构

上面的 25 条原始表述，归一后可以收敛成 9 个主题，不重复、不遗漏。

### A. 信号网络语义与节点模型

当前状态：

- **已收口并已拆出子计划**
- 对应子计划：[2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](./2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md)

包含原始点：

- 4
- 6
- 7
- 8
- 9
- 10
- 11
- 12
- 17
- 18

本主题要回答的问题：

- `Agent / actor / node / edge` 各自的正式语义是什么
- 连边在 MVP 中表达的究竟是“可达性”还是“默认下游接收者”
- “会话 / 通道”与“节点 / 连边”的边界如何划分
- 信号网络的 CRUD 测试范围是什么

目前已定：

- `node`、`actor`、`Agent` 都按**方法论概念**表述，而不是程序本体分类
- `v1` 采用**固定节点 + 可配边**
- 第一批对象以**内建领域节点**进入网络；需要强调消息传播时再按 `actor` 视角理解
- `blackboard` 在第一阶段按**特殊共享节点**纳入
- `edge` 对用户表达“输出后默认给谁”，在网络层同时表达“只有建边才允许通信”
- route table 是**档案级持久配置**
- 节点的输出由模板逻辑广播到**已连下游**
- `v1` 中**没有连边就不能发消息**
- 无边发信是**硬失败**，并要求给出建边 / 检查路由提示
- 第一阶段先采用**预注册 topic**
- 通配 `*` 只用于前端观察 / 诊断，不作为通用业务兜底
- 禁用 route 的投递结果记为 `skipped`
- 目标缺失或不可用的投递结果记为 `failed`
- `v1` 中的 CRUD 解释为：**边全 CRUD、节点只读**
- `if` / 条件控制节点**不进入第一阶段**

仍待继续探讨：

- 信号网络 CRUD 验收清单
- 动态建边、临时路由覆盖层与更强编排能力的未来形态

### B. API Agent 记忆、总结与提案闭环

当前状态：

- **已收口并已拆出子计划**
- 对应子计划：[2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](./2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md)

包含原始点：

- 13
- 14
- 19

本主题要回答的问题：

- API Agent 的工作记忆、长期记忆、公共记忆如何分层
- 时间块结束后如何自动形成“总结 + 下一步建议 + 提案”
- `blackboard` 作为协调 / 交接 / 摘要表面应如何工作

目前已定：

- 工作记忆、长期记忆、公共记忆需要**分层**
- 公共记忆不应偷塞进单个 Agent 的私有 memory
- `blackboard` 作为**每档案一个持久对象**进入主线计划
- `blackboard` 的默认定位是：
  - 协调板
  - 交接板
  - 摘要痕迹板
- `blackboard` 不是共享长期记忆总池
- Agent 长期记忆先保持私有，只有蒸馏后的共享内容才写入 `blackboard`
- 单 Agent 第一条关键用户叙事是：`timeblock.completed`
- 这条闭环以**内置预置连边**进入网络
- 默认产出是：**总结 + 建议 + pending proposal**
- `blackboard` 在这条闭环中默认只收**摘要痕迹**
- 第一阶段默认在**个人档案**中启用
- `blackboard` 的独立 Phase 1 合同已补充收口到：
  - [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](./2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md)
- 其 Phase 1 新增稳定判断包括：
  - 时间序条目
  - 追加修正
  - 每黑板总上限
  - 预警后阻写
  - 显式“弹出最早条目”
  - 交互型请求建立正式 route 并信号回送

仍待继续探讨：

- 长期记忆与 blackboard 的边界细则

### C. 多 Agent 协作与服务员体系

当前状态：

- **部分收口**
- 第一阶段边界已拆到：[2026-04-06-multi-agent-task-governance-phase1-plan.md](./2026-04-06-multi-agent-task-governance-phase1-plan.md)

包含原始点：

- 15
- 17

本主题要回答的问题：

- 多 Agent 之间如何分工、转交、协作
- “任务治理”和“面向人的多模态服务员”是不是同一条主线
- subAgent / teammate 的动态生成边界在哪里

当前保留判断：

- 单 Agent 自动闭环与多 Agent 协作应分两个阶段处理
- 多 Agent 更像组织与服务编排问题，不宜混入基础 signal 语义讨论
- 第一阶段**任务治理优先**
- `任务治理` 与 `多模态服务员` **分两个阶段**
- 第一阶段固定为：
  - `coordinator`
  - `proposer`
  - `reviewer`
  - `retrospector`
- `coordinator` 常驻，其余角色按需唤起
- 人类入口先落在任务 / 提案表面，而不是统一服务员聊天入口
- `reviewer` 只评论 / 批准 / 退回，不重写提案
- 退回后的提案由 `proposer` 修订并重新送审
- `retrospector` 独立于 `reviewer`，第一阶段优先做时间块结束后的结构化复盘记录
- 第一阶段**不做动态持久 `teammate`**

### D. Agent 能量与资源双计量

当前状态：

- **部分收口**
- 第一阶段判断已拆到：[2026-04-06-agent-energy-and-dual-metering-phase1-plan.md](./2026-04-06-agent-energy-and-dual-metering-phase1-plan.md)

包含原始点：

- 5
- 16

本主题要回答的问题：

- 生理能量、token、额度、算力、存储如何统一进入同一计量模型
- 心跳 / 定时唤醒 / 电池如何与 token 成本关联

当前保留判断：

- 这里至少存在两套不同资源：
  - 运行资源：时空、算力、存储、心跳频率
  - 模型资源：token、调用额度、成本
- 它们现在不应被混成一个数值，但最终需要统一产品语义
- 第一阶段优先承担**运行调度**
- 第一阶段采用**双账本同界面**
- 告警第一阶段先落在 diagnostics / `Agent workbench`
- 补能 / 唤醒第一阶段先采用**人工手动**模式
- 模型资源账本优先按 **invocation 记主账、turn 做聚合**
- 这条线放在“个人同步基线 → 信号网络 v1 → 单 Agent 闭环”之后接入主线

### E. 多端同步与验证链

当前状态：

- **已收口并已拆出子计划**
- 对应子计划：[2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md](./2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md)

包含原始点：

- 3

本主题要回答的问题：

- 多端同步功能如何验证
- Tauri manager 在验证链中承担什么角色
- 未来是否需要把 agent/network/collective 场景纳入同步验收

目前已定：

- 第一里程碑是**个人同步基线**
- 其范围是：
  - `EventLog`
  - `TimeBlock`
  - `Task`
  - `Settings`
  - `Proposal`
- `Proposal` 在这轮只收口到**草案与状态同步**
- `Tauri manager` 是**桌面真实验收标配**
- 标准起步拓扑是 **Web + Desktop**
- 但个人同步基线必须走完整验收梯子：
  - `Windows / 桌面标准链路`
  - `Windows ↔ Android`
  - `Android ↔ Android`
- 个人同步基线完成后，下一主线是**信号网络 v1**

### F. 对外文档与宣传生成

当前状态：

- **部分收口**
- 近期策略已并入路线顺序文档：[2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md](./2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md)

包含原始点：

- 2

本主题要回答的问题：

- Agent 是否参与生成 README、官网文案、功能介绍、版本发布说明
- 对外叙事应围绕哪些已验证能力展开

目前已定：

- 对外文档 / 宣传描述按**已验证里程碑**跟进
- 不允许宣传文案反向定义尚未验证的内部架构

### G. 集体档案 / 组织档案模型

当前状态：

- **主线已收口，找被邀请者子题已拆出并收口**
- 已拆到：[2026-04-06-multi-archive-and-collective-collaboration-outline.md](./2026-04-06-multi-archive-and-collective-collaboration-outline.md)
- 已定决策快照见：[2026-04-06-multi-archive-and-collective-settled-decisions.md](./2026-04-06-multi-archive-and-collective-settled-decisions.md)
- 会话补充澄清见：[2026-04-07-archive-session-and-ui-session-clarifications.md](./2026-04-07-archive-session-and-ui-session-clarifications.md)
- 子计划见：[2026-04-06-invitee-discovery-public-identifier-and-known-archives-plan.md](./2026-04-06-invitee-discovery-public-identifier-and-known-archives-plan.md)

包含原始点：

- 20
- 21
- 22
- 23
- 24
- 25

本主题要回答的问题：

- “档案”是否作为个人 / 集体的统一基础对象
- 集体档案的读写权限如何定义
- 集体档案与同步、认证、审批之间是什么关系
- 嵌套组织是否进入第一阶段

目前已定：

- 档案是统一基础对象，个人档案与集体档案在身份层**同型**
- 多档案并活与 `ArchiveSession` 是必要基础设施
- `ArchiveSession` 是 `RT` 本地运行会话，第一阶段状态收口为 `running / closed`
- 外部 UI 连接单独建模为 `UiSession / ClientSession`
- “前台 / 后台”改为 UI 侧派生概念，而不是 `RT` 全局状态
- 集体档案有自己的 `ArchiveSession`，但 UI 接入的是**成员座席**
- settings 分层为：个人档案级、集体本体级、成员×集体视角级
- 集体治理不引入固定管理员 / 创建者角色
- 邀请、加入、退出与治理门禁已有最小合同
- `v1` 只给个人档案开放长期主公开标识
- 公开标识、给人看的最小名片、授权用邀请材料明确分层
- 首次找人只支持带外导入公开标识，不要求目标当前在线
- 正式关系只在接受成功后沉淀，并以 `archive_id` 作为稳定主键
- 既有关系是延迟验证的关系记忆，不做后台主动探测

仍待继续探讨：

- 防伪、签名与公开标识轮换
- 多公开标识 / 多名片体系
- 局域网发现、目录中继等辅助找人机制
- 集体档案公开发现
- 更远期的跨层组织协作

### H. 集体记账 / Labor Ledger

当前状态：

- **已收口为独立系统第一阶段**
- 对应子计划：[2026-04-06-independent-collective-bookkeeping-system-plan.md](./2026-04-06-independent-collective-bookkeeping-system-plan.md)

包含原始点：

- 1

本主题要回答的问题：

- 第一阶段独立系统先承接哪些旧功能
- 它以什么架构与存储形态快速起步
- 后续如何为并入外心预留结构条件

当前保留判断：

- 第一阶段先做**独立配套系统**，不并入外心主线
- 第一版目标是**先快速承接旧有记账功能**
- 近期必须先承接的工作面是：
  - `账单总表`
  - `收支分类定义`
  - `快速记账`
  - `平账`
- 第一版架构是：**Rust 内核 + 简 Web UI**
- 数据策略是：**兼容外层，规范内核**
- 权威数据模型收口为：**事件账本 + 投影**
- 事件账本默认方向是 `JSONL`
- 权威事件文件按**年-月**分区
- 投影默认作为**本地派生缓存**，不提交到权威 Git 仓库
- 冲突处理默认先**自动拉取 / 重放 / 重试**，再考虑人工介入
- 该主题要求**及时落盘 Markdown 与 issue**

### I. 留给未来但先不落地的复杂组织问题

当前状态：

- **明确后置**
- 不进入当前主线计划的关闭条件

包含原始点：

- 25

当前判断：

- 第一阶段明确不解决“跨级组织同席协商”之类复杂治理模型
- 该类问题只作为远期研究保留，不进入当前 backlog 的关闭条件

---

## 4. 与当前代码和 GitHub 现状的映射

### A. 信号网络语义与节点模型

当前已存在：

- 默认静态路由：[config/signal-routes.default.json](/H:/A137442/Develop/AGI/exomind/config/signal-routes.default.json#L2)
- 基础路由编辑 UI：[src/components/RouteEditPanel.tsx](/H:/A137442/Develop/AGI/exomind/src/components/RouteEditPanel.tsx#L16)
- node-first 设备 / 节点叙事计划：[docs/plans/2026-03-30-network-node-first-implementation-plan.md](/H:/A137442/Develop/AGI/exomind/docs/plans/2026-03-30-network-node-first-implementation-plan.md#L5)

当前近邻 issue：

- [#387](https://github.com/exomind-team/exomind/issues/387) 拓扑节点生命周期与连边编辑
- [#691](https://github.com/exomind-team/exomind/issues/691) runtime builtin actor 显化
- [#797](https://github.com/exomind-team/exomind/issues/797) 多设备信号网络下 Agent 调度
- [#833](https://github.com/exomind-team/exomind/issues/833) API Agent 未来：持久化与 signal 节点化

缺口：

- 还没有把“`edge = 可通信关系`、默认下游由 actor 模板逻辑定义”沉淀成正式术语文档
- 现有拓扑编辑更偏 UI / runtime host 管理，不等于 workflow 语义已经收口

### B. API Agent 记忆、总结与提案闭环

当前已存在：

- Agent workspace 与长期知识目录：[crates/exomind-runtime/src/agent/workspace.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/workspace.rs#L95)
- cognition 的知识操作抽象：[crates/exomind-runtime/src/agent/cognition.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/cognition.rs#L32)
- 提案系统设计：[docs/plans/2026-04-01-agent-api-and-proposal-system-design.md](/H:/A137442/Develop/AGI/exomind/docs/plans/2026-04-01-agent-api-and-proposal-system-design.md#L21)
- proposal tools：[crates/exomind-runtime/src/agent/proposal_tools.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/proposal_tools.rs#L13)
- life agent 内部工具执行已可落到 proposal store：[crates/exomind-runtime/src/agent/life.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/life.rs#L467)

当前近邻 issue：

- [#71](https://github.com/exomind-team/exomind/issues/71) Agent 自动记忆系统
- [#677](https://github.com/exomind-team/exomind/issues/677) 提案系统
- [#823](https://github.com/exomind-team/exomind/issues/823) session-defined tools + history continuation
- [#830](https://github.com/exomind-team/exomind/issues/830) proposal service 接入 broker
- [#833](https://github.com/exomind-team/exomind/issues/833) API Agent 未来研究

缺口：

- “黑板节点”还没有单独抽象
- 自动总结与自动提案之间的完整产品故事还没做成正式闭环

### C. 多 Agent 协作与服务员体系

当前近邻 issue：

- [#797](https://github.com/exomind-team/exomind/issues/797) 分布式调度与冲突裁决
- [#392](https://github.com/exomind-team/exomind/issues/392) Agent / Actor 运行态监控
- [#728](https://github.com/exomind-team/exomind/issues/728) Agent Workbench 统一工作台
- [#806](https://github.com/exomind-team/exomind/issues/806) 终端 PTY Agent 生命周期
- [#818](https://github.com/exomind-team/exomind/issues/818) 终端 Agent 跨 RT 恢复

缺口：

- 没有一个“任务治理 / 服务员体系 / teammate 编排”的总 issue

### D. Agent 能量与资源双计量

当前已存在：

- heartbeat demo agent：[crates/exomind-runtime/src/agent/heartbeat.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/heartbeat.rs#L8)
- life agent 能量门槛与 tick：[crates/exomind-runtime/src/agent/life.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/agent/life.rs#L48)
- energy HTTP 路由：[crates/exomind-runtime/src/routes/energy.rs](/H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/routes/energy.rs#L23)

缺口：

- “时空 / token”双计量还没有正式产品模型或 issue

### E. 多端同步与验证链

当前已存在：

- 同步 epic：[#532](https://github.com/exomind-team/exomind/issues/532)
- 受管 tauri dev 工作流：[#518](https://github.com/exomind-team/exomind/issues/518)
- manager 设计文档：[docs/plans/2026-03-15-tauri-dev-manager-daemon-design.md](/H:/A137442/Develop/AGI/exomind/docs/plans/2026-03-15-tauri-dev-manager-daemon-design.md#L1)
- README 中的 manager 用法：[README.md](/H:/A137442/Develop/AGI/exomind/README.md#L79)
- node-first 设备视图：[src/ui/app/pages/agents/DeviceView.tsx](/H:/A137442/Develop/AGI/exomind/src/ui/app/pages/agents/DeviceView.tsx#L151)

缺口：

- 当前验收更多聚焦基础同步，不包含集体档案、信号网络编排、黑板节点等新场景

### F. 对外文档与宣传生成

当前已存在：

- 对外 README 叙事：[README.md](/H:/A137442/Develop/AGI/exomind/README.md#L26)
- 商业线 issue：[#242](https://github.com/exomind-team/exomind/issues/242)

缺口：

- 没有明确的“Agent 参与生成对外文档 / 宣传文案”的工作流议题

### G. 集体档案 / 组织档案模型

当前近邻：

- 身份 / 用户系统混合架构文档：[docs/plans/2026-03-07-user-system-hybrid-identity-architecture.md](/H:/A137442/Develop/AGI/exomind/docs/plans/2026-03-07-user-system-hybrid-identity-architecture.md)
- 同步 epic：[#532](https://github.com/exomind-team/exomind/issues/532)

缺口：

- “档案”尚未作为个人 / 集体统一基础对象进入正式 issue 主线

### H. 集体记账 / Labor Ledger

当前近邻：

- 治理 PR：[#565](https://github.com/exomind-team/exomind/pull/565)
- 治理主线：[#239](https://github.com/exomind-team/exomind/issues/239)

明确现状：

- 当前仓库公开讨论中有 `Labor Ledger / 透明财务账本`
- 但尚未进入 runtime / UI / 数据域主线
- 本轮检索没有找到直接名为“集体记账系统”的现成 issue

---

## 5. 推荐的后续任务池

下面的任务池按“应该继续追踪”而不是“立刻开发”来写。

### Task Group 1：信号网络语义 v2

目标：

- 正式定义 Agent / actor / node / edge 的语义边界
- 明确 edge 表达“可通信关系”，默认下游由 actor 模板逻辑定义
- 输出一份信号网络 CRUD 验收清单

建议状态：

- **部分已收口**
- `network v1` 的基础合同已进入主线计划
- 剩余的术语统一与 CRUD 验收清单可继续挂到 [#387](https://github.com/exomind-team/exomind/issues/387) / [#833](https://github.com/exomind-team/exomind/issues/833)

### Task Group 2：单 Agent 总结 → 提案闭环

目标：

- timeblock.completed 后自动读取上下文
- 生成总结
- 生成下一步建议
- 按需写入 proposal

建议状态：

- **已收口子计划**
- 见：[2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](./2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md)

### Task Group 3：Agent 记忆系统与黑板节点

目标：

- 明确工作记忆 / 长期记忆 / 公共记忆三层
- 抽出 `blackboard` 作为协调 / 交接 / 摘要表面

建议状态：

- **部分已收口**
- `blackboard` 已进入主线计划
- 共享面默认收口为“协调 / 交接 / 摘要”，不是共享长期记忆池
- Agent 记忆分层与 `blackboard` 子题仍可挂到 [#71](https://github.com/exomind-team/exomind/issues/71)

### Task Group 4：多 Agent 服务员与治理体系

目标：

- 定义多 Agent 角色编制
- 定义 task governance / waiter / multimodal servant 的边界
- 约束 subAgent / teammate 的生成与持久化

建议状态：

- **第一阶段边界已定**
- 见：[2026-04-06-multi-agent-task-governance-phase1-plan.md](./2026-04-06-multi-agent-task-governance-phase1-plan.md)
- 当前已收口为四角色任务治理层：`coordinator / proposer / reviewer / retrospector`
- 后续继续回链 [#797](https://github.com/exomind-team/exomind/issues/797) / [#728](https://github.com/exomind-team/exomind/issues/728)

### Task Group 5：能量双计量模型

目标：

- 明确运行资源与模型资源的区分
- 统一 energy / token / quota / heartbeat 的产品叙事

建议状态：

- **第一阶段判断已定**
- 见：[2026-04-06-agent-energy-and-dual-metering-phase1-plan.md](./2026-04-06-agent-energy-and-dual-metering-phase1-plan.md)
- 当前已收口为 diagnostics / workbench 告警 + 手动补能 / 唤醒 + invocation / turn 记账
- 后续仍需新开设计 issue 继续细化

### Task Group 6：集体档案 / 组织档案

目标：

- 定义个人档案与集体档案的统一基础模型
- 定义集体读写边界与审批关系
- 定义共享数据域：事件日志、时间块、任务、目标、知识

建议状态：

- **主线已收口**
- 当前主线计划已替代“新开 epic”的需求
- “找被邀请者”子题已拆为独立子计划
- `ArchiveSession / UiSession` 语义澄清已拆为独立补充文档
- 后续应基于主线计划继续拆 ArchiveSession、成员生命周期、治理门禁、公开标识、防伪与公开发现等子题
- `blackboard` Phase 1 补充合同与扩大讨论问题簇已拆到：
  - [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](./2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md)

### Task Group 7：集体记账 / Labor Ledger 产品化

目标：

- 把 Labor Ledger 从治理文档推进为产品对象
- 明确它是否需要：
  - 数据模型
  - 审批流程
  - UI 入口
  - 与档案 / 提案 / 任务的连接

建议状态：

- **已收口为独立系统第一阶段**
- 见：[2026-04-06-independent-collective-bookkeeping-system-plan.md](./2026-04-06-independent-collective-bookkeeping-system-plan.md)
- 后续应新开独立 issue，不并入一般治理讨论

### Task Group 8：多端同步验收链升级

目标：

- 把 agent/network/collective 场景纳入同步验收
- 将 Tauri manager、MCP、真实设备验证串成一条标准链路

建议状态：

- **阶段顺序已收口**
- 见：[2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md](./2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md)
- 继续挂到 [#532](https://github.com/exomind-team/exomind/issues/532) / [#518](https://github.com/exomind-team/exomind/issues/518)

### Task Group 9：对外叙事生成工作流

目标：

- 定义 Agent 如何参与生成对外文档、产品描述、版本公告、宣传文案
- 约束“只能基于已验证能力对外描述”

建议状态：

- **策略已定，工作流待补**
- 当前按“只跟随已验证里程碑”推进
- 继续挂到 [#242](https://github.com/exomind-team/exomind/issues/242)

---

## 6. 不应混淆的边界

为了避免后续讨论再次搅在一起，这里明确几条边界：

1. **集体档案** 不等于 **集体记账**
2. **信号网络语义** 不等于 **多 Agent 调度**
3. **Agent 私有记忆** 不等于 **公共黑板**
4. **运行能量** 不等于 **token 成本**
5. **Tauri manager 验证链** 不等于 **同步架构本身**
6. **对外宣传文案** 不应反向定义尚未验证的内部架构

---

## 7. 当前明确保留、暂不解的问题

以下问题保留，但不进入第一阶段关闭条件：

1. 跨级组织的复杂协商模型
2. 集体档案的正式认证 / OAuth / 外部身份接入细节
3. 把所有网络对象都做成 signal node 的极端一致化方案
4. 把 token、额度、功耗、算力压成一个统一标量的过早收敛
5. `集体档案的Agent`
6. `档案防伪 / 公开标识轮换`
7. `审计界面`

---

## 8. 这份文档之后怎么用

建议把本文作为这批灵感的总索引，后续使用方式如下：

1. 开新 issue 前，先从本文确认它属于哪个 Task Group
2. 如果新讨论只是 Task Group 的细化，不再重复新造概念名词
3. 如果后续某个主题正式收口到单独设计文档，可在本文补链接，不删除原始主题
4. 如果 GitHub 后续补齐了“集体记账”或“集体档案”正式 issue，回链到本文

---

## 9. 一句话总结

这批记录已经稳定收敛成 9 个持续追踪主题，其中 `集体档案 / 多档案会话主线` 已经收口为主线计划，“找被邀请者”已拆成独立子计划，`信号网络语义`、`单 Agent 时间块闭环`、`多 Agent 第一阶段边界`、`能量双计量第一阶段` 与 `独立集体记账第一阶段` 都已有对应子计划，后续不应再把它们混成一团讨论。
