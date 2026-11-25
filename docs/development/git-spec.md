# Git 与 worktree 规范

本页维护分支、工作区和交付内容的约定。源码开发者同时遵循[仓库 Agent 合同](../../AGENTS.md)。

## 分支管理规范

| 分支 | 用途 | 操作约定 |
|---|---|---|
| `main` | 公开发行 | 通过审核与发行流程接收变更，已公开的标签固定在原提交 |
| `dev` | 通用开发线 | 每个任务围绕一个目标，提交前验证相关行为 |
| `dev-0.6` | 0.6 系列开发与候选验证 | 按产品线选择正确基线；应用源码、构建请求、制品与设备结果各有证据 |
| `feature/*`、`refactor/*`、`hotfix/*`、`release/*` | 隔离具体功能、重构、紧急修补或发行准备 | 从该任务指定的基线建立，合并目的地与源产品线一致 |

开始工作时核对自身分支和他人尚在进行的修改。变更以单一逻辑目标组成可审阅提交。提交标题采用小写类型加简短说明，例如 `fix(beta): preserve the active draft`。已推送历史按不可变处理。安装 `jj` 的环境沿用既有 bookmark 和提交约定。当前各分支的服务端保护配置以 GitHub 仓库设置为准。[仓库操作细节](repo-agent-workflow.md)

```sh
git status --short --branch
git log -1 --oneline
git diff --check
```

### 重构与发布

重构提案说明目标、现有行为、失败反例、兼容和回退。按用户给定的范围实施并分别验证。β28 的代码简化先由接手 Agent 提请用户审阅。[简化审阅计划](../plans/2026-11-25-beta28-maintainer-simplification.md)

0.6 Beta 候选锁记录应用源码。Actions 的工作流提交、build-info 和下载的制品应能对账。创建公开 Release 走发行授权和标签流程，紧急修补也须保留验证与审阅依据。[版本状态](../AI-CONTEXT.md) · [构建指南](../../BUILD.md) · [发布治理](../../skills/release-governance/SKILL.md)

## Worktree 使用规范

默认在任务指定的工作区推进。用户或项目明确要求隔离 checkout 时，先核对基线与已有工作区。每个工作区独立选择测试端口、应用数据根及构建输出。Git 对象库共享，工作文件、依赖和构建产物仍占用磁盘空间。

```sh
git worktree list --porcelain
git status --short --branch
```

经授权创建或退出 worktree 时，使用当前宿主管理的入口，保留分支名、基线和目录的对应关系。清理前在目标工作区检查未提交文件和独有提交。并行工作保留其他 checkout 的改动，Windows 符号链接与实例配置按各自宿主验证。[端口与实例](port-env-configuration.md)

### Windows 符号链接

`.claude/agents`、`.claude/skills`、`.codex/agents` 和 `.codex/skills` 在 Git 中是相对符号链接。Windows checkout 先确认 Developer Mode 或对应创建权限，再核对仓库 `core.symlinks` 与实际链接类型。

```sh
git config --get core.symlinks
git ls-files -s -- .claude/agents .claude/skills .codex/agents .codex/skills
```

## AI 生成内容管理

`agent-output/` 是本地工作材料，按[仓库忽略规则](../../.gitignore)处理。供后续维护的说明归入 `docs/` 的相应入口，并清楚标记草案、已确认合同或实际验收。私有资料、凭据、设备诊断原件、安装包及临时转录保存在批准的本机位置。提交时只选择本次已审阅的文件。

历史分支示例及 2026 年 3 月的整理记录可通过 [Git 中的原版本](https://github.com/exomind-team/exomind/blob/4a241cebe19078305e751cc4293db98ae9a90f7d/docs/development/git-spec.md) 查阅。
