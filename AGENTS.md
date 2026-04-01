# AGENTS.md

本文件给项目内自动化 Agent 使用，执行规范以 `CLAUDE.md` 为准。

## 开发环境定位（Termux / Web-first）

1. 默认开发环境是 **Termux**，默认执行链路是 **Web-first**（先保证 Web 端功能正确）。
2. 日常开发与联调优先使用 Node 工具链（`node` / `npx`），先完成 Web + 同步服务验证。
3. Tauri / Android 构建验证属于后置环节，在 Web 链路通过后再执行。
4. 默认联调端口：Web `5173`，同步服务 `6984`（多 worktree 并行时按约定分配独立端口）。

## 符号链接兼容（Windows / Linux）

1. 仓库中的 `.claude/agents`、`.claude/skills` 与 `.codex/skills` 依赖相对符号链接。
2. Windows 与 Linux 混合开发时，Git 必须启用符号链接支持：`git config --global core.symlinks true`，至少保证当前仓库 `git config --local core.symlinks true`。
3. Windows 端首次配置前应开启 Developer Mode 或使用具备创建符号链接权限的终端，否则 checkout 后可能退化为内容为 `../skills` 或 `../agents` 的普通文本文件。

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
3. 同步服务默认仅监听 `127.0.0.1`（本地安全模式）；局域网联调时再显式设置 `EXOMIND_POUCHDB_HOST=0.0.0.0` 与 `VITE_SYNC_SERVER_URL=http://<LAN-IP>:<PORT>`。

## Agent 工作流程（执行清单）

1. 先在 issue 评论中给出方案与验收链路，再开始编码。
2. 新功能必须先补失败测试（单测/E2E），再写实现，再跑通过。
3. 新建 worktree 开发后，先执行依赖安装；`server/` 子项目使用 `bun install --omit optional`。
4. 端到端测试优先使用 `tests/e2e/playwright.issue*.config.ts` 的独立端口配置，避免污染主开发端口。
5. 完成后给出测试证据（命令 + 通过结果）并同步到 PR/Issue 评论。
6. 执行中必须维护任务清单，持续更新进行中/完成状态。
7. 默认执行顺序：先改代码，再编译/测试，再启动服务联调，再提交推送。
8. 编译与测试（默认 Node 链路）：
   - `npx tsc --noEmit`
   - `npx vitest run <相关测试>`
9. 联调服务启动（Web-first）：
   - Web：`npx vite --host 0.0.0.0 --port 5173`
   - Sync：`EXOMIND_POUCHDB_HOST=0.0.0.0 EXOMIND_POUCHDB_PORT=6984 node server/pouchdb-server.js`
10. 服务启动后用 `curl` 验证可用性（至少 `HTTP 200`）：
   - `curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8`
   - `curl -sS -D - -o /dev/null http://127.0.0.1:6984 | head -n 8`
11. 推送后必须在 PR 评论同步变更摘要、测试命令、结果证据；若一个 PR 覆盖两个相关 issue，需同步更新 PR 描述。
12. 合并前先检查是否有新的 blocking review；无阻塞且关键回归通过后再合并到 `dev`。

## Multi-Agent 协作最佳实践（多代理协作）

1. 仅在任务可拆成 **2 个及以上相互独立子问题** 时启用 multi-agent（多代理）；共享同一文件或强顺序依赖的问题优先单线程处理。
2. 主代理（Lead，主控）负责关键路径：复现问题、维护计划、合并结论、最终改码与验收；子代理优先做只读分析或在明确边界内修改。
3. 拆分任务时按领域分工，例如：`Tauri window（窗口层）`、`React/Tailwind shell（前端壳层）`、`tests（测试）`、`runtime/service（运行时/服务）`，避免多个 agent 同时编辑同一文件。
4. 给每个子代理明确输入/输出：范围、禁止事项、预期产物（文件路径、根因排序、最小修复建议、测试证据）。
5. 不直接信任子代理“已修复/已通过”的口头结论；主代理必须重新检查 `git diff`、运行测试并在真实运行环境（如 Tauri MCP / Playwright）复核。
6. 子代理失败、超时或 413 时，主代理继续推进主线，并把任务切得更小后重派；不要让团队协作阻塞关键路径。
7. 提交前由主代理统一做 verification（验证）：至少覆盖相关 `tsc`、`vitest`、`Playwright` 或真实窗口几何/截图复核，再决定提交与推送。

## 当前协作补充约定（2026-03-13）

1. 用户日常直接使用 `dev` 分支；较大范围功能改动默认在独立 `worktree` + 独立分支中进行，避免影响 `dev` 的持续使用。
2. 单个中大型改动优先收敛为 `1 issue + 1 worktree + 1 PR`，非必要不再扩散新的子 issue。
3. 详细方案、边界、验收标准、流程讨论优先写入对应 GitHub issue；聊天窗口只保留简短任务摘要、当前状态和必要决策。
4. 与用户的默认交流长度应控制在“单个聊天窗口易读上限”附近，优先使用短段落、少层级、可快速扫读的表达。
5. Windows + Bun 的 worktree 场景下，类型检查优先使用 `bunx tsc --noEmit`；若 `npx tsc --noEmit` 未命中本地 TypeScript，不直接视为代码失败。

## 图标刷新命令

- 全量刷新（推荐）：`bun run icon:all`
  - 用途：以 `src-tauri/icons/icon.svg` 为母版图（source icon，源图）生成 Tauri + Web 全部图标，并同步 `src-tauri/app-icon.png` 兼容旧链路。
- 分步命令（按需）：
  - `bun run icon:tauri`：从 `src-tauri/icons/icon.svg` 生成 `src-tauri/icons/` 的桌面/移动图标资源
  - `bun run icon:sync-source`：把生成后的 `src-tauri/icons/icon.png` 同步到 `src-tauri/app-icon.png`
  - `bun run icon:web`：从 `src-tauri/icons/icon.svg` 生成 `public/icons/` 的 Web 图标（16/32/180/192/512）

## 发布流程

| Tag 格式 | 产出 | Release 类型 |
|---------|------|-------------|
| `build/v0.3.2-build.20260222T1430` | GitHub Release | Pre-release（可直接下载） |
| `release/v0.3.3` | GitHub Release | 正式版 |
| `release/v0.3.3-beta.1` | GitHub Release | Pre-release |

```bash
# 日常构建测试（自动时间戳，Releases 页面直接下载）
bun run build:tag

# 正式发版（先 bump 版本号到 package.json / tauri.conf.json / Cargo.toml，再打 tag）
git tag release/v0.3.3 && git push origin release/v0.3.3
```

版本号规范：
- 有功能/修复 → bump patch（0.3.x）
- 纯资源变更（图标等）→ 不单独 bump，随下一个功能版本一起发
