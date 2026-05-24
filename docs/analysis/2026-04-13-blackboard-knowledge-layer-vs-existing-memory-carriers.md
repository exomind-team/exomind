# 2026-04-13 blackboard / knowledge layer 与现有 memory carrier 的断层调查

## 问题定义

这里说的“knowledge layer”，不是仓库里已经存在的正式 runtime 类型，而是当前讨论里那个尚未落到代码的分层契约：私有工作记忆 / 长期记忆 / 公共记忆到底怎样分层，哪些内容只能留在单 Agent 私有 memory，哪些内容经过蒸馏后才能进入 archive 级共享面。现有文档已经明确“工作记忆、长期记忆、公共记忆需要分层”，并且明确“公共记忆不应偷塞进单个 Agent 的私有 memory”，但同时又承认“长期记忆与 blackboard 的边界细则”仍待继续探讨。这说明问题不是 blackboard 完全没想过，而是分层规则只停在文档层，没有对应 runtime 抽象落地。（证据：[2026-04-06-agent-network-collective-ideas-consolidation.md](../plans/2026-04-06-agent-network-collective-ideas-consolidation.md):203-211,227-229; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):748-758）

当前断层有三层，不是一个命名问题。

第一层是 owner 断层。规划里的 `blackboard` 是“每档案一个持久对象”，而且是“actor 空间资源”；现有代码里的 `AgentWorkspace` 则是 `agents/{agent_id}` 下的私有目录，被直接定义成 agent 的 physical body。这两个对象的所有者不是一回事，一个属于 archive，一个属于 agent 本体。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):30-33,62-69; `crates/exomind-runtime/src/agent/workspace.rs:92-118`）

第二层是 scope 断层。blackboard 规划写的是 per-archive；当前运行时真正打穿全链路的 scope 却仍是 `profile_id / user_id`，内建 life agent 甚至还显式落回历史 `anonymous` bucket。只要 scope 还停在 profile 或匿名桶，archive 级共享层就没有稳定落点。（证据：[2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):32-43,104-107,166-176; `crates/exomind-runtime/src/agent/session.rs:365-369`; `src/lib/adapters/runtime-profile-scope.ts:1-10`; `crates/exomind-runtime/src/agent/life.rs:46-64`）

第三层是 interaction model 断层。blackboard Phase 1 要的是“时间序条目 + 追加修正 + 显式弹出最早条目 + 正式 route 回送”；现有 workspace knowledge 提供的是文件名级别 CRUD、总字节配额和目录枚举，life cognition 读到的也只是 knowledge 文件名摘要，不是共享条目流。把这两套模型硬套在一起，最后只会得到“换了名字的私有文件夹”，不是 blackboard。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):44-50,70-114; `crates/exomind-runtime/src/agent/cognition.rs:10-27,33-54`; `crates/exomind-runtime/src/agent/workspace.rs:158-240`; `crates/exomind-runtime/src/agent/life.rs:157-184,604-630`）

## blackboard 规划中已明确的边界

blackboard 的边界其实已经比很多人以为的更硬。[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md) 不是“脑暴笔记”，而是已经收口的 Phase 1 合同。

首先，它已经被明确收缩成“每档案一个持久对象，但语义临时、容量受限、以数据对象读写为主”的共享工作记忆面，而不是“长期保留 + 强审计总池”。Phase 1 只测信息记录、存储和读写；不做自动提升到任务 / 提案，也不做共享长期记忆池。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):13-18,30-42）

其次，它的条目模型不是文件模型，而是时间序条目。变更模型是追加修正，保留语义是语义临时，空间控制是每黑板总上限，接近上限先预警、再阻写。这里已经把 blackboard 定义成一个“可被撑满、必须释放”的 actor 空间资源，不是无限容器。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):44-69）

再次，它的释放语义也已经写死到足够具体。Phase 1 需要显式“移出黑板”动作，最小动作就是“弹出最早条目”；弹出后默认直接离开黑板存储，不自动升格为任务 / 提案，也不自动转入黑板内部归档区。文档甚至明确写出允许“直接删除”的理由，是为了让空间上限成为真实约束，而不是假约束。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):70-90）

