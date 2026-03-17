# 参与贡献（草案）

ExoMind 是一个集体共建的项目。每一份贡献——无论是一行代码、一个 bug 报告、还是一段文档——都是集体财富的一部分。

## 目录

- [快速参与](#快速参与)
- [贡献者等级](#贡献者等级)
- [开发环境](#开发环境)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [Issue 指南](#issue-指南)
- [所有制声明](#所有制声明)

---

## 快速参与

| 方式 | 适合谁 | 入口 |
|------|--------|------|
| 💬 **Discussions** | 想聊想法、提问、建议的人 | [Discussions](https://github.com/exomind-team/exomind/discussions) |
| 🐛 **Issues** | 发现 bug 或有功能需求的用户 | [Issues](https://github.com/exomind-team/exomind/issues) |
| 🔧 **Pull Requests** | 想贡献代码或文档的开发者 | 本文档 |
| 📖 **翻译** | 想帮助更多人理解的人 | 翻译指南（待完善） |
| 💰 **资金** | 想支持项目基础设施的人 | [透明财务](./FINANCES.md) |

不知道从哪开始？看看标记了 `good first issue` 的 Issue。

---

## 贡献者等级

我们相信信任是通过持续的贡献逐步建立的。ExoMind 的社区治理采用四级贡献者等级制度：

### L0: Community Member（社区成员）

**谁**：所有关注 ExoMind 的人。

**权限**：参与 Discussions、提 Issue、Star/Fork 仓库。

**怎么成为**：关注即可。

### L1: Contributor（贡献者）

**谁**：提交过被接受的贡献（代码、文档、翻译、设计等）的人。

**权限**：L0 权限 + 被邀请到贡献者交流频道。

**怎么成为**：提交一个被合并的 PR。

**评估维度**：贡献质量。

### L2: Reviewer（评审者）

**谁**：持续贡献且展现出对项目深入理解的人。

**权限**：L1 权限 + 评审和批准 PR + 参与技术讨论决策。

**怎么成为**：由现有 Reviewer 或 Maintainer 提名，集体投票通过。

**评估维度**：
- **能力** — 对代码库和架构的理解深度
- **持续性** — 稳定的贡献记录（不要求全职，但要持续）

### L3: Maintainer（维护者 / 同志）

**谁**：项目的核心守护者，拥有最高信任级别。

**权限**：L2 权限 + Merge 权限 + 架构决策 + 路线图制定。

**怎么成为**：由现有 Maintainer 提名，全体 Maintainer 一致通过。

**评估维度**：
- **能力** — 技术深度 + 架构视野
- **意愿** — 长期承诺，不是一时兴趣
- **理想一致** — 认同 ExoMind 的核心愿景：
  - 认知主权归个人所有
  - 生产资料归集体所有
  - 知识是人类公共财富

> 技术是门槛，理想是钥匙。
> 我们吸纳的不只是开发者，是同志。

### 降级与退出

- 长期不活跃（6个月无贡献）的 Reviewer/Maintainer 会被标记为 Emeritus（荣誉退役），保留贡献记录，暂停活跃权限。
- 违反行为准则或所有制原则的成员，经集体讨论后可撤销权限。
- 任何成员可随时自愿退出，贡献记录永久保留。

---

## 开发环境

### 前置要求

- [Bun](https://bun.sh/) >= 1.0
- [Rust](https://rustup.rs/) >= 1.75
- [Tauri CLI](https://v2.tauri.app/) v2

### 搭建步骤

```bash
# 克隆仓库
git clone https://github.com/exomind-team/exomind.git
cd exomind

# 安装前端依赖
bun install

# 开发模式
bun run tauri dev
```

### 项目结构

```
exomind/
├── src/                    # TypeScript 前端
│   └── ui/app/             # React 页面和组件
├── crates/
│   └── exomind-runtime/    # Rust Agent 运行时
│       └── src/
│           ├── agent/      # Agent trait + 实现
│           ├── signal/     # SignalPool 信号网络
│           ├── mesh/       # 多机 Mesh 互联
│           └── energy.rs   # 能量系统
├── src-tauri/              # Tauri 桥接层
└── docs/                   # 文档
```

---

## 提交规范

### Commit Message 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Type**:
- `feat` — 新功能
- `fix` — Bug 修复
- `docs` — 文档
- `refactor` — 重构（不改变功能）
- `test` — 测试
- `chore` — 构建/工具链

**示例**:
```
feat(signal): add hop-based loop prevention for mesh relay
fix(energy): prevent negative energy after tick overflow
docs(readme): update quick start guide
```

### 分支命名

```
feat/short-description
fix/issue-number-description
docs/what-you-documented
```

---

## Pull Request 流程

1. **Fork 仓库** — 在你的 Fork 上创建分支
2. **编写代码** — 遵循提交规范
3. **写测试** — 新功能必须有测试覆盖
4. **提交 PR** — 标题清晰，描述包含：
   - 做了什么（What）
   - 为什么做（Why）
   - 怎么测试（How to test）
5. **等待评审** — Reviewer 会在 48 小时内回复
6. **修改（如需要）** — 根据评审意见修改
7. **合并** — Reviewer/Maintainer 合并

### PR 检查清单

- [ ] 代码遵循项目规范
- [ ] 新功能有测试覆盖
- [ ] 文档已更新（如涉及 API 变更）
- [ ] Commit message 遵循规范
- [ ] CI 通过

---

## Issue 指南

### Bug 报告

请包含：
- ExoMind 版本
- 操作系统
- 复现步骤
- 期望行为 vs 实际行为
- 截图（如有）

### 功能建议

请包含：
- 你想解决什么问题
- 你设想的解决方案
- 替代方案（如有）

### Issue 标签

| 标签 | 含义 |
|------|------|
| `good first issue` | 适合新手的任务 |
| `help wanted` | 需要社区帮助 |
| `bug` | 确认的 Bug |
| `enhancement` | 功能增强 |
| `discussion` | 需要讨论的议题 |

---

## 所有制声明

ExoMind 遵循 **ExoMind Public License (EPL-1.0)**。

你的贡献成为集体财富的一部分——不是被某家公司占有，而是归所有贡献者共同拥有。

- 你的代码贡献：著作权归你与 ExoMind 集体共有
- 你的 Agent 数据：永远归你个人所有
- 项目收益：按贡献透明分配

详见 [LICENSE](./docs/governance/LICENSE-draft.txt) 和 [OWNERSHIP.md](./OWNERSHIP.md)。
