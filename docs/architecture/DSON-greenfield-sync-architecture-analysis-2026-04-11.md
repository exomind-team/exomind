# DSON 在 ExoMind Greenfield 同步架构中的可行性分析

> 分析日期：2026-04-11
> 目的：在“允许把现有同步系统推倒重来”的前提下，评估 DSON 是否适合作为 ExoMind 的主对象同步内核，以及它与 ECS 网络层、自定义恢复策略、投影层、校验层之间的正确分工
> 分析前提：本分析刻意不把现有 Pouch、当前 RT-only 实现、已有 issue 的路径依赖当作约束条件；只把它们作为背景材料，而不是设计边界
> 内部参考：`docs/architecture/overview.md`、`docs/architecture/principles.md`、`docs/architecture/ECS-communication-stack.md`、`docs/architecture/ECS-EDS-discussion-2026-03-04.md`、`docs/specs/sync.md`
> 外部参考：DSON README / 源码文档 / Blog / 论文摘要，iroh-docs README / docs.rs，Automerge 官方文档，Yjs 官方文档

---

## 任务清单

- [x] 读取 ExoMind 自身架构文档，抽象 greenfield 同步系统真正需要的分层
- [x] 读取 DSON 一手资料，确认其能力边界与适用范围
- [x] 补充读取 iroh-docs、Automerge、Yjs 的官方资料，建立对照坐标系
- [x] 结合 ExoMind 的对象类型，判断 DSON 在 greenfield 前提下的真实落位
- [x] 形成可直接继续讨论的架构研究文档

---

## 一、问题重述

本次研究不是回答：

- “DSON 能不能直接替换当前 ExoMind 的同步实现？”
- “DSON 能不能马上解决 `#868/#869`？”

而是回答一个更本质的问题：

> 如果 ExoMind 从今天开始重新设计同步系统，并允许把当前同步实现全部推倒重来，DSON 是否应该成为主方案的一部分？如果是，它在系统中的职责边界应该是什么？

这个问题的关键不在于“DSON 是不是一个 CRDT”，而在于：

- ExoMind 需要的同步系统到底包含哪些层
- DSON 能覆盖其中哪一层
- 哪些问题必须继续由 ECS 和 ExoMind 自己的同步策略承担

---

## 二、先给结论

结论分三层：

### 2.1 第一层结论

如果允许 greenfield，`DSON 应该被认真当作 ExoMind 的主候选之一`。

这里的“主候选”不是指“整个同步系统都交给 DSON”，而是指：

> DSON 很适合成为 ExoMind 的 `EDS Object Sync Layer（对象同步层）` 的核心内核。

### 2.2 第二层结论

`DSON 能解决 ExoMind greenfield 同步系统中的很大一部分问题，但不是全部问题。`

它主要解决的是：

- 可编辑对象的并发修改表达
- 对象级 delta 同步
- 并发值保留而非静默覆盖
- 低带宽、高延迟、机会网络环境下的对象状态收敛

它不能单独解决的是：

- peer discovery / pairing / auth
- transport / relay / multi-hop
- anti-entropy / recovery / bootstrap
- projector / read model
- 语义校验 / 审计留痕 / 人工决议
- append-only event rail、blob rail、presence / lease rail

### 2.3 第三层结论

如果真的采用 DSON，正确架构不是“万物 DSON 化”，而是：

- `ECS` 负责网络层
- `DSON` 负责 mutable object sync core
- `ExoMind 自己的 recovery / projection / validation` 负责把它变成完整同步系统

换句话说：

> DSON 是对象同步内核，不是完整同步系统。

---

## 三、ExoMind 在 Greenfield 场景下真正需要什么

从 ExoMind 自身文档出发，greenfield 下的同步系统至少应拆成五层。

这不是为了形式完整，而是因为项目文档本身已经隐含了这种结构：

- `ECS` 负责通信、连接、发现、组网
- `EDS` 负责持久数据和对象同步
- `domain projector` 负责把同步结果变成业务真相和 UI 可消费状态
- `principles.md` 要求系统保留痕迹、可解释、不可静默丢失语义

### 3.1 网络层（ECS Network Layer）

职责：

- peer discovery
- pairing / trust establishment
- addressing / reachability
- transport abstraction
- relay / multi-hop
- liveness / reconnect / heartbeat
- auth / encryption / capability exchange

这一层只解决“谁和谁能连、怎么连、怎么持续连”，不应该承载业务对象冲突语义。

### 3.2 对象同步层（EDS Object Sync Layer）

职责：

- 定义对象同步单位
- 定义对象内部并发修改如何表达
- 定义 delta / snapshot / sync envelope
- 定义 scope 隔离
- 定义对象如何落入本地 truth source

