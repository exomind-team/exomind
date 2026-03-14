# 文档体系重组设计

> 将分散在 `docs/`、`pm/` 的 850+ 文件整理为结构清晰、双入口（人类 + AI）的统一文档体系。

---

## 1. 问题定义

| 问题 | 现状 | 影响 |
|------|------|------|
| 文档膨胀 | 851 个 .md 文件，4.4MB | Agent 上下文加载慢，人类无法导航 |
| Plans 堆积 | `docs/plans/` 130+ 文件，1.2MB | 分不清哪些活跃、哪些已完成 |
| 架构文档重叠 | 4 份架构文档（127K 总量） | 信息矛盾，不知道哪份是权威 |
| docs/ vs pm/ 重叠 | PRD、roadmap、git-spec 双份 | 维护两处，容易不同步 |
| 临时内容残留 | docs/fixes/、docs/pr/ | 噪声，干扰检索 |
| 缺乏入口 | 无统一索引 | 新对话的 AI、新人都找不到北 |

**根因**：文档只有创建流程，没有生命周期管理（归档、合并、删除）。

**目标**：

1. **单一权威源** — 每个主题只有一份权威文档
2. **双入口** — 人类导航索引 + AI 加载上下文
3. **生命周期** — 活跃/归档/删除三态管理
4. **可维护** — 结构足够简单，新增文档有明确归属

---

## 2. 设计决策摘要

| 决策 | 结论 | 原因 |
|------|------|------|
| pm/ 目录 | 废除，全部并入 docs/ | 消除重叠，统一入口 |
| 已完成 plans | 关键决策合并进权威文档，原文件删除，保留历史索引 | 历史不需人看，Agent 按需查索引 |
| 架构文档 | 4 份合并为 1 份 `architecture/overview.md` | 单一权威源 |
| CLAUDE.md 架构部分 | 精简为索引，指向权威文档 | 避免 CLAUDE.md 与 docs/ 信息冲突 |
| AI-CONTEXT.md | 通用 AI 入口，索引式，与 CLAUDE.md/AGENTS.md 分离 | 不同 AI 工具共用公共上下文 |
| docs/README.md | 人 + Agent 共用导航索引 | 一份索引服务双方 |
| memory/ | 迁入 docs/memory/ | 统一到 docs/ 体系 |
| docs/fixes/, docs/pr/ | 通用经验合入 development/，原文件删除 | 临时内容不保留 |
| superpowers/specs/ | 暂保留路径（工具默认输出位置） | 后续再整合 |

---

## 3. 目标目录结构

```
项目根/
├── README.md                        # 项目介绍（面向 GitHub 访客）
├── CLAUDE.md                        # Claude Code 专用指令（精简，索引式）
├── AGENTS.md                        # Codex 专用指令
├── CHANGELOG.md                     # 版本历史
├── BUILD.md                         # 构建说明
├── QUICK-START.md                   # 快速上手
│
└── docs/
    ├── README.md                    # 文档导航索引（人 + Agent 共用）
    ├── AI-CONTEXT.md                # 通用 AI 上下文（索引式）
    ├── ARCHIVE-INDEX.md             # 已删除文档历史索引
    │
    ├── architecture/                # 架构设计（权威）
    │   ├── overview.md              #   4 份合并为 1 份
    │   ├── signal-pool.md           #   信号池专题
    │   ├── ECS-communication.md     #   ECS 通信专题
    │   └── DECISIONS/               #   ADR 决策记录
    │
    ├── specs/                       # 模块规格
    │   ├── sync.md                  #   SPEC-301/303 合并
    │   ├── auth.md                  #   SPEC-302/304 合并
    │   ├── settings-registry.md     #   设计 + 演化合并
    │   └── ...
    │
    ├── product/                     # 产品方向
    │   ├── PRD.md
    │   ├── roadmap.md
    │   └── completed-features.md
    │
    ├── development/                 # 开发指南与流程
    │   ├── quickstart.md
    │   ├── git-spec.md
    │   ├── git-worktree.md
    │   ├── team-collaboration.md
    │   ├── team-scheduling.md
    │   └── ...
    │
    ├── research/                    # 研究分析
    ├── agents/                      # Agent 文档
    │
    ├── plans/                       # 仅活跃计划
    │
    ├── superpowers/                 # 工具生成文档（暂保留路径）
    │   └── specs/
    │
    └── memory/                      # 记忆系统
```

### 删除清单

