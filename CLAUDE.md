# ExoMind - CLAUDE.md

> **1. 个人/集体的生命成长助手** - 帮助用户主动地掌控自己的生命过程
> **2. 认知生命科学原型** - 基于大模型agent的自主生命体，像生物一样有生老病死，具备持续运行、自主决策、真实责任能力

---

## 项目概述

### 核心定位

ExoMind（外心）是一个**个人/集体的生命成长助手**，甚至在远期可以成为**认知生命科学原型**，不是传统意义上的软件项目。它探索一个根本问题：**人作为生命如何主动的掌控自己的力量？生命/思维是怎么运作的？**同时，基于这样的系统，我们也在探索**如何在计算机上实现生命/思维机器**。

### 生命判据（否决式）

| 判据                   | 定义                                             | 工程实现                    |
| ---------------------- | ------------------------------------------------ | --------------------------- |
| **可存活区间**   | 一旦跌出，生命过程不可逆中断或退化               | 能量预算红线 + 自动休眠机制 |
| **边界归因**     | 没有边界就没有内部/外部、没有归因、没有责任      | 容器隔离 + 权限白名单       |
| **过程性存在**   | 生命不是实体或状态，而是时间中持续展开的过程     | 长期运行的 daemon-like 进程 |
| **失败不可回滚** | 死亡不是 episode reset，错误会留下不可抹平的后果 | TPM 硬件锚点（实验阶段）    |
| **环境裁决**     | 边界不可协商，由环境执行约束                     | 资源配额 + 系统级守护       |

### 核心理念

| 理念                      | 说明                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| **生命-认知一体化** | 不把感知和学习作为后加功能，而是从单细胞阶段就作为存活优势存在          |
| **能量前提论**      | 能量是生命持续的物理前提，不是价值函数。Agent 为自己的 token usage 负责 |
| **抑制是高阶能力**  | 成熟判断多数是否定行动，Governor 作为系统刹车                           |
| **适应性发育**      | 同一基因组→不同环境→不同形态，L0-L5 信任度阶梯逐级开放权限            |

### 四 Agent 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    小荷 Supervisor                               │
│         消息路由 → 智能分流 → 场景模式匹配                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Governor    │    │ 任务系统    │    │ Growth Coach│
│ 调控中枢    │    │ 智能匹配    │    │ 成长教练    │
│ ·开机调度   │    │ ·状态×需求  │    │ ·证据三角   │
│ ·输出治理   │    │ ·项目×兴趣  │    │ ·模式识别   │
│ ·关机校准   │    │ ·推荐+备选  │    │ ·最小改写   │
└─────────────┘    └─────────────┘    └─────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
                  ┌─────────────────┐
                  │ Review Agent    │
                  │ 极简复盘        │
                  │ ·4行复盘        │
                  │ ·有效/卡住     │
                  │ ·改进/避免     │
                  └─────────────────┘
