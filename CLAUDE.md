# ExoMind - CLAUDE.md

> **1. 个人/集体的生命成长助手** - 帮助用户主动地掌控自己的生命过程
> **2. 认知生命科学原型** - 基于大模型agent的自主生命体，像生物一样有生老病死，具备持续运行、自主决策、真实责任能力

---

## 项目概述

### 核心定位

ExoMind（外心）是一个**个人/集体的生命成长助手**，甚至在远期可以成为**认知生命科学原型**，不是传统意义上的软件项目。它探索一个根本问题：**人作为生命如何主动的掌控自己的力量？生命/思维是怎么运作的？**同时，基于这样的系统，我们也在探索**如何在计算机上实现生命/思维机器**。

### 生命判据（否决式）

| 判据                   | 定义                                             | 工程实现                    | 用户行为语义                     |
| ---------------------- | ------------------------------------------------ | --------------------------- | -------------------------------- |
| **可存活区间**   | 一旦跌出，生命过程不可逆中断或退化               | 能量预算红线 + 自动休眠机制 | 系统会在资源耗尽前自我保护       |
| **边界归因**     | 没有边界就没有内部/外部、没有归因、没有责任      | 容器隔离 + 权限白名单       | 每个操作都有明确的归属者         |
| **过程性存在**   | 生命不是实体或状态，而是时间中持续展开的过程     | 长期运行的 daemon-like 进程 | 任务在时间中推进，不能跳跃       |
| **失败不可回滚** | 死亡不是 episode reset，错误会留下不可抹平的后果 | TPM 硬件锚点（实验阶段）    | 操作生效=留下痕迹，无 undo       |
| **环境裁决**     | 边界不可协商，由环境执行约束                     | 资源配额 + 系统级守护       | 系统不为用户绕过环境限制         |

### 核心理念

| 理念                      | 说明                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| **生命-认知一体化** | 不把感知和学习作为后加功能，而是从单细胞阶段就作为存活优势存在          |
| **能量前提论**      | 能量是生命持续的物理前提，不是价值函数。Agent 为自己的 token usage 负责 |
| **抑制是高阶能力**  | 成熟判断多数是否定行动，Governor 作为系统刹车                           |
| **适应性发育**      | 同一基因组→不同环境→不同形态，L0-L5 信任度阶梯逐级开放权限            |

### 双层原则命名规范

ExoMind 的每一条系统级约束都必须具备**双层表述**，缺一不可：

| 层次 | 面向 | 措辞风格 | 适用场景 |
|------|------|---------|---------|
| **架构不变量（invariant）** | 开发者/架构师 | 强硬，描述硬约束 | `docs/architecture/`、代码注释 |
| **用户行为语义（affordance）** | 用户/产品 | 柔性，描述操作含义 | issue、UI文案、方法名、测试描述 |

**判断标准**：若一个约束只有不变量名而没有行为语义名，说明设计未完成。

示例：
- 不变量：**不可删除原则** → 行为语义：**删除=放弃**
- 不变量：**不可回滚原则** → 行为语义：**操作生效=留下痕迹**
- 不变量：**持续展开原则** → 行为语义：**任务在时间中推进**

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

### 分支与发布治理（2026-02）

#### 分支角色

1. `dev` 是开发主线，所有功能与修复默认先合入 `dev`。
2. `main` 是生产发布线，只接收可发布版本，不作为日常开发分支。

#### 分支命名规范

1. 功能分支：`feature/issue-<id>-<slug>` 或 `feature/<topic>`。
2. 修复分支：`fix/issue-<id>-<slug>` 或 `fix/<topic>`。
3. 文档分支：`docs/<topic>`。
4. 禁止使用临时、含糊或不可读命名（例如随机前缀、语义不明缩写）。

#### PR 与合并规则

1. 一条分支只对应一个主要目标，避免混合多个不相关改动。
2. 默认目标分支是 `dev`，非发布场景不直接向 `main` 提交 PR。
3. `main` 只通过 `dev -> main` 发布 PR 合并，并配套版本标签（Tag）。
4. 合并前至少完成构建验证；涉及功能变更时补充对应测试（单测/E2E）。

#### 清理与例外

1. 分支合并后，优先删除远程分支和本地分支，并移除对应 worktree。
2. 长期保留分支仅限：`dev`、`main`。
3. 如需临时保留分支，必须在 PR 或 Issue 中写明保留原因和截止时间。

#### Issue 修复标准链路（2026-03）

1. 开工前先在对应 Issue/PR 评论中给出：问题判断、拟定方案、验收链路。
2. 执行中使用任务清单持续跟踪，确保每轮都有明确的进行中/完成状态。
3. 先改代码，再做编译与测试验证（默认 Node 链路）：
   - `npx tsc --noEmit`
   - `npx vitest run <相关测试>`
4. 功能联调时固定启动并验证两个服务：
   - Web：`npx vite --host 0.0.0.0 --port 5173`
   - Sync：`EXOMIND_POUCHDB_HOST=0.0.0.0 EXOMIND_POUCHDB_PORT=6984 node server/pouchdb-server.js`
5. 使用 `curl` 验证服务可用性（至少返回 `HTTP 200`）：
   - `curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8`
   - `curl -sS -D - -o /dev/null http://127.0.0.1:6984 | head -n 8`
6. 验证通过后再提交与推送；禁止提交调试产物、临时日志、报告缓存。
7. 推送后必须在 PR 评论同步：改动摘要、测试命令、结果证据。
8. 允许一个 PR 同时解决两个相关 Issue；此时必须同步更新 PR 描述，明确覆盖范围与验收状态。
9. 合并前再次检查是否存在新的 blocking review；若无阻塞且关键回归通过，合并到 `dev`，并切回 `dev` 继续后续工作。

---

### 记忆系统 ⭐

每轮有价值的内容都要归档，形成可检索的知识库。详见：[pm/memory/README.md](pm/memory/README.md)

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

| Tag 模式 | 触发 | 产出 | Release 类型 |
|----------|------|------|-------------|
| `build/v0.3.2-build.20260222T1430` | 构建 + Release jobs | GitHub Release | Pre-release |
| `release/v0.3.3` | 构建 + Release jobs | GitHub Release | 正式版 |
| `release/v0.3.3-beta.1` | 构建 + Release jobs | GitHub Release | Pre-release |

```bash
# 日常构建测试（自动时间戳，Releases 页面直接下载）
bun run build:tag

# 正式发布
git tag release/v0.3.3 && git push origin release/v0.3.3
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

多角色团队协作的标准流程和规范，详见：[docs/development/team-collaboration.md](docs/development/team-collaboration.md)

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

## 多 Agent 团队调度经验

Claude Code 团队模式下的 Agent 协作实践经验，详见：[docs/development/team-scheduling.md](docs/development/team-scheduling.md)

---

*文档版本: v4.2*
*更新: 2026-03-09*