| 类型 | 目标 | 处理 |
|------|------|------|
| 目录 | `pm/`（整体） | memory/ 迁入 docs/，其余合并或删除 |
| 目录 | `docs/fixes/` | 通用经验提取后删除 |
| 目录 | `docs/pr/` | 摘要进 ARCHIVE-INDEX.md 后删除 |
| 文件 | `docs/architecture.md` | 合并进 architecture/overview.md |
| 文件 | `docs/overview.md` | 合并进 AI-CONTEXT.md / 根 README.md |
| 文件 | `docs/stack.md` | 信息已在 CLAUDE.md，删除 |
| 文件 | 已完成的 plans（~100 个） | 关键决策合并，原文件删除 |
| 文件 | 重叠的 SPEC 文件 | 合并后删除原文件 |

---

## 4. 关键文件设计

### 4.1 docs/README.md（文档导航索引）

```markdown
# ExoMind 文档导航

## 架构与设计
- [架构总览](architecture/overview.md) — 分层模型、Port/Service、Phase 路线
- [信号池](architecture/signal-pool.md) — SignalPool 架构与 Agent 进程模型
- [ECS 通信](architecture/ECS-communication.md) — 实体组件系统通信栈
- [决策记录](architecture/DECISIONS/) — ADR 架构决策

## 模块规格
- [同步模块](specs/sync.md) — 多设备数据同步
- [认证模块](specs/auth.md) — 密码哈希与用户认证
- [设置注册表](specs/settings-registry.md) — Schema-Driven 设置项
- ...

## 产品方向
- [产品需求](product/PRD.md)
- [路线图](product/roadmap.md)
- [已完成特性](product/completed-features.md)

## 开发指南
- [快速上手](development/quickstart.md)
- [Git 规范](development/git-spec.md)
- [Git Worktree](development/git-worktree.md)
- [团队协作](development/team-collaboration.md)
- [多 Agent 调度](development/team-scheduling.md)

## 其他
- [研究](research/) — 技术调研与分析
- [Agent 文档](agents/) — Review Agent 等
- [活跃计划](plans/) — 进行中的实施计划
- [记忆系统](memory/) — AI 对话记忆

## 历史
- [归档索引](ARCHIVE-INDEX.md) — 已完成/删除文档的历史索引
```

### 4.2 docs/AI-CONTEXT.md（通用 AI 上下文）

```markdown
# ExoMind AI Context

> 通用项目上下文，供任何 AI 工具加载。具体 AI 指令见 CLAUDE.md / AGENTS.md。

## 项目定位
ExoMind（外心）= 个人/集体的生命成长助手 + 认知生命科学原型

## 技术栈
Tauri 2.0 + React 18 + TypeScript + Rust | Zustand | Tailwind + Radix UI | Bun

## 核心架构
→ [docs/architecture/overview.md](architecture/overview.md)

## 当前阶段
Phase 2 完成（SignalPool L3-L5），Phase 3 进行中（资源管控 + 可观测性）

## 文档索引
→ [docs/README.md](README.md)

## 活跃工作
→ [docs/plans/](plans/) 中的文件均为进行中
```

### 4.3 ARCHIVE-INDEX.md 格式

```markdown
# 文档归档索引

已删除文档的历史记录。原文件可通过 git 历史查看。

## 架构设计
| 原路径 | 摘要 | 合并去向 | 删除提交 |
|--------|------|----------|----------|
| docs/architecture.md | 旧版架构总览 (v2) | architecture/overview.md | abc1234 |
| docs/architecture/MVP.md | 原始 MVP 设计 | architecture/overview.md | abc1234 |

## 计划文档
| 原路径 | 摘要 | 关联 Issue/PR | 删除提交 |
|--------|------|---------------|----------|
| docs/plans/2026-02-15-xxx.md | 功能 X 实施计划 | #123 | def5678 |
```

---

## 5. CLAUDE.md 精简方案

当前 CLAUDE.md 中的「核心架构」章节（~3K）改为：

```markdown
## 核心架构

→ 详见 [docs/architecture/overview.md](docs/architecture/overview.md)

**快速参考**：L1 Adapter → L2 Environment → L3 Service/Actor/Agent → L4 UI
```

保留一行快速参考，详细内容全部指向权威文档。

---

## 6. 质量保证

### 验收标准

1. **零重叠**：任何主题只有 1 份权威文档
2. **全索引**：docs/README.md 覆盖所有现存文档
3. **链接完整**：所有内部链接可达（无死链）
4. **AI 可加载**：AI-CONTEXT.md < 100 行，索引式
5. **CLAUDE.md 精简**：架构部分 < 10 行（索引 + 一行摘要）
6. **历史可追溯**：ARCHIVE-INDEX.md 覆盖所有被删除文档

### 评审流程

实施完成后，使用多 Agent 团队评审：
- Agent 1：链接完整性检查（遍历所有 .md 内链接）
- Agent 2：内容一致性检查（权威文档间无矛盾）
- Agent 3：索引覆盖度检查（所有 .md 文件在 README.md 中有入口）

---

*设计版本: v1.0*
*日期: 2026-03-14*
*状态: 待审批*