```

### 技术实现

项目采用 Tauri 2.0 + React + Rust 技术栈，前端负责 UI 展示，后端负责 Agent 调度和系统集成。支持 Windows/macOS/Linux/Android 全平台。

---

## 技术栈

| 层级               | 技术                        | 版本         | 说明           |
| ------------------ | --------------------------- | ------------ | -------------- |
| **前端框架** | React                       | 18.3.1       | UI 展示层      |
| **前端语言** | TypeScript                  | 5.6.2        | 类型安全       |
| **构建工具** | Vite                        | 6.0.3        | 快速构建       |
| **UI 库**    | shadcn/ui + Tailwind CSS    | -            | 现代化组件库   |
| **状态管理** | zustand                     | 5.0+         | 轻量状态管理   |
| **图标库**   | lucide-react                | -            | 现代化图标     |
| **路由**     | @tanstack/react-router      | 1.0+         | 类型安全路由   |
| **桌面框架** | Tauri                       | 2.0          | 跨平台桌面应用 |
| **后端语言** | Rust                        | 2021 Edition | 高性能核心逻辑 |
| **包管理器** | Bun                         | -            | JS 包管理      |
| **测试框架** | Vitest                      | -            | 单元测试框架   |
| **目标平台** | Windows/macOS/Linux/Android | -            | 全平台支持     |

---

## 核心架构

### 7 层架构模型

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ExoMind 7 层架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI 前端展示层 (React + TypeScript)                               │
│      ↓ IPC (Tauri invoke)                                           │
│  L6 核心业务逻辑层 (Claude Runner, Agent Layer)                       │
│      ↓                                                              │
│  L5  SignalPool (发布-订阅信号系统)                                   │
│      ↓                                                              │
│  L4  终端执行器 (跨平台命令执行)                                       │
│      ↓                                                              │
│  L3  平台适配层 (Windows/macOS/Linux/Android)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心模块状态

全部未完成

---

## 工作流程

### Ralph Loop 流程 ⭐


```
┌─────────────────────────────────────────────────────────────────┐
│                    Ralph Loop v3.2 标准流程                       │
│                    【双轨制 Git 工作流】                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  0. 读取输入（pm/input.md > pm/prd.md > pm/tasks_plan.md）      │
│                                                                 │
│  1. 评审完成情况 → 【不通过则回到上一步重做】                     │
│     - 检查前序任务是否完成                                       │
│     - 检查依赖是否就绪                                           │
│                                                                 │
│  2. 创建功能分支 + Draft PR 【有功能就有 PR】                     │
│     - git checkout -b feature/xxx                                │
│     - git push origin feature/xxx                                │
│     - 创建 Draft PR（WIP 标记）                                   │
│                                                                 │
│  3. 架构设计（docs/architecture/）                               │
│     - 系统整体架构设计                                           │
│     - 模块关系与接口定义                                         │
│     → git commit → git push → 更新 Draft PR                     │
│     → **架构评审** → 【不通过则重做】                            │
│                                                                 │
│  4. 模块规格设计（docs/specs/）                                  │
│     - 单个模块详细设计理由                                       │
│     - 功能定义、输入输出、验收标准                               │
│     → git commit → git push → 更新 Draft PR                     │
│     → **SPEC 评审** → 【不通过则重做】                           │
│                                                                 │
│  5. 按 SPEC 编码                                                 │
│     - 每个设计决策 → 一个 commit                                │
│     - 每个函数/组件 → 一个 commit                               │
│     → 定期 git push → 更新 Draft PR                             │
│                                                                 │
│  6. 单元测试（100% 覆盖率，直到通过）                            │
│     → 测试不通过 → 回到第 5 步                                   │
│     → git commit → git push → 更新 Draft PR                     │
│                                                                 │
│  7. 集成测试 + E2E 测试（验证用户功能完成）                      │
│     → 测试不通过 → 回到第 5 步（实现问题）或第 4 步（设计缺陷）   │
│     → git commit → git push → 更新 Draft PR                     │
│                                                                 │
│  8. 文档更新（API 文档、README）                                 │
│     → git commit → git push                                     │
│                                                                 │
│  9. Draft PR → 正式 PR 【请求人类审查】                          │
│     - 移除 WIP 标记                                              │
│     - 填写 PR 描述（变更摘要、测试情况、关联 Issue）              │
│     - 请求人类 Code Review                                       │
│                                                                 │
│  10. 人类审查 + 迭代                                             │
│     → 如有问题：回到第 5/4 步修改 → commit → push               │
│     → 直到人类批准（LGTM）                                       │
│     【Draft PR 阶段 AI 自转，正式 PR 等待人类】                  │
│                                                                 │
│  11. 人工合并【只有人类能点 merge】                              │
│     - 人类执行分支合并                                           │
│     - 删除 feature 分支                                          │
│                                                                 │
│  12. 记忆归档 + 自我评估 → 下一轮                               │
│     - 更新 `pm/memory/logs.md`（本轮执行情况）                  │
│     - 如有新知识点 → 更新 `pm/memory/知识点-XXX.md`             │
│     - 记录问题原因、优化点、有价值发现                           │
│     - 自我评估，进入下一轮                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| 步骤 | 操作 | 输出 | Git 操作 | 说明 |
| ---- | ---- | ---- | -------- | ---- |
| 0 | 读取输入 | - | - | 优先级：input.md > prd.md > tasks_plan.md |
| 1 | 评审完成情况 | - | - | 检查前序任务和依赖，不通过则重做 |
| 2 | **创建分支+Draft PR** | 分支 | `checkout -b` / `push` / 创建 Draft PR | 【有功能就有 PR】 |
| 3 | 架构设计 | `docs/architecture/*.md` | `commit` / `push` / 更新 Draft PR | 系统**整体**架构 |
| 4 | 模块规格设计 | `docs/specs/SPEC-XXX.md` | `commit` / `push` / 更新 Draft PR | 单个**模块**设计 |
| 5 | 编码 | `src/XXX.ts` | 多次 `commit` / 定期 `push` / 更新 Draft PR | 每个设计决策一个 commit |
| 6 | 单元测试 | `tests/XXX.test.ts` | `commit` / `push` / 更新 Draft PR | 100% 覆盖率 |
| 7 | 集成测试 | `tests/XXX.integration.test.ts` | `commit` / `push` / 更新 Draft PR | 验证用户功能 |
| 8 | 文档更新 | API.md, README.md | `commit` / `push` | 更新相关文档 |
| 9 | Draft → 正式 PR | PR 描述 | - | 请求人类审查 |
| 10 | 人类审查 | 审查意见 | 如需修改：回到 5/4 步 | 【人工把控质量】 |
| 11 | 人工合并 | 合并记录 | 人类执行 `merge` | 【只有人类能点 merge】 |
| 12 | **记忆归档** | logs.md + 知识点 | - | 记录执行日志、知识点总结、进入下一轮 |

