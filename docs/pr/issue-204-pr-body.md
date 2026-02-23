# feat(agent-hub): 前端 UI 设计 + 实现 — 全视图 (GH#204)

## 目标
严格对照 `pencil/eventlog-ui-design.pen` 完成 Agent Hub 全视图 UI 实现，并保持 mock/真实数据适配可切换（上层零改动）。

## 实现内容
- Agent Hub 三视图：拓扑 / 列表 / 设备
- Agent 详情页、Actor 详情页
- 对话页（流式输出）
- 市场浏览页
- 添加节点弹窗（含市场入口）
- mock 架构：
  - `src/config/mock-data.ts`
  - `src/lib/adapters/mock/agent-mock-adapter.ts`
  - `src/lib/adapters/agent-web-adapter.ts`
  - `src/lib/environment/bootstrap.ts` 根据 flag 注入
  - `src/lib/services/agent-hub.service.ts` 对上层统一收口

## 关键技术点
- 拓扑画布使用绝对定位 + SVG 连线，实现节点高亮与非关联节点/边淡化。
- Settings 开发者区保留「使用测试数据」开关，切换后无需改页面代码。
- 路由接线：
  - `/agents`
  - `/agents/agent/$agentId`
  - `/agents/actor/$actorId`
  - `/agents/chat/$agentId`
  - `/agents/market`

## 测试与验证
- 单测：
  - `bun vitest tests/unit/agent-hub tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/agent-hub.service.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx tests/unit/ui/agent-hub/agent-routing.issue204.test.ts`
- E2E：
  - `bun run test:e2e:issue204`
- 构建：
  - `bun run build`

## 评审结论
- 详见 PR 评论：
  - 进度评论：`docs/pr/issue-204-progress-comment.md`
  - 评审评论：`docs/pr/issue-204-review-comment.md`
- 结论：Approve

