# review

> 评审 Agent 索引与评审流程规范

---

## Agents 列表

| Agent | 用途 | 位置 |
|-------|------|------|
| **code-review** | PR 代码评审 | `skills/code-review/` |
| **superpowers** | 超级能力技能集合 | `skills/superpowers/` |

---

## 评审流程

### pm 目录文档评审流程

用于对 `pm/` 目录下文档进行规范性、正确性评审。

**评审内容概要**：
- 引用一致性检查：文件路径、文件名引用的准确性
- 流程逻辑矛盾检查：Ralph Loop、Git 规范、测试覆盖率等
- 内容完整性检查：Frontmatter、必填字段、格式规范
- 版本状态追踪检查：版本号、日期、里程碑状态

**使用方法**：
1. 启动 4 个 SubAgent 并行评审
   - SubAgent 1: 评审文档引用一致性
   - SubAgent 2: 评审流程逻辑矛盾
   - SubAgent 3: 评审内容完整性
   - SubAgent 4: 评审版本状态追踪
2. 汇总生成报告：`REVIEW.md`
3. 按 P0/P1/P2 优先级分类问题
4. 修复后提交 Git

**评审报告**：`agent-output/drafts/docs/REVIEW.md`

---

## 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **REVIEW.md** | `agent-output/drafts/docs/REVIEW.md` | pm 目录文档评审结果 |
| 开发规范 | `pm/development.md` | Ralph Loop 10 步开发流程 |
| Git 规范 | `pm/git-spec.md` | 分支管理 + Worktree |
| Agent 配置 | `pm/agent.md` | Agent 身份定义 |

---

*索引版本: v1.0*
*创建时间: 2026-02-03*