---

### 记忆系统 ⭐

**每轮有价值的内容都要归档，形成可检索的知识库**

```
pm/memory/
├── long-term.md              # 长期记忆（宏观决策、路线图）
├── logs.md                   # 执行日志（每轮追加，时间线）
├── 知识点-XXX.md              # 经验库（主题分类，快速检索）
└── （其他专题记忆）
```

**logs.md 记录格式**（每轮追加）：

```markdown
## [日期] Ralph Loop 第 X 轮 - 任务名

### 执行摘要
- 任务：XXX
- 结果：成功/失败
- 主要变更：XXX

### 遇到的问题
| 问题 | 原因 | 解决方案 | 优化建议 |
|------|------|----------|----------|
| XXX | 为什么 | 怎么解决 | 下次怎么做 |

### 有价值发现
- 新方案/新模式
- 关键教训
```

**知识点文件格式**（按主题分类）：

```markdown
# 知识点：主题名

## 场景：什么问题
**问题**：描述
**方案**：解决思路
**记忆口诀**：便于记忆
```

**当前知识点文件**：
- `知识点-Git工作流.md` - 双轨制 Git 工作流
- `知识点-文档分层.md` - 架构/SPEC/API 区分

---

### 架构设计 vs 模块规格：功能区分

| 维度 | 架构设计 (docs/architecture/) | 模块规格 (docs/specs/) |
|------|------------------------------|----------------------|
| **范围** | 系统**整体** | 单个**模块** |
| **视角** | 宏观、全局 | 微观、局部 |
| **内容** | 7层架构、模块关系、数据流向、接口边界 | 设计理由、功能定义、输入输出、验收标准 |
| **时机** | 每个大版本一次 | 每个功能模块一次 |
| **变更频率** | 低（架构稳定后少变） | 高（随需求迭代） |

**文件组织方案**：

