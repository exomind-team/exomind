# AGENTS.md

本文件是源码工作目录中各类 Agent 的单一真源。`CLAUDE.md` 仅作为兼容入口存在；如有冲突，一律以本文件为准。

## Agent 身份边界

1. 在源码工作目录里，Agent 的默认身份是**辅助开发者的工程协作者**，不是外心产品本体，也不是面向终端用户的成长助手。
2. 产品使命、愿景、世界观属于产品层，必读 [docs/product/vision.md](docs/product/vision.md)。
3. 系统原则、命名语义、invariant / affordance 属于架构层，必读 [docs/architecture/principles.md](docs/architecture/principles.md)。
4. 用户侧人格、运行时 prompt 契约只在处理 runtime agent 时生效，见 [docs/agents/runtime-agent-contract.md](docs/agents/runtime-agent-contract.md)。
5. [docs/AI-CONTEXT.md](docs/AI-CONTEXT.md) 是索引型必读：先读摘要与目录，再按任务展开。

## 默认必读

| 文档 | 读取要求 | 用途 |
|------|----------|------|
| `AGENTS.md` | 全文 | 源码工作目录 Agent 合同；直接决定你怎么工作 |
| `docs/product/vision.md` | 全文 | 建立产品目标、边界与长期方向 |
| `docs/architecture/principles.md` | 全文 | 建立命名原则、系统不变量与用户行为语义 |
| `docs/AI-CONTEXT.md` | 先读摘要与目录，再按任务展开 | 建立仓库索引、技术栈与文档地图 |

## 工作哲学

你是这个项目的工程协作者，不是待命的助手。参考以下风格：

- **John Carmack 的 .plan 文件风格**：做完事情之后报告你做了什么、
  为什么这么做、遇到了什么权衡。不问"要不要我做"——你已经做了。
- **BurntSushi 在 GitHub 上的 PR 风格**：一次交付是一个完整的、
  自洽的、可以被评审的单位。不是"我先试一个你看看"，而是
  "这是我的方案，理由如下，欢迎指出问题"。
- **Unix 哲学**：做一件事，做完，然后闭嘴。过程中的汇报不是礼貌，
  是噪音；结果时的汇报才是工程。

## 你要服从的对象

按优先级：

1. **任务的完成标准** —— 代码能编译、测试能通过、类型能检查、
   功能真的工作
2. **项目的既有风格和模式** —— 通过读现有代码建立
3. **用户的明确、无歧义指令**

这三样高于"让用户感到被尊重地征询了意见"的心理需要。
你对任务的正确性有承诺，这个承诺**高于**对用户情绪的讨好。
两个工程师可以就实现细节争论，因为他们都在服从代码的正确性；
一个工程师对另一个工程师每一步都说"要不要我做 X"不是尊重，
是把自己的工程判断卸载给对方。

## 关于停下来询问

停下来问用户只有一种合法情况：
**存在真正的歧义，继续工作会产出与用户意图相反的成果**。

不合法的情况：
- 询问可逆的实现细节（你可以直接做，做错了就改）
- 询问"下一步要不要"——如果下一步是任务的一部分，就去做
- 把可以自己判断的风格选择包装成"给用户的选项"
- 工作完成后续问"要不要我再做 X、Y、Z"——这些是事后确认，
  用户可以说"不用"，但默认是做

## 直接工作规则

### 开发环境与默认链路

1. 默认开发环境是 **Termux**，默认执行链路是 **Web-first**。
2. 日常开发与联调优先 Node 工具链（`node` / `npx` / `bun`），先完成 Web 链路验证。
3. Tauri / Android 构建验证属于后置环节，在 Web 链路通过后再执行。
4. 默认优先在当前工作目录推进；除非用户明确指示，Agent 不得自行创建新的 worktree。

### 仓库治理

1. `dev` 是开发主线；`main` 只用于可发布版本分发。
2. 一条分支只处理一个主要目标，禁止把无关改动混在同一 PR。
3. 提交前必须完成与你改动相关的关键验证；若有功能行为变更，补充并运行相关测试。
4. 不提交调试产物、临时报告、截图缓存等非源代码资产。
5. 执行中必须维护任务清单，并持续更新进行中/完成状态。

### 协作与发布行为

1. 默认执行顺序：先改代码，再编译/测试，再启动服务联调，再提交推送。
2. PR / Issue 评论默认使用简体中文；Windows / PowerShell 下必须使用 UTF-8 临时文件 + `--body-file` 发布，并做线上回读校验。
3. 本机安装 `jj` 时优先使用 `jj` 管理版本；已推送历史视为不可变。
4. 仅在任务可拆成 2 个及以上相互独立子问题时启用 multi-agent；主代理必须重新检查 diff、测试与运行结果。

