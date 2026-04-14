# 多 Domain Reconciliation 设计稿

> **状态**：设计草案，待实现
> **日期**：2026-04-13
> **关联规格**：[sync.md](../specs/sync.md)
> **历史背景计划（非当前规范）**：[PLAN-cross-device-incremental-sync.md](PLAN-cross-device-incremental-sync.md)
> **首个实现切片**：[2026-04-13-task-sync-reconciliation-solution-plan.md](2026-04-13-task-sync-reconciliation-solution-plan.md)

---

## 零、文档优先级

当前关于 reconciliation / peer-auth / scope-bound repair 的规范优先级固定为：

1. [sync.md](../specs/sync.md)
2. 本设计稿
3. 分域实现切片文档

[PLAN-cross-device-incremental-sync.md](PLAN-cross-device-incremental-sync.md) 只保留“从 Pouch 主链路迁出”的历史背景价值。  
凡是它与本稿在以下方面存在冲突时，必须以本稿为准：

- peer-auth 与 control-plane auth 的边界
- `summary -> compare -> pull -> snapshot fallback` 的 repair 语义
- scope-bound auth / `PeerScopeGrant`
- 各 domain 的“自动收敛”边界

---

## 一、设计结论

当前跨设备同步不能继续停留在“每个 domain 各自 live replication，再各自补洞”的状态。  
`EventLog / Task / TimeBlock` 应收敛到同一套 **reconciliation framework（持续校验 + 差异回填框架）**，每个 domain 只保留自己的摘要规则、增量 cursor 和 apply 逻辑。

核心结论有六条：

1. **同步闭环必须由 `fast path + repair path` 组成。**
   - `fast path` = live signal replication
   - `repair path` = 周期性 reconciliation
2. **reconciliation 不是 pairing 后一次性补偿，而是常规同步机制。**
3. **repair path 不再依赖 control-plane admin token，而是建立在 pairing 后已有的 peer auth 上。**
4. **UI 不持有 peer secret。**
   - peer auth 只存在于 runtime mesh state
   - UI 通过本地 runtime proxy 调用远端 peer data-plane
5. **peer auth 必须再绑定 `scope grant`，不能只绑定 `peer_id`。**
   - pairing 只证明“这是受信任设备”
   - 不等于“这个设备可读取任意 `user_id/profile_id` 作用域”
6. **三域共享同一壳层，但保留各自 adapter。**
   - 统一触发、统一鉴权、统一比较流程
   - 不统一业务数据形状和冲突语义

---

## 二、为什么要统一到多 Domain 框架

### 2.1 当前问题不是 task 独有，只是 task 最先暴露

[rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts) 当前对：

- `eventlog`
- `tasks`
- `timeblocks`

都走同一套 `confirmed_peer + authToken` 过滤。  
因此“repair path 绑死 control-plane auth”并不是 task 独有问题，而是三域共享的结构问题。

只是当前现场里：

- `EventLog` 更偏 append-only，live path 成熟，症状较轻
- `TimeBlock` 已有 active/completed 双形态，问题被拆散了
- `Task` 最依赖补偿同步，所以最容易暴露为“配对后长期不同步”

### 2.2 如果只修 task，会制造新的架构割裂

如果 task 单独长出一套：

- 独有摘要契约
- 独有 peer auth proxy
- 独有 drift 检测调度

而 eventlog / timeblock 继续沿用旧 backfill 逻辑，那么后面会出现：

- 三个 domain 三套 repair 语义
- 三套日志和调试心智
- 三套触发点和失败模式

这会比当前状态更难维护。

### 2.3 正确做法是：共享壳层，分域适配

统一的应该是：

- 何时触发 reconciliation
- 如何发现 peer
- 如何做 peer-auth 调用
- 如何比较本地与远端摘要
- 如何决定 `pull -> snapshot fallback`
- 如何记录 drift / recovery 日志

分开的应该是：

- 摘要内容
- 增量 cursor
- apply 规则
- snapshot 形状

---

