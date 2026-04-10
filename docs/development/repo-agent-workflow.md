# Repo Agent Workflow

> 面向源码工作目录 Agent 的技术操作细节。是否必须执行某条规则，以 [AGENTS.md](../../AGENTS.md) 为准。

## 默认开发环境（Termux / Web-first）

1. 默认开发环境是 **Termux**，默认执行链路是 **Web-first**（先保证 Web 端功能正确）。
2. 日常开发与联调优先使用 Node 工具链（`node` / `npx`），先完成 Web + 同步服务验证。
3. Tauri / Android 构建验证属于后置环节，在 Web 链路通过后再执行。
4. 默认联调端口：Web `5173`，同步服务 `6984`（多 worktree 并行时按约定分配独立端口）。

## Issue 修复标准链路

1. 先在 issue 评论中给出方案与验收链路，再开始编码。
2. 新功能必须先补失败测试（单测 / E2E），再写实现，再跑通过。
3. 新建 worktree 开发后，先执行依赖安装；`server/` 子项目使用 `bun install --omit optional`。
4. 端到端测试优先使用 `tests/e2e/playwright.issue*.config.ts` 的独立端口配置，避免污染主开发端口。
5. 完成后给出测试证据（命令 + 通过结果）并同步到 PR / Issue 评论。
6. 执行中必须维护任务清单，持续更新进行中 / 完成状态。
7. 默认执行顺序：先改代码，再编译 / 测试，再启动服务联调，再提交推送。

### 编译与测试（默认 Node 链路）

```bash
npx tsc --noEmit
npx vitest run <相关测试>
```

### 联调服务启动（Web-first）

```bash
# Web
npx vite --host 0.0.0.0 --port 5173

# Sync
EXOMIND_POUCHDB_HOST=0.0.0.0 EXOMIND_POUCHDB_PORT=6984 node server/pouchdb-server.js
```

### 服务可用性验证

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
curl -sS -D - -o /dev/null http://127.0.0.1:6984 | head -n 8
```

## GitHub 评论发布与纠错章程（Windows / PowerShell）

1. 所有 PR / Issue 评论默认使用**简体中文**撰写；仅在线程已有明确英文要求时才切换语言。
2. 禁止直接用 PowerShell here-string、管道拼接或内联字符串把评论正文直接喂给 `gh pr comment` / `gh issue comment`。
3. 正确发布方式必须是：
   - 先把评论正文写入临时 Markdown 文件（UTF-8）
   - 本地回读该文件，确认语言、措辞、换行、代码块都正确
   - 再使用 `gh ... --body-file <temp-file>` 发布
4. 评论发布后必须二次验证：
   - 用 GitHub API 回读刚发布的评论正文，例如 `gh api repos/<owner>/<repo>/issues/comments/<id> --jq .body`
   - 确认线上存储的正文仍是**可读的简体中文**
5. 若发现评论正文语言错误、编码损坏或信息丢失：
   - 必须**编辑原评论本体**修复，不要新增一条“更正说明”评论替代
   - 编辑原评论时同样遵守“临时文件写入 -> 本地回读 -> GitHub 回读”的完整链路

## jj (Jujutsu) 兼容规范

**优先级**：开发者本机安装了 `jj` 时优先使用 `jj` 管理版本，否则沿用 Git。两者 colocated 共存，操作同一个 `.git` 仓库。

**不可变原则**：已推送到远端的提交视为不可变。不允许修改远端 bookmark（含）之前的修订。

### 常用命令

| 用户说 | jj 命令 | Git 等价 | 说明 |
|--------|---------|---------|------|
| 拆分 | `jj split` | `git rebase -i` | 将当前 change 拆成多个 |
| 描述 | `jj describe -m "..."` | `git commit -m "..."` | 给已有 change 写描述 |
| 推送 | `jj git push` | `git push` | 推送 bookmark 到远端 |
| 撤销 | `jj undo` | `git reset` | 撤销上一步操作 |
| 查看状态 | `jj st` / `jj log` | `git status` / `git log` | 查看工作区 / 历史 |
| 新建修订 | `jj new -m "..."` | `git commit`（空提交） | 封存当前 change，开始新 change |

更多 Git / worktree 规则见 [docs/development/git-spec.md](git-spec.md)。

## Multi-Agent 协作最佳实践

1. 仅在任务可拆成 **2 个及以上相互独立子问题** 时启用 multi-agent；共享同一文件或强顺序依赖的问题优先单线程处理。
2. 主代理（Lead）负责关键路径：复现问题、维护计划、合并结论、最终改码与验收；子代理优先做只读分析或在明确边界内修改。
3. 拆分任务时按领域分工，例如：`Tauri window`、`React/Tailwind shell`、`tests`、`runtime/service`，避免多个 agent 同时编辑同一文件。
4. 不直接信任子代理“已修复 / 已通过”的口头结论；主代理必须重新检查 `git diff`、运行测试并在真实运行环境复核。
5. 提交前由主代理统一做 verification：至少覆盖相关 `tsc`、`vitest`、`Playwright` 或真实窗口 / 截图复核。

## 图标刷新命令

- 全量刷新（推荐）：`bun run icon:all`
  - 用途：以 `src-tauri/icons/icon.svg` 为母版图生成 Tauri + Web 全部图标，并同步 `src-tauri/app-icon.png`
- 分步命令（按需）：
  - `bun run icon:tauri`
  - `bun run icon:sync-source`
  - `bun run icon:web`

## 发布流程

| Tag 格式 | 产出 | Release 类型 |
|---------|------|-------------|
| `v0.4.0` | GitHub Release assets + GitHub Pages `preview` 元数据 | Pre-release（预览版） |
| `v0.4.0 promotion` | 同一 tag / 同一 commit，仅切换 GitHub Release `prerelease=false` 并刷新 GitHub Pages `release` 元数据 | 正式版 |

```bash
# 创建单一发布 tag（会先校验 package.json / tauri.conf.json / Cargo.toml 版本一致）
bun run build:tag

# 推送唯一 tag，触发 GitHub Release + GitHub Pages
git push origin v0.4.0

# 正式发版：在 GitHub Actions 手动执行 workflow_dispatch，并传入 promote_tag=v0.4.0
```

版本号规范：

- 唯一版本号格式：`0.x.y`
- 唯一 tag 格式：`v0.x.y`
- `preview / release` 只作为 GitHub Release 状态与 GitHub Pages 元数据视图
- 有功能 / 修复：bump patch
- 纯资源变更（图标等）：不单独 bump，随下一个功能版本一起发
