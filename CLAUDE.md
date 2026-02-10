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

### 分层架构模型（v4.0）

自底向上构建，每层都有运行时实体。

```
L4  UI ──────── React + zustand，只调 Service
    │
    │  ← Service interface（L3 向上暴露，谁提供谁定义）
    │
L3  Service / Actor / Agent ── 业务逻辑层
    │
    │  ← ActorContext interface（L3 定义自己需要的环境访问权限）
    │
L2  Environment ── 共享物理世界
    │               · 持有 Port 实例（能力）
    │               · 资源池（周期刷新型 + 总额有限型）
    │               · 消息缓冲（短期记录，自动淘汰）
    │               · 独占资源管理（acquire / release）
    │
    │  ← Port interface（L2 定义，谁消费谁定义）
    │
L1  Adapter ──── 具体实现，按运行时替换
                 Web: IndexedDB, fetch, Web Speech, WebContainer
                 Tauri: SQLite, Rust HTTP, Native Shell
```

#### 接口归属规则

| 接缝 | 接口放在 | 原则 | 本质 |
|------|----------|------|------|
| L1 ↔ L2 | Port interface 放 L2 | 谁消费谁定义 | 类型契约 |
| L2 ↔ L3 | ActorContext 放 L3 | 谁消费谁定义 | 权限边界 |
| L3 ↔ L4 | Service interface 放 L3 | 谁提供谁定义 | API 暴露 |

**核心逻辑**：接口永远归更稳定的一方所有。

#### Port 定义

| Port | 职责 | 读写 |
|------|------|------|
| ILLMPort | 大语言模型推理 | 双向 |
| IASRPort | 语音识别 | 读 |
| ITTSPort | 语音合成 | 写 |
| IStoragePort | 持久化存储 | 双向 |
| ITerminalPort | 终端执行 | 双向 |
| ISandboxPort | 沙箱脚本执行 | 双向 |
| IPlatformPort | 平台能力 | 双向 |
| IEventBusPort | 事件总线 | 双向 |
| ICryptoPort | 加密解密 | 双向 |

#### Environment 职责

1. **持有 Port 实例**（所有 Adapter 在 bootstrap 时注入）
2. **管理资源池**：
   - 周期刷新型（如 API 限额每 5h 刷新）
   - 总额有限型（如预付费余额）
3. **维护消息缓冲**（短期记忆，保留最近 5 分钟或 500 条）

#### Actor / Agent 模型（Phase 4）

| | Actor | Agent |
|---|---|---|
| 智能 | 无，机械执行 | 有，LLM 驱动 |
| 能量单位 | CPU/内存/存储 | Token |
| 通信 | 有界邮箱，异步消息 | 同 Actor |
| 示例 | 通知监听、定时器 | Governor、Task System、Growth Coach |

**去中心化**：没有中央路由器。每个 Agent 自己订阅信号源，自己判断是否处理。

#### 渐进式实施路线

| Phase | 目标 | 引入特性 |
|-------|------|----------|
| Phase 1 | 语音输入 → LLM → 事件日志 | Port 层、直接调用链 |
| Phase 2 | 解耦 Service 依赖 | EventBus 发布订阅 |
| Phase 3 | 资源管控 + 可观测性 | 资源池、消息缓冲 |
| Phase 4 | 多 Agent 并发协作 | Actor Model、Supervisor |
| Phase 5 | 高级生命特性 | Agent 生命周期，沙箱脚本 |

#### 设计模式总览

| 模式 | 应用 | 阶段 |
|------|------|------|
| Ports & Adapters | Port 定义能力接口 | Phase 1 |
| Facade | Service 包装底层机制 | Phase 1 |
| Observer | EventBus 发布订阅 | Phase 2 |
| Decorator | EncryptedStorage 叠加加密 | Phase 2 |
| Strategy | 邮箱策略、重启策略 | Phase 3-4 |
| Actor Model | 有界邮箱、异步通信 | Phase 4 |
| Supervisor Tree | 崩溃隔离、自动恢复 | Phase 4 |

### 文件组织

```
src/
├── adapters/           # L1：具体实现（llm, asr, tts, storage, terminal, crypto, platform）
├── environment/        # L2：共享物理世界
│   ├── interfaces/     #   Port interface 定义
│   ├── environment.ts  #   Environment 实现
│   ├── resource-pool.ts
│   ├── message-buffer.ts
│   └── bootstrap.ts    #   运行时检测 → 组装 Adapter
├── services/           # L3
│   ├── interfaces/     #   Service interface
│   └── impl/           #   Service 实现
├── actor/              # L3（Phase 4 引入）
│   ├── interfaces/     #   ActorContext 等
│   ├── mailbox.ts
│   ├── supervisor.ts
│   ├── actors/         #   具体 Actor
│   └── agents/         #   具体 Agent（LLM 驱动）
└── ui/                 # L4
    ├── components/
    ├── pages/
    ├── stores/
    └── providers/
```

### 核心模块状态

