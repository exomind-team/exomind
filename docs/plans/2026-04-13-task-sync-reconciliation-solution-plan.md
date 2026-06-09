# 任务同步 bug 解决方案草案：持续校验 + 差异回填

> **状态**：草案，待实现
> **日期**：2026-04-13
> **上位设计**：[2026-04-13-multi-domain-reconciliation-design.md](2026-04-13-multi-domain-reconciliation-design.md)
> **历史背景计划（非当前规范）**：[2026-04-01-issue-527-cross-device-sync-plan.md](2026-04-01-issue-527-cross-device-sync-plan.md)

---

## 零、文档优先级

当前 task reconciliation 的规范优先级固定为：

1. [sync.md](../specs/sync.md)
2. [2026-04-13-multi-domain-reconciliation-design.md](2026-04-13-multi-domain-reconciliation-design.md)
3. 本文

[2026-04-01-issue-527-cross-device-sync-plan.md](2026-04-01-issue-527-cross-device-sync-plan.md) 只作为历史迁移背景引用。  
凡是它与本文在以下方面存在冲突时，一律以本文和上位设计为准：

- repair path 的 peer-auth 设计
- `PeerScopeGrant`
- `summary -> compare -> pull -> snapshot fallback`
- task 自动收敛边界

---

## 一、目标

在不推翻现有 `mesh relay + signal SSE + RT SQLite` 主链路的前提下，修复“任务在真实配对后长期不回填”的闭环缺口，并把任务同步从“主要依赖 live signal”升级为“live signal + reconciliation”的常规机制。

本方案最终要解决三件事：

1. 任务域具备轻量漂移检测能力，而不是默认认为 signal 到了就一定正确。
2. 任务补偿同步不再依赖远端 runtime 的 control-plane admin token，而是能建立在 pairing 后已有的 peer auth 上。
3. 检测到 drift 后，系统自动进入补偿判断；当前 comparator 可吸收的场景走增量 / snapshot repair，不可吸收的场景显式记录未收敛。

---

## 二、当前断点

已确认的断点有两类：

### 2.1 鉴权模型断点

- [RtDomainBackfillCoordinator.tsx](../../src/ui/app/components/RtDomainBackfillCoordinator.tsx) 已经会周期触发回填。
- 但 [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts) 只处理 `confirmed_peer + authToken` 的 peer。
- pairing 交换的是 mesh peer token，不会把远端 control-plane Bearer 写进 host record。
- [runtime-host.service.ts](../../src/lib/services/runtime-host.service.ts) 还会清洗来源不明的 token。
- 所以在真实场景里，大量设备会停留在“已配对但不满足回填前提”的状态。

### 2.2 校验模型断点

- 当前任务域只有 live signal + snapshot import。
- snapshot import 不是按 drift 触发，而是满足前提后盲跑。
- 系统没有一个稳定的问题判断：`本地任务状态是否已经和对端收敛`。

因此当前 bug 的本质不是“任务同步功能完全缺失”，而是：

> **任务域缺少一个以漂移检测为入口、以 peer-auth 补偿为闭环的常规 reconciliation 路径。**

---

## 三、方案总览

### 3.1 最终结构

任务同步收敛为两条路径并存：

- `fast path`：现有 `task.replication.upserted` live signal，负责低延迟同步
- `repair path`：新建 `summary -> compare -> pull -> snapshot fallback` reconciliation，负责校验与补偿

二者关系是：

- live signal 成功时，用户几乎实时看到变化
- live signal 漏掉、旁路写入、或某一端一度离线时，reconciliation 负责追平

### 3.2 三阶段实现顺序

按既定决策，实施顺序不打乱：

1. 先补任务域的轻量 `summary / revision` 检测
2. 再把回填从 control-plane auth 改成 pairing peer auth 可用
3. 最后补 `drift -> route 级补偿` 自动闭环

---

## 四、第一阶段：任务域轻量摘要与漂移检测

### 4.1 新增任务摘要契约

新增任务域摘要响应，建议结构：

```ts
interface TaskReplicationSummary {
  schemaVersion: 1;
  scopeKey: string;
  taskCount: number;
  maxUpdatedAt: number;
  revisionHash: string;
  generatedAt: number;
}
```

含义：

- `taskCount`：快速发现明显缺失
- `maxUpdatedAt`：发现是否有更晚变更尚未同步
- `revisionHash`：避免“数量相同但内容不同”的漏检
- `generatedAt`：辅助日志与调试

