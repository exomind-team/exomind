# jj 版本控制哲学 × ExoMind 事件日志与时间块系统：系统性分析报告

> 日期：2026-03-24
> 性质：调查研究 + 设计启发
> 关联：ExoMind EventLog / TimeBlock / 生命判据

---

## 一、jj 的版本控制哲学拆解

### 1.1 核心洞察：对仓库状态本身做版本控制

jj（Jujutsu）由 Google 的 Martin von Zweigbergk 于 2019 年开始开发。它的核心不是"更好的 Git CLI"，而是一个根本性的架构决策：**对仓库状态本身做版本控制**。

Git 用锁文件串行化所有仓库变更。von Zweigbergk 问了一个问题：如果把仓库状态本身也版本化呢？这个单一决策级联产生了 jj 的所有特性——undo、无冲突阻塞、并发修改、无脏工作区问题。

### 1.2 十个设计原则

#### 原则 1：工作副本即提交（无未提交状态）

工作目录始终是一个真实的提交。没有"未提交更改"这种中间状态。

Git 有三个状态：工作目录、暂存区（index）、已提交历史——形成复杂的状态机。jj 将三者合一：你的工作目录就是当前提交。

**设计动机**：概念统一。Git 的 index 原本是性能优化，却泄漏到了用户模型中，产生了认知负担（什么已暂存？什么未暂存？什么已提交？）。如果提交廉价且重写容易，index 就没有存在的必要。

**后果**：命令永远不会因为"脏工作区"而失败。不需要 `git stash`。不存在"Your local changes would be overwritten"错误。围绕未提交状态的整类问题直接消失。

#### 原则 2：变更 ID vs 提交 ID（身份稳定性）

每个逻辑工作单元有两个标识符：
- **Change ID**（稳定，跨重写持久存在）
- **Commit ID**（内容哈希，每次重写都变）

**设计动机**：将身份与内容分离。一个变更是一个概念单元（"修复登录 bug"），它通过多次重写而演化。Change ID 追踪这个身份。Commit ID 追踪某一刻的内容快照。

Git 混淆了"我在做什么"和"某个特定的内容快照"。当你 `git commit --amend` 时，你并没有修改任何东西——你创建了一个全新的对象并移动了指针。jj 让这变得显式：Change ID 不变，Commit ID 变了，演化日志 (`jj evolog`) 记录了变更的完整演化历史。

#### 原则 3：不可变提交 + 自动后代变基

重写一个提交时，它的所有后代自动被变基到新提交之上。重写永远不会留下孤儿子节点。

**设计动机**：**结构一致性原则**——提交图应该始终反映所有变更的最新状态。如果你编辑了链 A-B-C-D 中的 B，C 和 D 自动变基到新 B 之上。如果产生冲突，冲突被记录在变基后的提交中——变基永远不会失败。

#### 原则 4：冲突是一等数据（冲突物化）

冲突不是阻塞操作的错误，而是**存储在提交中的数据**，可以在任何时候解决、通过变基传播、甚至被撤销。

**设计动机**：这可能是 jj 最具理论意义的创新。借鉴自 Darcs 和 Pijul（基于补丁的 VCS），但在基于快照的模型中实现。

关键洞察：冲突是**代数对象**，不是文本标记。三路合并冲突表示为 `A+(C-B)`，遵循代数化简规则：
- 冲突的变基：中间状态会被消去
- 冲突的撤销：代数化简后回到干净状态
- 相同变更规则：所有方自动解析

**后果**：操作永远不会因为冲突而失败。不需要 `git rebase --continue`。不需要 `git merge --abort`。

#### 原则 5：操作日志（每个变更可追溯可撤销）

每个变更仓库的操作都被原子性地记录在追加日志中。整个仓库状态可以恢复到任何之前的点。

**设计动机**：操作日志是实现**无锁并发**的机制——von Zweigbergk 最初的架构需求。每个变更创建仓库状态的新不可变快照，并发变更创建分歧的操作历史，可以像分歧的提交历史一样被合并。

任何操作——合并、变基、提交修改、分支移动——都可以通过 `jj undo` 一步撤销，因为之前的全仓库状态快照始终可用。

