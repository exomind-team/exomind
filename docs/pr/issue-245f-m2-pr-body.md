## 背景

Agent Hub 当前拓扑视图仍是静态布局，且列表视图未接入 SignalPool 路由真实数据，无法直接观察运行时路由状态与信号流向。

## 目标

- 列表视图：展示 RT `/signal-routes` 实时路由
- 拓扑视图：基于 React Flow 展示信号流向（Topic -> Agent/Actor/Frontend）

## 变更计划

1. 计划审批（本 PR 评论）
2. TDD 实现路由聚合与图构建
3. 接入 AgentsPage 列表与拓扑视图
4. Playwright 自动化验收（桌面 + 移动）
5. 评审与结果回写 PR 评论

## 验收标准

- [x] 列表视图展示 5+ 条真实路由
- [x] 拓扑图展示关键链路：
  - `user.input.text -> classifier / eventlog`
  - `session.end -> reviewer`
- [x] 节点可拖拽、画布可缩放
- [x] 桌面端和移动端均可查看

## 备注

- 每个阶段独立 commit（PR 最终 squash merge）
- 详细步骤见计划文档：
  - `docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md`
- 验收运行指令见进展评论：
  - `docs/pr/issue-245f-m2-progress-comment.md`
