# git-spec.md

> **生效日期**: 2026-02-03
> **版本**: v1.0
> **文档位置**: `pm/git-spec.md`
> **创建时间**: 2026-02-03

---

## 目录

1. [分支管理规范](#分支管理规范)
2. [worktree 使用规范](#worktree-使用规范)
3. [ai 生成内容管理](#ai-生成内容管理)

---

# 分支管理规范

> 本文档为 git 使用规范，整合了分支管理、worktree 使用等内容。

## 分支结构

```
main (生产环境)
  ↑     ↑
  │     └── hotfix/v1.2.1 (紧急修复)
  │
  └── dev (开发分支)
        ↑     ↑
        │     └── release/v1.3.0 (预发布)
        │
        └── feature/xxx-功能名称
```

### 分支说明

| 分支          | 角色     | 保护          | 生命周期 | 合并来源                     |
| ------------- | -------- | ------------- | -------- | ---------------------------- |
| `main`      | 生产环境 | ✅ 强制保护   | 永久     | `dev`, `hotfix/*`        |
| `dev`       | 开发主干 | ✅ 保护       | 永久     | `feature/*`, `release/*` |
| `feature/*` | 功能开发 | ❌ 可强制推送 | 临时     | `dev`                      |
| `release/*` | 预发布   | ❌ 可强制推送 | 临时     | `dev`                      |
| `hotfix/*`  | 紧急修复 | ❌ 可强制推送 | 临时     | `main`                     |

---

## 开发流程

### 1. 开始新功能

```bash
# 确保在 dev 上
git checkout dev
git pull origin dev

# 创建功能分支
git checkout -b feature/xxx-功能名称
```

### 2. 开发与提交

```bash
# 提交格式: [类型]: [简短描述] (类型使用小写)
git commit -m "feat: 添加用户登录功能"
git commit -m "docs: 更新项目文档"
git commit -m "fix: 修复登录页面崩溃问题"

# 常用类型 (小写)
# feat    - 新功能
# fix     - Bug 修复
# refactor - 重构 (不改变外在行为)
# perf    - 性能优化
# docs    - 文档更新
# chore   - 其他维护 (构建、依赖等)
# test    - 测试相关
# style   - 代码格式 (不影响语义)
# build   - 构建系统相关
# ci      - CI 配置相关
# revert  - 回滚提交
```

**提交规范**：
- ✅ 类型使用小写
- ✅ 描述简洁明了，首字母小写
- ✅ 冒号后有一个空格

### 3. 推送与合并

```bash
# 推送到远程
git push origin feature/xxx-功能名称

# 创建 Pull Request → 合并到 dev
# GitHub: https://github.com/exomind-team/exomind/pull/new/dev
```

### 4. 删除已完成的功能分支

```bash
# 本地删除
git branch -d feature/xxx-功能名称

# 远程删除
git push origin --delete feature/xxx-功能名称
```

---

## 重构流程

重构是 **改善代码内部结构而不改变外在行为** 的活动。

### 重构类型

| 类型                 | 影响范围      | 流程                                                   |
| -------------------- | ------------- | ------------------------------------------------------ |
| **代码级重构** | 单个文件/函数 | 直接在 feature 分支开发 → PR 到 dev                   |
| **模块级重构** | 多个文件/模块 | 创建 `refactor/模块名` 分支 → 充分测试 → PR 到 dev |
| **架构级重构** | 整个系统      | 参考 7层架构重构经验，分阶段进行                       |

### 重构最佳实践

```bash
# 1. 创建重构分支
git checkout dev
git pull origin dev
git checkout -b refactor/模块名

# 2. 先确保有测试覆盖
npm test  # 或 bun test

# 3. 小步重构，每次 commit 都要能运行
git commit -m "refactor: 提取 xxx 函数 [src/utils.ts]"

# 4. 完成重构后
git push origin refactor/模块名

# 5. 创建 PR 到 dev，必须有 code review
```

### 重构原则

- ✅ **小步提交**: 每次重构都要能正常运行
- ✅ **测试先行**: 先写测试，再重构
- ✅ **不混功能**: 纯粹重构，不添加新功能
- ✅ **随时可停**: 重构可以被中断而不丢失进度

---

## 版本发布流程

### 标准发布流程

```bash
# 1. 确定版本号
# - 大版本: BREAKING CHANGES → v2.0.0
# - 新功能: 向后兼容 → v1.2.0
# - Bug 修复: 向后兼容 → v1.2.1

# 2. 确保 dev 最新
git checkout dev
git pull origin dev

# 3. 创建预发布分支 (可选，用于测试)
git checkout -b release/v1.2.0

# 4. 更新版本号
# 方式A: 手动修改
# package.json, CHANGELOG.md

# 方式B: 使用 npm version
npm version patch  # 1.2.0 → 1.2.1
npm version minor  # 1.2.0 → 1.3.0
npm version major # 1.2.0 → 2.0.0

# 5. 更新 CHANGELOG
# 使用 conventional-changelog 自动生成

# 6. 合并到 main (重要：先删除 agent-output!)
git checkout main
rm -rf agent-output  # 删除 AI 生成内容（已在 dev 记录历史）
git commit -m "chore: 删除 agent-output 目录 (仅 main 分支)" --allow-empty
git merge release/v1.2.0 --no-ff -m "Release: v1.2.0"

# 7. 打标签
git tag -a v1.2.0 -m "Version 1.2.0"

# 8. 推送
git push origin main --tags

# 9. 删除预发布分支
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

### 版本号规则 (语义化版本)

```
vMAJOR.MINOR.PATCH

v2.1.3
│ │ └── PATCH (3): 向后兼容的 Bug 修复
│ └── MINOR (1): 向后兼容的新功能
└── MAJOR (2): 不兼容的 API 变更
```

| 场景     | 版本号   | 示例           |
| -------- | -------- | -------------- |
| 首次发布 | 1.0.0    | -              |
| 新功能   | MINOR +1 | 1.0.0 → 1.1.0 |
| Bug 修复 | PATCH +1 | 1.1.0 → 1.1.1 |
| 重大变更 | MAJOR +1 | 1.x.x → 2.0.0 |

### 发布检查清单

- [ ] 所有测试通过
- [ ] CHANGELOG 已更新
- [ ] 版本号已更新
- [ ] 文档已同步
- [ ] 标签已创建
- [ ] 部署验证通过

---

## 热修复流程

当生产环境出现 **紧急 bug** 时，使用 hotfix 分支：

```bash
# 1. 从 main 创建 hotfix 分支
git checkout main
git pull origin main
git checkout -b hotfix/v1.2.1

# 2. 修复问题
git commit -m "fix: 修复登录页面崩溃问题"

# 3. 合并到 main (紧急修复，可跳过测试)
git checkout main
git merge hotfix/v1.2.1 --no-ff -m "Hotfix: v1.2.1"

# 4. 打标签
git tag -a v1.2.1 -m "Hotfix v1.2.1"

# 5. 推送
git push origin main --tags

# 6. 合并回 dev (重要！)
git checkout dev
git merge hotfix/v1.2.1

# 7. 删除 hotfix 分支
git branch -d hotfix/v1.2.1
```

---

## 禁止操作

| 禁止                  | 说明                        |
| --------------------- | --------------------------- |
| ❌ 直接推送到 main    | 只能通过 PR 合并            |
| ❌ 强制推送 main/dev  | 保护分支禁止 force push     |
| ❌ 在 main 上开发     | 功能开发只能在 feature 分支 |
| ❌ 长期存在的功能分支 | 功能完成后立即删除          |
| ❌ 跳过代码审查       | PR 必须经过 review          |

---

# Worktree 使用规范

## 为什么使用 Worktree

Git Worktree 允许在**同一仓库的不同分支上并行工作**，而无需切换目录或创建完整的仓库副本。

### 核心优势

| 优势                 | 说明                                     |
| -------------------- | ---------------------------------------- |
| **隔离工作区** | 在独立目录工作，不干扰主分支的未提交更改 |
| **多分支并行** | 同时在多个分支上开发，无需频繁切换       |
| **资源共享**   | 共享 `.git` 目录，节省磁盘空间         |
| **独立环境**   | 每个 worktree 有独立的工作目录和索引     |

### 使用场景

- 需要保留当前工作区状态，临时处理其他任务
- 多分支并行开发（如同时开发两个独立功能）
- 需要在多个分支上运行测试或验证
- 团队成员需要独立的工作目录

---

## 目录结构规范

### 标准结构

```
D:\project\
├── .worktrees\                    ← Git 自动创建（隐藏目录）
│   ├── specs-consolidation\
│   │   └── (完整的项目副本)
│   └── feature-voice-recognition\
│       └── (完整的项目副本)
│
└── exomind\                       ← 主仓库目录
    ├── .git\                      ← Git 数据目录
    ├── src/
    ├── pm/
    └── ...
```

### Worktree 存放位置

```
推荐:      .worktrees/<分支名>/
替代方案:  ../.worktrees/<分支名>/
同级目录:  ../<分支名>-worktree/
```

### 命名规范

| 类型       | 命名规则                                         | 示例                          |
| ---------- | ------------------------------------------------ | ----------------------------- |
| 功能分支   | `feature/xxx-功能名` → `feature-xxx-功能名` | `feature-voice-recognition` |
| 重构分支   | `refactor/模块名` → `refactor-模块名`       | `refactor-signalpool`       |
| Spec 分支  | `specs/名称` → `specs-名称`                 | `specs-consolidation`       |
| 发布分支   | `release/v1.2.0` → `release-v1.2.0`         | `release-v1.2.0`            |
| 热修复分支 | `hotfix/v1.2.1` → `hotfix-v1.2.1`           | `hotfix-v1.2.1`             |

**规则**: 将分支名中的 `/` 替换为 `-`，确保目录名合法且易于识别。

---

## 使用流程

### 1. 创建 Worktree

```bash
# 在主仓库目录下
cd D:\project\exomind

# 方式A: 在 .worktrees 目录下创建（推荐）
git worktree add .worktrees/feature-voice-recognition feature/voice-recognition

# 方式B: 在父目录创建
git worktree add ../feature-voice-recognition feature/voice-recognition

# 方式C: 基于指定 commit 创建
git worktree add ../hotfix-branch <commit-hash>
```

### 2. 切换到 Worktree

```bash
# 直接进入目录
cd D:\project\exomind\.worktrees\feature-voice-recognition

# 或在 VS Code 中打开
code D:\project\exomind\.worktrees\feature-voice-recognition
```

### 3. 在 Worktree 中工作

```bash
# 在 worktree 目录中
cd D:\project\exomind\.worktrees\feature-voice-recognition

# 正常工作
bun dev

# 提交更改
git add .
git commit -m "feat: 添加语音识别功能"

# 推送到远程
git push origin feature/voice-recognition
```

### 4. 返回主仓库

```bash
# 切换回主仓库目录
cd D:\project\exomind

# 查看状态
git status
```

### 5. 删除 Worktree

```bash
# 先切换到主仓库（重要！）
cd D:\project\exomind

# 删除 worktree 目录
git worktree remove .worktrees/feature-voice-recognition

# 如果目录已手动删除，使用 --force
git worktree remove .worktrees/feature-voice-recognition --force

# 清理已删除分支的 worktree 引用
git worktree prune
```

---

## VS Code 中使用 Worktree

### 方法一：命令行打开

```bash
# 在主仓库中
cd D:\project\exomind

# 创建并直接打开
git worktree add .worktrees/feature-new
code .worktrees/feature-new
```

### 方法二：打开指定目录

1. 在 VS Code 中：`File` → `Open Folder`
2. 选择：`D:\project\exomind\.worktrees\feature-new`

### 方法三：使用 VS Code 设置

```json
// .vscode/settings.json
{
  "workbench.colorTheme": "Default Dark+",
  "files.exclude": {
    "**/.git": true,
    "**/.worktrees": true
  }
}
```

### 建议

- 为每个 worktree 使用独立的 VS Code 窗口
- 使用 VS Code 的多窗口功能并行查看
- 可以固定常用 worktree 到快速访问

---

## 相关指令速查

### 基础操作

| 命令                                 | 说明                     |
| ------------------------------------ | ------------------------ |
| `git worktree list`                | 列出所有 worktree        |
| `git worktree add <path> <branch>` | 创建新的 worktree        |
| `git worktree remove <path>`       | 删除 worktree            |
| `git worktree prune`               | 清理无效的 worktree 引用 |

### 进阶操作

| 命令                                    | 说明                     |
| --------------------------------------- | ------------------------ |
| `git worktree add -b <branch> <path>` | 创建新分支的 worktree    |
| `git worktree add <path> <commit>`    | 基于指定 commit 创建     |
| `git worktree lock <path>`            | 锁定 worktree 防止被删除 |
| `git worktree unlock <path>`          | 解锁 worktree            |

### 状态查看

| 命令                              | 说明                     |
| --------------------------------- | ------------------------ |
| `git worktree list --porcelain` | 机器可读的 worktree 列表 |
| `git status`                    | 查看当前 worktree 状态   |

---

## 注意事项

### 最佳实践

1. **始终从主仓库操作 worktree**

   ```bash
   # 正确
   cd D:\project\exomind
   git worktree remove .worktrees/feature-x

   # 避免（可能导致问题）
   cd .worktrees/feature-x
   git worktree remove .
   ```
2. **删除前确保已提交更改**

   ```bash
   # 检查状态
   git status

   # 提交或 stash
   git add .
   git commit -m "WIP: 暂存"
   ```
3. **使用有意义的路径名**

   ```bash
   # 推荐
   git worktree add .worktrees/feature-voice-recognition feature/voice-recognition

   # 避免
   git worktree add .worktrees/w1 feature/voice-recognition
   ```
4. **定期清理**

   ```bash
   # 清理已删除分支的引用
   git worktree prune
   ```

### 常见问题

**Q: worktree 目录可以放在 .git 同级吗？**
A: 可以，但不推荐。放在 `.worktrees/` 目录下更整洁，且可以配置 `.gitignore` 隐藏。

**Q: 如何同时运行多个 worktree？**
A: 可以，每个 worktree 是独立的工作目录，可以同时运行 `bun dev`。

**Q: worktree 会占用更多磁盘空间吗？**
A: 不会，worktree 共享 `.git` 目录，只复制工作文件。

---

# AI 生成内容管理

## agent-output/ 目录结构

使用 `agent-output/` 目录区分 AI 生成内容与人工确认内容。

```
agent-output/
├── drafts/           # AI 生成的草稿（待审核）
│   ├── specs/        # 规格文档草稿
│   ├── code/         # 代码草稿
│   └── docs/         # 文档草稿
├── reviewed/         # 已审核确认的内容
│   └── (同样结构)
└── prompts/          # AI 提示词记录
    └── conversations/
```

## 工作流程

```bash
# 1. AI 生成内容 → 放入 drafts/ 对应子目录
# 2. 人工审核
#    通过 → 移动到项目正式位置
#    不通过 → 删除或改进
# 3. 审核通过 → 提交到 Git (dev 分支)
```

## 原则

- ✅ `agent-output/` **在 dev 分支被 Git 追踪**
- ✅ 所有内容需 **人工审核** 后才能进入项目正式代码
- ✅ 审核通过的移动到 `docs/`、`src/` 等正式目录
- ⚠️ **main 分支不包含 `agent-output/`**（发版时删除）

## 版本历史

```
dev 分支:     包含 agent-output/ (完整历史)
     ↓
合并到 main: 先删除 agent-output/ 再合并
     ↓
main 分支:  无 agent-output，但 Git 历史中保留记录
```

## 示例

```bash
# 审核后的规格文档移动到正式位置
mv agent-output/drafts/specs/SPEC-023.md docs/specs/SPEC-023.md

# 提交
git add docs/specs/SPEC-023.md
git commit -m "docs: 添加 SPEC-023 AI Agent 设计规格"

# 发版时合并到 main（会自动删除 agent-output）
```

---

# 快速参考

## 分支管理

| 场景         | 命令                                     |
| ------------ | ---------------------------------------- |
| 开始新功能   | `git checkout -b feature/xxx`          |
| 开始重构     | `git checkout -b refactor/xxx`         |
| 开始热修复   | `git checkout -b hotfix/v1.2.1`        |
| 切换到 dev   | `git checkout dev`                     |
| 更新 dev     | `git pull origin dev`                  |
| 查看所有分支 | `git branch -a`                        |
| 删除本地分支 | `git branch -d feature/xxx`            |
| 强制删除分支 | `git branch -D feature/xxx`            |
| 创建标签     | `git tag -a v1.2.0 -m "Version 1.2.0"` |
| 推送标签     | `git push origin --tags`               |

## Worktree 操作

| 场景              | 命令                                            |
| ----------------- | ----------------------------------------------- |
| 列出所有 worktree | `git worktree list`                           |
| 创建 worktree     | `git worktree add .worktrees/<name> <branch>` |
| 删除 worktree     | `git worktree remove .worktrees/<name>`       |
| 清理无效引用      | `git worktree prune`                          |
| 锁定 worktree     | `git worktree lock .worktrees/<name>`         |
| 解锁 worktree     | `git worktree unlock .worktrees/<name>`       |

---

## 链接

- GitHub: https://github.com/exomind-team/exomind
- git flow 原始文章: https://nvie.com/posts/a-successful-git-branching-model/
- 语义化版本: https://semver.org/
- conventional commits: https://www.conventionalcommits.org/