### 4.2 `revisionHash` 的生成原则

`revisionHash` 不应只哈希 `count` 或 `updated_at`，而应基于稳定的 canonical task projection。

建议纳入哈希的字段：

- `id`
- `updated_at`
- `status`
- `completed_at`
- `title`
- `description`
- `done_condition`
- `priority`
- `tags`
- `source`
- `parent_id`
- `depends_on`
- `due_at`
- `estimated_minutes`
- `time_block_ids`

建议做法：

- 按 `id ASC` 稳定排序
- 以固定字段顺序构造 canonical JSON 或稳定字符串
- 对整组任务做单次 hash

这样可以覆盖：

- 数量相同但任务内容变化
- 一删一增后数量未变
- 相同 `maxUpdatedAt` 下的内容差异

### 4.3 路由与存储层改动

建议新增：

- Rust store 层
  - `TaskStore::replication_summary_scoped(scope_key)`
  - `SqliteTaskStore::replication_summary_scoped(scope_key)`
- RT 路由层
  - `GET /tasks/replication/summary`

其中：

- `taskCount` 可用现有 `len_scoped()` 路径
- `maxUpdatedAt` 与 `revisionHash` 由 store 统一生成
- TS 不自己扫表做 hash，避免 UI 与 RT 出现双重摘要实现

### 4.4 第一阶段验收

完成后应满足：

1. 本地 RT 可返回任务摘要。
2. 同步前后摘要可稳定比较。
3. 即使任务数量相同，只要标题、状态、依赖、时间预估等字段变化，摘要仍会变化。

说明：

- 第一阶段本身还不能完全修复“mesh-only peer 不回填”的 bug。
- 它的作用是先把 drift 判断模型建立起来，为后两阶段提供触发依据。

---

## 五、第二阶段：把补偿同步改为 pairing peer auth 可用

### 5.1 不建议直接把 peer secret 暴露给前端

当前 pairing 后，真正持有 peer outbound token 的是 runtime mesh state，而不是 TS host record。

见：

- [mesh/mod.rs](../../crates/exomind-runtime/src/mesh/mod.rs)
- [auth.rs](../../crates/exomind-runtime/src/auth.rs)

因此本阶段不建议走这种路径：

- UI 从 host record 里拿 peer secret
- UI 直接访问远端 peer data-plane 路由

这会把 mesh secret 泄漏到前端持久层，重新制造一套 token 生命周期问题。

### 5.2 建议方案：本地 runtime 做 peer proxy

建议把 peer-auth 补偿能力拆成两层：

#### 先补一层 `PeerScopeGrant`

在 task 方案里，pairing 本身不再等同于“可读当前 profile 的任务数据”。  
还必须新增一层 runtime 内部授权对象，例如：

```text
PeerScopeGrant {
  peer_id,
  domain: 'tasks',
  scope_key,
  granted_at,
}
```

规则固定为：

- peer token 只证明“是谁”
- `PeerScopeGrant` 决定“它能读哪个 scope”
- 没有 grant，即使已 pairing，也不能读取该 scope 的任务 summary / pull / snapshot

第一版要求进一步收紧到可实现粒度：

1. **request identity 注入**
   - `require_auth` 不能再只判断“某个 enabled peer 的 inbound secret 是否匹配”
   - 它必须反查出真实 `peer_id`
   - 并把 `AuthenticatedPeerIdentity { peer_id }` 注入 request context
2. **route 取 identity 的方式**
   - `/mesh/tasks/*` 只能从 request context 读取 caller peer identity
   - 不信任 caller 自报 `peer_id`
   - 不接受任意 caller 指定的 `user_id/profile_id`
   - handler 只允许通过唯一有效的 `PeerScopeGrant(peer_id, 'tasks')` 反推出目标 `scope_key`
3. **grant 持久化**
   - `PeerScopeGrant` 必须和 mesh state 一起持久化
   - 不能只存在于 pairing 当次的内存状态
   - 第一版主键固定为 `(peer_id, domain)`，值里保存唯一 `scope_key`
4. **grant 生命周期**
   - pairing 成功且本机已知当前活跃 `scope_key` 时，为对端 peer upsert `PeerScopeGrant(peer_id, 'tasks')`
   - app 登录 / profile 恢复时，对现存 confirmed peer 重新 reconcile grant
   - peer disable/delete、pairing 失效、logout 时撤销 grant
   - scope 切换时，先撤销旧 `PeerScopeGrant(peer_id, 'tasks')`，再写入新 grant