最后，它不是孤立记事板，而是信号网络里的特殊共享节点。交互型请求可以建立正式 route；弹出动作在回送成功进入发送流程后才删除；这些回链不是私下 reply 通道，而是进入 archive 级持久路由、在 route editor 中可见的正式连边。换句话说，blackboard 的出入口已经被绑定到 network / route 语义，而不是普通文件 API。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):92-114; [2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](../plans/2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md):166-180,228-229）

补一层更上位的边界：集体档案文档已经把 blackboard 和 eventlog / proposal 的职责拆开了。集体 `eventlog` 默认可直接写但必须强审计；时间块和任务结构变更走提案门禁；`blackboard` 也可直接写，但不按“长期保留 + 强审计总池”实现。也就是说，规划层已经拒绝把 blackboard 写成第二个 eventlog，也拒绝把它写成 proposal 前置缓存池。（证据：[2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):142-152,166-185; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1308-1311）

## 当前 workspace / knowledge / life agent 已经占据的语义位置

### 1. `AgentWorkspace` 已经是“私有长期记忆载体”

`AgentWorkspace` 的目录布局写得非常直白：`bootstrap/SOUL.md` 是 immutable DNA / identity，`knowledge/` 是 mutable long-term memory，`actions.jsonl` 是 append-only action log，`agent.state.json` 是认知状态快照。初始化路径也是 `base_dir/agents/{agent_id}`。这已经不是“一个临时实现细节”，而是一整套 agent 私有身体模型。（证据：`crates/exomind-runtime/src/agent/workspace.rs:95-138`）

更关键的是，这个 carrier 已经有完整操作面：文件名校验、读写删、总字节统计、配额阻止写入、目录枚举，全部现成。blackboard 同样要求容量受限、数据对象读写、显式空间控制；工程上最危险的捷径就是顺手复用这个壳，结果把 archive 共享面做成 agent 私有 knowledge 子目录。（证据：`crates/exomind-runtime/src/agent/workspace.rs:160-240`; [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):44-69）

### 2. life agent 已经把 workspace knowledge 当成“默认记忆面”

`CognitionContext` 里直接把 knowledge 定义成“long-term knowledge files”的 summary / index，`KnowledgeOp` 也直接是对 long-term memory 的写删操作。`CognitiveLifeAgent` 的 `body_status()` 会把 `knowledge_usage_ratio` 当成身体状态的一部分；`apply_knowledge_ops()` 会把 cognition 输出直接落到 workspace knowledge 文件，并对 `diary.md` 做特殊追加处理。也就是说，当前认知闭环已经天然把 workspace knowledge 当成 life agent 的记忆接口，而不是可替换组件。（证据：`crates/exomind-runtime/src/agent/cognition.rs:10-27,33-66`; `crates/exomind-runtime/src/agent/life.rs:135-184`）

默认 `LlmCognition` 更把这种语义固化了。高能量状态下，它会生成 `diary.md` 条目；低能量状态下则选择不写 knowledge 或只发 signal。这里的“知识”不是共享工作面，而是 diary 风格的私有长期文件。测试也把“tick 后应出现 `diary.md`”当成正确行为的一部分。（证据：`crates/exomind-runtime/src/agent/llm_cognition.rs:181-215`; `crates/exomind-runtime/src/agent/life.rs:827-857,885-910`）

### 3. 这套私有记忆语义已经被 UI 和 API 公开出来

运行时已经对 life agent 暴露 `/agents/:agent_id/workspace/{soul,knowledge,actions,state,status}` 这套 REST 路由；Tauri 命令层又把这些路由原样转发给前端；Agents 页则只要是 life agent 就直接渲染 `WorkspaceTabs`。Tabs 名称已经固定成“知识库 / 行动日志 / 身份”，动作类型文案也已经固定成“记忆写入 / 记忆删除”。这意味着“workspace knowledge = agent 的知识库 / 记忆面”不只是代码内部事实，已经是产品表面事实。（证据：`crates/exomind-runtime/src/routes/workspace.rs:72-160`; `src-tauri/src/commands/workspace_commands.rs:1-160`; `src/ui/app/pages/agents/AgentDetailPage.tsx:266-267`; `src/ui/app/pages/agents/WorkspaceTabs.tsx:54-97,127-132,513-539`）