## 三、目标与非目标

## 3.1 目标

1. 为 `EventLog / Task / TimeBlock` 提供统一 reconciliation framework。
2. 让 repair path 在真实 pairing 场景下闭环，不再要求远端 control-plane admin token。
3. 让 drift 检测成为同步入口，而不是满足条件后盲跑 snapshot import。
4. 保留 live replication 的低延迟优势，不把所有同步都降级成重拉快照。

## 3.2 非目标

1. 这轮不引入 CRDT。
2. 这轮不重写 mesh / SSE transport。
3. 这轮不把所有 domain 做成完全一致的数据模型。
4. `Reminder` 先不纳入第一批统一落地范围。
   - 原因不是它不需要
   - 而是它当前仍是异形 headless path，应在后续作为第四个 adapter 接入

---

## 四、目标架构

### 4.1 统一结构

每个 domain 的最终结构统一为：

```text
本地写入
  -> live replication topic
  -> 远端低延迟 apply

同时：
启动 / pairing后 / focus / online / 定时
  -> reconciliation coordinator
  -> local summary
  -> peer summary
  -> compare
  -> pull
  -> snapshot fallback
  -> convergence check
```

### 4.2 分层职责

#### Runtime

- 持有 peer secret
- 暴露 peer-auth data-plane 路由
- 暴露本地 admin/loopback proxy 路由
- 生成 domain summary
- 提供增量 pull / snapshot 导出

#### UI / TS Service

- 负责触发 reconciliation
- 负责调用本地 runtime proxy
- 负责把补偿结果导入本地 RT apply 路径
- 负责观测与状态上报

#### Domain Adapter

每个 domain 各自定义：

- `buildSummary`
- `compareSummary`
- `pullIncremental`
- `applyIncremental`
- `snapshotFallback`

---

## 五、鉴权设计

### 5.1 三类路由

后续路由必须明确分成三类：

#### A. Control-plane admin routes

例子：

- `/tasks/import/*`
- `/tasks/backup/sqlite`
- `/mesh/peers`
- `/mesh/pairing/*`

要求：

- 仅 admin secret / loopback / 显式开放 LAN 访问
- peer token 不可访问

#### B. Peer-auth data-plane routes

例子：

- `/mesh/tasks/summary`
- `/mesh/tasks/pull`
- `/mesh/tasks/snapshot/sqlite`
- `/mesh/eventlog/summary`
- `/mesh/eventlog/pull`
- `/mesh/eventlog/snapshot/sqlite`
- `/mesh/timeblocks/summary`
- `/mesh/timeblocks/pull`
- `/mesh/timeblocks/snapshot/sqlite`

要求：

- 仅 peer token 访问
- 只读
- 不提供管理操作
- 不接受“未经授权即可任意指定 `user_id/profile_id`”的调用方式

#### C. Local runtime proxy routes

例子：

- `/mesh/peers/:peer_id/tasks/summary`
- `/mesh/peers/:peer_id/tasks/pull`
- `/mesh/peers/:peer_id/tasks/snapshot/sqlite`

要求：

- UI 只调用本地 proxy
- proxy 从 mesh state 取 outbound peer token
- proxy 代替 UI 调远端 peer data-plane
- proxy 不再透传 `user_id/profile_id` 给远端 peer-auth route
- 远端 scope 由对端 runtime 的唯一有效 `PeerScopeGrant(peer_id, domain)` 决定

### 5.2 Scope-bound auth model

这轮必须补一个新的 runtime 权限对象：

```text
PeerScopeGrant {
  peer_id,
  domain,
  scope_key,
  granted_at,
  granted_by
}
```

含义：

- `peer token` 只证明调用方是谁
- `PeerScopeGrant` 决定它能访问哪个 `domain + scope_key`
- 二者必须同时成立，peer 才能读取该 scope 的同步数据

这解决的是当前 reviewer 指出的硬问题：