5. **授权语义**
   - grant 是接收侧 runtime 的本地授权记录，不是 caller 自带 token 的一部分
   - 因此“peer token 仍有效但 grant 已撤销”必须返回 `403`，而不是继续放行

第一版再补一条实现不变量：

- **同一 `(peer_id, 'tasks')` 在任一时刻只能存在一个有效 grant**

这条不变量是当前 route 设计成立的前提。因为：

- `/mesh/tasks/summary`
- `/mesh/tasks/pull`
- `/mesh/tasks/snapshot/sqlite`

都不再暴露 scope selector；handler 只能依赖 caller identity + domain 唯一定位 scope。  
如果 runtime 发现同一 peer 对 `tasks` 存在多个有效 grant，必须 fail closed，而不是猜测要读哪个 scope。

这一步是必须的，不是可选优化；否则会破坏 [sync.md](../specs/sync.md) 里的 scope 隔离前提。

#### 远端 peer data-plane 只暴露只读任务补偿接口

新增 peer-auth 可访问的只读路由：

- `GET /mesh/tasks/summary`
- `GET /mesh/tasks/pull`
- `GET /mesh/tasks/snapshot/sqlite`

这些路由：

- 只允许 peer token 访问
- 只暴露读能力
- 不暴露 import / overwrite / 管理操作
- 必须先校验并解析唯一有效的 `PeerScopeGrant(peer_id, 'tasks')`，再读对应 scope 数据

#### 本地 runtime 暴露 admin / loopback 可访问的 peer proxy 路由

新增本地 proxy 路由：

- `GET /mesh/peers/:peer_id/tasks/summary`
- `GET /mesh/peers/:peer_id/tasks/pull`
- `GET /mesh/peers/:peer_id/tasks/snapshot/sqlite`

调用链变为：

1. UI 调本地 runtime proxy
2. 本地 runtime 从 mesh state 取该 peer 的 `auth_token`
3. 本地 runtime 带着该 token 去访问远端 `/mesh/tasks/*`
4. 结果返回 UI 或直接供本地导入逻辑使用

这样能保证：

- peer secret 只留在 runtime 内部
- UI 不需要理解 peer token 生命周期
- pairing 建立的 mesh trust 能真正为任务补偿路径服务
- peer-auth route 不再依赖 caller 透传 `user_id/profile_id`

### 5.3 auth 边界调整

[auth.rs](../../crates/exomind-runtime/src/auth.rs) 当前 peer token 白名单只允许：

- `/mesh/events`
- `/mesh/stream`
- `/mesh/interests/*`
- `/mesh/discovered`

本阶段需要把任务补偿路由纳入 peer token 可访问的数据面白名单，例如：

- `/mesh/tasks/summary`
- `/mesh/tasks/pull`
- `/mesh/tasks/snapshot/sqlite`

同时保持以下边界：

- `/tasks/backup/sqlite` 继续是 admin/control-plane 路由
- `/tasks/import/*` 继续只允许本地 admin / loopback
- peer token 不获得写权限

并且：

- 白名单必须用**精确路由**，不能用宽前缀
- 如果 auth middleware 仍是前缀匹配模型，这一层要先收紧实现，再开放 peer snapshot 路由

### 5.4 第二阶段验收

完成后应满足：

1. 两台设备 pairing 成功后，即使没有远端 control-plane token，也能通过本地 runtime proxy 获取对端任务摘要。
2. 两台设备 pairing 成功后，即使没有远端 control-plane token，也能通过本地 runtime proxy 获取对端任务增量或 snapshot。
3. peer token 无法读取未授权 scope 的任务数据。
4. peer token 仍然无法访问 control-plane 管理接口。

---

## 六、第三阶段：检测到 drift 时自动走 route 级补偿

### 6.1 从 `RtDomainBackfillService` 演进为真正的 reconciliation service

当前 [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts) 的模式是：

- 枚举 peer
- 满足前提就盲跑 snapshot export/import

建议演进为：

- 枚举 confirmed peer
- 获取本地任务摘要
- 获取远端任务摘要
- 只有检测到 drift 时才进入补偿逻辑

可以保留现有 coordinator 触发点不变，先只重写内部策略。

peer 来源第一版建议保持双层：

- 调度候选仍来自 `RuntimeHostRecord.confirmed_peer`
- 实际代理调用前，再由 runtime 校验本地 `/mesh/peers` 中存在对应启用 peer