#### 原则 6：无暂存区（基于快照而非补丁）

没有 index/暂存区。所有文件更改自动成为当前工作副本提交的一部分。选择性提交通过 `jj split`（分解变更）和 `jj squash`（合并变更）实现。

**设计动机**：如果重写提交是廉价的，就不需要暂存区。先做所有修改，然后用 `jj split` 事后把它们切分成逻辑单元。这是**事后组织**模型，而非 Git 的**事前组织**模型。

#### 原则 7：匿名分支 / 书签

默认在匿名分支上工作。命名指针（称为"bookmarks"，不是"branches"）只在与远端交互时才需要。

**设计动机**：反转 Git 关于开发者意图的假设。Git 假设分支名应该自动跟随工作。jj 假设**显式追踪防止意外推送**。

#### 原则 8：一等合并与分歧变更

合并提交通过其相对于自动合并父节点的 diff 来定义，消除了"邪恶合并"。分歧变更（同一 Change ID 出现在多个可见提交上）是合法状态，不是错误。

#### 原则 9：演化概念（变更如何随时间演化）

每次重写创建前驱/后继关系。演化日志 (`jj evolog`) 显示单个变更经历修改的完整历史。变更是一个**过程，不是快照**。

#### 原则 10：Revset 语言（声明式修订选择）

Revset 是一种函数式、可组合的语言，用于选择修订集合，具有标准集合操作（并集 `|`、交集 `&`、否定 `~`）和图遍历操作符。来自 Mercurial，提供数学上的**一致性**。

### 1.3 理论基础

jj 处于 Git 的无理论快照模型和 Darcs/Pijul 的形式化补丁理论之间的实用中间地带：

- **Darcs**（2003）：物理学家 David Roundy 类比量子力学算子创建了补丁理论。两个基本操作——补丁逆和补丁交换——定义了补丁何时可以重排序
- **Pijul**：Mimram 和 di Giusto 用**范畴论**形式化了补丁理论。文件是对象，补丁是箭头，合并是**推出（pushout）**
- **jj 的位置**：不实现完整的补丁理论，使用 Git 的快照存储模型，但借鉴了 Darcs/Pijul 的一等冲突概念，通过冲突树的代数表示实现

---

## 二、ExoMind EventLog 系统现状

### 2.1 数据模型

EventLog 事件包含：`id`（UUID）、`timestamp`（毫秒时间戳）、`content`（文本）、`tags`（标签集合）、`metadata`（扩展元数据含 source 设备信息）。

16 个系统标签覆盖：时间块生命周期（block_start/end/pause/resume/feedback）、Agent 反馈、笔记、任务生命周期（task_created/started/resumed/suspended/completed/cancelled/linked/unlinked）。

### 2.2 存储层

**关键发现：EventLog 不是真正的只追加（append-only）。**

| 操作 | 存在？ | 位置 |
|------|--------|------|
| 追加事件 | ✅ | `addEvent()` |
| 更新事件 | ✅ | `updateEvent()` — 覆盖已有事件并设置 `updatedAt` |
| 删除事件 | ✅ | `deleteEvent()` — 从 PouchDB 移除 |
| 清空全部 | ✅ | `clearAll()` — 批量删除 |
| RT 侧 Upsert | ✅ | SQLite `INSERT ON CONFLICT DO UPDATE` |

这与 CLAUDE.md 的生命判据"操作生效=留下痕迹，无 undo"存在矛盾。

### 2.3 ECS 复制

通过 Signal Bus 的 `eventlog.replication.appended` 信号实现跨设备事件同步。复制载荷包含 `replicationSeq` 游标用于排序。接收方通过 `isSameLogicalEvent` 检测重复。

---

## 三、ExoMind TimeBlock 系统现状

### 3.1 状态机

TimeBlock 的 Phase 系统形成**单调前进的有限状态机**：

```
            startBlock()
                |
                v
          +----------+
          | running  | <-----+
          +----------+       |
              |   |          |
     pause()  |   | resume()
              v   |          |
          +----------+       |
          | paused   | ------+
          +----------+
                |
                | markEnding()
                v
      +---------------------+
      | feedback_in_progress|
      +---------------------+
                |
                | endBlock()
                v
      +---------------------+
      | feedback_submitted  |  (终态，不可逆)
      +---------------------+
```