### 4. eventlog / proposal 已经占据了“业务真相 carrier”

EventLogStore 不是泛用 memory，它是按 `user_id` 作用域存储 `EventRecord` 的事件真相载体，支持 append、list、mirror、checkpoint 和 watcher 通知；路径层面直接落成 `{user}.json`、`{user}.md` mirror 和 checkpoint 文件。ProposalStore 也不是便笺池，而是按 `scope_key` 存储带 `status`、`publisher`、`action_type` 的 typed proposal 对象。Proposal 执行器在 proposal 被批准后，会把动作落实到任务、时间块和 eventlog。这里已经形成一条清晰分工：eventlog 记发生过什么，proposal 记待裁决和已裁决的动作，执行后再回写业务对象与事件痕迹。（证据：`crates/exomind-runtime/src/eventlog.rs:22-48,78-85,124-174,298-310,346-360`; `crates/exomind-runtime/src/proposal/mod.rs:12-27,29-37,96-124`; `crates/exomind-runtime/src/proposal/store.rs:64-186`; `crates/exomind-runtime/src/proposal/executor.rs:45-188`）

### 5. 现有 scope 仍是 `profile / user_id`，不是 `archive`

`scope_key()` 当前先取 `profile_id`，再退回 `user_id`；前端统一把当前 profile 透传成 `user_id` query。内建 life agent 的 agent-api tick 还默认绑在 `anonymous` bucket，并用这个 scope 去读取 recent events 和创建 proposal。主题总报告也已经明确指出：当前 inspected code 仍主要围绕 `profile/user_id` 做作用域隔离，并未出现等价的集体档案运行时模型。只要这一层没换成 archive 级 owner，blackboard 很容易继续被塞进旧桶里。（证据：`crates/exomind-runtime/src/agent/session.rs:365-369,445-473`; `src/lib/adapters/runtime-profile-scope.ts:1-10`; `crates/exomind-runtime/src/agent/life.rs:46-64,479-499`; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1070-1099）

## 为什么新层容易与旧 memory carrier 混层

第一，命名已经先被旧实现占了。当前代码和 UI 把 `knowledge`、`知识库`、`记忆写入` 全都绑定到 `AgentWorkspace` 上，而规划文档又在谈“工作记忆 / 长期记忆 / 公共记忆分层”。当旧实现已经把“knowledge”产品化时，任何新提的 “knowledge layer” 都会天然被理解成“把 workspace knowledge 再做厚一点”，而不是引入一个 archive 级共享对象。（证据：`crates/exomind-runtime/src/agent/workspace.rs:95-103`; `src/ui/app/pages/agents/WorkspaceTabs.tsx:127-132,513-539`; [2026-04-06-agent-network-collective-ideas-consolidation.md](../plans/2026-04-06-agent-network-collective-ideas-consolidation.md):203-211）

第二，工程接口太像了。blackboard Phase 1 要“容量受限 + 数据对象读写 + 空间占用统计”；workspace knowledge 也已经有“字节配额 + 文件 CRUD + usage ratio + 列表 API”。如果只看实现便利性，不看 owner 和语义，最省事的方案就是在 workspace 上再加几个字段或目录。问题在于，这种复用会直接抹平“私有长期记忆”和“archive 共享工作面”的边界。（证据：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):44-69; `crates/exomind-runtime/src/agent/workspace.rs:160-240`; `crates/exomind-runtime/src/routes/workspace.rs:124-160`）

第三，现有 cognition 管线根本没有 blackboard 插槽。life agent 在 tick 时只把 `knowledge_summary` 传给 cognition，而且这个 summary 只是 knowledge 文件名拼接结果；工具面只有 recent events 和 proposal tools，没有 blackboard read / write 工具。这意味着如果不先改 cognition contract，blackboard 就只能以两种方式接入：要么被忽略，要么被冒充成现有 knowledge_summary 的一部分。这两条路都会混层。（证据：`crates/exomind-runtime/src/agent/cognition.rs:12-27,33-54`; `crates/exomind-runtime/src/agent/life.rs:604-630`; `crates/exomind-runtime/src/agent/life.rs:479-499`）

