# [GH#204] 进度补充（R11：修复 Agent 无测试数据）

## 问题现象
- 在设置页切换「使用测试数据」后，Agent 页仍可能继续显示真实/空数据，不会立即切到 mock 数据。

## 根因
- `getAgentHubService()` 是单例；
- `AgentHubServiceImpl` 在构造时把 `ExoMindEnvironment.getInstance()` 固定到实例字段；
- 切换 mock flag 后，后续调用仍读旧 `agent` adapter。

## 修复
- 文件：`src/lib/services/agent-hub.service.ts`
- 调整为“每次调用动态读取当前 environment 的 `agent` port”：
  - 保留依赖注入路径（测试/显式传 env 时不变）
  - 默认路径不再冻结 adapter 来源，切换 flag 后可生效

## TDD 证据（RED -> GREEN）
1. 新增失败用例：
   - `tests/unit/services/agent-hub-service-mock-toggle.issue204.test.ts`
   - 用例模拟环境从 `webAgentPort` 切到 `mockAgentPort`
   - 修复前：第二次调用仍命中 web（失败）
2. 修复后回归通过：

```bash
bun vitest tests/unit/services/agent-hub-service-mock-toggle.issue204.test.ts tests/unit/services/agent-hub.service.issue204.test.ts
```

结果：`2 files, 3 tests passed`

## 全链路验证
```bash
bun vitest tests/unit/agent-hub tests/unit/adapters/agent-mock-adapter.issue204.test.ts tests/unit/adapters/agent-web-adapter.issue204.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/agent-hub.service.issue204.test.ts tests/unit/services/agent-hub-service-mock-toggle.issue204.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agent-chat-market.issue204.test.tsx tests/unit/ui/agent-hub/agent-routing.issue204.test.ts
bun run test:e2e:issue204
bun run build
```

结果：
- 单测：`10 files, 25 tests passed`
- E2E：`2 passed`
- Build：通过（仅既有 non-blocking warning）

## 本轮提交
- `1cef1a8` fix(agent-hub): refresh adapter source after mock-data toggle