这一层才是 DSON 最自然的落点。

### 3.3 恢复层（Recovery Layer）

职责：

- anti-entropy
- checkpoint / cursor / causal context
- cold start / bootstrap
- snapshot fallback
- reconnect repair
- 双向补齐

这一层是完整同步系统必须有的部分，但 DSON 不自带。

### 3.4 投影层（Projection Layer）

职责：

- object state -> domain object
- domain object -> read model / UI model
- 触发 UI 更新
- 触发后续 service / actor side effect

这一层必须和同步协议解耦。

### 3.5 校验层（Validation / Audit Layer）

职责：

- invariant checks
- audit trail
- divergence detection
- repair trigger
- automatic resolution escalation

ExoMind 不是“最后一致就算完”，而是“要知道为什么现在是这个结果、哪条分支输了、有没有违反语义、是否需要人工处理”。

### 3.6 Greenfield 总分层

最贴近 ExoMind 的 greenfield 分层，可以写成：

1. `ECS Network Layer`
2. `EDS Object Sync Layer`
3. `Recovery Layer`
4. `Projection Layer`
5. `Validation Layer`

这五层里，DSON 主要覆盖第 2 层的一部分。

---

## 四、DSON 到底提供了什么

根据 DSON 官方 README、源码文档和 blog，DSON 的核心是一个面向 JSON-like 数据结构的 delta-state CRDT 库。

### 4.1 基本原语

DSON 提供三类基础原语：

- `OrMap`
- `OrArray`
- `MvReg`

它们可以嵌套成更复杂的对象结构。

### 4.2 核心语义

它的关键语义包括：

- `Observed-Remove semantics`
- `delta-state replication`
- `causal model`
- `tombstone-free removals`
- `MvReg` 保留并发值

这意味着：

- 并发 update vs delete 时，不会简单把对象吞掉
- 多个写者可以并发修改同一对象
- 元数据不会像某些 tombstone-heavy CRDT 一样随着历史无限膨胀

### 4.3 官方明确的边界

官方资料反复强调三件事：

1. 它是低层库
2. 它不带 networking protocols
3. 正确性依赖上层正确实现 causal transport / anti-entropy

源码文档还特别提醒：

> causal consistency guarantees are provided on a per-register basis

这句话非常关键，因为它直接决定了 ExoMind 不能把业务对象机械地拆成一堆互相独立的字段寄存器。

### 4.4 扩展点

DSON 不是完全封死的基础库，它还提供了两个很重要的扩展点：

- `ExtensionType`
- `Sentinel`

这两个点意味着：

- 你可以在 DSON 之上定义更符合域语义的 CRDT 扩展
- 你可以在 merge 或 apply 流程里插入验证、观察、授权或记录逻辑

这对 ExoMind 非常重要，因为它允许系统在不把业务逻辑塞进网络层的前提下，仍然保留“同步后的语义治理能力”。

---

## 五、为什么 DSON 很适合 ExoMind 的对象同步层

如果只看 “可编辑对象在多设备之间如何同步”，DSON 和 ExoMind 的诉求是高度吻合的。

### 5.1 它是对象级增量同步，而不是全量状态同步

ExoMind 并不希望每次都把整域全量拉回。

对 `Task`、`Proposal`、`Settings`、共享 metadata 这类对象，更自然的方式是：

- 对象内部改一小块
- 只传播这次变更对应的 delta
- 远端合并 delta

DSON 正好是围绕这个模型设计的。

### 5.2 它天然适合“多写者 + 断续连接”

ExoMind 的目标环境不是中心化单客户端数据库，而是：

- 多设备
- 多 runtime
- 可能临时离线
- 可能机会式连通
- 不想把冲突处理都推给应用开发者

DSON 的目标环境正是高延迟、低带宽、机会网络，这一点和 ExoMind 的长期愿景是对齐的。

### 5.3 它比“静默 LWW”更符合 ExoMind 的价值观

ExoMind 不适合把大量对象冲突一律简化成：

- 时间戳大的赢
- host_id 大的赢
- 先后顺序某个固定规则赢

这种规则虽然工程上省事，但会把真实语义静默抹掉。

`MvReg` 的价值恰恰在这里：

- 它允许先保留并发值
- 再由上层做裁决、展示、升级人工处理

这比“冲突没了，但没人知道发生过什么”更适合 ExoMind。

### 5.4 它是 Rust 低层库，和 RT/后端化方向天然兼容

Yjs/Yrs、Automerge 当然也都值得比较，但 DSON 的一个现实优势是：

- 它很 Rust-native
- 它的定位是低层库
- 它不强行绑定前端 editor/provider 心智