这样既不破坏当前产品表面的设备关系模型，也不会让 UI 直接依赖 mesh state 细节。

### 6.2 增量补偿协议

建议新增：

```ts
interface TaskReplicationPullCursor {
  kind: 'task_watermark';
  updatedAt: number;
  taskId: string;
}
```

以及远端拉取响应：

```ts
interface TaskReplicationPullResponse {
  schemaVersion: 1;
  scopeKey: string;
  items: Task[];
  nextCursor: TaskReplicationPullCursor | null;
  hasMore: boolean;
  summary: TaskReplicationSummary;
}
```

建议 `pull` 语义：

- 按 `(updated_at ASC, id ASC)` 稳定排序
- 查询 `updated_at > after.updatedAt`
- 或 `updated_at = after.updatedAt && id > after.taskId`
- 支持 `limit`

### 6.3 自动补偿算法

建议算法如下：

1. 取本地 `localSummary`
2. 取远端 `peerSummary`
3. 若摘要一致：直接跳过
4. 若 `peerSummary.maxUpdatedAt > localSummary.maxUpdatedAt`
   - 先走 `pull`
   - 对每个 task 复用现有 `/tasks/replication/upsert`
   - 应用后重新计算摘要
5. 若摘要仍不一致，则分流：
   - 若远端变化仍落在现有 merge comparator 可吸收的范围内，走 `snapshot/sqlite`
   - 本地 `importTasksFromSqliteSnapshot(..., 'merge')`
   - 若一开始就判断为 equal-watermark 内容冲突等不可吸收场景，则直接进入未收敛记录
6. 再次比较摘要
7. 若仍不一致，或第 5 步已判定为当前语义不可吸收，则标记为 `inventory_drift`
   - 记录结构化日志与 peer id
   - 不再假称已自动收敛
   - 等待后续 `inventory/tombstone` 级 repair 能力

### 6.4 为什么不是“任何 mismatch 都直接 snapshot”

因为这样会保留当前盲跑 repair 的问题：

- 每轮开销大
- 没有渐进式收敛路径
- 难以判断是否是小漂移还是全量偏差

更稳的做法是：

- 默认增量
- 增量无法证明收敛时再 snapshot fallback

### 6.5 为什么不是“只要 `maxUpdatedAt` 变大就一定足够”

因为仍然存在这些场景：

- 双方最大时间戳相同，但内容不同
- 一边删一边增导致摘要不同
- 历史快照 merge 后出现旧数据残差

所以：

- `maxUpdatedAt` 只决定“是否可先尝试 pull”
- `revisionHash` 才决定“是否真的已经收敛”

### 6.6 Phase 1 的收敛边界

当前 task 公开模型并不提供真实“硬删除”主路径，主要是：

- 创建
- 更新
- 状态迁移
- 取消 / 终态

因此第一版 task reconciliation 的自动收敛范围明确限定为：

- 新增缺失任务
- `updated_at` 更大的任务更新
- `updated_at` 相同但 terminal precedence 更强的终态变化
- `updated_at` 相同且 `completed_at` 更大的终态变化

并且需要明确一个容易误判的边界：

- `snapshot/sqlite` fallback 当前仍复用 `apply_task_import(..., Merge)`
- 该 merge 路径内部调用 `should_accept_replicated_task(current, incoming, None, local_host_id)`
- 也就是说 snapshot import **没有** `source_host_id` 参与 tie-break

因此对于以下场景，第一版只保证“检测到 mismatch”，不保证自动修复：

- `updated_at` 相同
- terminal 状态相同
- `completed_at` 相同
- 但 `title / description / depends_on / estimated_minutes / time_block_ids` 等内容不同

它**不承诺**自动修复所有“集合成员差异”，尤其是不明来源的历史残差。  
对这类情况，第一版只负责：

- 检测出来
- 不再盲目重试宣称收敛
- 为后续更强 repair 提供观测入口

### 6.7 第三阶段验收

完成后应满足：

1. drift 存在时，系统自动进入校验 / 补偿流程，不依赖手动重配对。
2. drift 不存在时，系统不会每轮都无条件导入整库 snapshot。
3. live signal 漏发、旁路写入、或临时离线后，reconciliation 能追平“本地缺失 / 明确较新 / 终态优势”这几类任务漂移。
4. 对 equal-watermark 内容冲突和未知残差集合差异，系统会明确记录，而不是误报已收敛。

---

## 七、推荐文件改动范围