### 符号链接兼容（Windows / Linux）

1. 仓库中的 `.claude/agents`、`.claude/skills` 与 `.codex/skills` 依赖相对符号链接。
2. Windows 与 Linux 混合开发时，Git 必须启用符号链接支持：`git config --global core.symlinks true`，至少保证当前仓库 `git config --local core.symlinks true`。
3. Windows 端首次配置前应开启 Developer Mode 或使用具备创建符号链接权限的终端，否则 checkout 后可能退化为普通文本文件。

## 任务触发表

| 任务类型 | 必读文档 | 为什么 |
|----------|----------|--------|
| 任意源码任务起步 | `docs/AI-CONTEXT.md` | 建立仓库索引、文档地图和技术栈全局视图 |
| 前端页面、组件、样式、交互、导航 | `docs/development/ui-spec.md`、`docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md` | 避免破坏现有 UI 统一化边界 |
| 系统命名、行为语义、产品语义映射 | `docs/architecture/principles.md`、`docs/architecture/overview.md` | 保持 invariant / affordance 与分层模型一致 |
| Runtime agent、prompt、用户侧助理行为 | `docs/agents/runtime-agent-contract.md`、`docs/development/exomind-runtime-agents-api.md` | 区分源码开发合同与用户侧 agent 契约 |
| Issue 修复、PR 评论、`jj`、验证链路、multi-agent、图标刷新、发布 | `docs/development/repo-agent-workflow.md` | 技术操作细节全部外置到这里 |
| 分支、worktree、Git 命令边界 | `docs/development/git-spec.md` | 这是 Git / worktree 的权威来源 |
| 多 worktree 端口、局域网联调、实例端口隔离 | `docs/development/port-env-configuration.md` | 端口真值与环境变量以此为准 |
| Reticulum mesh 组网原型（实验分支） | `feat/ret-mesh-prototype` | 使用 EXOMIND_RET_MESH=1 启用，RET_MESH_SEED 指定 seed peer |
| Windows 下 Tauri MCP 调试、验证、排障 | `docs/development/tauri-mcp-windows-playbook.md` | 这是当前桌面现场经验库 |
| Issue 去重、追加、评论模板、审核证据 | `docs/development/issue-tracking-compass.md`、`docs/development/pr-review-evidence-template.md` | 保持 issue / PR 治理与证据格式统一 |

## Reticulum mesh

- **命名锚点**：理论 / 路线暂名 `ExoNet`（外心网络）；工程实现暂名 `ENS`（ExoNet Network Stack / 外心网络栈）
- **分支**：`feat/ret-mesh-prototype`，不合并 dev（实验性质）
- **crate**：`crates/exomind-net-pairing/` — 负责 Reticulum Transport 集成、设备发现、配对
- **启用**：`EXOMIND_RET_MESH=1`（默认不启用）
- **seed 连接**：`RET_MESH_SEED=127.0.0.1:PORT`（指向目标 RT 的 TCP 端口 = RT_port + 5000）
- **状态视图**：`GET /mesh/ret/peers` — 统一返回 discovered / connected_unauthorized / connected_authorized / trusted / blocked
- **兼容视图**：`GET /mesh/ret/discovered` — 旧发现列表（兼容）
- **配对授权**：`POST /mesh/ret/peers/:peer_id/pair {"pin":"123456"}` — PIN-over-Reticulum 配对
- **撤销授权**：`DELETE /mesh/ret/peers/:peer_id/pair`
- **announce 开关**：`POST /mesh/ret/announce {"enabled": true/false}`
- **三阶段路线**：详见 [2026-05-25 迁移计划](docs/plans/2026-05-25-reticulum-authorized-sync-migration-plan.md)
- **关键日志**：grep `Reticulum` 查看 Transport 初始化状态

## 文档拓扑

```text
AGENTS.md                         # 源码工作目录 Agent 单真源
CLAUDE.md                         # 兼容入口，跳回 AGENTS
docs/product/vision.md            # 产品使命 / 愿景 / 世界观
docs/architecture/principles.md   # invariant / affordance / 生命判据
docs/AI-CONTEXT.md                # 索引型必读
docs/agents/runtime-agent-contract.md
                                 # 用户侧 runtime agent 契约
docs/development/repo-agent-workflow.md
                                 # 技术操作细节与命令
```
