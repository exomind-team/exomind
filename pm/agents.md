# ExoMind Agents 索引

> ExoMind 项目中使用的 AI Agents 和评审流程索引

---

## Agents 列表

| Agent | 用途 | 位置 |
|-------|------|------|
| **code-review** | PR 代码评审 | `skills/code-review/` |
| **superpowers** | 超级能力技能集合 | `skills/superpowers/` |

---

## 评审流程

### PM 目录评审流程

用于对 `pm/` 目录下文档进行规范性、正确性评审。

**评审维度**：
1. 引用一致性检查
2. 流程逻辑矛盾检查
3. 内容完整性检查
4. 版本状态追踪检查

**使用方法**：
```bash
# 启动 4 个 SubAgent 并行评审
1. SubAgent 1: 评审文档引用一致性
2. SubAgent 2: 评审流程逻辑矛盾
3. SubAgent 3: 评审内容完整性
4. SubAgent 4: 评审版本状态追踪

# 汇总生成报告
pm/REVIEW.md
```

**评审报告**：`pm/REVIEW.md`

---

## 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| PM 评审报告 | `pm/REVIEW.md` | pm 目录文档评审结果 |
| 开发规范 | `pm/development.md` | Ralph Loop 10 步开发流程 |
| Git 规范 | `pm/git-spec.md` | 分支管理 + Worktree |
| Agent 配置 | `pm/agent.md` | Agent 身份定义 |

---

*索引版本: v1.0*
*创建时间: 2026-02-03*
