# Proposal Lifecycle Notification Plan

## 目标

把 Proposal 从“RT 会发 replication snapshot、前端主要靠 polling 刷新”的过渡态，推进到“同步信号与治理事件分层、前端主路径 signal-driven、用户可见提醒可派生”的第一版可实现方案。

这份计划不处理 Proposal 全量通用化，也不把系统通知、移动端后台提醒、提示音等后续能力一次性打包进来。第一版只收口当前最直接影响 `#921 / #922 / #906 / #677` 的缺口：

- Proposal 已有 RT replication signal，但前端主信号流还没接入 Proposal。
- `提案箱` 页面与角标当前仍以 30 秒 polling 为主。
- Proposal 还没有与治理语义对应的 lifecycle 事件表面，无法明确表达“新提案到来”“状态已变化”“批准后执行失败”。

## 当前现状

### RT 已有但前端未接的部分

- [crates/exomind-runtime/src/routes/proposals.rs](../../crates/exomind-runtime/src/routes/proposals.rs)
  已经在创建、更新、评论后发布 `proposal.replication.upserted`。
- Proposal 复制层目前使用 proposal snapshot 语义，适合做同步和最终一致性，不适合直接承担提醒语义。

### 前端当前 Proposal 表面

- [src/ui/hooks/useSignalStream.ts](../../src/ui/hooks/useSignalStream.ts)
  当前没有 Proposal topic handler。
- [src/lib/services/signal-handlers.ts](../../src/lib/services/signal-handlers.ts)
  当前没有 Proposal payload 类型与分发分支。
- [src/ui/app/pages/proposals/ProposalInboxPage.tsx](../../src/ui/app/pages/proposals/ProposalInboxPage.tsx)
  当前依赖初次加载 + 30 秒 polling。
- [src/ui/app/components/ProposalNotificationBadge.tsx](../../src/ui/app/components/ProposalNotificationBadge.tsx)
  当前也依赖 30 秒 polling。
- [src/lib/types/proposal.ts](../../src/lib/types/proposal.ts)
  当前状态集只有 `pending / in_review / approved / rejected / snoozed`。

### 当前失败语义

- [crates/exomind-runtime/src/routes/proposals.rs](../../crates/exomind-runtime/src/routes/proposals.rs)
  中“批准后执行失败”当前做法是：保留 Proposal 状态，追加一条失败评论。
- 这意味着第一版不应为了“执行失败提醒”强行引入新的 ProposalStatus，而应把它建模成独立 lifecycle 事件。

## 已定设计

### 1. 同步信号与治理事件必须分层

第一版明确拆成两层：

- **同步层**
  - 继续使用 `proposal.replication.upserted`
  - 职责是数据同步、前端刷新、跨端 eventual consistency
- **治理 / lifecycle 层**
  - 新增专门事件 topic
  - 职责是表达治理语义和派生提醒

禁止把 `proposal.replication.upserted` 同时当成“同步真相源”和“提醒源”。

### 2. 第一版 lifecycle topic 固定为三类

- `proposal.created`
  - 只在新 Proposal 创建成功后发布
- `proposal.status_changed`
  - 只在 Proposal 状态真实变化后发布
  - 第一版覆盖所有现有状态迁移，而不只覆盖终态
- `proposal.execution_failed`
  - 只在 Proposal 已批准、执行器执行失败且失败评论已落盘后发布

### 3. 前端主路径切到 signal-driven，polling 只保留兜底

- `提案箱` 页面和 Proposal 角标的主刷新路径改为：
  - 收到 Proposal replication
  - 触发前端 Proposal 数据变化通知
  - 页面 / 角标立即刷新
- 现有 30 秒 polling 保留为兜底：
  - 处理 SSE 短断连
  - 处理切换 runtime target
  - 处理初期兼容窗口

### 4. 第一版用户可见提醒只做角标 + 应用内 toast

- 第一版不做系统通知。
- 第一版不做手机后台通知或提示音。
- 用户可见提醒来源于 lifecycle topic，而不是 replication topic。

### 5. 执行失败不改 Proposal 状态模型

- 第一版不新增 `execution_failed` status。
- `proposal.execution_failed` 只是独立 lifecycle 事件。
- Proposal 当前状态仍沿用现有模型，执行失败继续通过失败评论保留痕迹。

## 实现方案

### RT：Proposal 事件表面

在 [crates/exomind-runtime/src/routes/proposals.rs](../../crates/exomind-runtime/src/routes/proposals.rs) 中补齐两类发布：

1. 继续保留现有 `proposal.replication.upserted`
2. 新增 lifecycle 发布函数：
   - `publish_proposal_created_signal(...)`
   - `publish_proposal_status_changed_signal(...)`
   - `publish_proposal_execution_failed_signal(...)`

第一版事件 payload 统一包含：

- `schemaVersion`
- `scopeKey`
- `proposalId`
- `originHostId`
- `proposal`

