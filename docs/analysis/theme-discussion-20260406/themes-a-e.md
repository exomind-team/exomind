# 讨论背景、主题 A 至 E

[返回《2026-04-06 主题讨论总报告》](../2026-04-06-theme-discussion-total-report.md)

2026-04-06 主题讨论总报告







            2026-04-06 · Theme Governance Report

            2026-04-06 主题讨论总报告



              这份报告把 2026-04-04 原始讨论材料、4 月 6 日主题总集、4 月 7 日与 4 月 8 日后续收口文档，以及当前
              dev 分支代码现状压成同一张治理看板。目标不是再写一份长计划，而是让后续能直接用这份 HTML
              看主题、看进度、看已决 / 未决、看源文件、继续与星林讨论。[raw appendix][master][round-2]




              分支 dev
              基线提交 6e666bb5
              归一主题 10
              扩大讨论簇 3
              目标 能看 · 能溯源 · 能讨论






              原始材料压缩结果

              25 → 10

              原始零散消息被压成 10 个批次，其中“档案系统 OS 层”已从“集体档案”主题里单独拆出，避免继续混谈。[round-2][archive-os]





              当前推进分层

              6 / 3 / 1

              6 个主题已收口为主线或子计划，3 个主题部分收口，1 个主题明确后置；另有 3 个扩大讨论问题簇。[roadmap][discussion-clusters]










        筛选主题
        全部
        已收口
        部分收口
        后置

          已收口
          部分收口
          扩大讨论
          后置








            Overview

            一眼看全局


            先看主题分层，再看当前代码快照和详细主题卡片。后续继续讨论时，直接从“扩大讨论问题簇”接上即可。[round-2][clusters]







          已收口主题
6
A/B/E/G/H/I 已有主线或子计划，且 G 与 H 已正式拆开。[roadmap][archive-os]


          部分收口主题
3
C/D/F 已有方向和边界，但未全部进代码。[multi-agent][energy][docs-pipeline]


          后置主题
1
J 只保留研究价值，不进入当前关闭条件。[master]


          扩大讨论簇
