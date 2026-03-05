## [Follow-up] M2 修复计划（已审批并执行）

针对人工复测反馈，本轮修复目标：

1. 暗色模式下拓扑画布适配（节点/边可见）
2. 关闭右下角 MiniMap（避免遮挡）
3. 无 runtime host 时避免“空白拓扑/空白路由”
4. 兼容纯 Web + Runtime 1950 端口开发模式

### 修复范围

- `AgentsPage` 拓扑渲染层：
  - React Flow 边/标签/网格增加暗色 token
  - 默认不渲染 MiniMap
- `AgentsPage` 数据层：
  - `useMockData=true` 时启用 mock 路由回退（避免空白）
  - 无保存 host 时增加 runtime 直连回退（优先候选端口，如 1950/1949）
  - 支持通过 localStorage 配置候选端口：`exomind:agentHubRuntimePorts`
- E2E：
  - 增加 MiniMap 关闭断言
  - 增加暗色可见性断言
  - 增加 mock 回退断言
  - 增加直连回退断言

### 执行方式

- 流程：TDD（先失败测试，再实现，再全量验证）
- 提交：分步 commit（计划、修复）
- PR 状态：保持 Draft（未就绪，待人工复测）

### 计划文件

- `docs/plans/2026-03-04-issue-245f-m2-agent-hub-followup-fix-plan.md`
