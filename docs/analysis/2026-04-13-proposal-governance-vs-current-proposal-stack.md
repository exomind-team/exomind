# 2026-04-13 Proposal-first governance 与当前 proposal 实现之间的结构断层

本文只基于本仓库现有代码与文档，不使用网络资料。

## 问题定义

当前仓库里，`Proposal` 被两套不同层级的设计同时使用，但这两套设计还没有在实现层收拢成同一个对象。

一套是“个人同步基线的数据域”。路线计划把 `Proposal` 放在 `EventLog`、`TimeBlock`、`Task`、`Settings` 同级，只要求“草案内容一致、列表一致、状态一致”，并明确说**不要把审批执行后的业务副作用强行塞进同一关闭条件**（`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:35-49`）。

另一套是“proposal-first 的治理合同”。多 Agent 第一阶段计划已经把主队列定义为 proposal-first，把 `coordinator / proposer / reviewer / retrospector` 的职责边界、`in_review` 的正式语义、人类 UI 终审、同一提案修订、最多 3 轮退回-修订循环、治理痕迹挂到提案评论/历史，都写得很清楚（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:11-18`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:43-76`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:96-123`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:162-209`）。4 月 7 日的 settled decisions 又进一步把关键修正钉死了：`in_review = 等待人类 UI 终审`，需要新增 `changes_requested`，并把 `rejected` 改成 `cancelled`（`docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:54-64`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:72-99`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:119-163`）。

结构断层就在这里：计划里的 `Proposal` 已经是治理主对象，当前实现里的 `Proposal` 仍主要是一个“可存、可同步、可 PATCH、必要时顺手触发执行”的数据对象。

## 治理模型在计划中的清晰部分

- 主队列已经明确是 `proposal-first`，不是“任务为主，提案只是门禁分支”；`coordinator` 围绕提案主队列调度，任务更多是被提案驱动或引用的对象（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:13-19`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:54-68`）。
- 角色合同已经明确。`proposer` 负责生成和修订 `pending proposal`；`reviewer` 负责评论、证据复核、退回、预裁决，并且只能把提案推进到 `in_review`，不能直接批准；`retrospector` 不负责提案评审闭环（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:52-76`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:96-159`）。
- `in_review` 的正式语义已经明确，不是“Agent 内部还在讨论”，而是“等待人类 UI 终审”（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:166-177`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:85-118`）。
- 退回语义已经明确需要拆开。计划和 settled decisions 都认为现有 `Rejected` 不能继续被理解为真正终态，需要新增 `changes_requested`，并把真正的人类取消动作改成 `cancelled`（`docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:119-144`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:493-499`）。
- 修订路径也已经明确：被退回后在**同一提案**上修订并重送审，最多 3 轮；超过 3 轮则强制进入人类终审（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:178-189`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:253-269`）。
- 同时，路线顺序也很明确：proposal-first 治理不属于当前第一里程碑的关闭条件，它建立在“个人同步基线 + 信号网络 v1 骨架 + 单 Agent 关键闭环”之后（`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:27-49`, `docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:76-98`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:229-237`）。这说明断层有一部分是**阶段切分导致的有意未对齐**。

## 当前 RT / store / UI 实现状态

### RT

运行时路由已经把 proposal API 挂进主路由树，说明 proposal 端点在代码层不是“未接入状态”，而是正式路由的一部分（`crates/exomind-runtime/src/routes/mod.rs:24-35`）。

但 proposal API 的合同非常薄。创建请求只有标题、正文、动作类型、动作参数、引用、发布者；更新请求只有 `status`、`action_params`、`snooze_until` 三个可变字段，没有“submit for review”“request changes”“cancel”“resubmit”“approve by human”这类治理命令（`crates/exomind-runtime/src/routes/proposals.rs:36-55`）。