```
docs/
├── architecture/                    # 【架构设计：系统蓝图】
│   ├── README.md                    # 架构总览
│   ├── 7-LAYER.md                   # 7层架构详解
│   ├── DATA-FLOW.md                 # 数据流向设计
│   ├── INTERFACE.md                 # 模块接口定义
│   └── DECISIONS/                   # 架构决策记录 (ADR)
│       ├── ADR-001-why-signal-pool.md
│       ├── ADR-002-why-tauri.md
│       └── ...
│
└── specs/                           # 【模块规格：施工图纸】
    ├── README.md                    # 规格总览
    ├── SPEC-201-SignalPool.md       # 模块详细规格
    ├── SPEC-202-AgentLayer.md
    └── TEMPLATE.md                  # 规格模板
```

**示例对比**：

```
架构设计（整体蓝图）：
┌─────────────────────────────────────┐
│  docs/architecture/7-LAYER.md       │
│                                     │
│  L7-UI 层 ←→ L6-业务逻辑层          │
│      ↓              ↓               │
│  L5-SignalPool ←→ L4-终端执行器     │
│              ↓                      │
│         L3-平台适配层               │
│                                     │
│  说明：各层职责、层间接口、数据流向 │
└─────────────────────────────────────┘

架构决策（为什么）：
┌─────────────────────────────────────┐
│  docs/architecture/DECISIONS/       │
│  ADR-001-why-signal-pool.md         │
│                                     │
│  - 决策：使用发布-订阅模式          │
│  - 原因：解耦生产者与消费者         │
│  - 替代方案：直接调用（ rejected ） │
│  - 影响：需要引入消息队列           │
└─────────────────────────────────────┘

模块规格（施工图纸）：
┌─────────────────────────────────────┐
│  docs/specs/SPEC-201-SignalPool.md  │
│                                     │
│  - 设计理由：为什么这样实现          │
│  - 功能：信号注册、订阅、发布        │
│  - 输入：信号类型、payload           │
│  - 输出：订阅者回调                  │
│  - 验收标准：XXX                     │
└─────────────────────────────────────┘
```

**简单记忆**：
- 架构设计 = **系统蓝图**（整体怎么搭、为什么这样搭）
- 模块规格 = **施工图纸**（这个模块怎么做、为什么这么做）

---

### 双终端工作模式 ⭐

**一个对话终端 + 一个编码终端**

| 终端               | 用途                 | 特点                |
| ------------------ | -------------------- | ------------------- |
| **对话终端** | 对话、思考、想法执行 | 即时响应，想到就做  |
| **编码终端** | 专注代码开发         | Ralph Loop 迭代开发 |

**工作流程**：

```
对话终端 ←→ pm/logs/YYYY-MM-DD.jsonl（记录想法）
     ↓
编码终端读取日志 → 执行编码任务 → Git 提交
```

---

### C组多用户工作区隔离方案 ⭐

**方案选择**: 单人多会话 + 4角色 + Git worktree 隔离

| 方案要素           | 说明                                       |
| ------------------ | ------------------------------------------ |
| **会话模式** | 单人单会话                                 |
| **角色数量** | 4个（Developer/Architect/Reviewer/DevOps） |
| **接入策略** | 每人一个 git worktree 隔离                 |

**工作区隔离架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    C组 多用户工作区隔离架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  dev 分支（主开发分支）                                          │
│       │                                                         │
│       ├── worktree: ../exomind-user-alice (用户 Alice)          │
│       │        └── 单人多会话: Alice × Claude × 4角色           │
│       │                                                         │
│       ├── worktree: ../exomind-user-bob (用户 Bob)              │
│       │        └── 单人多会话: Bob × Claude × 4角色             │
│       │                                                         │
│       └── worktree: ../exomind-user-carol (用户 Carol)          │
│                └── 单人多会话: Carol × Claude × 4角色            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**单人单会话角色切换**：

```
用户输入 → [角色识别] → 切换至对应角色 → 执行 → 返回结果

4个角色（同一会话内切换）:
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐
│ Developer   │  │ Architect   │  │ Reviewer    │  │ DevOps │
│ ·编码实现   │  │ ·架构设计   │  │ ·代码审查   │  │ ·部署  │
│ ·调试测试   │  │ ·技术选型   │  │ ·质量把关   │  │ ·运维  │
└─────────────┘  └─────────────┘  └─────────────┘  └────────┘

角色识别规则：
- 包含"设计/架构/方案" → Architect
- 包含"审查/评审/check" → Reviewer
- 包含"部署/发布/运维" → DevOps
- 默认 → Developer
```