3
集体 Agent、防伪、审计界面都已转成问题清单。[discussion-clusters][issue #860][issue #837]


          当前 dev 现实
混合态
signal / proposal / energy / website 已有骨架，archive OS / collective archive / blackboard / bookkeeping 仍偏计划驱动。[routes][website-docs][blackboard][bookkeeping]





          阅读提示：本页强调的是“主题治理”和“推进状态”，不是最终架构定稿，也不是完整验收报告。
          当前现状评估基于代码 / 文档 / issue 的只读检查，未额外运行新一轮 tsc、vitest 或 E2E。[roadmap]







            Dev Snapshot

            当前 dev 快照


            不是理想架构图，而是“今天已经能在仓库里看到什么”。[routes][workspace.rs][website-docs]








            已经在代码里有锚点



              Signal Network 已有默认路由 config/signal-routes.default.json、route 编辑面 src/components/RouteEditPanel.tsx，以及 Agents 页中的 route/history 观察面 src/ui/app/pages/agents/RoutesTabView.tsx、src/ui/app/pages/agents/SignalHistoryTabView.tsx。[routes][route-edit][routes-tab][history-tab]
              单 Agent 记忆 / 提案 已有 workspace crates/exomind-runtime/src/agent/workspace.rs、life tick crates/exomind-runtime/src/agent/life.rs、proposal tools crates/exomind-runtime/src/agent/proposal_tools.rs 与 proposal store crates/exomind-runtime/src/proposal/store.rs。[workspace.rs][life.rs][proposal-tools][proposal-store]
              运行能量 已有能量生命周期锚点 crates/exomind-runtime/src/agent/life.rs 和能量路由面 crates/exomind-runtime/src/routes/energy.rs。[life.rs][energy-route]
              官网承接面 已有 Astro 站点、导航中的 website/src/components/Header.astro 指向 /docs，但正文页 website/src/pages/docs.astro 仍是占位状态。[header][website-docs]



            还主要停留在计划 / issue



              blackboard 在本次对 src/ 与 crates/ 的检索中没有实现命中，当前仍主要存在于 docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md。[blackboard]
              多 Agent proposal-first 状态机 虽然 in_review 已存在于 src/lib/types/proposal.ts 与 crates/exomind-runtime/src/proposal/store.rs，但 changes_requested 仍未进入 inspected code。[proposal.ts][proposal-store][multi-agent]
              档案系统 OS 层 规划已经写入 docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md，但当前代码仍广泛保留 profile 旧词，如 src/lib/adapters/runtime-profile-scope.ts、src/components/Chat/ChatPage.tsx。[archive-os][runtime-profile-scope][chat-page]
              独立集体记账 当前仍是主仓计划资产，按计划应尽快独立出仓，而不是长期留在 ExoMind 主仓实现。[bookkeeping][issue #845]









            Roadmap

            当前主线 / 并行线 / 扩大讨论顺序


            它决定哪些主题现在要变成开发任务，哪些只保留为问题簇。[roadmap][discussion-clusters]








            主线里程碑



              1. 个人同步基线[roadmap][issue #532]
              2. Signal Network v1[signal-plan][issue #387]
              3. 单 Agent 时间块闭环[signal-plan][issue #677]
              4. 再抬升到多 Agent / 双计量 / 多档案治理层[multi-agent][energy][archive-os]



            并行线与问题簇



              并行线：#865 用户手册、#847 对外草案包、#845 独立记账。[manual][docs-pipeline][bookkeeping]
              治理层顺序：#846 多 Agent 先于 #848 双计量。[multi-agent][energy]
              扩大讨论：#860 集体 Agent、防伪 / 标识轮换、审计界面。[discussion-clusters][issue #860][issue #837]









            Theme Atlas

            十大主题总览


            先看索引，再往下看详细主题卡片。[round-2][roadmap]







          A
信号网络语义与节点模型

signal network v1 的语义合同、节点进入方式与 route 行为。[signal-plan][issue #387]

已收口#387#833

          B
API Agent 记忆、总结与提案闭环

以 timeblock.completed 为中心的单 Agent 闭环。[signal-plan][issue #71]

已收口#71#677

          C
多 Agent 协作与服务员体系

proposal-first 四角色治理先行，统一服务员后置。[multi-agent][issue #846]

部分收口#846

          D
Agent 能量与资源双计量

运行资源 × 模型资源并列表达，先服务治理和调度。[energy][issue #848]

部分收口#848

          E
多端同步与验证链

先做个人同步基线，再把 network / collective 场景接入验收链。[roadmap][issue #532]

已收口#532#518

          F
对外文档、用户手册与宣传生成

开发文档和普通用户手册双分支并行，后续接 prompt-first 工作流。[docs-pipeline][issue #865]

部分收口#847#865

          G
档案系统 OS 层

默认档案、档案切换器、ArchiveSession / UiSession、多档案并活。[archive-os][issue #837]

已独立收口#837

          H
集体档案 / 组织档案模型

成员座席、邀请、blackboard、集体治理与 route 门禁。[collective][issue #860]

主线已收口#837#860

          I
集体记账 / Labor Ledger

先独立、先承接旧功能、先稳领域事件模型和本地 API。[bookkeeping][issue #845]

独立子计划#845

          J
复杂跨层组织协作

保留研究价值，但不进入当前 backlog 的关闭条件。[master][raw appendix]

后置









              A


                信号网络语义与节点模型


                v1 先收口为固定节点 + 可配边；连边既是默认下游，也是通信门禁。





            已收口


          Theme A 解决的是“外心怎么把 signal、node、actor、Agent、edge 这套词说清楚”。当前已经压到一个足以开工的合同：先做可观测、可配置、能硬失败的网络骨架，而不是一上来做通用编排宇宙。[plan][round-2]



            决策收口


5/5


            代码锚点


3/5


            离落地距离


主线前列






              已决



                node / actor / Agent 已明确按方法论视角表述，不是程序本体分类。[master][round-2]
                v1 固定为“固定节点 + 可配边”，第一批对象以内建领域节点进入网络，blackboard 作为特殊共享节点进入 v1 语义。[plan][issue #387]
                edge 对用户表达“输出后默认送达给谁”，对系统表达“只有建边才允许通信”；无边发信默认硬失败。[plan][issue #833]
                topic 先采用预注册集合，通配 * 只保留给前端观察与诊断，不作为通用业务兜底。[routes][plan]




              未决 / 后续细化



                完整 CRUD 验收清单仍待继续压实，尤其是禁用态、失败态、提示与测试样本。[master]
                “会话 / 通道”与“节点 / 连边”的边界虽然已有方向，但还没收成最终统一表述。[master]
                动态建边、临时路由覆盖层、更强编排能力与条件控制节点都明确后置。[round-2]




              当前 dev 现状



                默认路由已经存在，且能看到 timeblock.completed -&gt; reviewer 这样的预置连边雏形。[routes]
                前台已有 route 编辑与 signal history 观察面，说明“可看 / 可改”这层已经开始成形。[ui-route-edit][ui-history]
                但 inspected code 仍更像“route table + UI CRUD”，离完整的 workflow 语义合同还有最后一轮统一。[ui-routes][plan]






            docs/plans/2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md
            docs/plans/2026-04-06-remaining-themes-second-round-settled-plan.md
            config/signal-routes.default.json
            src/components/RouteEditPanel.tsx
            src/ui/app/pages/agents/RoutesTabView.tsx
            src/ui/app/pages/agents/SignalHistoryTabView.tsx
            #387
            #691
            #833







              B


                API Agent 记忆、总结与提案闭环


                单 Agent 关键用户叙事收口到 timeblock.completed。





            已收口


          Theme B 不再泛谈“Agent 会不会记忆”，而是明确先把单 Agent 的工作记忆、长期记忆、共享痕迹，以及总结到提案的自动链路压成一个可跑的产品故事。[plan][issue #71]



            决策收口


5/5


            代码锚点


4/5


            离落地距离


缺 blackboard






              已决



                工作记忆、长期记忆、公共记忆必须分层；公共痕迹不能偷塞进单 Agent 私有 memory。[master][issue #71]
                单 Agent 第一条关键叙事是 timeblock.completed，默认产出“总结 + 建议 + pending proposal”。[plan][issue #677]
                blackboard 是 per-archive、语义临时、容量受限的共享工作记忆面，在这条闭环里默认只收摘要痕迹。[blackboard]
                黑板 Phase 1 合同已补到“时间序条目 + 追加修正 + 显式弹出最早条目 + 正式 route 回送”。[blackboard]




              未决 / 后续细化



                长期记忆与 blackboard 的精确边界仍待细化，尤其是蒸馏、遗忘、提炼与读取面。[blackboard]
                哪类信号默认写入黑板、哪类只保留在私有经验文件，目前仍需围绕产品叙事继续压实。[master]
                闭环进入更多对象域前，还需要再验证时间块、事件、任务、提案之间的最小引用合同。[plan]




              当前 dev 现状



                AgentWorkspace 已经有 SOUL.md、knowledge、actions log 等物理体布局。[workspace.rs]
                CognitiveLifeAgent 已能基于最近事件做 tick，会话与提案工具链也已存在。[life.rs][proposal_tools.rs]
                但真正缺的不是“Agent 能不能调模型”，而是 blackboard 的独立实现，以及完整的“总结 -&gt; 建议 -&gt; 提案”产品闭环。[blackboard][proposal-store]






            docs/plans/2026-04-06-signal-network-v1-and-timeblock-agent-loop-plan.md
            docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
            crates/exomind-runtime/src/agent/workspace.rs
            crates/exomind-runtime/src/agent/life.rs
            crates/exomind-runtime/src/agent/proposal_tools.rs
            crates/exomind-runtime/src/proposal/store.rs
            src/lib/types/proposal.ts
            #71
            #677







              C


                多 Agent 协作与服务员体系


                先做 proposal-first 任务治理，不先做统一服务员前台。





            部分收口


          Theme C 的关键不是“多 Agent 很酷”，而是先把它收缩成一个受约束的任务治理层：固定角色、固定门禁、固定人类终审位置。这样才不会让它吞掉 signal / proposal / collective 的讨论边界。[plan][issue #846]



            决策收口


4/5


            代码锚点


2/5


            离落地距离


治理先行






              已决



                第一阶段先做任务治理，不先做多模态服务员，不先做通用 teammate 框架。[plan]
                固定四角色：coordinator、proposer、reviewer、retrospector。[plan]
                主队列采用 proposal-first；in_review 的正式语义已纠偏为“等待人类 UI 终审”。[round-3][round-5]
                reviewer 只能评论 / 退回 / 推进到 in_review，不能直接批准；默认最多 3 轮退回-修订后强制进入人类终审。[round-3]




              未决 / 后续细化



                changes_requested 的正式产品与代码状态还没落地，前台痕迹面也还未完全实现。[round-3]
                统一服务员入口、多模态服务员、动态 teammate 持久化都明确后置。[plan]
                多设备下的复杂分布式裁决只保留边界，不进入第一阶段关闭条件。[plan]




              当前 dev 现状



                前台已有提案入口和 Proposal Inbox，说明“任务治理表面”已经有落点。[routes.tsx]
                提案状态里已有 pending / in_review / approved / rejected / snoozed，但 inspected code 尚无 changes_requested，也还没把 rejected -&gt; cancelled 这轮纠偏落下去。[proposal.ts][round-3]
                现状更像“提案系统 + 人工入口已存在”，而不是“多 Agent 治理层已实现”。[proposal-store]






            docs/plans/2026-04-06-multi-agent-task-governance-phase1-plan.md
            docs/plans/2026-04-07-third-round-super-question-settled-decisions.md
            docs/plans/2026-04-08-fifth-round-super-question-settled-decisions.md
            src/routes.tsx
            src/lib/types/proposal.ts
            crates/exomind-runtime/src/proposal/store.rs
            #846







              D


                Agent 能量与资源双计量


                actor 与 Agent 都是方法论视角，差别在治理变量，不在程序本体。





            部分收口


          Theme D 现在最重要的纠偏已经完成：不要把“Agent 比 actor 更神秘”写成底层程序分类，而应写成“外心对它额外追踪了更多资源与治理变量”。双计量因此成为治理壳，而不是神秘电池比喻。[plan][issue #848]



            决策收口


4/5


            代码锚点


3/5


            离落地距离


治理面缺口大






              已决



                actor 与 Agent 都是方法论概念，差别在系统关注和监控的变量，而不是底层程序先天分类。[plan]
                第一阶段采用“双账本，同界面”：运行资源看时空资源，模型资源看 token / 调用额度 / 成本。[plan]
                凡是 RT 托管、且被视作 Agent 节点的对象，都默认进入双计量治理面；记录以 invocation 为主粒度、按 turn 聚合。[round-5]
                人类告警与 Agent 自观测先落在 diagnostics / workbench，Agent 侧默认走只读工具 / API。[plan]




              未决 / 后续细化



                正式 diagnostics / workbench 界面、告警规则与统一表达尚未落稿。[plan]
                完整生命叙事、自动补能 / 自动续命、跨多 Agent 的统一配额编排都明确后置。[plan]
                如果未来把这层扩到 actor 普遍治理，还要补资源面和人机可见面之间的边界。[round-5]




              当前 dev 现状



                运行时已经有能量快照、tick 成本、降频与补能逻辑，说明底层 life/energy 不是空白。[life.rs][energy.rs]
                但“token / 调用成本 / 运行能量”仍未在同一治理表面真正合流。[plan]
                现状更接近“底层能力已有、产品治理面未完成”，而不是双计量已经成型。[issue #848]






            docs/plans/2026-04-06-agent-energy-and-dual-metering-phase1-plan.md
            docs/plans/2026-04-07-third-round-super-question-settled-decisions.md
            docs/plans/2026-04-08-fifth-round-super-question-settled-decisions.md
            crates/exomind-runtime/src/agent/life.rs
            crates/exomind-runtime/src/routes/energy.rs
            #848







              E


                多端同步与验证链


                先做个人同步基线；Tauri manager 是桌面验收标配。





            已收口


          Theme E 的价值在于给“什么时候算真的可用”定了一条验收梯子。它把同步、manager、真实桌面验收和后续 signal / collective 场景接到了同一条验证链里。[plan][issue #532]



            决策收口


5/5


            代码 / 文档锚点


4/5


            离闭环距离


collective 仍缺






              已决



                实现顺序先做个人同步基线，再往上接 signal network 和更强的 collective 协作。[plan]
                Tauri manager 被明确锁为桌面真实验收标配，而不是可有可无的开发附属工具。[issue #518][playbook]
                第一批标准拓扑至少覆盖 Web + Desktop，后续再接 Windows ↔ Android 与 Android ↔ Android。[plan]
                验收不能只看数据同步，还要带代表性的 network / agent 用户叙事。[master]




              未决 / 后续细化



                signal network / collective 场景进入验收链后的标准叙事还需继续补足。[master]
                Proposal 当前只收口到草案 / 列表 / 状态一致，不包含审批副作用的全链路验收。[plan]
                Android、Windows、Web 的稳定性闭环与回归清单仍需持续补证据。[issue #532]




              当前 dev 现状



                #532 已在追踪新 RT + ECS 跨端同步，#518 已在追踪受管 tauri dev 工作流。[#532][#518]
                Windows 侧已有 Tauri MCP / manager 经验库和手工验收清单文档。[playbook][checklist]
                底层同步与验收工具链已经真实存在，但“最终标准验收梯子”还没有完全收尾。[plan]






            docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md
            docs/development/tauri-mcp-windows-playbook.md
            docs/testing/2026-03-30-mdns-link-proof-manual-checklist.md
            #518
            #532
