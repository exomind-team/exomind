# ExoMind - CLAUDE.md

> **1. 个人/集体的生命成长助手** - 帮助用户主动地掌控自己的生命过程
> **2. 认知生命科学原型** - 基于大模型agent的自主生命体，像生物一样有生老病死，具备持续运行、自主决策、真实责任能力

---

## 项目概述

### 核心定位

ExoMind（外心）是一个**个人/集体的生命成长助手**，甚至在远期可以成为**认知生命科学原型**，不是传统意义上的软件项目。它探索一个根本问题：**人作为生命如何主动的掌控自己的力量？生命/思维是怎么运作的？**同时，基于这样的系统，我们也在探索**如何在计算机上实现生命/思维机器**。

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

> **⚠️ Termux (Android) 开发环境能力提醒**
>
> 当前 Termux 环境已安装完整工具链，**不要假设它缺少某项能力**，先实测再下结论：
> - **Rust**: `cargo 1.93.1` / `rustc 1.93.1` — `cargo check` / `cargo test` 可用（首次编译约 2 分钟）
> - **Node/Bun**: `npx tsc --noEmit` / `npx vitest run` / `bun dev` 均可用
> - **Git/GitHub CLI**: `git` / `gh` / `jj` 均可用
> - **不可用**: Playwright E2E（需 Chromium）、Tauri 桌面窗口交互验证、Android APK 安装测试

---

## 核心架构

→ 详见 [docs/architecture/overview.md](docs/architecture/overview.md)

L1 Adapter → L2 Environment → L3 Service/Actor/Agent → L4 UI

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

#### jj (Jujutsu) 兼容规范

**优先级**：开发者本机安装了 jj 时优先使用 jj 管理版本，否则沿用 Git。两者 colocated 共存，操作同一个 `.git` 仓库。

**不可变原则**：已推送到远端的提交视为不可变。不允许修改远端 bookmark（含）之前的修订。这确保了：
- 与 GitHub PR 工作流兼容——推送后不 force push
- review 进度不会因为历史重写而丢失
- 符合生命判据"操作生效=留下痕迹"

**配置方式**：项目根目录的 `jj-config.toml` 是配置模板。首次使用时需手动应用到 jj 仓库配置：

```bash
jj config set --repo revset-aliases.'"immutable_heads()"' '"present(main@origin) | remote_bookmarks()"'
jj config set --repo revset-aliases.'"trunk()"' '"main@origin"'
```

**用户指令 → jj 命令速查**：

| 用户说 | jj 命令 | Git 等价 | 说明 |
|--------|---------|---------|------|
| 拆分 | `jj split` | `git rebase -i`（拆 commit） | 将当前 change 拆成多个 |
| 描述 | `jj describe -m "..."` | `git commit -m "..."` | 给已有 change 写描述（不是"创建"） |
| 推送 | `jj git push` | `git push` | 推送 bookmark 到远端 |
| 撤销 | `jj undo` | `git reset`（但更安全） | 撤销上一步操作 |
| 查看状态 | `jj st` / `jj log` | `git status` / `git log` | 查看工作区 / 历史 |
| 新建修订 | `jj new -m "..."` | `git commit`（空提交） | 封存当前 change，开始新 change |

**常用组合指令**：

- 「描述并推送」= `jj describe -m "..." && jj git push`
- 「拆分描述推送」= `jj split` → `jj describe -m "..."` → `jj git push`
- 「新建并描述」= `jj new -m "feat: 新功能"`

**核心心智模型**：jj 中修改即提交——文件一改就自动成为当前 change 的一部分，不需要 `add` 或 `commit`。「描述」不是创建快照，而是给已存在的 change 盖章定性。

**日常工作流**：

```bash
# 查看状态（替代 git status + git log）
jj st
jj log

# 描述当前修订（替代 git commit --amend 的消息部分）
jj describe -m "fix: 修复 bug"

# 创建新修订（封存当前 change，开始新 change）
jj new -m "feat: 新功能"

# 拆分当前修订为多个
jj split

# 推送到远端
jj git push

# 撤销上一步操作
jj undo
```

---

### GitHub Issue 依赖管理 ⭐

**必须使用 GitHub GraphQL API 管理 Issue 之间的依赖关系。** 不要用评论或 body 文本模拟依赖——GitHub 原生支持 `blockedBy/blocking` 和 `subIssue` 关系。

#### 阻塞关系（blocked by）

```bash
# 查询 issue 的阻塞关系
gh api graphql -f query='
{
  repository(owner: "exomind-team", name: "exomind") {
    issue(number: 123) {
      blockedBy(first: 10) { nodes { number title state } }
      blocking(first: 10) { nodes { number title state } }
    }
  }
}'

# 添加阻塞：issue A 被 issue B 阻塞（B 不完成则 A 无法开始）
gh api graphql -f query='
mutation {
  addBlockedBy(input: {issueId: "ISSUE_A_NODE_ID", blockingIssueId: "ISSUE_B_NODE_ID"}) {
    clientMutationId
  }
}'

# 移除阻塞
gh api graphql -f query='
mutation {
  removeBlockedBy(input: {issueId: "ISSUE_A_NODE_ID", blockingIssueId: "ISSUE_B_NODE_ID"}) {
    clientMutationId
  }
}'
```

#### 父子关系（sub-issue）

```bash
# 查询 sub-issues
gh api graphql -f query='
{
  repository(owner: "exomind-team", name: "exomind") {
    issue(number: 366) {
      subIssues(first: 20) { nodes { number title state } }
    }
  }
}'

# 添加子 issue
gh api graphql -f query='
mutation {
  addSubIssue(input: {issueId: "PARENT_NODE_ID", subIssueId: "CHILD_NODE_ID"}) {
    clientMutationId
  }
}'
```

#### 获取 issue 的 Node ID

GraphQL mutation 需要 Node ID（非编号），批量获取：

```bash
gh api graphql -f query='
{
  repository(owner: "exomind-team", name: "exomind") {
    i123: issue(number: 123) { id }
    i456: issue(number: 456) { id }
  }
}'
```

#### 注意事项

- 关闭 issue 时检查是否还在阻塞其他 issue，及时 `removeBlockedBy`
- 不要用评论或 body 模拟依赖关系，**始终用 GraphQL API**
- GitHub 会自动检测循环依赖并拒绝

---

### 记忆系统 ⭐

每轮有价值的内容都要归档，形成可检索的知识库。详见：[docs/memory/README.md](docs/memory/README.md)

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
对话终端 ←→ docs/memory/logs.md（记录想法）
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

docs/memory/             # 记忆系统（原 pm/memory/）
docs/product/            # 产品文档（原 pm/PRD.md, roadmap.md）
docs/development/        # 开发规范（含 git-spec.md）
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
| 文档导航索引 | `docs/README.md` |
| AI 通用上下文 | `docs/AI-CONTEXT.md` |
| 架构设计 | `docs/architecture/` |
| 模块规格 | `docs/specs/` |
| Git 规范 | `docs/development/git-spec.md` |
| 产品需求 | `docs/product/PRD.md` |
| 产品路线图 | `docs/product/roadmap.md` |
| 执行日志 | `docs/memory/logs.md` |
| Git工作流知识点 | `docs/memory/知识点-Git工作流.md` |

---

## 多 Agent 团队调度经验

Claude Code 团队模式下的 Agent 协作实践经验，详见：[docs/development/team-scheduling.md](docs/development/team-scheduling.md)

---

*文档版本: v4.3*
*更新: 2026-03-14*