**Phase 只能前进，不能后退。** `running ↔ paused` 循环是唯一的双向转换，但它们同属 phase 0。`feedback_in_progress` 是 phase 1，`feedback_submitted` 是 phase 2（终态）。

### 3.2 版本管理与冲突解决

每次状态变更递增 `version` 并标记 `actorId`（设备标识）。多设备冲突解决使用一个**五级级联判决**：

1. 不同 block（不同 startId）：优先更新的 startTime
2. 同 block 不同 phase：优先更高 phase（phase 单调性）
3. 同 block 同 phase：优先更高 version
4. 同 version：优先更新的 lastTransitionAt
5. 最终平局：字典序更大的 actorId

这保证了无需协调的收敛——类 CRDT 的 last-writer-wins + phase 单调性。

### 3.3 已知问题

- **Issue #104**：activeBlock 多设备同步竞争条件。乐观重试（3 次）缓解但不能完全解决高争用场景
- **非真正不可变**：已完成的 TimeBlock 没有更新 API，但 `replace_completed_scoped()` 可以覆盖整个列表
- **无撤销**：没有 undo/rollback，设计上刻意如此（生命判据）

---

## 四、核心对照分析

### 4.1 概念映射表

| jj 概念 | ExoMind 对应物 | 匹配度 | 差异 |
|--------|--------------|--------|------|
| 工作副本=提交 | ActiveBlock（始终存在，始终可变） | ★★★★ | ExoMind 允许"无活跃 block"状态，jj 不允许"无提交"状态 |
| Change ID（稳定身份） | startId（block 身份） | ★★★★ | 两者都在状态变更中保持身份不变 |
| Commit ID（内容哈希） | version 递增计数器 | ★★★ | jj 用内容哈希，ExoMind 用单调计数器 |
| 操作日志 | EventLog | ★★★★ | 两者都是变更的审计轨迹，但 EventLog 非真正只追加 |
| 冲突物化 | 多设备 LWW 解析 | ★★ | jj 将冲突存为数据；ExoMind 静默选择赢家丢弃输家 |
| Phase 单调性 | Phase 单调性 | ★★★★★ | 完美一致——两者都强制状态只能前进 |
| 不可变提交 | 已完成 TimeBlock | ★★★★ | 两者在完成后都是不可变的 |
| 无暂存区 | 无"规划"阶段 | ★★★ | 两者都倾向直接行动而非预备 |
| Revset 查询语言 | 无对应物 | — | ExoMind 没有事件查询语言 |
| 自动后代变基 | 无对应物 | — | ExoMind 没有依赖链概念 |

### 4.2 深层洞察

#### 洞察 1："你始终在一个提交中" ↔ "你始终在花时间"

jj 的激进洞察：不存在"未提交的工作"。你始终在一个提交内部。

ExoMind 可以更进一步：**不存在"不在时间块中"的状态。** 当前用户必须显式开始一个 block。如果系统始终有一个"环境时间块"——你始终在一个时间块中，只是有时还没给它命名呢？

```
jj 的方式：
  你编辑文件 → 自动成为当前提交的一部分
  你想命名 → jj describe "修复 bug"

外心的潜力：
  时间流逝 → 自动在一个环境时间块中
  你开始专注 → 给当前环境块命名 "写论文第三章"
  你没命名 → 时间块依然存在，只是标记为"未分类时间"
```

这消除了"我忘记启动计时器"的问题。时间没有空隙——你始终在花时间做某件事。

#### 洞察 2：操作日志 ↔ EventLog 的纯度缺失

jj 的操作日志是**严格只追加**的——你不能删除操作，只能添加新的操作来"撤销"之前的操作。

ExoMind 的 EventLog 有 `updateEvent()` 和 `deleteEvent()`——这违反了"操作生效=留下痕迹"的生命判据。

**启发**：EventLog 应该强制真正的只追加语义。"删除"一个事件应该记录为一个新的"删除事件"，而不是实际移除记录：