- 现有 mesh peer 只有 token / base_url / peer_id
- 没有任何 `scope` 归属
- 如果新 `/mesh/*` 路由只是简单包装现有 `user_id/profile_id` 查询参数，就会破坏“同 scope 同步、不同 scope 隔离”

因此后续要求固定为：

1. 远端 peer-auth data-plane 路由必须先从 token 解析出 `peer_id`
2. 再按 `(peer_id, domain)` 解析唯一有效 `PeerScopeGrant`，并由其导出目标 `scope_key`
3. 未授权 scope 一律 `403`
4. 测试必须包含“peer token 访问错误 scope 失败”的负向用例

第一版还必须补一条唯一性约束：

- **同一 `(peer_id, domain)` 在任一时刻只能存在一个有效 grant**

这样当前 peer-auth route 才能在**不暴露 scope selector**的前提下，仍然无歧义落到唯一 scope。

### 5.3 Request identity 注入机制

`PeerScopeGrant` 只有在 runtime 能拿到“当前请求到底是哪个 peer 调来的”时才可实现。  
因此第一版必须把现有 auth middleware 从“布尔判断 token 是否存在”升级为“解析并注入 request identity”。

最小可实现机制固定为：

1. `MeshState` 新增“按 inbound secret 反查 enabled peer”的查询能力。
   - 当前只有 `has_peer_with_inbound_secret(secret) -> bool`
   - 需要补成可返回 `peer_id` 的 lookup
2. `require_auth` 在 peer token 分支不再只做 `bool` 放行。
   - 它必须解析出对应 `peer_id`
   - 并把 `AuthenticatedPeerIdentity { peer_id }` 写入 `request.extensions`
3. peer-auth data-plane handlers 只能从 request extensions 读取 caller identity。
   - 不信任 query/header/body 里自报的 `peer_id`
   - 更不能继续接受任意 caller 指定的 `user_id/profile_id`
4. `PeerScopeGrant` 的检查发生在“已认证 peer identity”之上。
   - `peer token` 负责认证 caller
   - `PeerScopeGrant` 负责授权 caller 读取哪个 scope/domain

因此 peer-auth data-plane 的真正放行条件应是：

- `AuthenticatedPeerIdentity.peer_id` 已解析成功
- 对应 `PeerScopeGrant(peer_id, domain)` 唯一存在，并能导出 `scope_key`

peer-auth route 的 scope 解析规则也必须固定下来：

1. route 自己先确定当前访问的 domain。
   - 例如 `/mesh/tasks/*` => `tasks`
   - `/mesh/timeblocks/*` => `timeblocks`
2. handler 只用 `AuthenticatedPeerIdentity.peer_id + domain` 去查唯一有效 grant。
3. `scope_key` 只能从 grant 导出，**不能**继续从 query/body/header 读取。
4. 若 grant 缺失或出现多个有效 grant，则 fail closed。
   - 拒绝请求
   - 记录本地 auth 配置错误日志
   - 不做“猜一个 scope”式兜底

### 5.4 `PeerScopeGrant` 持久化与撤销生命周期

`PeerScopeGrant` 是**接收侧 runtime 的本地授权记录**，不是 caller 自带的 credential。  
它必须和 mesh state 一起持久化，否则 runtime 重启后 pairing 仍在、scope 授权却丢失。

第一版持久化模型要求：

1. grant 与 `peers / interests` 一起进入 mesh persisted state。
   - 当前 [mesh/mod.rs](../../crates/exomind-runtime/src/mesh/mod.rs) 只持久化 `peers + interests`
   - 需要新增 `scope_grants`
2. grant 以本机 runtime 为真相源。
   - 每台设备各自保存“允许哪些远端 peer 读取我本机哪个 scope”的 inbound grant
   - 不是把某个全局 grant 复制到双方
3. grant 的持久化主键第一版固定为 `(peer_id, domain)`
   - 值中保存唯一 `scope_key`
   - 第一批 `domain` 先支持 `tasks`
   - 后续再扩到 `eventlog / timeblocks`

第一版生命周期规则固定为：

