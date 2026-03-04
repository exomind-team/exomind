## M2 执行计划（待审批）

本 PR 将交付 Agent Hub 的两项能力：

1. 列表视图接入 RT `GET /signal-routes` 真实路由数据
2. 拓扑视图改为 React Flow，展示信号 Topic -> Target 的方向图

### 范围

- M2.1:
  - `AgentsPage` 新增“信号路由”列表 Section
  - 展示 `topic -> target_type + target_ref`
  - 展示状态 `active/inactive`
- M2.2:
  - 使用 `@xyflow/react` 渲染拓扑
  - 节点类型：Topic（椭圆）、Agent（矩形）、Actor（圆角矩形）、Frontend（菱形）
  - 边带方向箭头
  - 数据来源：`/signal-routes + /agents`

### TDD 与提交策略

- 先写失败测试，再最小实现，再回归通过
- 每个子任务至少一个独立 commit（最终 squash merge）
- 计划 -> 实现 -> E2E -> 评审，均写入 PR 评论并保留证据

### 验收映射

- [ ] 列表视图展示 5+ 条真实路由（非 mock）
- [ ] 拓扑展示关键链路：
  - `user.input.text -> classifier`
  - `user.input.text -> eventlog`
  - `session.end -> reviewer`
- [ ] 节点可拖拽、画布可缩放
- [ ] 桌面端与移动端可查看

### 计划文件

- `docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md`

---

请审批：回复“批准计划”后我开始进入 TDD 编码阶段。
