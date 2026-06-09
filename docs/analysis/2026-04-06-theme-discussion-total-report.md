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
          

        

        
          
            
              F

              
                对外文档、用户手册与宣传生成


                开发手册 / 对外叙事双分支并行；官网 /docs 收口为 5 个入口。

              

            

            部分收口
          

          Theme F 已拆成两条线并行：一条是 #847 的已验证里程碑到对外叙事草案包，另一条是 #865 的普通用户手册与官网 /docs。再往后，才是 prompt-first 文档生产链。[manual][pipeline]


          
            决策收口


4/5


            代码 / 站点锚点


3/5


            离上线距离


内容先行


          

          
            
              已决


              
                仓库 Markdown 是 canonical 真相源，网站只镜像已验收内容，当前仓库的 website/ 是承接面。[manual][header]
                官网 /docs 最终收为 5 个入口：3 分钟上手、核心概念、场景教程、常见问题 / 排障、进阶。[manual]
                首版最小必须有正式正文的只有“3 分钟上手”和“常见问题 / 排障”；其他入口可先以摘要或即将上线承接。[round-5]
                prompt-first 文档链 v1 只做到草稿生成层，先产出 #847 草案包和 #865 提取清单。[pipeline][#847][#865]
              
            

            
              未决 / 后续细化


              
                “草稿进入 canonical / 上站链”的正式门禁仍留作后续讨论。[pipeline]
                官网仓是否将来独立、如何与内容源仓解耦，也明确记为后续主题。[manual]
                对外宣传叙事仍需继续校准，尤其是旧 README 与当前主线能力之间的差异。[README][issue #242]
              
            

            
              当前 dev 现状


              
                README、README-zh、用户指南种子稿和官网导航都已经存在，说明“文档表面”不是空白。[README][user-guide][header]
                但 website/src/pages/docs.astro 仍是 Coming Soon，占位明显落后于 4 月 7 日和 4 月 8 日的决策。[docs.astro][manual]
                现状更接近“站点壳已在，信息架构已定，内容与工作流还没真正接上”。[pipeline]
              
            

          

          
            docs/plans/2026-04-07-fourth-round-user-manual-phase1-settled-decisions.md
            docs/plans/2026-04-08-fifth-round-super-question-settled-decisions.md
            docs/plans/2026-04-08-sixth-round-docs-pipeline-prompt-first-v1-decisions.md
            README.md
            docs/README.md
            src/docs/user-guide.md
            website/src/components/Header.astro
            website/src/pages/docs.astro
            #242
            #847
            #865
          

        

        
          
            
              G

              
                档案系统 OS 层


                默认档案、多档案并活、ArchiveSession / UiSession 与档案切换器。

              

            

            已收口
          

          Theme G 现在已经独立于“集体档案”主题。它关注的是 Tauri App 内部如何像操作系统一样管理多个档案：默认档案如何存在、窗口如何切换、会话如何恢复、哪些状态属于 RT，哪些状态属于 UI。[os-layer][session]


          
            决策收口


5/5


            代码锚点


2/5


            离落地距离


迁名先行


          

          
            
              已决


              
                核心术语正式锁为 archive，并要求文档与 UI 统一迁移，不再把 profile 当核心术语。[os-layer]
                OS 层默认进入固定内置默认档案，通过档案切换器进入其他档案；默认档案可显式升级为正式个人档案。[os-layer]
                ArchiveSession 表示 RT 本地运行会话，UiSession 表示 UI 终端连接；切档案采用“先连新档案，再关旧档案”的事务流。[session]
                默认档案第一阶段能力边界固定为“本地功能 + 同步”，明确不承接公开身份与集体接入。[os-layer]
              
            

            
              未决 / 后续细化


              
                默认档案与统一登录壳的最终关系仍后置，不进入当前关闭条件。[os-layer]
                profile -&gt; archive 的代码层系统性迁移还没完成，只锁了方向和边界策略。[os-layer]
                默认档案在未来集体层的限制合同，只在边界上有结论，未进入本轮细部定稿。[os-layer]
              
            

            
              当前 dev 现状


              
                文档已经把 ArchiveSession、UiSession、默认档案升级流和切换事务讲清楚。[session][os-layer]
                但 inspected code 仍大量保留 profile 旧字段、旧存储键和旧适配器命名。[runtime-profile-scope][ChatPage]
                Theme G 的现实状态是“文档已成体系，代码仍在迁移前夜”。[issue #837]
              
            

          

          
            docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md
            docs/plans/2026-04-07-archive-session-and-ui-session-clarifications.md
            src/lib/adapters/runtime-profile-scope.ts
            src/components/Chat/ChatPage.tsx
            src/config/voice-omni-settings.ts
            #837
          

        

        
          
            
              H

              
                集体档案 / 组织档案模型


                成员座席、邀请、公开规则、blackboard 与集体工作面。

              

            

            已收口
          

          Theme H 不再承担 OS 层问题，而专注于“集体档案本身是什么”。它定义成员怎样进入、哪些数据可以直写、哪些要提案、成员座席怎样成为 UI 入口，以及 blackboard 与 route 如何成为集体协作介质。[settled][issue #837]


          
            决策收口


5/5


            代码锚点


1/5


            离落地距离


问题定义已稳


          

          
            
              已决


              
                外心默认去中心化，不强制中心化用户服务器或注册服务器；任何设备、任何档案都可组网。[settled]
                集体档案与个人档案在身份层同型，但前台进入集体时接入的是“成员对集体的座席”，不是抽象集体本体。[settled]
                每档案一个持久 blackboard；集体事件日志可直写但强审计，时间块与任务结构变更走提案门禁。[settled][blackboard]
                公开标识、邀请材料、成员生命周期与 route 编辑门禁都已进入主线文档。[invitee][settled]
              
            

            
              未决 / 后续细化


              
                集体 Agent、防伪 / 公开标识轮换、审计界面都已从本主题拆成扩大讨论簇，不在当前回合硬收口。[discussion-clusters]
                “如何找到被邀请者”虽已独立成子计划，但发现机制的产品细节仍要继续讨论。[invitee]
                更复杂的跨层级组织协作只保留研究入口，不进入近期实现关闭条件。[master]
              
            

            
              当前 dev 现状


              
                文档层已覆盖成员生命周期、提案门禁、公开标识、邀请与 blackboard 合同。[settled]
                但 inspected code 仍主要围绕 profile/user_id 做作用域隔离，并未出现等价的集体档案运行时模型。[runtime-profile-scope][proposal-rt-adapter]
                Theme H 当前仍主要是计划驱动，尚未进入主代码的真实运行层。[issue #837]
              
            

          

          
            docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md
            docs/plans/2026-04-06-invitee-discovery-public-identifier-and-known-archives-plan.md
            docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
            src/lib/adapters/runtime-profile-scope.ts
            src/lib/adapters/eventlog-rt-adapter.ts
            src/lib/adapters/proposal-rt-adapter.ts
            #837
            #860
          

        

        
          
            
              I

              
                集体记账 / Labor Ledger


                先独立成系统，再讨论怎么并回 ExoMind。

              

            

            已收口
          

          Theme I 的最大价值是把“记账”从当前外心主线里安全拆出。这样既能快速承接旧功能，又不会把 archive / collective / signal 的主线卡死在另一个领域系统上。[bookkeeping-plan][issue #845]


          
            决策收口


5/5


            代码锚点


0/5


            离实现距离


应尽快拆仓


          

          
            
              已决


              
                第一阶段先做独立配套系统，不作为外心内置数据域推进。[bookkeeping-plan]
                最应该优先稳住的是“领域事件模型 + 本地 API”，而不是先把 UI 或身份语义绑死到 ExoMind 主仓。[round-5]
                第一版交付形态固定为 Rust 内核 + 简 Web UI，权威账本采用“事件账本 + 投影”的结构。[bookkeeping-plan]
                权威原始层默认采用追加友好的 JSONL，GitHub 私有仓库只是可替换传输层，不是领域语义核心。[bookkeeping-plan]
              
            

            
              未决 / 后续细化


              
                旧表导入、完整统计看板、并回 ExoMind 的时机与接口都后置。[bookkeeping-plan]
                第一阶段只保留最小归因，不预留 archive / member 身份语义。[round-5]
                拆仓后的 transport、多人协作与更强审计还要单独展开。[bookkeeping-plan]
              
            

            
              当前 dev 现状


              
                当前主仓里只有规划文档与 issue，未见实际实现代码。[bookkeeping-plan]
                这不是落后，而是刻意的边界选择：先把系统独立出来，避免污染 ExoMind 主线。[issue #845]
                Theme I 当前最重要的推进动作不是写主仓代码，而是尽快完成独立仓库的启动。[round-5]
              
            

          

          
            docs/plans/2026-04-06-independent-collective-bookkeeping-system-plan.md
            docs/plans/2026-04-08-fifth-round-super-question-settled-decisions.md
            #845
          

        

        
          
            
              J

              
                复杂跨层组织协作


                例如跨级组织、跨集体并桌、复杂联邦协商。

              

            

            后置
          

          Theme J 保留的是研究价值，而不是近期关闭条件。像“法国跟欧盟坐一桌”这类跨层组织问题，目前只需要记住它们将来会出现，不应该让它们反过来拖慢前面的基础设施建设。[master]


          
            决策收口


2/5


            代码锚点


0/5


            当前策略


只记不做


          

          
            
              已决


              
                这类问题明确后置，不进入当前 backlog 的关闭条件。[master]
                它的存在价值是约束前面主题的抽象边界，而不是反向支配近期实现顺序。[master]
              
            

            
              未决 / 后续细化


              
                未来何时重开、以何种组织理论模型重开，都尚未决定。[master]
                它依赖 G/H/C 的基础设施先站稳，否则讨论只会空转。[master]
              
            

            
              当前 dev 现状


              
                当前代码与 issue 中没有必要的实现锚点，这是符合预期的。[master]
                报告里保留它，是为了防止后续误以为“没提过”或“已经被否决”。[raw appendix]
              
            

          

          
            docs/plans/2026-04-06-agent-network-collective-ideas-consolidation.md
            原始讨论材料全文摘录（仓外暂存原件）
          

        

      

      
        
          
            Expanded Discussion

            扩大讨论问题簇


            这三簇问题当前只记录，不在本轮收口。它们的作用是为后续和星林 / @HailayLin 的扩大讨论提供统一挂点。[discussion-clusters][issue #860][issue #837]


          

        

        
          
            扩大讨论

            集体 Agent


            当前只锁了问题定义层和最小现实形态，不锁最终执行一致性方案。[discussion-clusters][round-5]


            
              已定最小值：第一阶段默认先挂在成员座席主机上运行。[discussion-clusters]
              当前基线：它更像“汇聚管理层”，而不是跨 RT 同步的单一执行实例。[round-5]
              待讨论：多设备同时在线时如何定义唯一执行、任务队列与本地临时执行态如何分层、副作用提交怎样门禁。[issue #860]
            
            
              docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
              docs/plans/2026-04-08-fifth-round-super-question-settled-decisions.md
              #860
            

          
          
            扩大讨论

            档案防伪 / 公开标识轮换


            当前已经明确“先记问题，不讨论答案”。这簇问题会直接影响公开标识、邀请材料与信任建立方式。[discussion-clusters]


            
              威胁模型是什么：撞库、冒名、旧标识泄露、伪造邀请、旧 PublicCard 残留。[discussion-clusters]
              公开标识的稳定性与轮换能力如何兼容，哪些对象承担信任责任。[invitee]
              是否需要签名、见证或其他证明材料，目前一律后置到扩大讨论。[raw appendix]
            
            
              docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
              #837
            

          
          
            扩大讨论

            审计界面


            当前只保留问题清单，不把 UI 形态或空间策略误写成既定方案。[discussion-clusters]


            
              对象局部历史与全局审计总控台如何分层。[discussion-clusters]
              blackboard 的移出 / 删除动作是否要保留额外痕迹，以及这些痕迹占多少空间才合理。[discussion-clusters]
              人类、成员、Agent 各自应能看到哪些审计面，目前还没有产品定稿。[issue #837]
            
            
              docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
              #837
            

          
        

        当前规则：这三簇问题进入 GitHub 跟踪时，都应显式提及 @HailayLin，并以“记录待讨论问题”为目标，而不是假装本轮已经有定案。[discussion-clusters][issue #860][issue #837]

      

      
        
          
            Boundaries

            不应混淆的边界


            这部分是为了降低后续继续讨论时的语义滑移。它们不是新主题，而是已经在问答中多次出现的纠偏结论。[master][archive-session]


          

        

        
          
            方法论概念 vs 程序本体


            
              node / actor / Agent 不应被写成三种天生不同的程序种类。[master][energy]
              它们是外心观察、编排、监控与治理运行体时采用的不同视角。[round-2]
            
          
          
            连边语义 vs 可达性神话


            
              edge 首要语义是“输出后默认送达给谁”。[signal-plan]
              同时它也是权限门禁，所以“无边不能发”是系统约束，不是图论装饰。[signal-plan][issue #833]
            
          
          
            档案系统 OS 层 vs 集体档案层


            
              OS 层讨论的是默认档案、切换器、ArchiveSession、UiSession、多档案并活。[archive-os][archive-session]
              集体档案层讨论的是成员座席、邀请、公共规则、blackboard 和集体治理。[collective][blackboard]
            
          
          
            个人同步基线 vs 集体协作系统


            
              多端同步可以先行建立在事件日志、时间块、任务、设置项等个人基线之上。[roadmap][issue #532]
              它不必等待完整的信号网络和集体档案系统全部完工。[roadmap]
            
          
          
            blackboard vs 业务真相对象


            
              blackboard 第一阶段只承接共享工作记忆、协调便笺和摘要痕迹。[blackboard]
              任务、时间块、提案、事件日志仍各自保有业务真相地位。[signal-plan][blackboard]
            
          
          
            独立记账系统 vs ExoMind 主线域


            
              记账系统近期先独立，不直接塞进档案 / 集体档案 / signal 网络主线。[bookkeeping][issue #845]
              真正要保住的是领域事件模型和本地 API，而不是当前主仓里的临时位置。[bookkeeping][round-5]
            
          
        

      

      
        
          
            Source Register

            源文件与追踪入口登记


            如果后续要继续推进、回读、开 issue、或与星林共读，优先从这些入口进。这里故意偏长，以优先保证可追溯性。


          

        

        
          
            原始材料 / 总索引


            
              原始讨论材料全文摘录（仓外暂存原件）
              docs/plans/2026-04-06-agent-network-collective-ideas-consolidation.md
              docs/plans/2026-04-06-remaining-themes-second-round-settled-plan.md
            
          
          
            已决主题主文档


            
              docs/plans/2026-04-06-roadmap-sequencing-personal-sync-baseline-plan.md
              docs/plans/2026-04-06-multi-archive-and-collective-settled-decisions.md
              docs/plans/2026-04-07-archive-os-layer-default-archive-and-switcher-decisions.md
              docs/plans/2026-04-07-archive-session-and-ui-session-clarifications.md
              docs/plans/2026-04-07-blackboard-phase1-and-expanded-discussion-clusters.md
            
          
          
            代码现状锚点


            
              config/signal-routes.default.json
              crates/exomind-runtime/src/agent/workspace.rs
              crates/exomind-runtime/src/agent/life.rs
              crates/exomind-runtime/src/proposal/store.rs
              src/lib/types/proposal.ts
              src/lib/adapters/runtime-profile-scope.ts
              website/src/pages/docs.astro
            
          
          
            Issue 追踪入口


            
              #71 agent memory
              #387 signal topology lifecycle
              #518 tauri manager
              #532 sync epic
              #677 proposal system
              #837 archive-first / multi-archive epic
              #845 independent bookkeeping
              #846 multi-agent governance
              #847 external docs draft package
              #848 dual metering
              #860 collective agent
              #865 user manual / docs
            
          
        

      

      
        
          
            Raw Appendix

            原始材料全文摘录


            按你的优先级，这一节优先服务“可追溯性”。这里先把原始材料全文挂上，并显式说明它来自仓外暂存原件；后续若需要，还可以继续追加更多问答原文附录。


          

        

        
          原始讨论材料全文
          
            源说明：仓外暂存原件，HTML 中不展示本地磁盘路径。

            集体记账系统，先前讨论过，应该在GitHub上，待检索

---

Agent生成外心软件文档→宣传 对外描述

---

多端同步 功能→Tauri manager验证

---

描述性概念 可由 actor/Agent 区分
方法论概念 可由 节点/actor 区分

---

方法论区分
资源消耗计量计量方式不同：时空（算力/存储） + **token**（能量）

---

MVP：演员模型「固定邮箱」🆚网络模型「先天连边」
演员模型之上：只要说「输出/发消息」就广而告之给别的节点
❓连边作为呈现：❌节点连边可达✅节点可发消息
工作流「RSS→总结→汇报」，连接变成了「固定联系人」，节点变成了函数
→这时候「连边」成了「节点运行『输出』随后自动发给的其他节点」，即「输出后连到哪里」
📍结论：连边管「下一步给谁」

---

📍定义在「会话」「通道」层次，actor一般不控制连边，也有if分支节点，Agent潜力上能跟任何节点发消息
但需要「建立『以后可能发消息』的连接」作为连边的语义，🎯这样子旨在与「工作流模型」的「连边」语义

---

测试：增删改查 信号网络
节点连边→Agent/Codex自己看一看

---

MVP DOD：API Agent有记忆（对话上下文=工作记忆，独立经验文件=长期记忆），输入外心（事件日志，时间块，）→输出「提案」「时间块总结」等内容
①单Agent：时间块结束后编写总结、推荐任务（提案）。良定义提案系统「不需要下一步，纯程序自动进行」
②多Agent：「任务治理」「面向人 多模态服务员」
③Agent的能量系统：定时唤醒、心跳检测、电池（额度）等，贯彻生命自维持
④网络可变/理论验证：接入可编排的程序，节点actor、连边可变，动态生成节点连边，自然而然引入subAgent、teammate→动态生成 可持久化工作流。只保证「有连边一定有联系」（为了/例子「提案系统→任务」等，不需要放进信号网络）
⑤网络可变/实际接入：事件日志、时间块、任务（包装到信号网络节点，只读/权限）、提案等，也包括未来的目标，都在信号网络中工作。网络不关心所有，只保证「放在网络里一定是要关注的」，Agent工作流
💡Agent公共记忆→actor「黑板」节点

---

组织as档案，一个不可登录、可多端同步的档案
→集体档案，技术上避免个人直接读写，读OR写AND（所有人集体决议）
安全建议等，「请面向屏幕」这些
可考虑（作为抽象接口）但不实现（这些让专人去做OAuth等）
📌底层依然是共享档案，有集体事件日志、集体时间块、集体任务、集体目标、集体知识，但要档案（个人or集体）加入才能用
💡集体套集体→开始层次组织，开始分布式认知、计算等等
❓后续造出可能性后，再考虑诸如「跨级组织，法国跟欧盟坐一桌」这样的问题
          

        
      

      本页是主题治理报告，不是最终架构定稿，也不是完整验收报告。它的价值在于把讨论对象、已决结论、未决问题、当前进度与追踪入口压到同一张图上。