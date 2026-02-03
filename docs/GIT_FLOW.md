# 分支管理规范

> **生效日期**: 2026-01-30
> **版本**: v1.1
> **参考**: [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) / [语义化版本](https://semver.org/)

---

## 分支结构

```
master (生产环境)
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

| 分支 | 角色 | 保护 | 生命周期 | 合并来源 |
|------|------|------|----------|----------|
| `master` | 生产环境 | ✅ 强制保护 | 永久 | `dev`, `hotfix/*` |
| `dev` | 开发主干 | ✅ 保护 | 永久 | `feature/*`, `release/*` |
| `feature/*` | 功能开发 | ❌ 可强制推送 | 临时 | `dev` |
| `release/*` | 预发布 | ❌ 可强制推送 | 临时 | `dev` |
| `hotfix/*` | 紧急修复 | ❌ 可强制推送 | 临时 | `master` |

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
# 提交格式: [类型]: [简短描述]
git commit -m "FEAT: 添加用户登录功能"

# 常用类型
# FEAT    - 新功能
# FIX     - Bug 修复
# REFACTOR - 重构 (不改变外在行为)
# PERF    - 性能优化
# DOCS    - 文档更新
# CHORE   - 其他维护 (构建、依赖等)
# TEST    - 测试相关
# STYLE   - 代码格式 (不影响语义)
# BUILD   - 构建系统相关
# CI      - CI 配置相关
# REVERT  - 回滚提交
```

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

| 类型 | 影响范围 | 流程 |
|------|----------|------|
| **代码级重构** | 单个文件/函数 | 直接在 feature 分支开发 → PR 到 dev |
| **模块级重构** | 多个文件/模块 | 创建 `refactor/模块名` 分支 → 充分测试 → PR 到 dev |
| **架构级重构** | 整个系统 | 参考 7层架构重构经验，分阶段进行 |

### 重构最佳实践

```bash
# 1. 创建重构分支
git checkout dev
git pull origin dev
git checkout -b refactor/模块名

# 2. 先确保有测试覆盖
npm test  # 或 bun test

# 3. 小步重构，每次 commit 都要能运行
git commit -m "REFACTOR: 提取 xxx 函数 [src/utils.ts]"

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

# 6. 合并到 master (重要：先删除 agent-output!)
git checkout master
rm -rf agent-output  # 删除 AI 生成内容（已在 dev 记录历史）
git commit -m "chore: 删除 agent-output 目录 (仅 master 分支)" --allow-empty
git merge release/v1.2.0 --no-ff -m "Release: v1.2.0"

# 7. 打标签
git tag -a v1.2.0 -m "Version 1.2.0"

# 8. 推送
git push origin master --tags

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

| 场景 | 版本号 | 示例 |
|------|--------|------|
| 首次发布 | 1.0.0 | - |
| 新功能 | MINOR +1 | 1.0.0 → 1.1.0 |
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
# 1. 从 master 创建 hotfix 分支
git checkout master
git pull origin master
git checkout -b hotfix/v1.2.1

# 2. 修复问题
git commit -m "FIX: 修复登录页面崩溃问题"

# 3. 合并到 master (紧急修复，可跳过测试)
git checkout master
git merge hotfix/v1.2.1 --no-ff -m "Hotfix: v1.2.1"

# 4. 打标签
git tag -a v1.2.1 -m "Hotfix v1.2.1"

# 5. 推送
git push origin master --tags

# 6. 合并回 dev (重要！)
git checkout dev
git merge hotfix/v1.2.1

# 7. 删除 hotfix 分支
git branch -d hotfix/v1.2.1
```

---

## CHANGELOG 管理

### 手动维护格式

```markdown
## [v1.2.0] - 2026-01-30

### 新增功能 ✨
- 功能 A 的描述

### 修复 🐛
- 问题 B 的修复

### 改进 🛠️
- 改进 C 的说明
```

### 自动生成 (推荐)

使用 **conventional-changelog** 根据 commit 自动生成：

```bash
# 安装
npm install -D conventional-changelog-cli

# 配置 package.json
{
  "scripts": {
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s"
  }
}

# 生成 changelog
npm run changelog
```

**提交格式规范**：

```
<type>(<scope>): <subject>

<body>

<footer>
```

示例：

```
feat(auth): 添加 Google 登录支持

实现了 Google OAuth 2.0 登录流程

Closes #123
```

---

## 快速参考

| 场景 | 命令 |
|------|------|
| 开始新功能 | `git checkout -b feature/xxx` |
| 开始重构 | `git checkout -b refactor/xxx` |
| 开始热修复 | `git checkout -b hotfix/v1.2.1` |
| 切换到 dev | `git checkout dev` |
| 更新 dev | `git pull origin dev` |
| 查看所有分支 | `git branch -a` |
| 删除本地分支 | `git branch -d feature/xxx` |
| 强制删除分支 | `git branch -D feature/xxx` |
| 创建标签 | `git tag -a v1.2.0 -m "Version 1.2.0"` |
| 推送标签 | `git push origin --tags` |

---

## 禁止操作

| 禁止 | 说明 |
|------|------|
| ❌ 直接推送到 master | 只能通过 PR 合并 |
| ❌ 强制推送 master/dev | 保护分支禁止 force push |
| ❌ 在 master 上开发 | 功能开发只能在 feature 分支 |
| ❌ 长期存在的功能分支 | 功能完成后立即删除 |
| ❌ 跳过代码审查 | PR 必须经过 review |

---

## 远程分支清理

```bash
# 查看已合并的远程分支
git remote prune origin --dry-run

# 清理
git remote prune origin

# 查看落后/领先
git status
git fetch origin
git rev-list --left-right origin/dev...dev
```

---

## Git Flow 可视化

```
时间 ───────────────────────────────────────────────────────→

master:    ─●────────────────●────────────────●──
              │            (tag:        (tag:
              │             v1.0.0)     v1.1.0)
              │
dev:        ●──●──●──●──●──●──●──●──●──●──●──●──
               \          /           /
feature/xxx:    ●────────●           /
                                    /
feature/yyy:    ●────────────────●──
```

---

## AI 生成内容管理

使用 `agent-output/` 目录区分 AI 生成内容与人工确认内容。

### 目录结构

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

### 工作流程

```bash
# 1. AI 生成内容 → 放入 drafts/ 对应子目录
# 2. 人工审核
#    通过 → 移动到项目正式位置
#    不通过 → 删除或改进
# 3. 审核通过 → 提交到 Git (dev 分支)
```

### 原则

- ✅ `agent-output/` **在 dev 分支被 Git 追踪**
- ✅ 所有内容需 **人工审核** 后才能进入项目正式代码
- ✅ 审核通过的移动到 `docs/`、`src/` 等正式目录
- ⚠️ **master 分支不包含 `agent-output/`**（发版时删除）

### 版本历史

```
dev 分支:     包含 agent-output/ (完整历史)
     ↓
合并到 master: 先删除 agent-output/ 再合并
     ↓
master 分支:  无 agent-output，但 Git 历史中保留记录
```

### 示例

```bash
# 审核后的规格文档移动到正式位置
mv agent-output/drafts/specs/SPEC-023.md docs/specs/SPEC-023.md

# 提交
git add docs/specs/SPEC-023.md
git commit -m "DOCS: 添加 SPEC-023 AI Agent 设计规格"

# 发版时合并到 master（会自动删除 agent-output）
```

---

## 链接

- GitHub: https://github.com/exomind-team/exomind
- Git Flow 原始文章: https://nvie.com/posts/a-successful-git-branching-model/
- 语义化版本: https://semver.org/
- Conventional Commits: https://www.conventionalcommits.org/
- AI 输出规范: ../../agent-output/README.md
