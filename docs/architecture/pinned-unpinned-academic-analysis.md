横纵分析法 × 交叉分析法 · 学术关联分析

# EDS Pinned/Unpinned 数据可同步性体系

系统性学术关联分析报告：追溯分布式一致性理论与移动计算的演化脉络，
对照 CRDT、Actor Model 与 MEC 的设计取舍，评估 EDS 这一原创概念的学术定位

研究日期

2026-04-14

分析框架

HV-Analysis + Cross-Analysis

报告性质

学术关联研究

**Pinned（钉死）**与**Unpinned（可移）**构成一对描述"语义可移植性"的一级概念：数据在跨 Runtime 同步时，若语义迁移后耗损可控则为 Unpinned；若钉死在某 Runtime、迁移后耗损不可接受则为 Pinned。二者通过 Unpin/Pin 过程可双向转化，并通过字段级混合对象实现间接控制——这一框架与传统 CRDT 研究处于不同分析维度，却在分布式系统历史中找到多处深层共鸣。

[研究概述](#overview)
[纵轴分析](#vertical)
[横轴分析](#horizontal)
[横纵交汇](#cross)
[参考文献](#references)

Part I

研究概述

概念来源、分析框架与核心问题定义

核心概念

**Pinned（钉死）**：语义被钉死在某一 Runtime（RT），换 RT 后耗损不可接受。
**Unpinned（可移）**：迁移后耗损可控可接受，天然具备跨 RT 同步能力。

双向循环：Pinned —Unpin→ Unpinned —同步→ Unpinned —Pin→ Pinned

混合对象：同一对象内部分字段 Pinned、部分字段 Unpinned；其他 RT 通过 Unpinned 字段间接控制 Pinned 字段（如 PTY 信号网络）。

📌

分析框架：HV-Analysis × Cross-Analysis

横纵分析法 + 交叉分析法，双框架联合执行

本报告采用双重分析框架：**HV-Analysis（横纵分析法）**从历史脉络（纵轴）与当代对照（横轴）两个维度解构 Pinned/Unpinned 的学术根基；**Cross-Analysis（交叉分析法）**以 EDS 的核心问题——"这个数据到底应不应该在 RT 间流动"——为锚点，系统检索 CRDT 原始论文、CAP 定理、移动计算等参考源，评估 EDS 框架的原创性与学术定位。

核心问题：在学术史上，"语义可移植性"（Pinned/Unpinned 的本质）与"数据可达性"（CRDT 解决的核心问题）长期被分开研究。EDS 把它们合并到一个体系里——这是原创性贡献，还是有问题的过度抽象？本报告将给出判断。

📚

主要概念来源文档

「EDS中数据的可同步性，对应的Pinned属性以及样例」（2026-04-14）—— 定义了 Pinned/Unpinned 的语义、转化路径与混合对象模型，以 Codex 会话为典型案例。

「EDS 完整架构冻结计划 v1」（2026-04-14）—— 冻结了 Pin 作为 EDS 一级概念的定位，明确了四类数据（Unpinned / Pinned-To-One-RT / Runtime-Only / Hybrid）与字段级 Pin 合同。

🔬

深度参考研究报告

「CRDT深度研究报告」（2026-04-13）—— 完整追溯 CRDT 从 CAP 定理裂缝中诞生、到 Figma/Yjs/Automerge 工业验证的全过程。

「DSON深度研究报告」（2026-04-13）—— 分析 DSON（Delta-State CRDT）的墓碑无关设计与 helsing-ai 的工程化路径。

Part II · 纵轴

Diachronic Analysis
历时性分析：概念的演化脉络

从 CAP 定理的裂缝到 Pinned/Unpinned 的提出——40 年分布式系统研究如何一步步逼近"数据该不该迁移"这个根本问题

CAP

2.1 CAP 定理与 PACELC 模型：一致性与可用性的根本张力

Eric Brewer, PODC 2000 → Abadi, 2010 → 影响延续至今

理解 Pinned/Unpinned 的学术脉络，必须回到 1998 年 UC Berkeley Eric Brewer 在 PODC 大会上提出的 CAP 猜想（2000 年被 Gilbert & Lynch 证明）。CAP 定理指出：分布式系统最多只能同时满足**一致性（Consistency）**、**可用性（Availability）**和**分区容错性（Partition Tolerance）**中的两个。

对于需要跨互联网协作的应用而言，网络分区是常态而非例外，因此实际的选择只剩两个：*牺牲一致性*（允许各节点暂时不一致，但最终收敛到相同状态）或 *牺牲可用性*（等待所有节点达成一致后才能响应）。

2010 年，Daniel Abadi 在 PACELC 模型中进一步指出：即使在无网络分区的情况下，延迟（Latency）与一致性之间也存在根本 trade-off。这个洞察对 Pinned/Unpinned 框架的直接意义在于：**选择将数据钉死在某 RT（Pinned），本质上是在 CAP/PACELC 的约束下选择了"延迟优先"路径——因为钉死数据避免了跨 RT 一致性协调的开销**。

CAP 定理的真正贡献不是告诉开发者"你必须在三者中选两个"，而是迫使研究者承认：在分布式系统中，一致性不是免费的午餐，必须付出代价。这个认识为后续所有"降低一致性要求以换取可用性或性能"的方案（包括 CRDT）奠定了理论基础。

CRDT

2.2 CRDT 的诞生：从"最终一致性"到"数学证明的无冲突合并"

Marc Shapiro et al., INRIA RR-7506, 2011 → 工业验证 2015-2026

CRDT 的演化史本身就是一部"如何解决数据合并问题"的思想进化史。

1979

Brian Randell 提出复制数据类型概念

伦敦大学学院，分布式操作系统研究的最早系统化工作。

1981

Babaoglu & Marzullo：单调递增数据结构无需锁或协调

证明了"交换性（commutativity）"是实现无冲突合并的关键性质——CRDT 理论的数学直觉源头。

1991

Attiya & Welch：精确化交换性条件

将直觉拔高为可操作的充分条件，为后续 CRDT 形式化奠定基础。

2006-2008

Shapiro 团队（Inria）与 Preguiça/Baquero 团队合作

核心问题：能否找到一组充分条件，使得任何满足这些条件的复制数据类型都能保证最终一致性？

2011-01-13

Marc Shapiro, Nuno Preguiça, Carlos Baquero, Marek Zawirski

《A Comprehensive Study of Convergent and Commutative Replicated Data Types》

INRIA RR-7506。首次系统性提出 CRDT 正式定义，建立 CvRDT（状态型）与 CmRDT（操作型）分类体系，给出 G-Set、2P-Set、OR-Set、LWW-Register 等具体实现。下载量超 16.8 万次。

2015-2017

Figma 的破局：CRDT 在专有系统中的工业验证

自定义 CRDT，针对设计文档高度定制，证明了 CRDT 在高性能产品中与 OT（Google Docs）相比的优越性。

2015-2021

Yjs 的崛起：JavaScript 生态的 CRDT 民主化

Kevin Jahns，21.6k Stars，50+ 企业使用——"npm install yjs，五行代码集成"。CRDT 从需要分布式系统 PhD 才能实现的技术变成了前端工程师的日常工具。

2017-2023

Automerge 与 "Local-first Software" 运动

Martin Kleppmann 等，Onward! 2019 论文系统论证 CRDT 是"本地优先软件"的基础设施。

2023

DSON：墓碑无关（tombstone-free）的新一代 JSON CRDT

helsing-ai 开源，用因果上下文（Causal Context）替代墓碑标记，解决了 CRDT 的"无界元数据增长"问题。与 Pinned/Unpinned 框架共同构成 EDS 的技术底座。

#### CRDT 分类体系与 Pinned/Unpinned 的深层对应

| CRDT 类型 | 特征 | 对应 Unpinned/Pinned |
| --- | --- | --- |
| **G-Set**（只读集合） | 只能添加、不能删除；天然收敛 | Unpinned 典型 — 追加操作无需协调，迁移无耗损 |
| **2P-Set**（双向集合） | 添加+移除，但移除后元素不能重新添加 | Unpinned — 移除集合可复制，但有语义限制 |
| **OR-Set**（可观察移除集合） | 可添加、可删除、可重新添加；Observed-Remove 语义 | Unpinned — DSON OrArray 采用此语义 |
| **LWW-Register**（最后写入获胜寄存器） | 每个字段以时间戳或逻辑时钟排序 | 字段级混合 — EDS 中字段级 Pin 对应，每个字段独立选择 CRDT primitive |
| **CvRDT**（状态型） | 节点保存完整状态，合并时取半格（join） | Unpinned 基础设施 — 完整状态可迁移 |
| **CmRDT**（操作型） | 节点间传递操作，要求交换性 | 边界情况 — 某些 Pinned 语义（如正在运行的进程）无法用操作表达 |

CRDT 的核心区分——"可移动状态"（movable state）与"不可移动语义"（immovable semantics）——在学术上早有认识，但一直没有被显式命名为 Pinned/Unpinned。EDS 的贡献之一，是把这种区分显式化为一对对立概念，并赋予其工程可操作性。

☁

2.3 移动计算与 Cyber Foraging：状态迁移的工程实践

Mahadev Satyanarayanan, 1990s-2001 → 影响延续至今

Pinned/Unpinned 框架最深刻的历史先驱，来自**移动计算（Mobile Computing）**领域。

1989 年，卡内基梅隆大学的 Mahadev Satyanarayanan 提出**Cyber Foraging**（计算蜜源）概念：移动设备在需要更多计算资源时，可以将任务"卸载"（offload）到附近的基础设施（如固定的计算站）。这个概念直接引出了一个问题：*什么样的计算状态可以被迁移，什么样的不能？*

2001 年，Satyanarayanan 在 IEEE Pervasive Computing 发表论文，描述了"Internet Suspend/Resume"（ISR）系统——允许用户在任何时刻"暂停"一台计算机的运行状态，然后在另一台计算机上"恢复"。ISR 的核心技术挑战与 Pinned/Unpinned 高度重叠：

ISR 的"可迁移"部分

• 用户文件（已保存状态）→ 对应 Unpinned

• 应用程序内存快照（可序列化部分）→ 对应 部分 Unpinned

• 网络连接状态（依赖本地网络栈）→ 对应 Runtime-Only

• 操作系统内核对象、硬件句柄 → 对应 Pinned

ISR 的"不可迁移"部分及处理方式

• 策略：直接放弃（不尝试迁移内核态）

• 策略：替代（在新机器上重建等价状态，如重新发起网络连接）

• 策略：降级（"Resume"后部分功能降级运行）

#### 与 Pinned/Unpinned 的关键对应

ISR 的"降级"策略直接对应 Pinned/Unpinned 框架的"语义可移植性"维度：降级意味着状态迁移后在目标机器上仍可运行，但功能不完整——这正是 Pinned 数据跨 RT 后的典型命运。而 ISR 的"替代重建"策略，对应的是 Pinned → Unpinned 的转化过程（在 ISR 中是手动重建，在 EDS 中是"Unpin"操作）。

关键发现

Cyber Foraging 研究早在 1990 年代就系统性地遇到了"什么状态可以迁移"的问题，并发展出了一套实践策略。但这套策略从未被显式形式化为 Pinned/Unpinned 这样的对称概念体系，也从未与 CRDT 研究产生深度交汇。EDS 的 Pinned/Unpinned 框架，可以视为在新的技术上下文（RT 虚拟化、AI Agent 运行时）下，对这一经典问题的重新形式化。

⚙

2.4 进程迁移：与"不可迁移语义"的斗争

1990s 分布式系统研究 → Mach, Condor, Berkeley NOW → 学术史

进程迁移（Process Migration）是 1990 年代分布式系统研究的一个核心议题。研究者试图实现：将一个正在运行的进程从一个节点移动到另一个节点，而进程的执行不中断。

这个目标在技术上极具挑战性，因为进程包含：

• **可迁移部分**：堆（heap）、栈（stack）、代码段、寄存器值 → 对应 Unpinned

• **不可迁移部分**：文件描述符（指向本机文件）、网络连接（绑定本机端口）、进程 ID（OS 局部）、硬件资源句柄 → 对应 Pinned

研究社区最终得出的结论是：**强制的进程透明迁移（full transparent migration）在实践中几乎不可能实现**。Mach 微内核的进程迁移研究（Douglis & Ousterhout, 1989）和 Condor 高性能计算集群的迁移策略，都最终走向了"选择性迁移"——只迁移可以安全迁移的部分，对不可迁移部分采用"代理"或"重连"策略。

这个结论与 Pinned/Unpinned 框架的核心主张高度一致：**不是所有数据都应该被迁移**；正确的设计是显式区分哪些数据可以迁移（Pinned/Unpinned 区分的核心洞察），然后为不可迁移部分设计替代机制（如 EDS 中的信号网络——通过 Unpinned 信号间接控制 Pinned 进程）。

#### 进程迁移 vs Pinned/Unpinned 的术语对照

| 进程迁移术语 | Pinned/Unpinned 等价术语 | EDS 机制 |
| --- | --- | --- |
| 透明迁移（transparent migration） | Unpinned 数据的无缝跨 RT 同步 | DSON / CRDT 合并 |
| 代理（proxying） | 通过 Unpinned 信号间接控制 Pinned 进程 | PTY 信号网络 |
| 重连（reconnection） | Pinned → Unpinned 转化后的重新绑定 | Unpin → 同步 → Pin 循环 |
| 降级运行（degraded operation） | NotOwned 状态的显式残缺态 | PinState::NotOwned(runtime\_id) |
| 不可迁移资源（immovable resource） | Pinned-To-One-RT | Codex 进程 ID / PTY 句柄 |

Part III · 横轴

Synchronic Analysis
共时性分析：当代对照与概念映射

在当前时间截面上，Pinned/Unpinned 与 CRDT、Actor Model、MEC、unikernel、分布式数据库等研究领域形成怎样的对照？

🔀

3.1 CRDT 的 Pin 类比：哪些天然 Unpinned，哪些有 Pinned 特征？

CRDT 类型与 Pinned/Unpinned 的系统性对照

将 CRDT 的各种数据结构类型与 Pinned/Unpinned 框架进行系统性对照，可以揭示两个框架之间的互补与错位关系。

| CRDT 类型 | 可迁移性判断 | Pinned/Unpinned 定性 | 边界条件 |
| --- | --- | --- | --- |
| **Append-only log**（G-Set） | 天然可复制，无需协调 | Unpinned 典型 | EDS EventLog 对应此模式 |
| **RGA**（Replicated Growable Array，协作编辑用） | 可复制，但并发删除需 OR 语义 | Unpinned | 多用户同时编辑同一列表 |
| **OR-Map / OR-Array**（DSON 核心类型） | 可复制，支持字段级并发修改 | Unpinned（字段级） | DSON 的墓碑无关设计使字段迁移极高效 |
| **MvReg**（多值寄存器） | 可复制，并发写入均保留 | Unpinned | 冲突时展示多个值，用户介入 |
| **LWW-Register**（最后写入获胜） | 可复制，但"最后写入"的判断依赖时钟 | 字段级混合 | 物理时钟不可靠时，逻辑时钟偏差导致非预期覆盖 |
| **有 leader 的 replicated state machine** | 状态机可复制，但 leader 身份不可迁移 | Pinned（leader 身份） | Raft leader 选举失败则服务不可用 |
| **数据库连接池 / 事务句柄** | 不可迁移，绑定本地资源 | Pinned | 对应 EDS Runtime-Only 类别 |
| **AtomicGroup**（EDS 引入） | 跨字段语义依赖，不可独立合并 | 特殊约束 | CRDT 合并不能破坏组内语义；EDS Governance Layer 强制此约束 |

#### CRDT 与 Pinned/Unpinned 的维度错位

这里出现了一个关键的学术观察：**CRDT 研究的核心问题是"并发修改如何合并"，而 Pinned/Unpinned 的核心问题是"这个数据应不应该在 RT 间流动"**。这两个维度在传统研究中是分离的：

CRDT 解决的是"合并正确性"

给定两个副本，应用 CRDT 合并算法后状态是否收敛？操作是否满足交换性/结合性？元数据是否无界增长？——这是 CRDT 的核心关切。

Pinned/Unpinned 解决的是"归属正确性"

这个数据应该被迁移吗？迁移后语义是否耗损？不可迁移部分如何与可迁移部分共存？——这是 Pinned/Unpinned 的核心关切。

这意味着：**即使 CRDT 合并完全正确，Pinned/Unpinned 问题依然存在**。反过来说，即使数据完全 Pinned（从不参与同步），CRDT 的并发合并机制也完全不适用。两个框架是正交的，但共同构成 EDS 的完整性。

🎭

3.2 Actor Model 与单宿主 Actor：状态可迁移性的经典问题

Carl Hewitt, 1973 → Erlang/OTP → Akka → Orleans → 对照

Actor Model（Actor 模型）由 Carl Hewitt 在 1973 年提出，是分布式系统领域最重要的并发模型之一。Actors 通过异步消息通信，每个 Actor 维护私有状态，消息 mailbox 是唯一的并发访问点。

#### Actor Mailbox 与状态的可迁移性

在经典 Actor Model 中，Actor 的 mailbox 和状态在概念上是绑定到 Actor 自身的——Actor 是"单宿主"的。这意味着：

• **Actor 状态**：在纯理论模型中不可迁移（因为 Actor 的 identity 由其消息处理能力定义，迁移后 identity 改变）

• **Mailbox 中的消息**：可重新路由（重新发送到新地址的 Actor），但已处理消息不可撤回

• **Actor 创建者**：在某些变体中（如 Akka Cluster）中可以迁移整个 Actor 系统，但需要显式的集群协调

| Actor Model 变体 | 状态迁移能力 | 与 Pinned/Unpinned 的对应 |
| --- | --- | --- |
| Erlang/OTP Process | 状态可序列化，但运行时进程不可透明迁移 | 部分 Unpinned（状态） + Pinned（进程 ID/ mailbox） |
| Akka Cluster | 支持 Actor 跨节点迁移（需要停机重分配） | 迁移时类似 Unpin → Pin 过程 |
| Orleans（Virtual Actors） | Actor 在逻辑上是永恒的，实现可在运行时迁移 | Virtual Actor ≈ 纯 Unpinned（逻辑 identity 与物理位置解耦） |
| Axon Framework | 命令/事件分离，事件可复制，命令不可复制 | 命令 = Pinned，事件 = Unpinned |

Orleans 的 Virtual Actor 模式是一个特别有启发性的参照：当 Actor 的 identity 与其物理位置完全解耦时，它就变成了纯 Unpinned 的——逻辑上存在，但物理上可以在任何节点实现。EDS 中"Codex 会话"从 RT-A 迁移到 RT-B 的过程，本质上也是一次 Actor 实现位置的切换。PTYA 的信号网络提供了消息路由的底层能力，类似于 Virtual Actor 的透明位置管理。

#### EDS 对 Actor Model 的扩展：信号 Actor 网络

EDS 的 PTY 信号网络（见 `crates/exomind-runtime/src/pty/mod.rs` 中的 `PtyManager` 与 `publish_lifecycle_signal`）可以被视为一个 Actor 系统的变体：

• 每个 PTY 实例（`PtyInstance`）是一个 Actor，状态包括进程句柄（`Box<dyn Child>`）、PTY writer、scrollback buffer

• `SignalPool` 扮演 mailbox 角色，接收 lifecycle signal（`pty.spawned`, `pty.exited`）

• **Pinned 部分**：进程句柄、PTY writer——绑定到本机 OS，无法跨 RT 迁移

• **Unpinned 部分**：session ID、session metadata、scrollback buffer（可序列化）——可通过信号网络传播到其他 RT

• **间接控制**：其他 RT 通过发送 `PtyOutputMsg`（输入数据）到 SignalPool，实现对 Pinned 进程的控制——这是 Actor Model 中典型的"通过 mailbox 通信"模式

📡

3.3 移动边缘计算（MEC）：归属与协同的数据管理

ETSI MEC 标准 → 5G 边缘计算 → 与 RT/终端节点数据归属的对照

移动边缘计算（Mobile Edge Computing，MEC）是 5G 时代的关键架构范式：在无线网络边缘（基站或靠近用户的服务器）部署计算和存储资源，使延迟敏感型应用能在本地处理数据，而不需要将所有流量回传到中心云。

#### MEC 的数据归属问题

MEC 系统面临的核心数据问题与 Pinned/Unpinned 高度平行：

| MEC 数据类型 | 归属与迁移特性 | EDS Pinned/Unpinned 等价 |
| --- | --- | --- |
| 无线接入网数据（RAN） | 必须在边缘节点处理，不能迁移到云 | Pinned |
| 用户会话上下文 | 可在边缘缓存，在用户切换基站时可能失效 | Hybrid |
| 处理结果 / 分析报告 | 可上传云端或迁移到其他边缘节点 | Unpinned |
| AI 推理模型（边缘部署） | 模型权重可更新，但推理执行必须本地 | 字段级混合 |

MEC 与 EDS 的最大共鸣在于**数据引力（Data Gravity）**概念：在 MEC 中，数据倾向于被拉向计算发生的地方（"计算靠近数据"），而不是将数据拉到中心。这与 EDS 中"Pinned 数据意味着计算和数据都在同一 RT 上"的内禀一致。

🧊

3.4 Unikernel 与容器快照：应用打包迁移的工程实践

MirageOS (2010), Unikraft (2017) → 容器镜像 → 与进程迁移的关系

Unikernel（独核操作系统）将应用程序及其依赖打包成一个单一的、专门的虚拟机镜像，移除所有不必要的操作系统组件。与传统进程迁移相比，Unikernel 的迁移策略更接近"不可变基础设施"——不是迁移正在运行的实例，而是重新部署快照。

#### Unikernel 迁移模型

• **构建时**：应用 + 专用 OS → 编译为单一镜像（类似"打包成 SessionArchive"）

• **部署时**：镜像 → 在任何虚拟化平台上运行（类似"Unpinned 数据同步到新 RT"）

• **运行时**：无持久 OS 状态，只有应用状态（类似"激活后的 Pinned 状态"）

关键对应

Unikernel 的"构建时打包 → 任意平台运行"模式，与 EDS 的**Unpin 过程**（将 Pinned 的 Codex 会话打包成 SessionArchive）高度对应：都是在做"提取语义本质、去除环境依赖、重新打包"的工作。两者的区别在于：Unikernel 在构建时完成这一步（静态），EDS 的 Unpin 在运行时动态完成（可以在任意时刻触发）。

#### 容器快照与检查点迁移

Docker/Containerd 的镜像系统采用了类似的思路：应用及其依赖被打包成只读镜像层，在任何支持 OCI 标准的节点上运行。CRIU（Checkpoint/Restore in Userspace）进一步支持 Linux 进程的检查点和恢复（类似进程迁移）。

但在实践中，Docker 容器迁移（checkpoint & restore）面临与 1990s 进程迁移完全相同的问题：网络命名空间（network namespace）的迁移、PID 的重绑定、文件系统挂载点的处理——这些都属于**系统级 Pinned 资源**。CRIU 的解决方案与 Cyber Foraging 如出一辙：逐类处理，可迁移则迁移，不可迁移则放弃或降级。

🏛

3.5 分布式数据库的 Leader 复制：可读性与归属的精确对应

Raft (Ongaro & Ousterhout, 2014) → Multi-leader → 对照

Raft 共识算法（Ongaro & Ousterhout, 2014）是分布式系统领域最重要的共识协议之一，其设计目标是通过"复制状态机"实现分布式一致性。

#### Raft 的可读性与 Pinned/Unpinned 的精确对应

| Raft 配置 | 写入 | 读取 | Pinned/Unpinned 等价 |
| --- | --- | --- | --- |
| 强一致读取（从 leader） | 必须经过 leader | 只能从 leader 读 | Pinned（leader 绑定） |
| 租约读取（leader 租约内） | 必须经过 leader | 可在本地读取（租约有效期内） | Hybrid（时序 Unpinned） |
| \_follower reads\_（配置开启） | 必须经过 leader | 可从 follower 读（可能过期） | Unpinned（读取） |
| 只读多主（Multi-leader） | 可在任意节点写入 | 可在任意节点读取 | Unpinned |

这组对照揭示了一个深刻的观察：**Pinned/Unpinned 维度并不只存在于"完整对象"的粒度，也可以存在于"读写操作"的粒度**——Raft 的 leader 配置，本质上是在做"写入操作必须在 Pinned 节点执行，读取操作可以在 Unpinned 节点执行"的决策。这与 EDS 中"同步字段可跨 RT 读取，Pinned 字段只能在本 RT 写入"的语义完全平行。

#### Jujutsu / jj 的 Conflict Object 与 EDS ConflictObject

Jujutsu（jj）是 2020 年代兴起的 Git-like 版本控制系统，其 operation log + conflict object 模型对 EDS 的 ConflictObject 设计有直接参照价值（见 `skills/cross-analysis/references/source-jj.md`）。jj 将冲突提升为第一类对象（Conflict Object），与 EDS Governance Layer 的 ConflictObject 概念高度共鸣：两者都是将"无法自动合并的情况"显式建模为独立对象，而非掩盖在模糊的 merge 行为中。

Part IV · 横纵交汇

Cross-Section Analysis
交叉洞察：Pinned/Unpinned 的学术定位与三个未来剧本

汇聚纵轴历史脉络与横轴当代对照，对 EDS 原创性做出判断，并推演三个未来剧本

💡

4.1 横纵交汇洞察：EDS 的原创性评估

#### 判断一：Pinned/Unpinned 不是"过度抽象"，而是"迟到已久的显式化"

通过对纵轴历史脉络的追溯，本报告的判断是：Pinned/Unpinned 框架的各个组成要素都曾在学术史上分别出现——CAP 定理提供了认识论基础，CRDT 提供了技术手段，进程迁移和 Cyber Foraging 提供了工程实践模式，Actor Model 提供了概念框架。但**从未有人将"语义可移植性"显式命名为 Pinned/Unpinned，并赋予其一级概念地位**。

EDS 的原创性不在于"发明"了这些思想，而在于：

• **首次显式命名**：将分散在 CRDT、进程迁移、Cyber Foraging 中的隐含区分，显式命名为一对对立概念

• **首次统一框架**：将"语义可移植性"与"并发合并正确性"（CRDT 的核心问题）区分开来，并指出两者正交

• **首次操作化**：提供了 Unpin/Pin 双向转化路径，以及字段级 Pin 的工程合同（`PinState = Owned | NotOwned`）

#### 判断二："语义可移植性"与"数据可达性"的交汇点

这是本报告最核心的学术洞察：

交汇定理

**数据在 RT 间流动需要满足两个正交条件：**
**(1) 可达性（Reachability）**：CRDT/同步协议能正确传输和合并数据 —— 这是 CRDT 解决的核心问题
**(2) 可移植性（Portability）**：数据迁移后在目标 RT 上仍能发挥原有语义 —— 这是 Pinned/Unpinned 解决的核心问题

传统 CRDT 研究只关注 (1)，传统进程迁移研究只关注 (2)，EDS 首次将两者统一在一个体系里。这是 EDS 真正的原创性所在。

#### 判断三：字段级 Pin 是最具原创性的设计决策

在 Pinned/Unpinned 框架的各个组成部分中，**字段级 Pin**（同一对象内含 Pinned 字段和 Unpinned 字段）是最具原创性的设计决策。这个设计：

• 在学术史上没有直接先例（进程迁移和 Cyber Foraging 都工作在进程/VM 粒度，不在字段粒度）

• 直接来源于 EDS 内部的需求：Codex 会话中，进程句柄是 Pinned 的，但会话 ID 是 Unpinned 的——这种混合需求只能通过字段级 Pin 解决

• 通过 DSON 的字段级 CRDT primitive 映射（`FieldType → MvReg / OrMap / OrArray`）获得了技术实现基础

#### 判断四：间接控制机制（PTY 信号网络）是框架的杀手级应用

Pinned/Unpinned 框架最令人信服的应用场景，是**PTY 信号网络**：通过 Unpinned 的信号（`PtyOutputMsg::Data`）跨 RT 传输，实现对 Pinned 的本地进程（`Box<dyn Child>`）的远程控制。这个机制：

• 证明了 Pinned/Unpinned 不是纯粹的理论抽象，而是有具体工程实现的

• 揭示了"语义可移植性"与"间接控制"的内在联系：当直接迁移不可行时，通过 Unpinned 的信号间接控制 Pinned 资源，是最优雅的工程路径

• 与 Actor Model 的 mailbox 通信模式形成深层共鸣

🔮

4.2 三个未来剧本

基于历史脉络与当代格局的交叉推演

剧本 A · 最可能的路径

Pinned/Unpinned 成为 RT 间数据治理的事实标准

随着 AI Agent 运行时（RT）逐渐成为分布式计算的标准单元，"哪个数据该在哪个 RT 上运行"将成为一个普遍问题。Pinned/Unpinned 框架因为：

• 概念简洁（只有两种状态 + 转化路径），易于被开发者理解

• 与现有技术（CRDT、DSON）正交，不需要推翻已有基础设施

• 有具体的工程实现（PTY 信号网络、字段级 Pin 合同）

而成为 RT 间数据治理的事实标准。届时，开发者设计新的 RT 对象时，会首先问："这个数据是 Pinned 还是 Unpinned？"——就像现在问"这个操作是读还是写"一样自然。

触发条件 ExoMind RT 生态规模扩大，更多开发者接触 RT 间协作场景

剧本 B · 中性剧本 · 局部采纳

Pinned/Unpinned 成为 ExoMind/EDS 内部规范，但不向外传播

Pinned/Unpinned 框架的语义精确性足够高，但在推广上存在壁垒：

• CRDT 生态（Yjs、Automerge）已经建立了"用 CRDT 解决跨设备同步"的心智，Pinned/Unpinned 需要额外的概念学习成本

• 非 EDS/RT 架构的系统，天然不需要"RT 归属"概念

在此剧本下，Pinned/Unpinned 成为 EDS 内部的显式设计规范，但不会向更广泛的分布式系统社区扩散。这相当于 Jujutsu / jj 在版本控制领域的定位：概念精确、工程扎实，但影响范围有限。

风险 框架的正确性无法通过更大规模的社区验证

剧本 C · 悲观剧本 · 过度抽象

Pinned/Unpinned 被 CRDT 生态吸收，丧失独立概念地位

如果 CRDT 生态继续演进，开始原生支持"数据归属约束"（例如 Yjs 或 DSON 增加 Pin annotation），那么 Pinned/Unpinned 框架的价值将被吸收进 CRDT 实现细节，丧失其作为独立概念的地位。

这个剧本的触发条件是：某个主流 CRDT 库（最可能是 DSON，因为 DSON 已经在 ExoMind 生态中有使用背景）原生引入 Pin 语义，将其变成 CRDT 的元数据属性（类似 Yjs 的 Awareness 协议）。届时，"Pinned/Unpinned"不再是独立概念，而变成"带有 Pin 标记的 CRDT 对象"。

这未必是坏事——说明 Pinned/Unpinned 框架的核心思想被主流生态采纳了，但 EDS 的"原创性"叙事将失去支撑。

风险 EDS 未能建立足够的先发优势，框架被更强大的生态系统吸收

#### 三个剧本的共同前提

无论哪个剧本成立，一个前提条件不变：**EDS 必须首先在自己的生态中充分实现和验证 Pinned/Unpinned 框架**。当前实现状态（根据 EDS 架构成型性评估报告 2026-04-14）：

• Task 域：生产级，已实现 summary → compare → pull → snapshot fallback 全链路

• EventLog / TimeBlock 域：只有 snapshot fallback，无增量 pull，**尚未触及 Pinned/Unpinned 区分**

• PTY / Codex 会话：Pinned/Unpinned 语义已在代码中体现（`PtyInstance` 的 Pinned 进程 + SignalPool 的 Unpinned 信号），但尚未显式建模为 Pin 合同

• **最关键的缺口**：EventLog Reconciliation 和 TimeBlock Reconciliation 尚未实现，无法验证 Unpinned 数据在不同域的同步语义一致性

⚠

4.3 对 EDS 架构的批判性建议

#### 缺口一：Pin 分类与依赖契约表尚未正式落地

EDS 冻结计划要求在实现前必须具备"Pin 分类与依赖契约表"，但当前代码中尚未看到显式的 `PinState` 类型或 `Owned/NotOwned` 枚举（截至 2026-04-14 的代码快照）。`PtyManager` 和 `SignalPool` 已经隐含地实现了 Pinned（进程句柄）和 Unpinned（信号）的区分，但没有将其提升为显式的类型系统合同。

#### 缺口二：UniquePinned 的"多 RT 唯一持有"问题尚无解决方案

原始文档（「EDS中数据的可同步性」）明确指出 UniquePinned 数据（如"接力式迁移"的 Codex 会话）面临"如何在 CRDT 同步之上保证通道唯一性"的问题。当前代码中没有任何机制来实现这一约束——`PeerScopeGrant` 提供的是范围授权（scope grant），不是唯一性保证（uniqueness guarantee）。

#### 缺口三：字段级 Pin 的 Schema 映射尚未正式定义

EDS 冻结计划要求"全字段显式覆盖"的 Schema 合同，但当前代码中尚未看到显式的 FieldType → DSON primitive 映射表。`crates/exomind-runtime/src/sqlite_json_bridge/mod.rs`（新增）的存在表明桥接层正在建设中，但字段级 Pin 的标注体系尚未建立。

本报告的核心建议：**在继续扩展同步域（EventLog / TimeBlock）之前，应优先完成 Pin 分类与依赖契约表的正式定义**。否则，EventLog Reconciliation 的实现将面临"哪些字段应该进入 DSON，哪些应该 Pinned"的判断困境——而这正是 Pinned/Unpinned 框架存在的首要意义。

Part V

参考来源

本报告引用的所有学术论文、技术文档与代码实现

Brewer, E. (2000). Towards Robust Distributed Systems (CAP 猜想)

PODC 2000, Invited Talk · https://people.eecs.berkeley.edu/~brewer/cs262b/

Eric Brewer 在 PODC 2000 大会上提出的分布式系统 CAP 猜想，后由 Gilbert & Lynch（2002）形式化证明。奠定了"一致性、可用性、分区容错性不可兼得"这一分布式系统基本约束的理论基础。

Abadi, D. (2010). PACELC Model

ACM SIGMOD Record, 2010 · http://dbmsmusings.blogspot.com/2010/04/pacelc-model-for-reasoning-about.html

Daniel Abadi 在 CAP 定理基础上增加了 PACELC（Partition-Availability-Consistency, Else Latency）维度，指出即使在无分区情况下，延迟与一致性之间也存在 trade-off。

Shapiro, M., Preguiça, N., Baquero, C., Zawirski, M. (2011). A Comprehensive Study of Convergent and Commutative Replicated Data Types

INRIA RR-7506, January 2011 · https://hal.science/hal-00902436

CRDT 领域的奠基性论文，首次系统性地提出 CRDT 正式定义、CvRDT/CmRDT 分类体系、以及 G-Set、2P-Set、OR-Set、LWW-Register 等具体实现。下载量超 16.8 万次，被引用数千次。

Kleppmann, M., Beresford, A. (2017). A Conflict-Free Replicated JSON Datatype

IEEE TPDS, 2017 · arXiv:1608.03960

将 CRDT 数学保证扩展到任意嵌套 JSON 结构的里程碑工作，为 Automerge 的理论基础，也是 EDS 中 DSON 字段级 CRDT 设计的学术先驱。

Kleppmann, M., Wiggins, A., van Hardenberg, P., McGranaghan, M. (2019). Local-first software: You own your data, in spite of the cloud

Onward! 2019 · https://www.inkandswitch.com/local-first/

系统论证了 CRDT 是实现"本地优先软件"的基础设施，直接影响了此后数年大量笔记、文档、代码协作工具的产品决策。也是 Pinned/Unpinned 框架"用户数据主权"哲学的来源。

Ongaro, D., Ousterhout, J. (2014). In Search of an Understandable Consensus Algorithm

USENIX ATC 2014 · Raft Paper

Raft 共识算法。提供了分布式数据库 leader 复制与 Pinned/Unpinned 的精确对照：leader 绑定写入（Pinned），follower reads（Unpinned），租约 reads（Hybrid）。

Satyanarayanan, M. (2001). Pervasive Personal Computing in an Internet Suspend/Resume

IEEE Pervasive Computing, 2001

Cyber Foraging / ISR 系统的核心论文，系统性地提出了"什么计算状态可以迁移，什么不能"的分类框架。与 Pinned/Unpinned 框架构成跨越 25 年的历史呼应。

Douglis, F., Ousterhout, J. (1989). Transparent Process Migration: Experiences with Sprite

USENIX Summer 1989

1990 年代进程迁移研究的代表性工作，揭示了进程迁移中"不可迁移语义"（内核对象、文件描述符、硬件句柄）的系统性分类。与 Pinned/Unpinned 框架构成直接的概念对应。

Hewitt, C. (1973). A Universal Modular Actor Formalism for Artificial Intelligence

IJCAI 1973 · Actor Model 创始论文

Actor Model 创始论文。提供了"单宿主 Actor 的 mailbox 通信"模型，与 EDS PTY 信号网络构成深层共鸣。

DSON GitHub — helsing-ai/dson

https://github.com/helsing-ai/dson · Rust crate · 154 Stars

Delta-State CRDT 的工业级 Rust 实现，墓碑无关（tombstone-free）设计。是 EDS 的核心 DSON primitive 供应商。OrMap/OrArray/MvReg 三种类型为 EDS 字段级 Pin 提供了技术实现基础。

ExoMind EDS 架构成型性评估报告（2026-04-14）

内部文档 · H:\A137442\Develop\AGI\exomind\docs\research\EDS架构成型性评估报告-2026-04-14.md

提供了 EDS 当前实现的成熟度评估。Task 域生产级，EventLog/TimeBlock 域早期阶段，Projection 和 Validation 层存在缺口。是判断 Pinned/Unpinned 框架当前落地状态的核心依据。

ExoMind PTY 模块 — crates/exomind-runtime/src/pty/mod.rs

Rust Runtime · PtyManager + PtyInstance + SignalPool

PTY 信号网络的代码实现。`PtyInstance` 持有 Pinned 资源（进程句柄、PTY writer），`SignalPool` 传播 Unpinned 信号（`PtyOutputMsg`）。提供了 Pinned/Unpinned 框架最具说服力的工程实现案例。

ExoMind Replication Actor — crates/exomind-runtime/src/signal/actors/replication\_actor.rs

Rust Runtime · 5 域 Replication Actor

实现了 EventLog、Task、TimeBlock（Active/Completed）、Proposal 的 replication actor。提供了当前 EDS 对象同步层的核心实现。使用了 LWW 语义（`updated_at`）和 host\_id 字符串序作为 tiebreaker，与 CRDT 的 MVReg 语义平行但尚未引入完整 CRDT。

EDS 完整架构冻结计划 v1（2026-04-14）

内部文档 · H:\A137442\Develop\AGI\exomind\docs\plans\2026-04-14-EDS-architecture-freeze-plan.md

冻结了 Pin 作为 EDS 一级概念的定位，定义了四类数据（Unpinned / Pinned-To-One-RT / Runtime-Only / Hybrid）与字段级 Pin 合同。是 Pinned/Unpinned 框架在架构层面的最高权威依据。

EDS Pinned/Unpinned 概念文档（2026-04-14）

内部文档 · H:\A137442\Develop\AGI\exomind\docs\architecture\【人写】2026-04-14 - EDS中数据的可同步性，对应的Pinned属性以及样例.md

Pinned/Unpinned 概念的原始定义文档，提供了 Codex 会话等典型案例，以及 Unpin → 同步 → Pin 的转化路径分析。是本报告的核心概念来源。

Jujutsu / jj — source-jj.md

交叉分析参考源 · H:\A137442\Develop\AGI\exomind\.claude\skills\cross-analysis\references\source-jj.md

版本控制领域的 Conflict Object 参考。jj 将冲突提升为第一类对象，与 EDS ConflictObject 设计形成共鸣。

EDS Pinned/Unpinned 数据可同步性体系 — 学术关联分析报告

横纵分析法 × 交叉分析法 · 2026-04-14 · ExoMind 架构研究

本报告基于公开学术文献、EDS 内部文档与源代码分析生成