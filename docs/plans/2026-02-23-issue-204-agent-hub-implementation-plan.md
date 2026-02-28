# GH#204 Agent Hub 全视图实现计划（Implementation Plan）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 `pencil/eventlog-ui-design.pen` 像素级还原 Agent Hub 全视图（拓扑/列表/设备、Agent/Actor 详情、对话流式输出、市场浏览、添加节点弹窗），并完成 mock/real adapter 零上层改动切换。

**Architecture:** 新增 Agent Hub 领域契约（port + types + service），由 `bootstrap.ts` 注入 mock 或 real adapter；页面统一通过 service 取数与交互，不在 UI 写环境分支判断。路由层扩展 `/agents/*` 子路由，保持现有 `New UI` 布局与底部导航模式。

**Tech Stack:** React 18 + TypeScript + TanStack Router + Zustand（若需要）+ Vitest + Playwright + Bun。

---

## 设计稿锚点（Pencil Node IDs）

- `LxbUp`: Agent Hub - 拓扑视图
- `pVisN`: Agent Hub - 拓扑视图（节点选中态）
- `Kn7SD`: Agent Hub - 列表视图
- `hjRST`: Agent Hub - 设备视图
- `BUKXz`: Agent Hub - 添加节点（含市场）
- `bSWUQ`: Agent 详情 - 日报Agent
- `ockaZ`: Actor 详情 - 定时唤醒
- `Rw8LA`: Agent 对话 - 日报Agent
- `KWsUv`: 市场 - 浏览

## 任务 1：建立 Agent Hub 领域契约（types + port）

**Files:**
- Create: `src/lib/types/agent-hub.ts`
- Modify: `src/lib/types/index.ts`
- Create: `src/lib/environment/interfaces/agent.port.ts`
- Test: `tests/unit/agent-hub/agent-types-contract.issue204.test.ts`

**Step 1: 写失败测试（RED）**
- 新增契约测试，先引用未实现的 `agent-hub` 类型/port，验证字段覆盖三视图 + 详情 + 市场 + 对话。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/agent-hub/agent-types-contract.issue204.test.ts`
- Expected: FAIL（模块不存在/导出缺失）

**Step 3: 最小实现（GREEN）**
- 实现最小可用类型：`AgentNode / ActorNode / DeviceViewModel / MarketItem / ChatMessageChunk` 等。
- 实现 `IAgentPort`（或等价命名）接口声明。

**Step 4: 运行测试确认通过**
- Run: `bun vitest tests/unit/agent-hub/agent-types-contract.issue204.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/types/agent-hub.ts src/lib/types/index.ts src/lib/environment/interfaces/agent.port.ts tests/unit/agent-hub/agent-types-contract.issue204.test.ts`
- `git commit -m "feat(agent-hub): add domain types and port contract for issue-204"`

## 任务 2：实现 mock fixture + mock adapter + web adapter

**Files:**
- Create: `src/lib/adapters/mock/fixtures/agent-hub.ts`
- Create: `src/lib/adapters/mock/agent-mock-adapter.ts`
- Create: `src/lib/adapters/agent-web-adapter.ts`
- Test: `tests/unit/adapters/agent-mock-adapter.issue204.test.ts`
- Test: `tests/unit/adapters/agent-web-adapter.issue204.test.ts`

**Step 1: 写失败测试（RED）**
- 为 mock adapter 写读取拓扑/列表/设备、详情、市场、对话流式输出行为测试。
- 为 web adapter 写本地存储读取回退测试。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 按 Pencil 文案与结构落地 fixture。
- mock adapter 返回深拷贝数据，支持流式 chunk 生成。
- web adapter 提供真实数据占位（默认空/最小 seed）。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/lib/adapters/mock/fixtures/agent-hub.ts src/lib/adapters/mock/agent-mock-adapter.ts src/lib/adapters/agent-web-adapter.ts tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts`
- `git commit -m "feat(agent-hub): add mock and web adapters with fixtures for issue-204"`

## 任务 3：bootstrap/environment 注入 agent adapter（mock/real）