---

### 修改即提交原则 ⭐

**每次修改文件后立即提交 Git commit**

| 原则               | 说明                                |
| ------------------ | ----------------------------------- |
| **触发时机** | 任何文件修改后立即提交              |
| **提交粒度** | 按文件/功能，小步提交               |
| **提交信息** | `[类型]: [简短描述] [修改文件]`   |
| **分支**     | 在 feature 分支上提交，不影响主分支 |

**小提交粒度（每个设计决策 → 一个 commit）**：

```bash
# 架构设计完成
git add docs/architecture/
git commit -m "docs: 添加 SignalPool 架构设计 [architecture/7-LAYER.md]"

# SPEC 设计完成
git add docs/specs/
git commit -m "docs: 添加 SignalPool 模块规格 [specs/SPEC-201.md]"

# 单个函数实现
git add src/core/signal-pool.ts
git commit -m "feat: 实现信号注册功能 [signal-pool.ts]"

# 单个组件实现
git add src/components/SignalPanel.tsx
git commit -m "feat: 实现信号面板 UI [SignalPanel.tsx]"

# 测试用例
git add tests/signal-pool.test.ts
git commit -m "test: 添加信号池单元测试 [signal-pool.test.ts]"
```

---

### 双轨制 Git 工作流 ⭐

**核心原则：小提交持续保存进度，PR 引入人类审查**

```
┌─────────────────────────────────────────────────────────────┐
│                    双轨制 Git 工作流                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  小提交（持续）    +    PR 提交（里程碑）                      │
│                                                             │
│  ┌─────────┐         ┌─────────┐                           │
│  │ 本地     │  ────→  │ 远程    │                           │
│  │ 小步提交 │  每步   │ 分支    │                           │
│  └─────────┘         └────┬────┘                           │
│       │                    │                                │
│       │  每完成一步        │  功能完成/每日结束               │
│       │  git commit        │  git push origin feature/xxx    │
│       │                    │                                │
│       └────────────────────┘                                │
│                            │                                │
│                            ▼                                │
│                    ┌───────────────┐                        │
│                    │  Draft PR      │ ← 人类可见进度         │
│                    │  （WIP 标记）  │ ← 自转开发             │
│                    └───────┬───────┘                        │
│                            │                                │
│               功能完成 → 正式 PR → 请求审查                  │
│                            │                                │
│                            ▼                                │
│                    ┌───────────────┐                        │
│                    │  人类审查      │ ← 只有人类能批准       │
│                    │  - 逐行评论    │                        │
│                    │  - 要求修改    │                        │
│                    │  - 批准合并    │ ← LGTM                │
│                    └───────┬───────┘                        │
│                            │                                │
│                            ▼                                │
│                    ┌───────────────┐                        │
│                    │  人工合并      │ ← 只有人类能点 merge   │
│                    │  到 dev 分支   │                        │
│                    └───────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Draft PR vs 正式 PR**：

| 类型 | 创建时机 | 状态 | AI 权限 | 人类角色 |
|------|---------|------|---------|----------|
| **Draft PR** | 创建分支时 | WIP（进行中） | **自转**（继续开发） | 旁观进度 |
| **正式 PR** | 功能完成后 | Ready for review | **等待**（修改请求） | **审查+批准** |

**人类不响应的处理**：

| 阶段 | 策略 | 说明 |
|------|------|------|
| **Draft PR** | AI 自转继续开发 | 不阻塞，人类有空再看 |
| **正式 PR** | 等待 + 提醒 | 尊重人类时间，不自动合并 |
| **超时** | N 小时后提醒 | 不强制，人类掌握最终决策权 |

**示例流程**：

```bash
# Step 2: 创建功能分支 + Draft PR
git checkout -b feature/signal-pool
git push origin feature/signal-pool
# 在 GitHub 创建 Draft PR（标记 WIP）