对于一个本来就想自己掌控 Runtime、Transport、Projector、Validator 的系统来说，这反而更干净。

---

## 六、为什么 DSON 不能独自构成 ExoMind 的完整同步系统

这部分必须说清楚，否则很容易把“DSON 适合作为主对象同步内核”误读为“DSON 就是全部答案”。

### 6.1 它不解决网络层

DSON 不负责：

- discovery
- pairing
- auth
- transport
- relay
- NAT / multi-hop
- liveness

这些仍然必须由 ECS 负责。

### 6.2 它不自带恢复协议

即使对象内核正确，系统仍需要：

- checkpoint
- anti-entropy
- delta retention
- replay window
- snapshot fallback
- bootstrap

否则只能做到“在线时大概能同步”，做不到“离线回来后稳定收敛”。

### 6.3 它不自动维护跨字段语义不变量

这是最关键的理论边界。

如果有两个强耦合字段：

- `Task.status`
- `Task.completed_at`

或者：

- `Proposal.status`
- `Proposal.action_params`

那么不能假设“因为都放进 DSON 了，所以语义自然正确”。

DSON 官方已经明确提醒它的因果一致性主要是 `per-register`。

这意味着：

- 单个寄存器的值收敛没有问题
- 但跨寄存器的关系不自动成立

因此，ExoMind 必须在对象建模层做语义原子化，而不是在最后才用补丁式校验救火。

### 6.4 它不提供投影和业务可用状态

同步层只解决“对象如何收敛”，不直接解决：

- 页面上显示什么
- 统计如何算
- 哪个对象算“当前活跃”
- 冲突发生时用户看到什么

这些仍然是 projector / read model 的职责。

### 6.5 它不等于审计与可解释性

ExoMind 的一些对象冲突不是只要最后收敛就够了，还需要：

- 留下 losing branch 证据
- 知道谁改的
- 知道为何最后是这个结果
- 能在必要时升级成人工决议

这需要系统性的 validator / audit layer，不是 DSON 自己自动给出的。

---

## 七、采用 DSON 的正确对象建模原则

如果 ExoMind 真的采用 DSON，最重要的工程原则不是“把所有字段塞进去”，而是：

> 以“语义原子”建模，不以“叶子字段”机械建模。

### 7.1 为什么不能简单按字段拆寄存器

因为 DSON 的 `per-register` 因果一致性意味着：

- 字段 A 先到
- 字段 B 后到

在另一个副本那里，这种顺序不一定和原来相同。

如果两个字段之间有强语义耦合，就会出现业务层看起来很怪的中间态。

### 7.2 更合理的建模方式

应把强相关字段组合成“语义原子”。

例如：

- `Task.lifecycle_atom = { status, completed_at, cancelled_at }`
- `Task.content_atom = { title, description, note }`
- `Proposal.decision_atom = { status, action_params, acted_at }`
- `Proposal.comments` 用 append-like 结构
- `Settings.preference_group` 按组建模而不是按单键拆碎

### 7.3 这不是 DSON 原生要求，而是 ExoMind 的建模策略

这里要区分清楚：

- `DSON 提供的是低层原语和因果约束边界`
- `语义原子化建模` 是 ExoMind 在采用 DSON 时应主动制定的规则

这是从 DSON 的边界反推出的设计原则。

---

## 八、哪些数据域适合走 DSON，哪些不适合

ExoMind 的数据域并不应该统一走一条物理同步路径。

### 8.1 很适合进入 DSON rail 的对象

#### `Proposal`

这是最适合的对象之一。

原因：

- 最接近文档对象
- `comments` 天然是可增长结构
- `status/action_params` 存在明显并发修改价值
- 适合保留并发值后再做上层裁决

#### `Task`

也很适合，但前提是建模要谨慎。

适合放入 DSON 的部分：

- 标题
- 描述
- 标签
- 非终态内容编辑

需要额外语义治理的部分：

- 终态流转
- 生命周期字段
- 与时间块或提案联动的业务状态

#### `Settings / Config / Shared Metadata`

这类对象通常最适合 DSON：

- 结构稳定
- JSON-like
- 并发编辑真实存在
- 允许做 group-based merge

### 8.2 有条件适合的对象

#### 一般性的工作区对象 / 注释 / 结构化元数据

如果对象主要表现为：

- 嵌套结构
- 字段可并发修改
- 不要求单例占有或强时序语义

那通常都适合进入 DSON rail。

### 8.3 不应直接用 plain DSON 解决的对象

#### `EventLog`

原因：

- 它本质上是 append-only fact stream
- 主要价值在事件追加、去重、审计、不丢失
- 把它当成“文档编辑对象”反而不自然