第四，现有 truth carrier 已经很稳，blackboard 容易被错当成它们的替代品。proposal executor 明确把批准结果执行到 task / timeblock / eventlog；eventlog 自己还带 mirror / checkpoint；主题总报告也明确说任务、时间块、提案、事件日志仍各自保有业务真相地位。如果 blackboard 没有被强约束成“共享工作记忆、协调便笺和摘要痕迹”，开发中很容易把原始事件、待办草稿甚至待审动作直接堆进 blackboard，最后与 eventlog / proposal 抢语义地盘。（证据：`crates/exomind-runtime/src/proposal/executor.rs:45-188`; `crates/exomind-runtime/src/eventlog.rs:124-174,298-310`; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1308-1311）

第五，archive 级 runtime owner 还没在代码里长出来。blackboard 规划写的是 per-archive 持久对象，且在集体档案中默认对 `active_member` 可读；但当前 theme 报告直接指出，blackboard 还没有实现命中，相关主题仍偏计划驱动。没有 archive-level runtime object 的情况下，最顺手的落点还是现有 agent workspace 或 profile-scoped store，这正是混层的土壤。（证据：[2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):166-185; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):580,609,765-767,1097-1099）

## 迁移阻力

### 1. 已经存在的 API / UI / 文案债

`workspace/knowledge` 已经有 REST 路由、Tauri 命令、前端标签页和状态卡。要把 blackboard 或新 knowledge layer 引进来，不能只加一个 store；还必须决定是保留现有“知识库”给私有记忆，还是把它让给共享层。如果这一步不重命名，用户和开发者都会把 archive 共享面误解成 agent 私有知识库的一个变体。（证据：`crates/exomind-runtime/src/routes/workspace.rs:72-160`; `src-tauri/src/commands/workspace_commands.rs:91-160`; `src/ui/app/pages/agents/WorkspaceTabs.tsx:513-539`）

### 2. 存储 owner 需要从 `agent_id` 迁到 `archive_id`

现有 `AgentWorkspace` 直接以 `agents/{agent_id}` 为根，所有知识、状态、日志都绑定到 agent 本体。blackboard 规划却要求“每档案一个持久对象”，并且在集体场景里还要记录作者与座席 / 设备。也就是说，新层不只是新目录，而是新的 owner、归因字段和访问控制模型。（证据：`crates/exomind-runtime/src/agent/workspace.rs:114-137`; [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):51-59; [2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):166-185）

### 3. 作用域基础设施仍然偏旧词

现在从 session 到 frontend query，跑通的是 `profile_id / user_id`；内建 life agent 还显式绑定 `anonymous`。blackboard 若继续沿用这条链，就会把“archive 共享面”错误地落在 profile 作用域上；若要纠偏，则必须同步改 session、adapter、store key 和 route 语义，不是单点 patch。（证据：`crates/exomind-runtime/src/agent/session.rs:365-369`; `src/lib/adapters/runtime-profile-scope.ts:1-10`; `crates/exomind-runtime/src/agent/life.rs:46-64`; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1097-1099）

### 4. 审计与删除语义并不兼容

eventlog 是强审计载体，带 mirror / checkpoint；workspace knowledge 则支持直接删除和覆盖；blackboard 规划要的是“显式弹出最早条目”“必要时直接离开黑板存储”，但同时又把“是否需要 retained tombstone / 额外可见痕迹”留成未决问题。三者的 retention model 完全不同，不能简单复用其中任意一个。（证据：`crates/exomind-runtime/src/eventlog.rs:212-220,298-310`; `crates/exomind-runtime/src/agent/workspace.rs:182-205`; [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):70-90,116-124,183-193）

### 5. life agent 的默认叙事已经围绕私有 diary 和 proposal 建起来了