**Files:**
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/environment/environment.ts`
- Test: `tests/unit/environment/bootstrap.test.ts`

**Step 1: 写失败测试（RED）**
- 在 bootstrap 测试先断言 `useMockData=true` 时注入 `AgentMockAdapter`，否则注入 `AgentWebAdapter`。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/environment/bootstrap.test.ts`
- Expected: FAIL（agent adapter 未注入）

**Step 3: 最小实现（GREEN）**
- 扩展 `RuntimeBootstrapResult` + `Environment` 暴露 `agent` 能力。
- 无上层页面分支改动（zero upper-level branching）。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/lib/environment/bootstrap.ts src/lib/environment/environment.ts tests/unit/environment/bootstrap.test.ts`
- `git commit -m "feat(agent-hub): wire agent adapter in bootstrap and environment"`

## 任务 4：Service 层统一（避免页面直接碰 adapter）

**Files:**
- Create: `src/lib/services/agent-hub.service.ts`
- Modify: `src/lib/services/index.ts`
- Test: `tests/unit/services/agent-hub.service.issue204.test.ts`

**Step 1: 写失败测试（RED）**
- 先写 service 测试，断言页面需要的读取方法与流式方法都通过 `env.agent` 转发。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/services/agent-hub.service.issue204.test.ts`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 实现 `getAgentHubService()` 单例与 `AgentHubService` 接口。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/agent-hub.service.ts src/lib/services/index.ts tests/unit/services/agent-hub.service.issue204.test.ts`
- `git commit -m "feat(agent-hub): add service facade for zero upper-layer adapter switching"`

## 任务 5：实现主页面 `/agents`（拓扑/列表/设备 + 添加节点弹窗）

**Files:**
- Modify/Create: `src/ui/new/pages/AgentsPage.tsx`
- Create: `src/ui/new/pages/agents/components/*`（按需拆分）
- Test: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`

**Step 1: 写失败测试（RED）**
- 断言视图三态切换、节点选中高亮与弱化、添加节点弹窗打开关闭、进入市场按钮。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 严格对齐 `LxbUp / pVisN / Kn7SD / hjRST / BUKXz` 的核心尺寸与视觉 token：
  - 393 宽画布、Header/Toggle、列表分组卡、设备卡、Overlay + Bottom Sheet。
- 给可测节点补 `data-testid`。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/ui/new/pages/AgentsPage.tsx src/ui/new/pages/agents/components tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- `git commit -m "feat(agent-hub): implement topology/list/device views and add-node sheet"`

## 任务 6：实现详情页（Agent + Actor）

**Files:**
- Create: `src/ui/new/pages/agents/AgentDetailPage.tsx`
- Create: `src/ui/new/pages/agents/ActorDetailPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx`

**Step 1: 写失败测试（RED）**
- 断言 Hero 卡、分区卡片、CTA（与 Agent 对话）和返回导航。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 严格对齐 `bSWUQ / ockaZ` 的版式（卡片圆角、分隔、统计排布、文案层级）。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/ui/new/pages/agents/AgentDetailPage.tsx src/ui/new/pages/agents/ActorDetailPage.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx`
- `git commit -m "feat(agent-hub): implement agent and actor detail pages"`

## 任务 7：实现对话页（流式输出）+ 市场浏览页

**Files:**
- Create: `src/ui/new/pages/agents/AgentConversationPage.tsx`
- Create: `src/ui/new/pages/agents/AgentMarketPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx`

**Step 1: 写失败测试（RED）**
- 对话页：断言消息气泡、输入栏、发送后出现流式 chunk 增量更新。
- 市场页：断言搜索框、分类 tabs、推荐卡片列表。

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 按 `Rw8LA / KWsUv` 对齐布局与 token。
- 通过 service 的 stream API 做 chunk 渐进渲染（非一次性替换）。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/ui/new/pages/agents/AgentConversationPage.tsx src/ui/new/pages/agents/AgentMarketPage.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx`
- `git commit -m "feat(agent-hub): implement streaming chat and market browse pages"`

## 任务 8：路由接线 + 设置页 mock toggle 验证

**Files:**
- Modify: `src/routes-new.tsx`
- Modify (按需): `src/ui/new/pages/NewSettingsPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-routing.issue204.test.ts`
- Test (按需补充): `tests/unit/settings/settings-mock-data-toggle.issue204.test.tsx`

**Step 1: 写失败测试（RED）**
- 断言新增路由：
  - `/agents`
  - `/agents/agent/$agentId`
  - `/agents/actor/$actorId`
  - `/agents/chat/$agentId`
  - `/agents/market`

**Step 2: 运行测试确认失败**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-routing.issue204.test.ts`
- Expected: FAIL

**Step 3: 最小实现（GREEN）**
- 完成 route lazy import 与页面接线。
- 保持“使用测试数据”开关在开发者区可用。

**Step 4: 运行测试确认通过**
- 同上命令，Expected: PASS

**Step 5: Commit**
- `git add src/routes-new.tsx src/ui/new/pages/NewSettingsPage.tsx tests/unit/ui/agent-hub/agent-routing.issue204.test.ts tests/unit/settings/settings-mock-data-toggle.issue204.test.tsx`
- `git commit -m "feat(agent-hub): wire routes and keep settings mock-data toggle"`

## 任务 9：Playwright 自动化（issue204 独立端口）

**Files:**
- Create: `tests/e2e/playwright.issue204.config.ts`
- Create: `tests/e2e/agent-hub.issue204.test.ts`
- Modify: `package.json`（新增 `test:e2e:issue204` script）

**Step 1: 写失败 E2E（RED）**
- 先写测试覆盖：
  - 三视图切换
  - 节点选中态
  - 添加节点弹窗 + 市场入口
  - 详情跳转
  - 对话流式输出

**Step 2: 运行确认失败**
- Run: `bun run test:e2e:issue204`
- Expected: FAIL

**Step 3: 最小实现修正（GREEN）**
- 补充稳定 selector/testid 与交互细节，消除 flake。

**Step 4: 运行确认通过**
- Run: `bun run test:e2e:issue204`
- Expected: PASS

**Step 5: Commit**
- `git add tests/e2e/playwright.issue204.config.ts tests/e2e/agent-hub.issue204.test.ts package.json`
- `git commit -m "test(agent-hub): add issue-204 playwright e2e coverage"`

## 任务 10：全量验证 + PR 进度评论 + 评审评论

**Files:**
- Create: `docs/pr/issue-204-progress-comment.md`
- Create: `docs/pr/issue-204-review-comment.md`

**Step 1: 运行验证**
- `bun vitest tests/unit/agent-hub tests/unit/environment/bootstrap.test.ts tests/unit/settings/settings-mock-data-toggle.issue204.test.tsx`
- `bun run test:e2e:issue204`
- `bun run build`

**Step 2: 填写 PR 进度评论（证据）**
- 写入本轮变更、测试命令、关键输出摘要。

**Step 3: 请求并执行评审（review）**
- 执行代码评审（按严重级别给 findings）。
- 修复后再次验证并更新评论。

**Step 4: Commit**
- `git add docs/pr/issue-204-progress-comment.md docs/pr/issue-204-review-comment.md`
- `git commit -m "docs(agent-hub): add issue-204 progress and review evidence comments"`

## PR / Issue 评论发布流程

1. 若尚无 PR，先创建 draft PR（base: `dev`，head: `vk/5574-gh-204-feat-agen`）。
2. 先发计划评论：
   - `bun run gh:comment -- --type issue --number 204 --file docs/pr/issue-204-plan-comment.md`
   - `bun run gh:comment -- --type pr --number <PR号> --file docs/pr/issue-204-plan-comment.md`
3. 每个任务完成后更新 PR 进度评论（追加或新建）。
4. 最终发布评审结论评论（Approve / 需修复项）。

## 完成定义（Definition of Done）

- UI 视觉与布局对齐上述 9 个 Pencil 节点（关键尺寸/间距/圆角/色值/层级）。
- `mock-data` 开关下，无上层页面改动即可切换 mock/real adapter。
- 单测 + E2E + build 全通过，并给出命令与结果证据。
- PR 中包含：计划评论、阶段进度评论、最终评审评论。

