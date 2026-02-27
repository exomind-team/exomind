# [GH#204] 进度补充（R12：修复暗色白底 + mock 切换后网络无数据）

## 问题复现
1. `Agent` 页面在暗色主题下仍显示浅色背景（白底风格）。
2. 当 `useMockData=false` 先进入 `/agents` 初始化环境后，再在设置页切到 `useMockData=true`，返回 `Agent` 页面仍无 mock 拓扑数据。

## 根因定位
1. **暗色白底**：`src/ui/new/pages/AgentsPage.tsx` 及详情/对话/市场页面大量容器只写了浅色类（`bg-white / bg-[#FAF7F5]`），缺少 `dark:*`。
2. **mock 切换不生效**：`ExoMindEnvironment` 是单例，首次初始化后固定 `agent/task adapter`；切换 mock flag 后没有同步刷新 adapter。

## TDD（先红后绿）
### RED（先写失败测试）
- 新增：
  - `tests/unit/environment/environment-mock-data-sync.issue204.test.ts`
- 更新：
  - `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
  - `tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx`
  - `tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx`

红灯命令：
```bash
bun vitest tests/unit/environment/environment-mock-data-sync.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx
```
结果：`4 files failed, 6 tests failed`

### GREEN（最小修复后通过）
修复点：
1. `src/lib/environment/environment.ts`
   - 增加运行时 `mock-data` 同步逻辑；
   - `getInstance()` 每次返回前检查开关变化，若变化则重建并替换 `task/agent adapter`。
2. Agent Hub 全链路页面补齐暗色样式：
   - `src/ui/new/pages/AgentsPage.tsx`
   - `src/ui/new/pages/agents/AgentDetailPage.tsx`
   - `src/ui/new/pages/agents/ActorDetailPage.tsx`
   - `src/ui/new/pages/agents/AgentConversationPage.tsx`
   - `src/ui/new/pages/agents/AgentMarketPage.tsx`

绿灯命令：
```bash
bun vitest tests/unit/environment/environment-mock-data-sync.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx
```
结果：`4 files passed, 8 tests passed`

## Playwright 自动化回归
新增 E2E 场景：
- 文件：`tests/e2e/agent-hub.issue204.test.ts`
- 用例：`Issue #204 Agent Hub runtime toggle（运行时切换测试数据）`
- 校验点：
  1. 先 `useMockData=false` 进入 `/agents`（无拓扑数据）；
  2. 不刷新页面，去设置页切换 `useMockData=true`；
  3. 回到 `/agents` 出现 `agent-topology-node-agent-daily`；
  4. 校验暗色背景计算值 `rgb(12, 10, 9)`。

执行：
```bash
bun run test:e2e:issue204
```
结果：`3 passed`

## 最终验证
```bash
bun vitest tests/unit/agent-hub tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/environment/environment-mock-data-sync.issue204.test.ts tests/unit/services/agent-hub.service.issue204.test.ts tests/unit/services/agent-hub-service-mock-toggle.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx tests/unit/ui/agent-hub/agent-routing.issue204.test.ts tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx
bun run test:e2e:issue204
bun run build
```
结果：
- 单测：`12 files, 29 tests passed`
- E2E：`3 passed`
- Build：通过（仅既有 warning）

## 本轮提交
- `e962785` fix(agent-hub): sync mock toggle adapters and dark-mode surfaces