`PATCH /proposals/:id` 的实际行为是：先按需改 `action_params`，再按需改 `status`；如果状态从非 `approved` 变成 `approved`，就在同一个 HTTP 处理流程里立即调用 `ProposalExecutor` 执行任务 / eventlog / timeblock 副作用，失败则补一条来自 `Runtime Executor` 的普通评论（`crates/exomind-runtime/src/routes/proposals.rs:137-201`）。这不是治理编排，而是“状态位翻转后顺手执行业务效果”。

测试也把这套路径固化了。现有测试直接从 `pending` 通过 API PATCH 到 `approved`，然后断言任务被创建、eventlog 被写入；另一个测试断言 `approved` 之后再 `rejected` 会得到 `409 CONFLICT`，并且终态后不能再改 `action_params`（`crates/exomind-runtime/src/routes/proposals.rs:467-547`, `crates/exomind-runtime/src/routes/proposals.rs:615-685`）。

### store 与复制

Rust store 的过滤维度只有 `status` 和 `action_type`，没有队列所有者、轮次、升级原因、证据状态、人类终审状态之类的治理字段（`crates/exomind-runtime/src/proposal/store.rs:28-32`）。

SQLite schema 也证明当前对象是一个快照行：`id / scope_key / title / body / action_type / action_params_json / references_json / status / publisher_json / comments_json / snooze_until / created_at / updated_at`。没有 `history`、`review_round`、`requested_by`、`reviewed_by`、`approved_by`、`cancelled_by`、`evidence`、`decision_reason` 这类治理结构（`crates/exomind-runtime/src/proposal/store.rs:520-540`）。

状态机同样是现阶段的轻量版本。store 只认识 `pending / in_review / approved / rejected / snoozed`，并允许 `pending -> approved`、`pending -> rejected`、`pending -> snoozed`、`snoozed -> approved` 这类直接跳转；`approved` 和 `rejected` 被当作真正终态（`crates/exomind-runtime/src/proposal/store.rs:802-892`）。这和计划里的“`reviewer` 只能推进到 `in_review`，只有人类 UI 才能产生最终批准/取消”不是一个状态机。

更关键的是复制模型。proposal 路由发布的信号 topic 是 `proposal.replication.upserted`，payload 的 cursor kind 直接叫 `proposal_snapshot`，并把整个 `proposal` 快照塞进 payload（`crates/exomind-runtime/src/routes/proposals.rs:234-253`）。复制 actor 收到后，不是重放治理动作，而是决定要不要接受这个快照；一旦接受，就直接 `save_replica_scoped` 整行 upsert 到 store（`crates/exomind-runtime/src/signal/actors/replication_actor.rs:257-284`, `crates/exomind-runtime/src/proposal/store.rs:311-348`）。

冲突解决也只看 `updated_at`，时间相同再用 `origin_host_id` 和 `local_host_id` 做字典序 tie-break，没有任何“人类终审优先”“终态不可被较晚的非终态覆盖”“review round 递增”之类的治理规则（`crates/exomind-runtime/src/signal/actors/replication_actor.rs:399-412`）。这就是标准的数据面收敛逻辑，不是治理合同。

### UI 与信号流

前端类型和 Rust store 一样，只认识 `pending / in_review / approved / rejected / snoozed`，没有 `changes_requested`、`cancelled`、历史记录、轮次、升级信息等治理字段（`src/lib/types/proposal.ts:1-63`）。

`ProposalInboxPage` 也不是一个治理状态机容器，而是一个本地 React 页面状态：`proposals`、`selectedProposalId`、`activeFilter`、`actionParamsText` 等全部存在组件自己的 `useState` 里（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:188-201`）。数据刷新方式是初次加载加 30 秒轮询，不是基于 proposal signal 的实时投影（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:202-259`）。

页面动作表面只有“保存草稿 / 批准执行 / 暂缓 / 拒绝”，没有“送审”“请求修改”“取消”“重新送审”“升级给人类”等治理动作（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:332-432`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:648-694`）。