EventLog 更适合：

- append-only rail
- EventTape / Journal
- 基于 event id 的去重与重放

#### `Active TimeBlock`

原因：

- 它更像 `lease / ownership / process-state`
- 有强烈的“当前活跃实例”语义
- 不是普通多字段文档 merge 就能解决的问题

如果未来要用 DSON，也更可能是：

- 自定义 extension
- 或和专门的 lease/protocol 结合

而不是 plain `OrMap + MvReg` 直接解决。

#### `Completed TimeBlock`

原因：

- 它更像事实集合
- 关键问题通常在重叠关系、时间语义、事实保留
- 不一定适合先按“文档对象”思维处理

#### `Blob / File / Attachment`

原因：

- 文件天然更适合 CAS/blob rail
- 不应把二进制内容硬塞进 DSON 文档层

### 8.4 因此，Greenfield 的正确答案是多 rail

如果采用 DSON，正确形态不是“统一所有同步对象”，而是多条同步轨并存：

- `Event / Fact Rail`
- `Mutable Object Rail`
- `Presence / Lease Rail`
- `Blob / File Rail`

而 DSON 主要属于第二条。

---

## 九、和其他主流路线的对照

为了避免因为只看 DSON 而产生过强偏见，本次也对照了 `iroh-docs`、`Automerge`、`Yjs` 的官方资料。

### 9.1 DSON vs iroh-docs

`iroh-docs` 的定位更像：

- 多维 key-value 文档系统
- 内建高效同步协议
- 依赖 `iroh-blobs + iroh-gossip`
- 具备 namespace / author / content-hash / reconciliation 能力

它的优势是：

- 同步协议成套一些
- 和 blob/gossip 体系配合自然
- 少造 recovery/transport 边界附近的轮子

它的代价是：

- 更偏 entry/hash/replica 协议系统
- JSON 对象级语义建模不如 DSON 直接
- 采用它时，网络与同步协议的主导权会更偏向 `iroh` 体系

因此：

- 如果 ExoMind 更想“少自研同步协议”，`iroh-docs` 更省事
- 如果 ExoMind 更想“ECS 自己掌控网络与连通，EDS 只要对象同步核”，DSON 更贴合

### 9.2 DSON vs Automerge

Automerge 的优势是：

- local-first 经验成熟
- 文档冲突可见性更友好
- 变更与合并模型更完整
- 社区和资料成熟度更高

但它的风格更偏：

- opinionated document system
- local-first app infrastructure

相对来说，DSON 更低层、更组合式、更接近“自己定义对象层 + 自己做 projector / validator”。

如果 ExoMind 强调：

- Runtime 主导
- Rust 后端内核
- 自己定义对象语义和恢复层

那么 DSON 的低层特性反而是优点。

### 9.3 DSON vs Yjs / Yrs

Yjs 的优势非常明显：

- provider 生态成熟
- update/state vector 机制成熟
- rich text / editor 场景极强
- update 天然满足 `commutative / associative / idempotent`

但它更偏向：

- 浏览器协同
- 文本编辑器和共享文档生态

如果 ExoMind 要的是“后端 Runtime 主导的对象同步核”，Yjs 并不是最顺手的落点。

### 9.4 综合判断

在“Rust 后端 + 自己掌控网络层 + 自己定义业务语义层”的组合下：

- `DSON` 是很强的候选
- `iroh-docs` 是协议更成套的候选
- `Automerge` 是 local-first 文档系统更成熟的候选
- `Yjs` 是前端协同文档生态更成熟的候选

所以 DSON 不是唯一合理答案，但它在 ExoMind 的技术气质下非常值得认真考虑。

---

## 十、如果采用 DSON，ExoMind 的推荐 greenfield 架构形态

下面给出一个尽量接近 ExoMind 的架构草图。

### 10.1 总体分工

#### ECS

负责：

- discovery
- pairing
- transport
- relay
- auth
- liveness

不负责：

- 对象冲突 contract
- 业务对象最终裁决

#### DSON Sync Core

负责：

- object delta generation
- object merge
- conflict preservation at object/register level
- typed object sync primitives

不负责：

- peer/network lifecycle
- bootstrap/repair protocol
- read model
- audit explanation

#### ExoMind Recovery Layer

负责：

- checkpoint
- causal context exchange
- anti-entropy
- bootstrap
- snapshot fallback
- repair cycle

#### ExoMind Projection Layer

负责：

- sync object -> domain object
- domain object -> UI/read model
- side effect trigger

#### ExoMind Validation Layer

负责：

- invariant checks
- audit log
- conflict escalation
- repair trigger
- human-visible reasoning

### 10.2 一个合理的数据流