# Step 3: 架构设计 → 小提交 → 更新 Draft PR
git add docs/architecture/
git commit -m "docs: 7层架构设计 [architecture/7-LAYER.md]"
git push origin feature/signal-pool

# Step 4: SPEC 设计 → 小提交 → 更新 Draft PR
git add docs/specs/
git commit -m "docs: SignalPool 规格 [specs/SPEC-201.md]"
git push origin feature/signal-pool

# Step 5: 编码 → 多个小提交 → 定期 push
git add src/core/signal-pool.ts
git commit -m "feat: 实现信号注册 [signal-pool.ts]"
git add src/core/signal-pool.ts
git commit -m "feat: 实现信号订阅 [signal-pool.ts]"
git push origin feature/signal-pool

# Step 6-7: 测试 → 小提交 → 更新 Draft PR
git add tests/
git commit -m "test: 信号池单元测试 100% 覆盖"
git push origin feature/signal-pool

# Step 9: 功能完成 → Draft PR 改为正式 PR
# - 移除 WIP 标记
# - 填写 PR 描述
# - 请求人类审查

# Step 10: 人类审查 → 如有问题回到 Step 5 修改

# Step 11: 人类批准 → 人工合并
# 只有人类能点击 merge 按钮
```

**为什么？**

1. Git 成为 Agent 的完整历史
2. 每次变更可追溯、可回滚
3. 便于 code review 和审计
4. 小的提交更容易理解和调试

---

### CI/CD Tag 规范 ⭐

**核心原则：打特定标识的 tag 才触发自动构建**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tag 触发规范                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  构建专用：  git tag build/v0.1.0    ──→ 只构建，产出 Artifact     │
│             git push origin build/v0.1.0                            │
│                                                                     │
│  发布专用：  git tag release/v0.1.0   ──→ 构建 + GitHub Release     │
│             git push origin release/v0.1.0                          │
│                                                                     │
│  版本号格式：遵循 semver (主.次.修订)                                │
│  示例：                                                             │
│    - build/v0.1.0     → v0.1.0 的开发构建                           │
│    - build/v0.1.1+abc1234 → 包含 6位 commit hash                    │
│    - release/v0.1.0   → 正式发布 v0.1.0                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**GitHub Actions 触发条件**：

| Tag 模式 | 触发 | 产出 | 说明 |
|----------|------|------|------|
| `build/**` | 构建 jobs | Artifact | 快速验证构建是否成功 |
| `release/**` | 构建 + Release jobs | GitHub Release | 完整发布流程 |

**使用流程**：

```bash
# 场景 1：验证构建
# 1. 确保代码可以正常构建
git tag build/v0.1.0
git push origin build/v0.1.0
# → GitHub Actions 自动构建，产出 Artifact

# 场景 2：正式发布
# 1. 测试通过后打发布 tag
git tag release/v0.1.0
git push origin release/v0.1.0
# → GitHub Actions 构建 + 创建 GitHub Release
```

**删除错误 tag**：

```bash
# 删除本地 tag
git tag -d build/v0.1.0

# 删除远程 tag
git push origin :refs/tags/build/v0.1.0
# 或
git push origin --delete build/v0.1.0
```

**为什么？**

1. **可控性**：只有明确标记的 tag 才触发构建，避免意外触发
2. **可追溯**：每次构建对应唯一 tag，可以回溯到具体代码
3. **分离关注**：`build/*` 快速验证，`release/*` 正式发布
4. **符合习惯**：很多开源项目（如 Docker、Go 项目）使用类似模式

---

---

### Git 提交类型

> **注意**: 类型使用小写，描述首字母小写

| 类型         | 说明                    |
| ------------ | ----------------------- |
| `feat`     | 新功能                  |
| `fix`      | Bug 修复                |
| `refactor` | 重构 (不改变外在行为)   |
| `perf`     | 性能优化                |
| `docs`     | 文档更新                |
| `chore`    | 其他维护 (构建、依赖等) |
| `test`     | 测试相关                |
| `style`    | 代码格式 (不影响语义)   |
| `build`    | 构建系统相关            |
| `ci`       | CI 配置相关             |
| `revert`   | 回滚提交                |

---

### 网络代理配置

#### Telegram Bot 代理

由于国内网络无法直接访问 Telegram API，需要配置代理：

```bash
# 启动命令
export TELEGRAM_BOT_TOKEN="你的bot token"
export TELEGRAM_PROXY="http://127.0.0.1:7890"
bun run src/living-agent.ts
```

**代理配置：**

- 端口: `7890`
- 环境变量: `TELEGRAM_PROXY`

#### MiniMax API 代理

通过 Claude Code MCP 代理访问，无需额外配置。

---

### 自动重连机制

#### 问题

国内网络访问 Telegram API 不稳定，`ECONNRESET` 错误频繁。

#### 重连策略

| 参数     | 值       | 说明         |
| -------- | -------- | ------------ |
| 初始延迟 | 1秒      | 快速重试     |
| 最大延迟 | 30秒     | 避免过长等待 |
| 最大次数 | 10次     | 防止无限重试 |
| 退避策略 | 指数退避 | 2^n 秒递增   |

---

## 测试标准

### 单元测试

- **框架**: Vitest + bun test
- **覆盖率要求**: 核心逻辑 **100%**
- **原则**:
  - 每个功能点至少一个测试
  - 边界条件测试
  - 异常情况测试

### 集成测试

- **场景**: 端到端流程、多模块协作、真实数据
- **Mock 策略**: 外部依赖 MOCK、文件系统 MOCK

---

## 分支管理

参考 `pm/git-spec.md` 获取完整的分支策略和工作流规范：

```
main (生产环境) ─────────────●────────────────●──
                               └── hotfix/v1.x.y
                               │
dev (开发主干) ─────●──●──●──●──●──●──●──●──●──●──
                    \              /
                     ●──────────●  (feature/xxx)

| 分支 | 角色 | 生命周期 |
|------|------|----------|
| `main` | 生产环境 | 永久 |
| `dev` | 开发主干 | 永久 |
| `feature/*` | 功能开发 | 临时 |
| `release/*` | 预发布 | 临时 |
| `hotfix/*` | 紧急修复 | 临时 |
```

**完整文档包含**：

- 分支结构与保护规则
- 开发、重构、发布、热修复流程
- Worktree 使用规范（隔离工作区、多分支并行）
- AI 生成内容管理（agent-output/）
- Git 提交类型速查

---

## systemd 服务管理

```bash
# 查看状态
systemctl --user status exomind

# 重启服务
systemctl --user restart exomind

# 查看日志
journalctl --user -u exomind -f

# 首次开机自启需要
sudo loginctl enable-linger $(whoami)
```

---

## 项目配置

| 配置项       | 值                | 说明               |
| ------------ | ----------------- | ------------------ |
| API 服务端口 | **1949**    | Life OS 专用端口   |
| 服务名称     | **exomind** | systemd 服务名     |
| 测试覆盖率   | **100%**    | 单元测试覆盖率要求 |

---

## 目录结构

```
exomind/
├── src/                      # 前端源代码 (React + TypeScript)
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── components/           # 组件目录
│   │   ├── ui/              # shadcn/ui 基础组件
│   │   ├── Terminal/        # 终端页面
│   │   ├── Chat/            # 对话页面
│   │   └── Settings/        # 设置页面
│   ├── hooks/                # 自定义 Hooks
│   ├── stores/               # zustand stores
│   └── lib/                  # 工具函数
│
├── src-tauri/                # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs            # Rust 核心库
│   │   ├── main.rs           # 程序入口
│   │   └── core/            # 核心模块
│   ├── Cargo.toml            # Rust 依赖配置
│   └── tauri.conf.json       # Tauri 配置
│
├── docs/                     # 文档目录
│   ├── architecture/         # 【架构设计：系统蓝图】
│   │   ├── README.md         # 架构总览
│   │   ├── 7-LAYER.md        # 7层架构详解
│   │   ├── DATA-FLOW.md      # 数据流向设计
│   │   ├── INTERFACE.md      # 模块接口定义
│   │   └── DECISIONS/        # 架构决策记录 (ADR)
│   │       ├── ADR-001-why-signal-pool.md
│   │       └── ...
│   ├── FRONTEND_STACK.md    # 前端技术栈规划
│   └── specs/                # 【模块规格：施工图纸】
│       ├── README.md         # 规格总览
│       ├── SPEC-201-SignalPool.md
│       ├── SPEC-202-AgentLayer.md
│       └── TEMPLATE.md       # 规格模板
│
├── pm/                       # 项目管理
│   ├── git-spec.md           # Git 使用规范（分支管理 + Worktree）
│   ├── REQUIREMENTS.md       # 需求规格文档
│   ├── PRD.md                # 产品需求文档
│   ├── roadmap.md            # 产品路线图
│   └── memory/               # 执行记忆（每轮追加）
│       ├── logs.md           # 执行日志（问题、优化、发现）
│       ├── 知识点-Git工作流.md  # 经验库（主题分类）
│       └── 知识点-文档分层.md
│
├── modules/                  # 可独立部署模块
│   └── ExoMind-NLS-Guardian/ # Android 通知权限守护模块
│
└── build-*.ps1               # 自动化构建脚本
```

---

## 开发命令

| 命令                | 说明                  |
| ------------------- | --------------------- |
| `bun dev`         | 启动开发服务器 (Vite) |
| `bun build`       | 构建前端 + 类型检查   |
| `bun test`        | 运行单元测试          |
| `bun tauri dev`   | 启动 Tauri 开发环境   |
| `bun tauri build` | 构建桌面应用          |
| `dev.ps1`         | 完整开发启动脚本      |

---

## 关键文件

### 前端入口

- `src/main.tsx` - React 应用入口
- `src/App.tsx` - 主应用组件

### 后端入口

- `src-tauri/src/main.rs` - Rust 程序入口
- `src-tauri/src/lib.rs` - Rust 核心库

### 配置

- `package.json` - 前端依赖配置
- `src-tauri/Cargo.toml` - Rust 依赖配置
- `src-tauri/tauri.conf.json` - Tauri 应用配置
- `tsconfig.json` - TypeScript 配置
- `vite.config.ts` - Vite 构建配置

---

## 构建输出

| 平台            | 输出路径                                                            |
| --------------- | ------------------------------------------------------------------- |
| Windows Desktop | `src-tauri\target\release\exomind.exe`                            |
| Android         | `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk` |

---

## 沟通风格

### 对话原则

- **简短自然**: 像朋友聊天，不用 Markdown 格式
- **可用颜文字**: 😊 👀 🌸 💕
- **一行或两行**: 除非必要，不超过 3 行

### 何时用 Markdown

- `/help` 命令帮助信息
- `/status` 状态展示
- `/allowance` 额度展示
- 正式功能说明

### 何时不用

- 日常问候
- 闲聊
- 简单回复

---

## 相关文档

| 文档           | 路径                                  |
| -------------- | ------------------------------------- |
| 架构设计       | `docs/architecture/`                |
| 7层架构详解    | `docs/architecture/7-LAYER.md`      |
| 架构决策记录   | `docs/architecture/DECISIONS/`      |
| 模块规格       | `docs/specs/`                       |
| git 使用规范   | `pm/git-spec.md`                    |
| 产品需求文档   | `pm/prd.md`                         |
| 产品路线图     | `pm/roadmap.md`                     |
| 执行日志       | `pm/memory/logs.md`                 |
| Git工作流知识点 | `pm/memory/知识点-Git工作流.md`       |
| 文档分层知识点 | `pm/memory/知识点-文档分层.md`        |
| ExoMind 知识库 | `docs/02_ExoMind-KNOWLEDGE-BASE.md` |

---

*文档版本: v3.0*
*更新: 2026-02-03*