1. **创建 / 刷新**
   - pairing 成功后，本机 runtime 在已知当前活跃 `scope_key` 的前提下，为对端 `peer_id + domain` upsert 唯一 inbound grant
   - app 登录后或活跃 profile 恢复时，runtime 对已确认 peer 做一次 grant reconcile，补齐缺失或漂移的 grant
2. **撤销**
   - peer 被 disable / delete
   - pairing 关系失效
   - 本机 logout
   - 本机活跃 `scope_key` 切换时，先撤销该 `peer_id + domain` 旧 grant，再写入新 grant
3. **镜像关系**
   - 双向同步意味着双方各自都要保存自己的 inbound grant
   - 但两边 grant 的创建与撤销是独立执行的，不假设“我这边授权”自动等于“对端也授权”

实现口径上，这意味着：

- “peer 仍存在但 grant 已撤销”必须返回 `403`
- “grant 缺失但 peer token 仍有效”不能被误判成未认证；它是“已认证、未授权”
- “同一 `(peer_id, domain)` 同时存在多个有效 grant”属于授权状态损坏，必须 fail closed

### 5.5 关键决策

**UI 不存储 peer secret。**

原因：

- pairing secret 本质上是 mesh-level credential
- 把它写回 host record 或前端状态，会重新制造 secret 生命周期与泄漏面
- runtime 已经天然持有 peer token，最稳妥的方式就是让 runtime 代理

### 5.6 路由白名单必须是精确匹配，不用宽前缀

当前 auth middleware 是前缀匹配思路。  
因此 peer-auth 白名单不能写成：

- `/mesh/tasks/snapshot/`

而应收紧为精确路由，例如：

- `/mesh/tasks/summary`
- `/mesh/tasks/pull`
- `/mesh/tasks/snapshot/sqlite`

否则后续任何挂在该前缀下的新路由都可能自动暴露给 peer token。

---

## 六、统一协调器设计

### 6.1 统一触发点

统一 reconciliation coordinator 应在以下时机触发：

- app 启动后
- pairing 成功后
- `focus`
- `online`
- 固定时间间隔

说明：

- 这与当前 `RtDomainBackfillCoordinator` 的触发点基本一致
- 要改的不是触发点，而是内部策略

### 6.2 统一处理流程

对每个 confirmed peer、每个 enabled domain adapter，执行：

1. 读取本地摘要
2. 通过本地 runtime proxy 读取远端摘要
3. 比较摘要
4. 摘要一致则跳过
5. 摘要不一致则优先尝试增量 pull
6. 增量 apply 后重新比较
7. 仍不一致时走 snapshot fallback
8. fallback 后再次比较
9. 仍不一致则记录 drift failure，等待下轮重试

### 6.3 peer 来源的权威规则

调度层与鉴权层不强行共用一个对象。

建议第一版规则：

- **调度层**：仍以 `RuntimeHostRecord` 里的 `confirmed_peer` 为候选集合
- **鉴权层**：真正发起 proxy 调用前，runtime 必须确认对应 `peer_id` 在本地 `/mesh/peers` 中仍存在且启用

原因：

- `RuntimeHostRecord` 仍是产品表面上的“受信任设备”来源
- mesh state 才是真正持有 peer token 的 auth 真相源

也就是说：

- 没有 confirmed host：不调度
- 没有 active mesh peer：不代理
- 两者都成立：才进入 reconciliation

### 6.4 统一状态与观测

协调器至少要统一记录：

- `peer_id`
- `domain`
- `reason`
- `local_summary`
- `remote_summary`
- `repair_mode`
  - `none`
  - `incremental`
  - `snapshot_fallback`
- `result`
  - `converged`
  - `skipped`
  - `failed`

这样三域的排障口径才会统一。

---

## 七、统一 adapter 契约

建议在 TS 层抽象为：

