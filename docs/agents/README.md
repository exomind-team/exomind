# docs/agents/

本目录承载**文档层**的 Agent 契约，而不是可执行 agent 资产本身。

## 目录职责

- 源码工作目录里的开发 Agent 合同：项目根目录 [AGENTS.md](../../AGENTS.md)
- 用户侧 / runtime agent 契约： [runtime-agent-contract.md](runtime-agent-contract.md)
- 专项 agent 文档：例如 [Review Agent 索引](../../agents/review-agent/references/index.md)

## 与 `/agents`、`/skills` 的关系

1. `/agents` 与 `/skills` 放的是可执行资产、技能包和流程定义。
2. `docs/agents/` 放的是文档化契约、行为边界和 prompt 设计说明。
3. Claude Code 通过 `.claude/skills` 和 `.claude/agents` 符号链接发现运行资产；这不替代文档契约。