### 7.1 Rust runtime

- [crates/exomind-runtime/src/task/store.rs](../../crates/exomind-runtime/src/task/store.rs)
- [crates/exomind-runtime/src/task/sqlite_store.rs](../../crates/exomind-runtime/src/task/sqlite_store.rs)
- [crates/exomind-runtime/src/routes/tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs)
- [crates/exomind-runtime/src/routes/mesh.rs](../../crates/exomind-runtime/src/routes/mesh.rs)
- [crates/exomind-runtime/src/auth.rs](../../crates/exomind-runtime/src/auth.rs)
- [crates/exomind-runtime/src/mesh/mod.rs](../../crates/exomind-runtime/src/mesh/mod.rs)

### 7.2 TypeScript / UI

- [src/lib/services/rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)
- [src/ui/app/components/RtDomainBackfillCoordinator.tsx](../../src/ui/app/components/RtDomainBackfillCoordinator.tsx)
- [src/lib/services/task-backup.service.ts](../../src/lib/services/task-backup.service.ts)
- [src/lib/adapters/task-rt-adapter.ts](../../src/lib/adapters/task-rt-adapter.ts)
- 新增 `src/lib/services/task-reconciliation.service.ts` 或将相关逻辑并入现有 backfill service

---

## 八、测试与验证

### 8.1 Rust 单测

新增或扩展：

- 任务摘要生成测试
- `pull` cursor 排序与分页测试
- peer token 访问 `/mesh/tasks/*` 成功、访问 control-plane 失败测试
- local proxy 路由正确使用 peer outbound token 的测试

### 8.2 TS / Vitest

新增或扩展：

- drift 为空时不触发补偿
- drift 存在且 `peer.maxUpdatedAt > local.maxUpdatedAt` 时先走 pull
- pull 后仍 mismatch 时自动 fallback 到 snapshot
- mesh-only confirmed peer 可进入任务 reconciliation

### 8.3 端到端验证

至少覆盖：

1. A 端创建任务，B 端断网后重连，等待 reconciliation 后出现任务
2. A 端改标题 / 依赖 / 时间预估，B 端即使漏掉 live signal，也能被 reconciliation 追平
3. A 端与 B 端数量相同但内容不同，仍能检测 drift
4. pairing 后没有远端 control-plane token，任务域仍能补偿同步

---

## 九、风险与后续硬化

### 9.1 `useSignalStream` 的 same-origin early return

[useSignalStream.ts](../../src/ui/hooks/useSignalStream.ts) 当前对 `originHostId === currentRuntimeHostId` 有早退逻辑。  
它未必是当前主因，但在 reconciliation 落地后仍应复核，避免 UI 刷新层误判。

### 9.2 runtime 内部旁路写入不发 replication

如果 runtime 内部某些 task 写入旁路未发布 `task.replication.upserted`，live signal 仍会漏。  
不过 reconciliation 落地后，这类问题会从“永久不同步”降级为“延迟收敛”，风险可控。

### 9.3 摘要 hash 的性能

第一版允许直接扫描 scoped task 列表计算 digest。  
如果后续任务量明显增大，再考虑：

- 持久化 revision counter
- 物化摘要表
- journal 化 change cursor

这些都不是本次 bug 修复的前置条件。

---

## 十、建议的最小交付切片

如果要按最小风险推进，建议按以下切片提交：

### 切片 A：摘要契约

- 加 `TaskReplicationSummary`
- 加 `/tasks/replication/summary`
- 补单测

### 切片 B：peer-auth 读通路

- 加 `/mesh/tasks/*`
- 加 `/mesh/peers/:peer_id/tasks/*` proxy
- 加 `AuthenticatedPeerIdentity` request context 注入
- 加 `PeerScopeGrant(peer_id, 'tasks')` 唯一性与持久化
- 扩 auth 白名单
- 补 auth / proxy 测试

### 切片 C：自动补偿闭环

- 重写 `RtDomainBackfillService`
- 先比摘要，再 pull，再 snapshot fallback
- 补 TS 测试与端到端验证

---

## 十一、一句话方案

> **保留现有任务 live replication 作为快路径，但新增“任务摘要比较 -> peer-auth 拉增量 -> snapshot fallback”的 reconciliation 闭环，并把 peer secret 留在 runtime 内部，通过本地 runtime proxy 访问远端 peer data-plane，从而在不依赖 control-plane admin token 的前提下修复真实配对场景里的任务同步缺口。**
