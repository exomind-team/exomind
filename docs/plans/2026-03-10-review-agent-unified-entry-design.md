# Review Agent Unified Entry Design

**Goal:** 把审阅 Agent 的人类输入面收敛为一个统一 prompt，让 Agent 每轮都先运行路由脚本，自行判断下一步进入 discovery、review 或 idle-wait。

## 背景

当前实现虽然已经有恢复状态和 bootstrap 脚本，但人类仍然需要决定喂哪一份 prompt。这与“Agent 会话可能随时中断、恢复时人类不应假设当前阶段”的目标冲突。

## 设计结论

采用单一入口方案：

1. 人类侧只保留一份统一 prompt。
2. Agent 每轮启动时都先运行 `router` 脚本。
3. `router` 读取 `temp/pr-monitor/` 状态并结合 GitHub 当前事实，输出：
   - `action`
   - `reason`
   - `selectedPrNumber`
   - `sleepSeconds`
4. Agent 按 `router` 输出执行内部子流程：
   - `discovery`
   - `review`
   - `idle-wait`

## 目录调整

- 新增：
  - `docs/agents/review-agent/review-agent.prompt.md`
  - `docs/agents/review-agent/router-and-recovery.md`
  - `Scripts/review-agent/router-lib.ts`
  - `Scripts/review-agent/router.ts`
- 删除对外入口语义：
  - `docs/agents/review-agent/prompts/bootstrap.prompt.md`
  - `docs/agents/review-agent/prompts/discovery.prompt.md`
  - `docs/agents/review-agent/prompts/review.prompt.md`

## 保留内容

- `discovery-loop.md` 和 `review-loop.md` 继续保留，作为内部协议
- 状态文件与恢复规则继续保留
- `discovery.ts` / `review-loop.ts` 仍是执行子流程的脚本

## 为什么这样更稳

- 人类不再承担阶段判断责任
- 会话中断和恢复逻辑集中在脚本层，可测试
- prompt 更短、更稳定，不会随着阶段增多而分裂
- discovery/review 的内部协议仍可独立演进