```ts
interface DomainReconciliationAdapter<TSummary, TPullCursor> {
  domain: 'eventlog' | 'tasks' | 'timeblocks';
  getLocalSummary(): Promise<TSummary>;
  getPeerSummary(peerId: string): Promise<TSummary>;
  summariesEqual(local: TSummary, remote: TSummary): boolean;
  canPullIncremental(local: TSummary, remote: TSummary): boolean;
  pullIncremental(peerId: string, local: TSummary): Promise<{ changed: boolean }>;
  importSnapshot(peerId: string): Promise<{ changed: boolean }>;
}
```

这个接口故意保持薄：

- 不把 domain 内部 cursor 细节硬塞到 shared layer
- shared layer 只关心“能否比较、能否拉增量、何时 fallback”

---

## 八、分域设计

### 8.1 EventLog Adapter

#### 数据特性

- append-only
- 天然适合 cursor pull
- 删除和覆盖非常少

#### 摘要建议

```ts
interface EventLogSummary {
  schemaVersion: 1;
  scopeKey: string;
  eventCount: number;
  currentRevision: number | null;
  latestEventId: string | null;
  maxTimestamp: number;
  revisionHash: string;
}
```

#### 增量 cursor

- `since_id`

#### 补偿策略

- 第一版复用现有 `GET /eventlog?since_id=...` 与 `full_snapshot|incremental_batch` 语义
- `replicationSeq` 继续只作为 live topic payload 元数据，不作为 repair path 的主 pull cursor
- snapshot sqlite 只做兜底

#### 说明

`EventLog` 是最适合最先迁入统一框架的第二个 domain，因为它的增量语义最简单。

### 8.2 Task Adapter

#### 数据特性

- 列表型对象
- 以 `updated_at` 驱动增量
- 当前已有 `/tasks/replication/upsert`

#### 摘要建议

```ts
interface TaskSummary {
  schemaVersion: 1;
  scopeKey: string;
  taskCount: number;
  maxUpdatedAt: number;
  revisionHash: string;
}
```

#### 增量 cursor

- `(updated_at, task_id)`

#### 补偿策略

- 先 `pull`
- 对每个 task 复用现有 `/tasks/replication/upsert`
- 对“在当前 comparator 下可判定为更晚的新增 / 更新型 drift”再走 sqlite snapshot `merge` fallback
- 若 `merge` 后仍 mismatch，则标记为 `inventory_drift`
  - 第一版不宣称自动收敛
  - 需要后续的 `inventory/tombstone` 机制或更强 repair 语义

#### 说明

`Task` 是当前必须最先修掉的 bug 域，因此它应当成为 unified framework 的第一个实现 adapter。

补充边界：

- 当前公开任务生命周期并不提供真正的“硬删除”
- 第一版 task reconciliation 只自动吸收以下几类远端变化：
  - 本地缺失任务
  - `updated_at` 更大的任务更新
  - `updated_at` 相同但 terminal precedence 更强的终态变化
  - `updated_at` 相同且 `completed_at` 更大的终态变化
- `snapshot merge` 路径当前不带 `source_host_id`
- 因此对“`updated_at` 相同、terminal 状态相同、`completed_at` 相同但内容不同”的 equal-watermark 冲突，系统只能检测，不承诺自动修复
- 对未知残差集合差异，系统可以检测，但不应在文档里假称现有 `merge snapshot` 一定修得掉

### 8.3 TimeBlock Adapter

#### 数据特性

`TimeBlock` 不能被当成简单列表，它至少分两部分：

- `active block`
- `completed blocks`

#### 摘要建议

```ts
interface TimeBlockSummary {
  schemaVersion: 1;
  scopeKey: string;
  activeFingerprint: string | null;
  completedCount: number;
  completedMaxEndTime: number;
  completedRevisionHash: string;
}
```

#### 增量 cursor

- completed: `(end_time, start_id)`
- active: 不走列表 pull，而是读当前快照

#### 补偿策略