```
当前：deleteEvent("e-123") → 记录从数据库消失
应该：appendEvent({ type: "event_retracted", targetId: "e-123", reason: "用户撤回" })
      → 原始记录保留，新增一条撤回记录
      → 查询时过滤掉已撤回的事件
```

#### 洞察 3：冲突物化 ↔ 多设备同步的哲学差异

jj 的态度：冲突是**数据**，不是**错误**。两个人同时修改同一个文件？存下来，以后再说。

ExoMind 的态度：冲突是**需要立即解决的问题**。两台设备同时修改 activeBlock？LWW 自动选一个赢家，输家被静默丢弃。

**启发**：如果 ExoMind 像 jj 一样把冲突当作数据呢？

```
当前（LWW）：
  设备 A：暂停了时间块（phase=0, version=3）
  设备 B：结束了时间块（phase=1, version=2）
  → 自动选择 B（phase 更高），A 的暂停操作被丢弃

冲突物化：
  → 记录冲突事件：{
      type: "block_conflict_detected",
      deviceA: { action: "pause", version: 3 },
      deviceB: { action: "end", version: 2 },
      resolution: "phase_monotonicity_selected_B",
      discarded: "A_pause"
    }
  → 用户可以在事件日志中看到"设备 A 的暂停操作被冲突解析覆盖了"
```

这不改变解析策略，但让冲突**可见**——用户知道发生了什么，而不是困惑"为什么我的暂停没生效？"

#### 洞察 4：演化日志 ↔ 时间块的状态历史

jj 的 `jj evolog` 显示一个变更经历的完整修改历史。ExoMind 的时间块只有最终状态——中间的 pause/resume 历史分散在 EventLog 中，没有直接关联。

**启发**：为每个时间块维护一个内联的**演化日志**：

```typescript
interface TimeBlockEvolution {
  startId: string;
  history: Array<{
    timestamp: number;
    actorId: string;
    fromPhase: ActiveBlockPhase;
    toPhase: ActiveBlockPhase;
    version: number;
    trigger: 'user' | 'conflict_resolution' | 'timer_expired';
  }>;
}
```

这让"这个时间块经历了什么"变成一等公民——不需要从 EventLog 中拼凑。

#### 洞察 5：补偿操作 vs 无撤销

jj 的 undo 并非真正的撤销——它创建一个**新操作**来恢复之前的状态。undo 本身被记录。这与 ExoMind 的"操作留痕"原则完全兼容！

**启发**：ExoMind 可以支持"补偿操作"而不违反无回滚原则：

```
用户："我不小心结束了时间块"
当前：无法挽回，block 已进入 feedback_submitted 终态

补偿操作方案：
  → 创建补偿事件：{ type: "block_correction", originalBlockId: "b-123",
                     reason: "误操作结束", correction: "reopen_as_new_block" }
  → 基于原始 block 的状态创建一个新的活跃 block，继承 name、taskIds
  → 原始 block 保留在已完成列表中（留痕）
  → 新 block 的 metadata 引用原始 block（可追溯）
```

这是"前进式修正"——不删除历史，而是在历史之上追加修正。和 jj 的 undo 哲学一致。

#### 洞察 6：Revset → 事件查询语言

jj 的 Revset 是声明式的修订选择语言。ExoMind 的 EventLog 没有类似物——查询事件要么通过代码中的 filter/map，要么通过 RT 的简单 URL 参数。

**启发**：为 EventLog 设计一个可组合的查询语言：

```
# 最近 7 天的所有专注记录
blocks_completed & after("7d ago")

# 某个任务的完整生命周期
task("t-001").events

# 工作日的有效专注时长
blocks_completed & weekday & duration > 25min

# 被冲突解析覆盖的操作
tag("block_conflict_detected") & after("30d ago")
```

这不需要立即实现——但它是时间块系统未来进化的方向：从命令式操作到声明式查询。

---

## 五、时间块系统打磨灵感

基于以上分析，按优先级排列具体改进方向：

### 5.1 短期（可立即行动）

