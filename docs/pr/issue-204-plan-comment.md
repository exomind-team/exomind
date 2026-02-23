# [GH#204] Agent Hub 全视图实施计划（待审批）

## 本次目标
- 严格对照 `pencil/eventlog-ui-design.pen` 像素级还原：
  - 拓扑视图（含节点选中态）
  - 列表视图
  - 设备视图
  - Agent 详情页
  - Actor 详情页
  - 对话页（流式输出）
  - 市场浏览页
  - 添加节点弹窗（含市场入口）
- 落地 mock 架构：
  - `src/config/mock-data.ts`（沿用）
  - `src/lib/adapters/mock/agent-mock-adapter.ts`（新增）
  - `bootstrap.ts` 根据 flag 注入 mock/real adapter（上层零改动）
- 全程执行：TDD（先红后绿）+ Playwright 自动化验证 + 分步 commit + PR 评审闭环。

## 设计稿锚点（Pencil Node IDs）
- `LxbUp` 拓扑
- `pVisN` 拓扑选中态
- `Kn7SD` 列表
- `hjRST` 设备
- `BUKXz` 添加节点（含市场）
- `bSWUQ` Agent 详情
- `ockaZ` Actor 详情
- `Rw8LA` 对话
- `KWsUv` 市场

## 执行分解（每步至少 1 个 commit）
1. 建立 Agent Hub 类型与 Port 契约（先测试后实现）。  
2. 实现 `agent-mock-adapter` + `agent-web-adapter` + fixtures。  
3. `bootstrap/environment` 注入 agent adapter（mock/real 切换）。  
4. 新增 `agent-hub.service.ts`，页面通过 service 访问数据。  
5. 实现 `/agents` 主页（三视图 + 节点选中态 + 添加节点弹窗）。  
6. 实现 Agent/Actor 详情页。  
7. 实现对话流式输出页 + 市场浏览页。  
8. 路由接线 `/agents/*` 并保留设置页「使用测试数据」开关能力。  
9. 新增 `tests/e2e/playwright.issue204.config.ts` + `agent-hub.issue204.test.ts`。  
10. 运行 `vitest + playwright + build`，发布进度评论与最终评审评论。  

## 验收链路
- 单测：契约、adapter、bootstrap 注入、service、页面结构与交互、路由接线。
- E2E：视图切换、节点选中、弹窗开关、详情跳转、市场浏览、对话流式输出。
- 构建：`bun run build` 通过。

## 过程约束
- 每一阶段完成后立即提交 commit，并推送到当前 PR 分支。
- PR 评论持续同步：
  - 计划评论（本条）
  - 阶段进度评论（含测试证据）
  - 最终评审评论（Findings + 结论）

## 请求审批
- 请确认是否按本计划开始实施。  
- 回复关键字：`批准执行`（如需调整我将先改计划再动代码）。

