# [GH#204] Agent Hub 实现进度更新（R9-R10）

## R9：Playwright 专项覆盖（RED -> GREEN）
- 提交：`e16fb3e`
- 变更：
  - 新增 `tests/e2e/playwright.issue204.config.ts`（固定 `1420` 端口，`reuseExistingServer: true`）
  - 新增 `tests/e2e/agent-hub.issue204.test.ts`
  - 修复列表页到详情页点击（`agent-list-item-agent-daily` 可正确跳转）
- RED 证据（历史失败）：
  - `getByTestId('agent-list-item-agent-daily')` 找不到，E2E 失败
- GREEN 结果：
  - `bun run test:e2e:issue204` -> `2 passed`

## R10：Pencil 视觉对齐补强（拓扑/列表/设备/详情/对话/市场）
- 提交：`ee91158`
- 变更范围：
  - `src/ui/new/pages/AgentsPage.tsx`
  - `src/ui/new/pages/agents/AgentDetailPage.tsx`
  - `src/ui/new/pages/agents/ActorDetailPage.tsx`
  - `src/ui/new/pages/agents/AgentConversationPage.tsx`
  - `src/ui/new/pages/agents/AgentMarketPage.tsx`
  - `tests/unit/ui/agent-hub/*.issue204.test.tsx`
  - `tests/e2e/agent-hub.issue204.test.ts`
- 关键对齐点：
  - 拓扑：绝对定位画布 + SVG 连线 + 选中高亮/非关联淡化
  - 列表：分类筛选条、前导图标、Chevron、分组计数样式
  - 设备：总览卡（CPU/MEM/Latency）+ 分组设备卡
  - 详情/对话/市场：头部结构、信息层级、输入栏/搜索栏、市场卡片作者行

## TDD 与验证证据
### 1) UI 单测（先红后绿）
```bash
bun vitest tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx
```
结果：`3 files, 6 tests passed`

### 2) issue-204 全链路单测
```bash
bun vitest tests/unit/agent-hub tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/agent-hub.service.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx tests/unit/ui/agent-hub/agent-routing.issue204.test.ts
```
结果：`9 files, 24 tests passed`

### 3) Playwright issue204 专项
```bash
bun run test:e2e:issue204
```
结果：`2 passed`

### 4) 构建校验
```bash
bun run build
```
结果：构建成功（仅保留既有 chunk size / dynamic import 警告，无阻断错误）

## 本轮新增提交（按步骤提交）
- `ee91158` feat(agent-hub): polish issue-204 full views to match pencil screens