| # | 改进 | 来源 | 复杂度 |
|---|------|------|--------|
| S1 | **冲突可见化**：多设备冲突解析时写入一条 EventLog 记录，让用户知道发生了什么 | 洞察 3 | 低 |
| S2 | **移除 EventLog 的 updateEvent/deleteEvent**：用补偿事件替代，强制只追加 | 洞察 2 | 中 |
| S3 | **时间块演化日志**：在 activeBlock 中维护 `phaseHistory` 数组，记录每次状态转换 | 洞察 4 | 低 |

### 5.2 中期（需要设计讨论）

| # | 改进 | 来源 | 复杂度 |
|---|------|------|--------|
| M1 | **环境时间块**：系统始终有一个活跃时间块，"开始专注"变为"命名当前块" | 洞察 1 | 高 |
| M2 | **补偿操作**：支持"前进式修正"——误操作后基于原始状态创建新 block | 洞察 5 | 中 |
| M3 | **冲突物化存储**：不只是日志记录，而是保存冲突的两个版本供用户裁决 | 洞察 3 | 高 |

### 5.3 长期（需要架构变更）

| # | 改进 | 来源 | 复杂度 |
|---|------|------|--------|
| L1 | **事件查询语言**（ExoMind Revset）：声明式事件/时间块查询 | 洞察 6 | 高 |
| L2 | **时间块分叉**：允许将一个进行中的 block 分裂为两个并发活动 | jj 原则 8 | 高 |
| L3 | **Change ID 概念引入任务系统**：任务的概念身份跨越创建/取消/重建保持稳定 | jj 原则 2 | 中 |

---

## 六、与生命判据的对齐

| 生命判据 | jj 的实现 | ExoMind 当前 | 改进方向 |
|---------|----------|-------------|---------|
| **失败不可回滚** | undo 创建新操作，不删除旧操作 | EventLog 允许删除（违规） | S2：强制只追加 |
| **过程性存在** | 工作副本始终是提交（持续展开） | 允许无活跃 block（间断） | M1：环境时间块 |
| **边界归因** | actorId 标识每个操作的来源 | actorId + deviceId | 已对齐 ✅ |
| **环境裁决** | 冲突由代数规则裁决 | 冲突由 LWW + phase 单调性裁决 | S1：冲突可见化 |
| **可存活区间** | 操作日志保证可恢复 | 无恢复机制 | M2：补偿操作 |

---

## 七、参考来源

### jj 哲学

- [Chris Krycho, "jj init"](https://v5.chriskrycho.com/essays/jj-init/) — 最全面的哲学分析
- [Steve Klabnik's Jujutsu Tutorial](https://steveklabnik.github.io/jujutsu-tutorial/) — 实践哲学
- [Jujutsu 官方文档](https://docs.jj-vcs.dev/latest/) — 核心概念、冲突、操作日志、Revset
- [jj 技术冲突文档](https://docs.jj-vcs.dev/latest/technical/conflicts/) — 代数冲突表示
- ["Jujutsu is great for the wrong reason"](https://www.felesatra.moe/blog/2024/12/23/jj-is-great-for-the-wrong-reason) — 并发优先论点
- [Martin von Zweigbergk's Git Merge 2022 slides](https://docs.google.com/presentation/d/1F8j9_UOOSGUN9MvHxPZX_L4bQ9NMcYOp1isn17kTC_M/view) — 创作者原始演讲
- [A Categorical Theory of Patches (Mimram & di Giusto)](https://www.researchgate.net/publication/258521116_A_Categorical_Theory_of_Patches) — Pijul 的范畴论基础

### ExoMind 代码

- `src/lib/types/event.ts` — Event, TimeBlock, ActiveBlockData, SYSTEM_TAGS
- `src/lib/storage/event-storage.ts` — PouchDB 事件存储（含 update/delete）
- `src/lib/services/timeblock.service.ts` — 时间块服务（状态机、冲突解析）
- `src/lib/storage/active-block-storage.ts` — 活跃块存储（PouchDB 冲突解析）
- `src/lib/services/ecs-eventlog-replication.service.ts` — ECS 复制
- `crates/exomind-runtime/src/eventlog_sqlite.rs` — RT SQLite EventLog（upsert 语义）
- `crates/exomind-runtime/src/timeblock_sqlite.rs` — RT SQLite TimeBlock
