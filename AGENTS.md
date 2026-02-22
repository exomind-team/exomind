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
3. 同步服务默认仅监听 `127.0.0.1`（本地安全模式）；局域网联调时再显式设置 `EXOMIND_POUCHDB_HOST=0.0.0.0` 与 `VITE_SYNC_SERVER_URL=http://<LAN-IP>:<PORT>`。

## Agent 工作流程（执行清单）

1. 先在 issue 评论中给出方案与验收链路，再开始编码。
2. 新功能必须先补失败测试（单测/E2E），再写实现，再跑通过。
3. 新建 worktree 开发后，先执行依赖安装；`server/` 子项目使用 `bun install --omit optional`。
4. 端到端测试优先使用 `tests/e2e/playwright.issue*.config.ts` 的独立端口配置，避免污染主开发端口。
5. 完成后给出测试证据（命令 + 通过结果）并同步到 PR/Issue 评论。

## 图标刷新命令

- 全量刷新（推荐）：`bun run icon:all`
  - 用途：以 `app_qwen_icon.png` 为母版图（source icon，源图）同步并生成 Tauri + Web 全部图标。
- 分步命令（按需）：
  - `bun run icon:sync-source`：同步源图到 `src-tauri/app-icon.png`
  - `bun run icon:tauri`：生成 `src-tauri/icons/` 的桌面/移动图标资源
  - `bun run icon:web`：生成 `public/icons/` 的 Web 图标（16/32/180/192/512）

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