其中：

- `proposal.status_changed` 额外包含：
  - `fromStatus`
  - `toStatus`
- `proposal.execution_failed` 额外包含：
  - `errorMessage`
  - `failedAt`

发布时机固定为：

- 创建成功后：
  - 先发布 replication
  - 再发布 `proposal.created`
- 状态变化后：
  - 先发布 replication
  - 再发布 `proposal.status_changed`
- 执行失败后：
  - 先把失败评论写回 store
  - 再发布带最终 Proposal 快照的 replication
  - 最后发布 `proposal.execution_failed`

### Frontend：Proposal 数据变化通知层

新增一个最小 Proposal 服务层，位置固定为：

- [src/lib/services/proposal.service.ts](../../src/lib/services/proposal.service.ts)

职责：

- 封装 Proposal RT adapter 的常用读写能力
- 提供 `onProposalChange(callback)` 订阅接口
- 提供 `notifyProposalDataChanged()` 给 signal hook 调用

第一版不要求把 `ProposalInboxPage` 全量重写成 store 驱动，但要求：

- `ProposalInboxPage` 的读取入口改为通过 `ProposalService`
- `ProposalNotificationBadge` 的计数读取改为通过 `ProposalService`
- 两者都订阅 `onProposalChange()`，收到通知后立即刷新

### Frontend：Signal 接线

需要修改三处：

- [src/lib/services/signal-handlers.ts](../../src/lib/services/signal-handlers.ts)
  - 新增 Proposal replication 与 lifecycle payload 类型
  - 新增 Proposal topic 分发分支
- [src/ui/hooks/useSignalStream.ts](../../src/ui/hooks/useSignalStream.ts)
  - 接入 Proposal replication handler
  - 接入 Proposal lifecycle handler
  - Proposal replication 只触发 `notifyProposalDataChanged()`
  - Proposal lifecycle 只负责 toast 派生逻辑
- [src/App.tsx](../../src/App.tsx)
  - 不新增额外 coordinator，继续复用现有 `useSignalStream()` 主入口

### Frontend：Toast 规则

第一版 toast 规则固定如下：

- `proposal.created`
  - 文案聚焦“有新的待处理提案”
- `proposal.status_changed`
  - 文案聚焦“提案状态已变化”
- `proposal.execution_failed`
  - 文案聚焦“批准后执行失败，需要人工处理”

去噪规则：

- 当前就在 `/proposals` 页面时：
  - 抑制 `proposal.created`
  - 抑制 `proposal.status_changed`
- `proposal.execution_failed` 始终提示，不做页面抑制

### 非目标

第一版明确不做：

- 系统通知
- 手机后台通知
- 背景提示音
- Proposal 专属前端全局 store
- Proposal 新状态枚举
- 评论新增、参数编辑等所有非状态变化的 lifecycle topic

## 测试与验证

### RT 测试

- 创建 Proposal 后：
  - 收到 `proposal.replication.upserted`
  - 收到 `proposal.created`
- Proposal 状态迁移后：
  - 收到 `proposal.replication.upserted`
  - 收到 `proposal.status_changed`
  - `fromStatus / toStatus` 正确
- Proposal 批准后执行失败时：
  - 失败评论已追加
  - Proposal 状态未被偷换成新状态
  - 收到 `proposal.execution_failed`

### Frontend 测试

- `useSignalStream` 收到 Proposal replication 后，会触发 `notifyProposalDataChanged()`
- `ProposalInboxPage` 收到 Proposal 数据变化通知后立即刷新，不必等待下一轮 polling
- `ProposalNotificationBadge` 收到 Proposal 数据变化通知后立即刷新 pending 数量
- `/proposals` 页面内 create/status toast 被抑制
- `proposal.execution_failed` toast 不被抑制

### 人工验证

1. 创建一条新的 pending Proposal
   - 角标即时变化
   - 非 `/proposals` 页面看到 toast
2. 在提案箱中批准 / 拒绝 / 暂缓 Proposal
   - 页面即时刷新
   - 非 `/proposals` 页面看到状态变化 toast
3. 让 Proposal executor 进入失败路径
   - Proposal 详情可见失败评论
   - 任何页面都能看到失败 toast
4. 断开 SSE 或切换 RT 后恢复
   - polling 仍能把数据补齐

## 关联

- [#677](https://github.com/exomind-team/exomind/issues/677)
  Proposal 系统总入口与现有提案箱表面
- [#921](https://github.com/exomind-team/exomind/issues/921)
  当前系列 pilot：`edit_task` 不再只是补动作类型，也要验证治理事件表面
- [#922](https://github.com/exomind-team/exomind/issues/922)
  Proposal 向 RT action gate 演化时，治理事件层与 signal-driven inbox 是新增约束
- [#906](https://github.com/exomind-team/exomind/issues/906)
  本计划作为当前 Proposal 栈到后续 signal-source / signal network 的桥接样本