以 `Proposal` 为例：

1. 本地用户修改 `Proposal`
2. 修改先进入 typed object abstraction
3. typed object abstraction 产出 DSON delta
4. ECS 把 delta 发到对端
5. 对端 DSON store merge delta
6. merge 后触发 validator
7. validator 检查 `status/action_params/comments` 是否违反 contract
8. 若通过，则写入 projector
9. projector 生成 domain read model
10. UI 读取 read model
11. 若不通过，则记录 conflict/audit，并触发 repair 或人工决议路径

这个数据流很符合 ExoMind 的系统气质：

- 同步层是同步层
- 投影层是投影层
- 校验层是校验层
- 网络层是网络层

---

## 十一、最大的风险与代价

如果采用 DSON，最大风险不在算法，而在系统工程。

### 11.1 风险一：低层灵活性意味着上层要写得更多

DSON 很低层，这是它的优势，也是它的成本。

必须自己补的内容包括：

- DocRegistry
- SyncSession / RecoverySession
- checkpoint strategy
- compaction strategy
- bootstrap protocol
- validator framework
- projector framework

### 11.2 风险二：对象建模一旦做错，后面会很难补

如果早期粗暴按字段拆寄存器，后面再补：

- lifecycle atom
- invariant grouping
- conflict object

会非常痛苦。

所以若走 DSON 路线，必须先严肃设计对象建模规则。

### 11.3 风险三：容易误把“CRDT 收敛”当成“业务正确”

这是所有 CRDT 路线都会遇到的问题，但 DSON 的低层性让这个问题更明显。

必须始终区分：

- `data converged`
- `business semantics correct`

这两个不是同一件事。

### 11.4 风险四：多 rail 设计比“统一一把梭”复杂

采用 DSON 的正确架构不是单 rail，而是：

- event rail
- mutable object rail
- lease rail
- blob rail

这会让系统整体更复杂，但这是符合问题本身复杂性的，不是额外的人为复杂度。

---

## 十二、最终判断

本次研究之后，结论可以明确写成：

### 12.1 可以肯定的部分

在 greenfield 前提下，`DSON 非常适合作为 ExoMind 的对象同步层主候选之一`。

它尤其适合：

- Proposal
- Task
- Settings / Config
- 共享 metadata
- 一般性的 mutable structured objects

### 12.2 必须同时成立的限定条件

这个判断成立的前提是：

1. ExoMind 明确采用分层架构
2. ECS 继续负责网络层
3. Recovery Layer 明确独立设计
4. Projection Layer 与 Validation Layer 不被省略
5. 对象建模按语义原子设计，而不是机械拆字段

### 12.3 不应误读的部分

这不意味着：

- DSON 单独就能成为 ExoMind 完整同步系统
- 所有 domain object 都应该统一迁入 DSON
- EventLog、Active TimeBlock、Blob 都适合 DSON
- 采用 DSON 后就不需要自己定义 conflict contract

### 12.4 最准确的一句话

> 如果 ExoMind 愿意在 greenfield 前提下重新设计同步系统，那么最合理的方向之一是：`ECS 负责连通，DSON 负责 mutable object sync core，ExoMind 自己的 recovery / projection / validation 负责把它变成完整同步系统。`

---

## 十三、仍待继续研究的问题

虽然本轮结论已经足够明确，但还有几类问题值得在下一轮单独展开。

### 13.1 对象建模规范

需要正式回答：

- 什么是语义原子
- 一个对象应该拆成几个 atom
- 哪些字段必须一起同步
- 哪些字段必须走 validator 而非自动 merge

### 13.2 Recovery 协议草案

需要正式回答：

- delta retention 如何设计
- causal context 如何交换
- 什么场景走增量补齐，什么场景退回 snapshot
- snapshot 粒度是对象级、域级还是 profile 级

### 13.3 Validation / Audit 机制

需要正式回答：

- conflict object 是否要显式建模
- audit trail 放在哪里
- losing branch 如何可追溯
- 什么情况下自动裁决，什么情况下升级人工

### 13.4 多 rail 的边界规范

需要正式回答：

- 哪些 domain 进入 mutable object rail
- 哪些 domain 保持 event rail
- Active TimeBlock 是否要单独成为 process-state rail
- Blob / file 是否由独立 CAS 体系承接

---

## 十四、DSON / Yrs / Automerge 横向交叉分析

本章不是重做全文判断，而是在前文结论的基础上，把 `DSON`、`Yrs`、`Automerge` 拉到同一个坐标系里做横向比较。

这里特意选 `Yrs` 而不是单独展开 `Yjs`，原因是：

