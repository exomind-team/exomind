# [GH#245f] M2 Agent Hub 信号路由 + 拓扑图进度更新

## 已完成范围
1. M2.1 列表视图接入 RT `GET /signal-routes` 真实数据：
   - `AgentsPage` 列表新增“信号路由”区块（`agent-signal-route-section`）
   - 展示 `topic`、`target_type + target_ref`、`active/inactive` 状态
2. M2.2 拓扑视图改造为 React Flow：
   - 使用 `@xyflow/react` 渲染信号流向（Topic/Agent/Actor/Frontend）
   - 边使用方向箭头、支持 active/inactive 样式
   - 数据由 `/signal-routes + /agents` 聚合构图
3. 交互与稳定性修复：
   - 为自定义节点补 `Handle`，确保边渲染
   - 连接 `useNodesState + onNodesChange`，拓扑节点支持拖拽状态更新
4. 自动化验收补齐：
   - 新增 issue245f 专项 E2E（桌面 + 移动）
   - 修复 CORS、等待策略与移动端浏览器配置稳定性

## 关键文件
- `src/ui/app/pages/AgentsPage.tsx`
- `src/ui/app/pages/agents-signal-topology.ts`
- `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- `tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`
- `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`
- `tests/e2e/playwright.issue245f.config.ts`
- `package.json`

## 验证与验收运行指令（可直接复现）
```bash
# 1) 单元测试（issue245f 相关）
bunx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx

# 2) E2E（桌面 + 移动）
bun run test:e2e:issue245f

# 3) TypeScript 校验
bunx tsc --noEmit --pretty false

# 4) 构建校验
bun run build
```

## 本轮结果
- Vitest：`3 files, 9 tests passed`
- Playwright：`4 passed`
- TSC：通过
- Build：通过

## 提交记录（按步骤）
- `57bb4b0` docs(plan): define m2 signal-routes + react-flow execution flow
- `e9e9837` test+feat(agent-hub): add signal graph builders from routes and agents
- `96f3450` test+feat(agent-hub): show real signal routes in list view
- `3095b0b` test+feat(agent-hub): render signal topology with react flow
- `8b923bf` fix+test(agent-hub): enable signal-flow edges and pass issue245f e2e

## 验收映射
- [x] 列表视图展示 5+ 条真实路由（非 mock）
- [x] 拓扑展示关键链路：
  - `user.input.text -> classifier`
  - `user.input.text -> eventlog`
  - `session.end -> reviewer`
- [x] 节点可拖拽、画布可缩放
- [x] 桌面端与移动端可查看
