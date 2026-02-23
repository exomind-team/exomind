# [GH#204] 进度补充（R13：处理评审 P1 + Agent 标题字号）

## 本轮目标
1. 按评审修复 `P1`：`Agent/Actor` 详情空数据时不再永久“加载中”。
2. 按产品反馈调整：`Agent 网络` 页面标题字号与任务页保持一致。

## 根因与修复
### 1) 详情空数据永久 loading（P1）
- 根因：`detail === null` 同时被用于“正在加载”和“已加载但无数据”两种状态，导致无法区分。
- 修复：
  - `src/ui/new/pages/agents/AgentDetailPage.tsx`
  - `src/ui/new/pages/agents/ActorDetailPage.tsx`
  - 新增 `loading` 状态，分离三种渲染：
    - `loading`：显示“加载中”
    - `loaded + null`：显示空态（`未找到 Agent/Actor 详情`）+ 返回入口
    - `loaded + data`：正常详情页

### 2) Agent 页面标题过大
- 修复文件：`src/ui/new/pages/AgentsPage.tsx`
- 标题从 `text-[30px] font-bold` 调整为与任务页一致：`text-lg font-semibold`（并保持暗色样式）。

## TDD 证据（RED -> GREEN）
### RED（先失败）
- 新增失败断言：
  - `tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx`
    - `renders agent empty state when detail is missing`
    - `renders actor empty state when detail is missing`
  - `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
    - `uses task-page sized title`

失败命令：
```bash
bun vitest tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
```
失败结果：`2 files failed, 3 tests failed`

### GREEN（修复后通过）
```bash
bun vitest tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
```
通过结果：`2 files, 8 tests passed`

## 回归验证
```bash
bun vitest tests/unit/agent-hub tests/unit/ui/agent-hub/agent-actor-detail.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
bun run test:e2e:issue204
bun run build
```
结果：
- 单测：`3 files, 10 tests passed`
- E2E：`3 passed`
- Build：通过（仅既有 warning）

## 本轮提交
- `611593e` fix(agent-hub): handle empty detail states and align header size