- ExoMind 的 greenfield 主战场更接近 `Rust runtime / backend object sync`
- `Yrs` 是 `Yjs` 模型与协议在 Rust 侧的核心实现
- 如果最终要把对象同步核嵌进 ExoMind RT，`Yrs` 比纯 JS 的 `Yjs` 更直接可比

### 14.1 比较目的

本章要回答的不是“谁最好”，而是：

1. 三者各自解决的是哪一类同步问题
2. 如果 ExoMind 从零设计 sync stack，三者各自更适合放在哪一层
3. 如果只能优先选一个作为 `mutable object rail` 的核心，哪个更贴近 ExoMind 的目标

### 14.2 检索路线与来源选择

本次横向比较坚持只看一手官方资料。

| 阶段 | 操作 | 结果 |
|------|------|------|
| **DSON** | 读取 README、`src/lib.rs`、Cargo metadata、官方 blog、论文摘要 | 确认其核心是 `delta-state JSON-like CRDT + low-level library + no built-in networking + per-register causal consistency` |
| **Yrs** | 读取 docs.rs、GitHub README、官方 source docs | 确认其核心是 `Yjs-compatible shared types + y-sync + awareness + state vector / diff update` |
| **Automerge** | 读取 docs.rs、GitHub README、官方 conflict 文档 | 确认其核心是 `JSON-like collaborative document + built-in sync protocol + deterministic winner with conflict visibility + patch/history model` |
| **生态成熟度** | 使用 GitHub 官方 API 查看仓库元数据 | 确认三者在仓库年龄、stars、forks、近期开发表现上有明显差异 |

### 14.3 总览对比表

| 维度 | DSON | Yrs | Automerge |
|------|------|-----|-----------|
| **核心定位** | 低层、可组合的 JSON-like delta-state CRDT 库 | Yjs 兼容的 Rust CRDT 实现，偏 shared types / collaborative document | 偏完整的 local-first collaborative document 系统 |
| **主抽象** | `OrMap` / `OrArray` / `MvReg` | `Doc + Shared Types`（`TextRef/ArrayRef/MapRef/XML` 等） | `document + map/list/text/counter/scalar` |
| **内建同步协议** | 没有 | 有，`y-sync protocol` + `Awareness` | 有，`sync protocol` |
| **网络前提** | 上层自己实现 transport + anti-entropy | 提供 update/state vector/diff，同步与 provider 心智较成熟 | 官方 sync 依赖 `reliable in-order transport` |
| **冲突表达** | `MvReg` 显式保留并发值；OR collections | 多数 shared types 自动合并；`MapRef` 采用 logical LWW | 默认给出 deterministic winner，但可读出全部 conflicts |
| **冲突可见性** | 高，但需要自己做 typed abstraction | 中，更多是“自动合并后继续工作” | 高，默认 winner + `get_all/getConflicts` 风格可见性 |
| **文本/序列能力** | 无内建强文本心智 | 很强，rich text / XML / cursor / awareness / undo | 有 text/cursor/patch，但中心不是 editor 生态 |
| **历史/补丁能力** | 主要是 delta + causal context | update/state vector/snapshot，比文档历史更偏同步 | history / heads / patches / patchlog 更完整 |
| **扩展性** | 高，`ExtensionType` + `Sentinel` | 高，但主要围绕 shared types / protocol 扩展 | 高，但文档模型比 DSON 更成型、更有主张 |
| **Rust RT 嵌入感** | 很强 | 很强 | 很强 |
| **对 ExoMind 的第一直觉适配** | 最适合 `mutable object rail` | 最适合未来 rich text / editor / collaborative surface | 最适合“完整文档对象 + 历史可见”的 local-first 子系统 |

### 14.4 生态成熟度横向观察

截至本次调研时的官方仓库元数据：

| 仓库 | 创建时间 | Stars | Forks | 最近活跃 |
|------|----------|-------|-------|----------|
| `helsing-ai/dson` | 2025-07-09 | 154 | 6 | 2026-04-02 |
| `y-crdt/y-crdt` | 2020-09-29 | 2022 | 121 | 2026-01-23 |
| `automerge/automerge` | 2019-12-26 | 6156 | 239 | 2026-04-09 |

这不能直接推出“谁更适合 ExoMind”，但能说明：

- `DSON` 目前更年轻、更轻量、生态更小
- `Yrs` 和 `Automerge` 在公开生态和长期演进上明显更成熟
- 如果 ExoMind 重视“少踩新库边缘坑”，生态成熟度本身就是一个现实权重

### 14.5 三者各自真正擅长什么

#### 14.5.1 DSON：最像“对象同步内核”

如果只看架构位置，`DSON` 最像：