- 先校验 active fingerprint
- 再校验 completed summary
- completed 增量 pull 只覆盖 append-only completed history
- active 第一版走单对象快照导入，但实际 apply 语义仍是 merge pick-winner，不是 force overwrite
- completed gap block 的后续 `describe` 修改不要求被 completed cursor 捕获
  - 这类 drift 由 summary 发现
  - 第一版依赖整域 snapshot fallback，把同 `block.id` 的 completed block 覆盖回来
- active rename 等不推进 `phase / version / order_time / actor_id` 的修改，summary 可以发现，但 snapshot fallback 后仍可能保持本地版本
- 整体不一致时再走 timeblock snapshot fallback

#### 说明

`TimeBlock` 的 adapter 必须内部拆成 `active + completed` 两条子语义，但对 shared coordinator 仍然暴露为一个 domain。

补充边界：

- completed history 的自动补偿主要覆盖：
  - 缺失 completed block
  - 同 `block.id` 的 snapshot 回填
- active block 的自动补偿只覆盖会推进现有比较键的修改：
  - 更高 `phase`
  - 更大 `version`
  - 更晚 `last_transition_at/updated_at/start_time`
  - 最后才是 `actor_id` tie-break
- 对只改名称等未推进这些排序键的 active drift，第一版只负责检测与记录，不宣称自动收敛

---

## 九、为什么不做“三个域一份完全相同的协议”

因为三域的数据单调性不同：

- `EventLog` 更接近 append-only stream
- `Task` 更接近 mutable object set
- `TimeBlock` 是 `single active object + completed history` 的复合体

统一它们的 **协调框架** 是对的。  
强行统一它们的 **cursor 语义和摘要字段** 是错的。

所以本设计明确区分：

- **统一壳层**
- **分域 adapter**

---

## 十、实现顺序决策

### 10.1 第一阶段：Task 最小垂直切片先落地

第一步不是先抽完整 shared shell，而是先把 Task 跑通到可验证闭环。

先做这些 task 直接需要的最小共享能力：

1. scope-bound auth model
2. task exact-match peer-auth routes
3. task local runtime proxy
4. task summary / pull / fallback

### 10.2 第二阶段：从已工作的 Task 路径中抽 shared layer

原因：

- 真实 bug 已经确认
- 任务域对补偿同步依赖最强
- 现有 `replication/upsert` 可直接复用
- 先把第一个 adapter 跑通，再抽 shared shell，风险更低

抽取对象包括：

1. shared reconciliation coordinator
2. shared proxy client shape
3. shared logging / telemetry shape

### 10.3 第三阶段：EventLog 接入同框架

原因：

- append-only，最容易验证统一壳层是否通用
- 可检验 `summary -> pull -> fallback` 的最简单版本

### 10.4 第四阶段：TimeBlock 接入同框架

原因：

- 语义最复杂
- 更适合作为“shared layer 足够通用”的最终验收

### 10.5 Reminder 后置

`Reminder` 先不作为首批 adapter。  
它需要先补 headless RT apply / export / import 对称性，再挂入同框架。

---

## 十一、验收口径

当以下条件满足时，才算这份设计被真正落实：

1. `EventLog / Task / TimeBlock` 最终都进入同一 reconciliation coordinator。
2. 三域都不再依赖远端 control-plane admin token 才能做 repair。
3. UI 不持有 peer secret。
4. peer token 访问未授权 scope 时会被拒绝。
5. drift 不存在时，三域都不会每轮无条件导入整库 snapshot。
6. drift 存在时，三域都能自动进入补偿路径；超出当前 merge 语义的 mismatch 会被显式记录为未收敛，而不是误报修复成功。
7. `Task`、`EventLog`、`TimeBlock` 的排障日志字段统一，可横向比较。

---

## 十二、一句话结论

> **当前应把跨设备同步收敛为“统一 reconciliation 壳层 + EventLog/Task/TimeBlock 分域 adapter”的架构：live signal 负责快路径，runtime 内部 peer-auth proxy 支撑 repair path，所有 domain 都走 `summary -> compare -> pull -> snapshot fallback`，但各自保留符合本域数据形状的摘要、cursor 和 apply 语义。**