UI 文案本身也暴露出语义漂移。筛选项和统计卡仍然使用“`rejected` = 已拒绝”，并把 `in_review` 的提示写成“需要继续讨论的提案”，而不是“等待人类 UI 终审”（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:47-58`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:540-543`）。

还有一个明显信号：虽然 Rust 主路由已经合并了 proposal router，但页面仍把 RT 返回 404 视为一个常态兼容分支，并在页面上直接提示“当前 RT 还没有接入 proposal 端点”（`crates/exomind-runtime/src/routes/mod.rs:24-35`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:505-512`）。这说明 UI 对 proposal stack 的心理模型，依旧更接近“可选的数据接口”，不是系统治理主队列。

`useSignalStream` 进一步证明这一点。这个 hook 目前接的是 task、reminder、eventlog、active block、completed timeblock、review.completed、keyboard state，没有 proposal handler（`src/ui/hooks/useSignalStream.ts:1-5`, `src/ui/hooks/useSignalStream.ts:218-374`）。也就是说，RT 明明会发 `proposal.replication.upserted`，但前端主信号流根本不接 proposal，所以 proposal 页面现在只能靠轮询和本地状态刷新，不是治理工作台式的实时同步。

## 状态机断层

- 计划要的 `changes_requested` 根本不存在。当前代码只能用 `in_review -> pending` 或直接 `rejected` 来近似“退回”，但这两者都不是同一件事（计划：`docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:119-144`；代码：`crates/exomind-runtime/src/proposal/store.rs:802-892`, `src/lib/types/proposal.ts:1-6`）。
- 计划要把真正终态从 `rejected` 修正为 `cancelled`，并把“请求修改”从终态里拆出去；当前代码仍把 `rejected` 当真正终态，并且终态后禁止继续更新（计划：`docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:123-131`；代码：`crates/exomind-runtime/src/routes/proposals.rs:615-685`, `crates/exomind-runtime/src/proposal/store.rs:802-892`）。
- 计划要求 `reviewer` 只能推进到 `in_review`，只有人类 UI 才能产生 `approved / cancelled`；当前代码允许从 `pending` 直接 PATCH 成 `approved` 或 `rejected`，而且 update 合同里没有角色信息，proposal 层本身不区分 `reviewer` 和 `human`（计划：`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:166-177`；代码：`crates/exomind-runtime/src/routes/proposals.rs:47-55`, `crates/exomind-runtime/src/routes/proposals.rs:167-180`, `crates/exomind-runtime/src/proposal/store.rs:818-839`, `crates/exomind-runtime/src/routes/proposals.rs:467-523`）。
- 计划要求“同一提案修订、最多 3 轮退回-修订循环”；当前模型没有轮次字段，没有结构化历史，只有可变 `action_params`、普通评论和 `updated_at`，因此根本无法表达“现在是第几轮”“为什么被退回”“是否已强制升级给人类”（计划：`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:178-185`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:205-209`；代码：`crates/exomind-runtime/src/proposal/store.rs:520-535`, `src/lib/types/proposal.ts:35-47`）。
- 计划把 `in_review` 定义为“等待人类 UI 终审”；当前 UI 却把它解释成“需要继续讨论的提案”，这已经不是缺字段，而是语义直接错位（计划：`docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:94-99`；代码：`src/ui/app/pages/proposals/ProposalInboxPage.tsx:540-543`）。
- 路线文档把“审批后的业务副作用”排除在当前里程碑关闭条件之外；当前 RT 却把“状态改成 `approved`”和“立刻执行副作用”绑定在一个 HTTP 流程里。实现并不是没有执行，而是**先把执行耦合上了，却没把治理合同补上**（计划：`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:43-49`；代码：`crates/exomind-runtime/src/routes/proposals.rs:174-201`）。

## 为什么它仍像数据面而非治理合同