当前单 Agent 主闭环是 `timeblock.completed -> 总结 + 建议 + pending proposal`，而 `blackboard` 在这个闭环里只收摘要痕迹。代码层的默认 cognition 却仍是“写 `diary.md` + 可能发 signal”，并没有“摘要写入 blackboard”的步骤。换句话说，旧叙事已经运行，新层想插进来，必须明确替换哪一步，而不是再加一个并行存储面。（证据：[2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](../plans/2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md):166-180,228-229; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):749-751,767; `crates/exomind-runtime/src/agent/llm_cognition.rs:181-215`）

## 建议的后续验证问题

1. blackboard 的第一责任 owner 到底是谁：`ArchiveSession`、成员座席、还是某个 life agent？如果不先定 owner，后面所有 store 设计都会自然滑回 `AgentWorkspace`。（参照：[2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):36-43,104-107,166-185）

2. runtime 里是否要给 blackboard 单独的 store / route / tool，而不是继续挂在 `/agents/:agent_id/workspace/*` 下面？这题不先答，工程上最省事的实现一定是错误实现。（参照：`crates/exomind-runtime/src/routes/workspace.rs:72-160`; [2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):44-50,92-114）

3. “只有蒸馏后的共享内容才写入 blackboard”在代码层最小合同是什么？至少要给出 3 类允许写入示例和 3 类禁止写入示例，否则边界会继续停留在口头层。（参照：[2026-04-06-agent-network-collective-ideas-consolidation.md](../plans/2026-04-06-agent-network-collective-ideas-consolidation.md):203-211; [2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md](../plans/2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md):170-180）

4. 现有 `diary.md`、私有 knowledge 文件和未来 blackboard 条目之间是否存在蒸馏关系？如果存在，谁触发、何时触发、失败后是否重试，都要定；如果不存在，也要明确声明“私有 diary 永不自动进入 blackboard”。（参照：`crates/exomind-runtime/src/agent/life.rs:157-184,604-630,827-910`; `crates/exomind-runtime/src/agent/llm_cognition.rs:181-215`）

5. blackboard 的 scope key 最终是 `archive_id`、`archive_session_id` 还是别的键？它怎样与当前 `profile_id / user_id` 兼容或切断？没有这一步，archive 语义无法进入代码主路径。（参照：`crates/exomind-runtime/src/agent/session.rs:365-369`; `src/lib/adapters/runtime-profile-scope.ts:1-10`; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1097-1099）

6. “弹出最早条目”是否必须留下 tombstone、eventlog 事件或 route history 之外的额外痕迹？这个问题现在被后置，但如果不尽快定，blackboard store 的数据模型就无法稳定。（参照：[2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md](../plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md):96-124,183-193; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1255-1259）

7. 在 UI 上，blackboard 应该出现在 node / workbench 附近，还是先作为 archive 级对象面板出现？规划已经倾向前者；如果实现时又复用当前 life agent workspace 页，就等于从入口层面把共享层误做成 agent 私有工具页。（参照：[2026-04-06-multi-archive-and-collective-settled-decisions.md](../plans/2026-04-06-multi-archive-and-collective-settled-decisions.md):180-185; `src/ui/app/pages/agents/AgentDetailPage.tsx:266-267`; `src/ui/app/pages/agents/WorkspaceTabs.tsx:513-539`）

8. 最小验收测试应该如何写，才能证明没有混层？至少需要三条硬测试：blackboard 不落在 `AgentWorkspace/knowledge`；eventlog 原始事件不会自动变成 blackboard 条目；proposal / task / timeblock 仍保持业务真相地位而不是退化成 blackboard 内嵌对象。（参照：`crates/exomind-runtime/src/agent/workspace.rs:95-138,158-240`; `crates/exomind-runtime/src/eventlog.rs:124-174`; `crates/exomind-runtime/src/proposal/executor.rs:45-188`; [2026-04-06-theme-discussion-total-report.md](2026-04-06-theme-discussion-total-report.md):1308-1311）

## 一句话结论

当前真正的断层不是“还没实现 blackboard”，而是“archive 级共享工作记忆已经有了清楚规划，但代码里已存在的私有 memory carrier 也已经完整成型”。如果不先把 owner、scope、API 和蒸馏合同切开，所谓 blackboard / knowledge layer 最终只会沦为 `AgentWorkspace/knowledge` 的别名。