| 模块 | 状态 | Phase |
|------|------|-------|
| Port 层 | 未完成 | Phase 1 |
| Environment | 部分完成 | Phase 1-3 |
| Service 层 | 部分完成 | Phase 1 |
| EventBus | 部分完成 | Phase 2 |
| Actor/Agent | 未完成 | Phase 4 |

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
│     - **PR 必须合并到 dev 分支**                                │
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
| 11 | 人工合并 | 合并记录 | 人类执行 `merge` 到 dev | 【只有人类能点 merge】【PR 必须合并到 dev】 |
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

### 架构设计 vs 模块规格

| 维度 | 架构设计 (docs/architecture/) | 模块规格 (docs/specs/) |
|------|------------------------------|----------------------|
| **范围** | 系统整体 | 单个模块 |
| **视角** | 宏观、全局 | 微观、局部 |
| **内容** | 分层架构、Port/Service 定义 | 设计理由、功能定义、输入输出、验收标准 |
| **变更频率** | 低 | 高 |

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

### Git 工作流 ⭐

**核心原则：小提交持续保存进度，PR 引入人类审查**

#### 分支策略

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

#### 小提交原则

每次修改文件后立即提交 Git commit。

| 原则 | 说明 |
|------|------|
| **触发时机** | 任何文件修改后立即提交 |
| **提交粒度** | 按文件/功能，小步提交 |
| **提交信息** | `[类型]: [简短描述] [修改文件]` |

#### Git 提交类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构 (不改变外在行为) |
| `perf` | 性能优化 |
| `docs` | 文档更新 |
| `chore` | 其他维护 (构建、依赖等) |
| `test` | 测试相关 |
| `style` | 代码格式 (不影响语义) |
| `build` | 构建系统相关 |
| `ci` | CI 配置相关 |
| `revert` | 回滚提交 |

> **注意**: 类型使用小写，描述首字母小写

#### Draft PR vs 正式 PR

| 类型 | 创建时机 | 状态 | AI 权限 | 人类角色 |
|------|---------|------|---------|----------|
| **Draft PR** | 创建分支时 | WIP（进行中） | **自转**（继续开发） | 旁观进度 |
| **正式 PR** | 功能完成后 | Ready for review | **等待**（修改请求） | **审查+批准** |

#### CI/CD Tag 规范

| Tag 模式 | 触发 | 产出 |
|----------|------|------|
| `build/**` | 构建 jobs | Artifact |
| `release/**` | 构建 + Release jobs | GitHub Release |

```bash
# 构建验证
git tag build/v0.1.0 && git push origin build/v0.1.0

# 正式发布
git tag release/v0.1.0 && git push origin release/v0.1.0
```

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
src/
├── adapters/           # L1：具体实现（llm, asr, tts, storage, terminal, crypto, platform）
├── environment/         # L2：共享物理世界
├── services/            # L3：业务逻辑层
├── actor/              # L3：Actor/Agent 模型
└── ui/                 # L4：前端展示层

docs/
├── architecture/        # 架构设计
└── specs/               # 模块规格

pm/
├── git-spec.md          # Git 规范
└── memory/              # 记忆系统
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

## 团队协作规范

### 4 角色分工

| 角色 | 职责 | 任务类型 |
|------|------|---------|
| **Architect** | 架构设计、v4 合规审核 | 架构设计、接口定义 |
| **Developer** | 编码实现、单元测试 | 功能开发、重构 |
| **Developer-2** | 编码实现、单元测试 | 功能开发、重构 |
| **Tester** | 编写/运行测试、质量保证 | 单元测试、集成测试 |
| **Reviewer** | 代码审核、安全检查 | 架构合规、安全审核 |

### 任务循环流程

```
架构设计 → 编码实现 → 单元测试 → 代码审核
    ↓           ↓           ↓           ↓
   通过?      通过?       通过?       通过?
    ↓           ↓           ↓           ↓
  否→返回    否→返回     否→返回    是→完成
```

### 循环执行规则

| 循环 | 可用目标 | 包含任务 |
|------|---------|---------|
| Cycle 1 | 页面可访问 | 路由、页面、测试、审核 |
| Cycle 2 | 密码安全 | 密码哈希模块 |
| Cycle 3 | 架构就绪 | sync 模块架构 |
| Cycle 4 | 架构合规 | sync-store 重构 |
| Cycle 5 | 完整功能 | PouchSyncAdapter |

### Git 提交规则

**每位成员完成任务后必须**：
1. Git commit 提交代码
2. Git push 推送到远程

**Commit 格式**：
```
[类型]: [简短描述] [修改文件]

类型：feat/fix/docs/test/refactor
示例：feat: 实现密码哈希模块 [password-hash.ts]
```

### Lead 职责

- 分配任务、协调流程
- 每个循环完成后更新 PR 描述
- 回写知识到 CLAUDE.md 和 pm/memory/logs.md

---

## 相关文档

| 文档 | 路径 |
|------|------|
| 架构设计 | `docs/architecture/` |
| 模块规格 | `docs/specs/` |
| Git 规范 | `pm/git-spec.md` |
| 产品需求 | `pm/prd.md` |
| 产品路线图 | `pm/roadmap.md` |
| 执行日志 | `pm/memory/logs.md` |
| Git工作流知识点 | `pm/memory/知识点-Git工作流.md` |

---

*文档版本: v4.0*
*更新: 2026-02-03*
