# 2026-04-18 Proposal 生命周期事件与实时通知计划

> 状态：已实现（2026-04-19，`401c4e2a`；后续回归修正进行中）
>
> 用途：把当前围绕 proposal 实时同步、生命周期事件、角标刷新与应用内提醒的已定决策沉淀为一份可直接实现的本地计划文档。
>
> 关联 issue：
>
> - [#677 feat(rt/proposal): 提案系统 — Agent 操作审批队列（提案集）与外部 Agent 接入审批](https://github.com/exomind-team/exomind/issues/677)
> - [#922 design(rt/proposal): 将提案系统抽象为可组合 RT action gate，而非持续扩展固定 action 枚举](https://github.com/exomind-team/exomind/issues/922)
> - [#906 research(migration): 搬迁性更新——抛弃旧骨架并迁移已验证成果](https://github.com/exomind-team/exomind/issues/906)

## 1. 背景与当前缺口

当前 proposal 域已经具备：

- RT 侧 `ProposalStore / ProposalExecutor / proposals route`
- 前端 `ProposalInboxPage`、`ProposalNotificationBadge`
- RT 侧 `proposal.replication.upserted`

但 proposal 的“同步”和“提醒”目前仍处于割裂状态：

1. RT 已经会发 `proposal.replication.upserted`，但前端主信号流还没有接 proposal。
2. 请求箱页面与角标当前主要依赖轮询，不是 signal-driven。
3. proposal 目前缺少专门的生命周期事件；“新建提案”“状态变化”“批准后执行失败”无法用独立 topic 表达。
4. proposal badge 已存在，但它只是轮询结果的 UI 表面，不代表 proposal 已经进入前端实时事件流。

这导致当前 proposal 的行为更接近“会轮询的 inbox”，而不是：

- 一个能实时刷新、低延迟反映状态变化的治理入口
- 一个可以进一步向结构化治理事件 / signal-source 方向演进的过渡层

## 2. 目标与边界

### 2.1 本轮目标

本轮实现同时补两层：

1. **状态传播层**
   - proposal 进入前端实时信号流
   - 请求箱页面与角标不再以 polling 作为主路径
2. **用户提醒层**
   - proposal 新建、状态变化、执行失败通过专门 lifecycle events 进入应用内提醒

### 2.2 本轮不做

- 不引入浏览器/系统级通知
- 不引入移动端后台通知或提示音
- 不为 proposal 建完整前端 store
- 不修改 proposal 当前状态模型（`pending / in_review / approved / rejected / snoozed`）
- 不把 comment 追加、`action_params` 编辑等所有变更都升级为独立 lifecycle topic

## 3. 已定决策

### 3.1 信号分层

proposal 本轮明确拆成两类信号：

1. **replication topic**
   - `proposal.replication.upserted`
   - 职责：跨端同步、前端数据刷新、恢复补齐
   - 不负责用户提醒语义

2. **lifecycle topics**
   - `proposal.created`
   - `proposal.status_changed`
   - `proposal.execution_failed`
   - 职责：表达治理生命周期事件，供前端提醒与后续结构化治理链路消费
   - 不承担跨端最终一致性真相源职责

结论：**不复用 `proposal.replication.upserted` 直接做 toast，也不把 lifecycle topic 当作数据同步真相源。**

### 3.2 Lifecycle topic 的第一版合同

三类 lifecycle topic 第一版均采用与现有 signal 风格一致的结构：

```ts
{
  schemaVersion: 1,
  scopeKey: string,
  cursor: {
    kind: 'proposal_created' | 'proposal_status_changed' | 'proposal_execution_failed',
    proposalId: string,
    updatedAt: string,
    originHostId: string,
  },
  proposal: Proposal,
  transition?: {
    fromStatus: ProposalStatus,
    toStatus: ProposalStatus,
  },
  execution?: {
    failureMessage: string,
  },
}
```

约束如下：

- `proposal.created`
  - 只在 proposal 创建成功后发出
  - 不附带 `transition`
- `proposal.status_changed`
  - 只在 `status` 真的变化时发出
  - 必须带 `transition.fromStatus / toStatus`
- `proposal.execution_failed`
  - 只在 proposal 批准后执行失败时发出
  - 必须在失败评论已成功写回 proposal 后发出
  - `proposal` 字段必须是**已经包含失败评论的最终快照**
  - 必须带 `execution.failureMessage`

### 3.3 Proposal 当前状态模型不在本轮改写

本轮不把 proposal 当前状态模型直接改成 `executing / executed / execution_failed`。

第一版兼容当前实现：

- proposal 批准后执行失败时，proposal 状态仍可能保持 `approved`
- 真正的失败语义由 `proposal.execution_failed` lifecycle event 承担
- 失败原因继续通过 proposal comment 留痕

这条约束用于避免本轮把 `#922` 的长期状态机改造和“实时通知接线”混在一起。

### 3.4 前端数据刷新路径

前端不引入完整 proposal store，而是新增两层轻量能力：

1. **proposal 数据变更通知器**
   - 作用：供请求箱页面和角标订阅“proposal 数据需要刷新”
   - 形式：对齐现有 `notifyTaskDataChanged()` / `notifyReminderDataChanged()` 风格
   - 第一版接口固定为：
     - `subscribeProposalDataChanges(listener: () => void): () => void`
     - `notifyProposalDataChanged(): void`

2. **proposal lifecycle 事件分发器**
   - 作用：把 `useSignalStream` 收到的 lifecycle topic 派发给提醒层
   - 第一版接口固定为：
     - `subscribeProposalLifecycle(listener: (event: ProposalLifecycleEvent) => void): () => void`
     - `emitProposalLifecycle(event: ProposalLifecycleEvent): void`

结论：**页面刷新与 toast 提醒使用两条不同的前端通道。**

### 3.5 前端组件职责拆分

第一版职责如下：

- `useSignalStream`
  - 接 proposal replication topic
  - 接 proposal lifecycle topics
  - replication 到达时只做 `notifyProposalDataChanged()`
  - lifecycle 到达时只做 `emitProposalLifecycle(...)`

- `ProposalInboxPage`
  - 初始化仍走 RT adapter 拉取列表
  - 继续保留 30 秒轮询兜底
  - 订阅 `subscribeProposalDataChanges()`，收到事件立即刷新

- `ProposalNotificationBadge`
  - 保留当前 pending 计数逻辑
  - 继续保留 30 秒轮询兜底
  - 订阅 `subscribeProposalDataChanges()`，收到事件立即刷新

- `ProposalNotificationCoordinator`（新）
  - 挂在根路由壳层（当前为 `src/routes.tsx`，因为需要 router context）
  - 订阅 `subscribeProposalLifecycle()`
  - 统一决定是否 toast、toast 文案和抑制策略

### 3.6 第一版提醒策略

第一版只做应用内 toast，不做系统通知。

提醒规则固定为：

1. `proposal.created`
   - 在 proposal 创建成功后提醒
   - 目标是让“新待处理请求”不被静默错过

2. `proposal.status_changed`
   - 对所有状态变化都派发事件
   - 第一版默认都允许进入 toast 决策层

3. `proposal.execution_failed`
   - 始终使用高优先级失败提示
   - 文案要明确“批准后执行失败，需要人工处理”

### 3.7 提醒抑制与降噪

第一版降噪策略固定为：

- 当前路由已经在 `/proposals` 时：
  - 抑制 `proposal.created`
  - 抑制普通 `proposal.status_changed`
- `proposal.execution_failed`
  - 无论当前是否在 `/proposals`，都不抑制
- 页面数据刷新与角标更新不受 toast 抑制影响，仍需实时发生

这是为了满足当前优先级：**不漏请求优先，但避免在治理主页面内重复打断用户。**

### 3.8 Polling 保留为兜底

proposal 接入实时流后：

- 请求箱页面保留当前 30 秒轮询
- 角标保留当前 30 秒轮询
- polling 的职责降级为：
  - 断线恢复兜底
  - 错过 signal 时的自愈
  - 外部 RT / 旧版本 RT 的兼容回退

结论：**第一版不切纯 signal-driven，不移除 polling。**

### 3.9 与 `#922 / #906` 的关系

本计划是当前 proposal 系列的一层过渡骨架，而不是长期终态：

- 对 `#922`
  - lifecycle topic 是当前系列“结构化治理事件”方向的一个落点
  - 它为后续 proposal history / governance event / action gate 分层提供前置验证

- 对 `#906`
  - 本轮把 proposal 的“复制信号”和“治理生命周期事件”明确分层
  - 后续搬迁式重构里，lifecycle event 应被视为 signal-source / signal network 方向的可搬迁合同之一

## 4. 实现分解

### 4.1 RT：发布 lifecycle topics

关键入口：

- [crates/exomind-runtime/src/routes/proposals.rs](../../crates/exomind-runtime/src/routes/proposals.rs)

实现要求：

1. `create_proposal()`
   - 继续发布 `proposal.replication.upserted`
   - 新增发布 `proposal.created`

2. `update_proposal()`
   - 当 `status` 真正变化时：
     - 继续发布 `proposal.replication.upserted`
     - 新增发布 `proposal.status_changed`
   - 当批准后执行失败时：
     - 先把失败评论写回 store
     - 再发布 `proposal.execution_failed`
     - 最后确保 replication 仍反映最终 proposal 快照

3. 生命周期 topic 的 payload 构造应独立于 replication payload 构造，避免两个职责继续共享一个“万能 payload builder”。

### 4.2 Frontend：接入 proposal signal

关键入口：

- [src/lib/services/signal-handlers.ts](../../src/lib/services/signal-handlers.ts)
- [src/ui/hooks/useSignalStream.ts](../../src/ui/hooks/useSignalStream.ts)

实现要求：

1. 在 `signal-handlers.ts` 中补 proposal payload 类型和 topic 分发分支。
2. 在 `useSignalStream.ts` 中补 proposal 分支：
   - replication -> `notifyProposalDataChanged()`
   - lifecycle -> `emitProposalLifecycle(...)`
3. proposal 的 signal 接线不应绕过 `useSignalStream` 另开第二条 SSE 连接。

### 4.3 Frontend：补轻量 proposal notifier / coordinator

建议新增：

- `src/lib/services/proposal-data-change.service.ts`
- `src/lib/services/proposal-lifecycle.service.ts`
- `src/ui/app/components/ProposalNotificationCoordinator.tsx`

实现要求：

1. `proposal-data-change.service.ts`
   - 提供 `subscribeProposalDataChanges()` 与 `notifyProposalDataChanged()`
   - 不负责缓存 proposal 数据

2. `proposal-lifecycle.service.ts`
   - 提供 `subscribeProposalLifecycle()` 与 `emitProposalLifecycle()`
   - 只负责事件派发，不做 UI 决策

3. `ProposalNotificationCoordinator`
   - 挂在根路由壳层（当前为 `src/routes.tsx`，因为需要 router context）
   - 使用当前路由判断是否抑制普通 toast
   - 统一处理 toast 文案与失败提示

### 4.4 UI：请求箱与角标改为“signal 优先，polling 兜底”

关键入口：

- [src/ui/app/pages/proposals/ProposalInboxPage.tsx](../../src/ui/app/pages/proposals/ProposalInboxPage.tsx)
- [src/ui/app/components/ProposalNotificationBadge.tsx](../../src/ui/app/components/ProposalNotificationBadge.tsx)

实现要求：

1. `ProposalInboxPage`
   - 保留初次加载与 30 秒轮询
   - 新增订阅 `subscribeProposalDataChanges()`
   - 收到变更通知后走现有 `loadProposals({ silent: true })`

2. `ProposalNotificationBadge`
   - 保留现有 pending-only 计数逻辑
   - 新增订阅 `subscribeProposalDataChanges()`
   - 收到变更通知后立即刷新 pending count

3. 不在本轮把 badge 改成基于本地 store 的派生值，避免引入额外状态主权。

## 5. 验收与测试

### 5.1 RT 验收

- 创建 proposal 时：
  - 发出 `proposal.created`
  - 发出 `proposal.replication.upserted`
- proposal 状态变化时：
  - 发出 `proposal.status_changed`
  - `fromStatus / toStatus` 正确
- proposal 批准后执行失败时：
  - 失败评论已写回 proposal
  - 发出 `proposal.execution_failed`
  - replication 看到的是包含失败评论的最终 proposal 快照

### 5.2 Frontend 验收

- 收到 `proposal.replication.upserted` 后：
  - 请求箱无需等 30 秒即可刷新
  - 角标无需等 30 秒即可刷新
- 收到 `proposal.created` 后：
  - 非 `/proposals` 路由出现新提案 toast
- 收到 `proposal.status_changed` 后：
  - 非 `/proposals` 路由出现状态变化 toast
- 收到 `proposal.execution_failed` 后：
  - 任意路由都出现高优先级失败 toast

### 5.3 测试清单

建议补以下自动化测试：

1. Rust：
   - `routes::proposals` topic 发布测试
   - 批准后执行失败的 lifecycle + replication 顺序测试

2. TypeScript：
   - `signal-handlers.ts` proposal topic 分发测试
   - `useSignalStream` proposal replication / lifecycle 接线测试
   - `ProposalNotificationCoordinator` toast 抑制测试
   - `ProposalNotificationBadge` signal-driven refresh 测试

### 5.4 人工验收场景

1. 创建一条 `pending` proposal
   - badge 立即增加
   - 非 `/proposals` 页面出现新请求提示
2. 将 proposal 变为 `in_review / approved / rejected / snoozed`
   - 请求箱立即刷新
   - 非 `/proposals` 页面收到状态变化提示
3. 批准一条会执行失败的 proposal
   - proposal 中出现失败评论
   - 任意路由出现失败 toast
4. 断开 signal 或外部 RT 不支持 lifecycle topic 时
   - 页面和角标仍能在 polling 周期内恢复正确状态

## 6. 后续拆分建议

本计划落地后，后续应继续拆出两条 follow-up：

1. **系统通知 / 移动端后台提醒**
   - 浏览器 Notification / Tauri 原生通知 / 手机后台提示音
2. **proposal 结构化 history / governance event 深化**
   - 让 lifecycle topic 与 proposal history / 审计轨更紧密收敛，继续向 `#922` 推进