先看命名原则。架构原则明确要求：涉及“提案、取消、放弃、推进”等动作时，系统级约束必须同时具备 invariant 和 affordance 两层表述；并且不要把产品语义直接坍缩成 CRUD 语义，成功发生的动作要留下可追踪、可解释的痕迹（`docs/architecture/principles.md:7-11`, `docs/architecture/principles.md:15-30`）。

当前 proposal stack 还没有做到这一层，原因很直接：

- 当前真相源是**快照行**，不是治理日志。schema 存的是一行 proposal 当前值，复制发的是 `proposal_snapshot`，冲突解决靠 `updated_at`。这套设计天然偏向“收敛到同一个最终值”，而不是“保留并裁决谁在何时以什么权限做了什么决定”（`crates/exomind-runtime/src/proposal/store.rs:520-540`, `crates/exomind-runtime/src/routes/proposals.rs:244-253`, `crates/exomind-runtime/src/signal/actors/replication_actor.rs:399-412`）。
- API 是字段 PATCH，不是治理命令。更新入口只接受 `status` / `action_params` / `snooze_until`，这就是典型的数据面接口。它表达的是“把值改成什么”，不是“谁以什么身份请求修改、送审、取消、批准”（`crates/exomind-runtime/src/routes/proposals.rs:47-55`, `crates/exomind-runtime/src/routes/proposals.rs:143-170`）。
- 治理痕迹没有结构化落盘。计划里说治理痕迹应该挂到“提案评论 / 提案历史”，但当前实现只有 `comments`，没有 `history`；评论本身也是自由文本，不是结构化 transition record（计划：`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:205-209`；代码：`crates/exomind-runtime/src/proposal/store.rs:520-535`, `src/lib/types/proposal.ts:29-47`）。
- 权限与责任主体没有进入 proposal 模型。当前对象只有一个 `publisher` 记录“最初是谁发起的”，评论里也只有普通 `author`；没有 `reviewer decision`、`coordinator escalation`、`human final approver` 这些职责归因位（`src/lib/types/proposal.ts:23-47`）。
- 批准与执行被压缩成一个同步动作。治理合同本应先回答“是否批准、谁批准、批准的语义是什么”，数据面才回答“批准后执行什么副作用”。当前实现直接把两者绑在一起，所以 `approved` 更像“执行开关”而不是“治理决议”（`crates/exomind-runtime/src/routes/proposals.rs:174-201`）。
- 前端没有 proposal 专属实时投影。一个 proposal-first 主队列，正常应该在 UI 层表现为队列、责任、轮次、升级、终审态的明确表面；当前页面只是轮询列表并手工 mutate 本地数组，`useSignalStream` 也不接 proposal topic。这还是 inbox/data browser，不是治理合同界面（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:188-259`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:332-432`, `src/ui/hooks/useSignalStream.ts:218-374`）。

## 迁移阻力