- `EDS Object Sync Core`
- 一组可以嵌入 ExoMind runtime 的低层 CRDT 原语
- 一个需要上层自己补齐 transport / recovery / validation 的对象同步引擎

它最突出的优点是：

- 低层、干净、组合式
- 显式保留并发值，而不是默认把冲突藏掉
- 不把网络、provider、文档 UI 心智硬塞给调用方
- 有 `ExtensionType` 和 `Sentinel`，适合 ExoMind 做领域扩展和后校验

它最突出的代价是：

- 同步协议和恢复协议都要自己设计
- 对象建模要求很高
- `per-register` 一致性意味着 ExoMind 必须主动做“语义原子化建模”

换句话说：

> DSON 最适合“我们知道自己要构建什么样的同步系统，因此希望 CRDT 层尽量低、尽量可控”的场景。

#### 14.5.2 Yrs：最像“协作文档 / shared types 平台”

`Yrs` 的官方资料给出的中心非常明确：

- `Doc + Shared Types`
- `Text / Array / Map / XML`
- `Awareness + y-sync protocol`
- `state vector / diff update / merge_updates`

它特别强的地方在于：

- 文本、序列、嵌入元素、cursor、undo/redo、subdocs 等能力非常完整
- Rust 实现已经内建一整套同步心智，而不是只给你 CRDT 原语
- 如果目标是 collaborative editor、shared surface、structured text，它明显比 DSON 更现成

但它和 ExoMind `mutable object rail` 的天然张力也很明显：

- `MapRef` 的官方冲突模型是 logical last-write-wins
- 它更擅长“让共享文档继续工作”，而不是“把 object-level divergent values 显式保留给业务层裁决”
- 它的建模重心更偏 shared type/document，而不是“面向业务对象 contract 的可解释冲突治理”

因此：

> Yrs 更像 ExoMind 未来某条“协同文本/共享画布/共享富文档”轨道的候选，而不是最理想的 `Task / Proposal / Settings` 统一对象同步内核。

#### 14.5.3 Automerge：最像“更完整的 local-first 文档系统”

Automerge 的位置介于 DSON 和 Yrs 之间。

它不像 DSON 那么低层，也不像 Yrs 那样强烈偏向 editor/shared type 生态。

它更像：

- 一个 JSON-like collaborative document system
- 内建 sync protocol
- 维护 change history / heads / patches
- 默认给出 deterministic winner，但同时保留 conflict visibility

它的优势是：

- 对 ExoMind 这类 JSON-like object world 来说很自然
- conflict 可见性比 Yrs 强
- 不像 DSON 那么“万事要自己补”，因为它把文档、同步、patch、history 组织得更完整

它的代价是：

- 比 DSON 更有主张，意味着 ExoMind 可控空间相对变少
- 官方 sync protocol 明确依赖 `reliable in-order transport`
- 它更像“完整文档系统”，而不是“极低层 CRDT 原语箱”

因此：

> Automerge 特别适合“想要一个更完整的 local-first 文档内核，同时仍保留一定 conflict visibility”的场景。

### 14.6 从 ExoMind greenfield 目标反推，三者各自最合理的落位

如果按照 ExoMind 前文已经抽象出的五层架构来看：

1. `ECS Network Layer`
2. `EDS Object Sync Layer`
3. `Recovery Layer`
4. `Projection Layer`
5. `Validation Layer`

那么三者最合理的落位如下。

#### DSON 的落位

最适合：

- `EDS Object Sync Layer` 的核心内核

不负责：

- `Network`
- `Recovery`
- `Projection`
- `Validation`

这和 ExoMind 的分层理念最一致。

#### Yrs 的落位

最适合：

- `EDS` 中偏 collaborative surface / shared document 的分支
- 未来如果 ExoMind 要有富文本 note、共享画布对象、文档编辑 surface，这条路会非常强

但如果强行让它统领全部 mutable object rail，会出现 object-level conflict contract 不够直观的问题。

#### Automerge 的落位

最适合：

- 一个更完整的 document-centric EDS 子系统
- 如果 ExoMind 想把大量 mutable objects 直接建成 local-first documents，并希望自带 sync/history/patch 能力，Automerge 是很强的整体候选

但它对 ExoMind 的“ECS 自主网络层 + 多 rail 分工 + validator 治理层”愿景来说，没有 DSON 那么干净。

### 14.7 面向 ExoMind 数据域的实际判断

#### `Proposal`

- `DSON`：很适合
- `Automerge`：也很适合
- `Yrs`：可做，但不是最顺手

理由：

- `Proposal` 是最像 JSON-like mutable object 的对象
- 需要显式表达 `status / action_params / comments` 的并发与治理
- DSON 和 Automerge 都比 Yrs 更贴近这种 object contract

