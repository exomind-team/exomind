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

## 端口与 Worktree 约定

1. 多个 worktree 并行开发时，必须为每个 worktree 分配独立端口（Web/HMR/PouchDB/ASR）。
2. `VITE_SYNC_SERVER_URL` 未设置时，前端会使用“当前浏览器 hostname + `EXOMIND_POUCHDB_PORT`”拼接同步地址。
3. 局域网联调时，优先设置 `EXOMIND_POUCHDB_HOST=0.0.0.0` 并显式设置 `VITE_SYNC_SERVER_URL=http://<LAN-IP>:<PORT>`。

## Agent 工作流程（执行清单）

1. 先在 issue 评论中给出方案与验收链路，再开始编码。
2. 新功能必须先补失败测试（单测/E2E），再写实现，再跑通过。
3. 新建 worktree 开发后，先执行依赖安装；`server/` 子项目使用 `bun install --omit optional`。
4. 端到端测试优先使用 `tests/e2e/playwright.issue*.config.ts` 的独立端口配置，避免污染主开发端口。
5. 完成后给出测试证据（命令 + 通过结果）并同步到 PR/Issue 评论。