- 最大的阻力不是“少几个状态”，而是**阶段切分冲突**。路线计划明说当前里程碑只要 proposal 的内容/列表/状态一致，多 Agent proposal-first 治理应在后续前提满足后再接上（`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:27-49`, `docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:76-98`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:229-237`）。这意味着把 proposal 立刻升级成治理主对象，不只是改代码，而是改当前主线顺序。
- Rust enum、SQLite schema、TS union、UI 文案和测试都已经把 `rejected` / `snoozed` / `approved` 这套状态写死了。新增 `changes_requested`、把 `rejected` 改成 `cancelled`，会同时触及后端存储、序列化、前端类型、筛选项、统计文案和测试断言（`crates/exomind-runtime/src/proposal/store.rs:520-540`, `crates/exomind-runtime/src/proposal/store.rs:876-892`, `src/lib/types/proposal.ts:1-6`, `src/ui/app/pages/proposals/ProposalInboxPage.tsx:47-58`）。
- 现有 API 和测试都建立在“通用 PATCH status”之上。如果改成治理命令式接口，`create/list/update/comment` 这一层要重切，现有适配器和页面动作也要一起换（`crates/exomind-runtime/src/routes/proposals.rs:36-55`, `crates/exomind-runtime/src/routes/proposals.rs:137-201`, `crates/exomind-runtime/src/routes/proposals.rs:467-547`）。
- `approved` 现在已经是副作用执行触发器。只要保留这一点，状态机就会继续倾向“执行开关”；如果拆开批准与执行，又会影响 `ProposalExecutor`、eventlog 记录和现有测试预期（`crates/exomind-runtime/src/routes/proposals.rs:174-201`, `crates/exomind-runtime/src/routes/proposals.rs:467-545`）。
- 复制层的 last-write-wins 快照策略，对多角色治理尤其脆弱。今天它可以收敛“最新状态”；明天如果要表达“reviewer 请求修改”和“human 取消”这类不同权限、不同语义的动作，仅靠 `updated_at` 不足以裁决（`crates/exomind-runtime/src/routes/proposals.rs:244-253`, `crates/exomind-runtime/src/signal/actors/replication_actor.rs:257-284`, `crates/exomind-runtime/src/signal/actors/replication_actor.rs:399-412`）。
- 历史数据无法无损回填。现有行里没有 review round、升级原因、终审人、结构化决议；以后即使新增这些字段，旧 proposal 也只能保留“当前快照 + 评论文本”，无法可靠重建治理轨迹（`crates/exomind-runtime/src/proposal/store.rs:520-535`, `src/lib/types/proposal.ts:29-47`）。
- 前端目前没有 proposal store，也没有 proposal signal 投影。要把 proposal 提升成治理主队列，不能只在页面上多加两个按钮，必须补一层真正的前端状态与实时同步结构（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:188-259`, `src/ui/hooks/useSignalStream.ts:218-374`）。

## 建议的后续验证问题

1. `Proposal` 在当前阶段到底是“个人同步基线的数据域”，还是已经要提前承担多 Agent proposal-first 治理合同？这决定断层是暂时分层，还是已经变成阻塞问题（`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:27-49`, `docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:229-237`）。
2. 人类 UI 终审的权威动作集到底是什么？是只有 `approved / cancelled`，还是人类也可以发出 `changes_requested`？当前计划文档对“退回”与“取消”已经分开，但代码还没有对应命令面（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:169-177`, `docs/plans/2026-04-07-third-round-super-question-settled-decisions.md:119-144`）。
3. proposal 层真正的真相源应该是什么：快照行、结构化 history、eventlog 事件，还是三者分层共存？如果治理痕迹默认挂在“评论 / 历史”，那“历史”是否要成为一等数据结构，而不是继续依赖自由文本评论（`docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md:205-209`, `crates/exomind-runtime/src/proposal/store.rs:520-535`）。
4. `approved` 是否还应该继续同步触发执行？如果治理决议和执行后果需要分层，那么 proposal 状态机和 `ProposalExecutor` 的边界应该怎么切（`docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md:43-49`, `crates/exomind-runtime/src/routes/proposals.rs:174-201`）。
5. 多设备并发治理时，什么规则替代当前的 `updated_at` last-write-wins？尤其是“reviewer 请求修改”和“human 终审取消/批准”冲突时，是否需要权限优先级、轮次号或因果日志（`crates/exomind-runtime/src/signal/actors/replication_actor.rs:399-412`）。
6. 前端是否要为 proposal 建立专门的 store 和 signal 投影？如果 proposal-first 主队列是真的，30 秒轮询和页面本地状态很难承接角色协作、轮次推进和终审提醒（`src/ui/app/pages/proposals/ProposalInboxPage.tsx:202-259`, `src/ui/hooks/useSignalStream.ts:218-374`）。
7. 现有 proposal 数据是否需要迁移策略？如果后续引入 `changes_requested`、`cancelled`、history、review round，旧数据如何保持可读，哪些字段只能从现在开始新增而不能回填（`crates/exomind-runtime/src/proposal/store.rs:520-540`, `src/lib/types/proposal.ts:35-47`）。