#### `Task`

- `DSON`：适合，但必须做语义原子化建模
- `Automerge`：适合，尤其在需要 history / conflict visibility 时
- `Yrs`：不理想，尤其对 lifecycle 类字段

#### `Settings / Config`

- `DSON`：适合
- `Automerge`：适合
- `Yrs`：能做，但不是第一候选

#### 富文本笔记 / 协作文档 / 富文本说明

- `Yrs`：最强
- `Automerge`：可做
- `DSON`：不占优势，除非自己做很多扩展

#### `EventLog`

三者都不是最优主路径。

`EventLog` 更适合 append-only / event rail，而不是 document rail。

#### `Active TimeBlock / presence / lock / lease`

三者都不能直接作为完整答案。

这类对象更像：

- process-state rail
- lease/presence protocol
- 需要专门 contract 的运行态对象

### 14.8 如果 ExoMind 只能优先选一个作为 mutable object rail 的主候选

在 ExoMind 这套 greenfield 分层假设下，如果只能优先选一个作为：

- `Task / Proposal / Settings / metadata`
- 这类 mutable object rail 的主候选

我的判断顺序是：

1. `DSON`
2. `Automerge`
3. `Yrs`

原因不是“DSON 综合最好”，而是它与 ExoMind 的架构分工最对齐：

- ExoMind 本来就想自己掌控网络层
- ExoMind 本来就需要单独的 recovery / projection / validation
- ExoMind 本来就不适合把所有对象都塞进 editor/shared-type 心智

在这个前提下：

- `DSON` 的低层性正好是优点
- `Automerge` 次之，因为它更完整，但也更有主张
- `Yrs` 更像未来的专用轨，而不是统一对象同步底座

### 14.9 但如果 ExoMind 不是只选一个，而是允许多轨并存

如果允许多轨并存，那么更合理的组合反而是：

- `DSON`：mutable object rail
- `Yrs`：rich text / collaborative surface rail
- `append-only event rail`：EventLog / fact stream
- `blob rail`：file / attachment / binary payload

在这种设计下，Automerge 的角色会变得更微妙：

- 它仍然可以替代 DSON 成为 mutable object rail 候选
- 但如果已经接受 `DSON + Yrs + event/blob rails` 这种分工，Automerge 就未必是必须的

### 14.10 本章结论

本章的最终结论可以压缩成四句话：

1. `DSON` 最像 ExoMind `mutable object rail` 的低层同步内核。
2. `Yrs` 最适合 ExoMind 未来的 rich text / collaborative surface，而不是统一对象合同层。
3. `Automerge` 是一个更完整、更成熟的 document-centric 候选，如果 ExoMind 想减少自建对象同步基础设施，它是最强备选之一。
4. 如果 ExoMind 继续坚持“ECS 自控网络层 + EDS 多 rail + validator 治理层”，那么 `DSON 仍是最贴合这套架构哲学的第一候选`。

---

## 参考资料

### 内部参考

- `docs/architecture/overview.md`
- `docs/architecture/principles.md`
- `docs/architecture/ECS-communication-stack.md`
- `docs/architecture/ECS-EDS-discussion-2026-03-04.md`
- `docs/specs/sync.md`

### 外部参考

- DSON README  
  https://github.com/helsing-ai/dson/blob/main/README.md

- DSON crate docs / source docs  
  https://docs.rs/dson  
  https://raw.githubusercontent.com/helsing-ai/dson/main/src/lib.rs

- DSON Cargo metadata  
  https://raw.githubusercontent.com/helsing-ai/dson/main/Cargo.toml

- DSON blog  
  https://blog.helsing.ai/posts/dson-a-delta-state-crdt-for-resilient-peer-to-peer-communication/

- DSON paper / IBM Research page  
  https://research.ibm.com/publications/dson-json-crdt-using-delta-mutations-for-document-stores

- Range-Based Set Reconciliation  
  https://arxiv.org/abs/2212.13567

- iroh-docs repository / docs  
  https://github.com/n0-computer/iroh-docs  
  https://docs.rs/iroh-docs/latest/iroh_docs/

- Automerge repository / docs / conflicts reference  
  https://github.com/automerge/automerge  
  https://docs.rs/automerge/latest/automerge/  
  https://automerge.org/docs/reference/documents/conflicts/

- Yrs repository / docs / sync and map conflict references  
  https://github.com/y-crdt/y-crdt  
  https://docs.rs/yrs/latest/yrs/  
  https://docs.rs/yrs/latest/src/yrs/types/map.rs.html

- Yjs repository / document updates reference  
  https://github.com/yjs/yjs  
  https://docs.yjs.dev/api/document-updates
