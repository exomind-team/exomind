# AGENTS.md

本文件给项目内自动化 Agent 使用，执行规范以 `CLAUDE.md` 为准。

## 目标

1. `dev` 是开发主线。
2. `main` 是生产发布线，仅用于可发布版本分发。

## 分支策略

1. 功能改动使用 `feature/issue-<id>-<slug>` 或 `feature/<topic>`。
2. 修复改动使用 `fix/issue-<id>-<slug>` 或 `fix/<topic>`。
3. 文档改动使用 `docs/<topic>`。
4. 一条分支只处理一个主要目标，禁止把无关改动混在同一 PR。

## PR 与合并

1. 默认向 `dev` 发起 PR。
2. `main` 只接受 `dev -> main` 的发布 PR。
3. 合并前至少执行：
   - `bun run build`
4. 若有功能行为变更，需补充并运行相关测试（单测或 E2E）。

## 分支清理

1. PR 合并后删除远程分支。
2. 同步删除本地分支与对应 worktree。
3. 仅长期保留 `dev` 与 `main`。

## 提交范围约束

1. 不提交调试产物、临时报告、截图缓存。
2. E2E 脚本应保留在 `tests/e2e/`，测试报告目录应忽略。
3. 提交信息应直接描述变更目的，避免空泛描述。

## Agent 工作流程记忆

1. 开始任务先检查分支与工作区：`git status -sb`、`git branch --show-current`。
2. 问题排查按固定顺序执行：读 issue → 明确复现路径 → `rg` 定位代码 → 锁定根因 → 给出最小修复方案。
3. 涉及 Issue 的开发，统一先开分支：`feature/issue-<id>-<slug>` 或 `fix/issue-<id>-<slug>`。
4. PR 评论必须包含五项：复现步骤、根因分析、修复方案、验证方法、风险与回归点。
5. 完成前至少做一次针对性验证（相关单测/E2E 或 `bun run build`），再提交和推送。

