# 已确认决策：任务同步改为持续校验 + 差异回填

> **状态**：已确认，待实现
> **日期**：2026-04-13
> **关联计划**：[2026-04-01-issue-527-cross-device-sync-plan.md](2026-04-01-issue-527-cross-device-sync-plan.md)
> **相关代码**：
> [RtDomainBackfillCoordinator.tsx](../../src/ui/app/components/RtDomainBackfillCoordinator.tsx)、
> [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)、
> [runtime-host.service.ts](../../src/lib/services/runtime-host.service.ts)、
> [runtime-mesh-host-sync.service.ts](../../src/lib/services/runtime-mesh-host-sync.service.ts)、
> [PeerPairingDialog.tsx](../../src/ui/app/components/PeerPairingDialog.tsx)

---

## 一、这次先确认什么，不再混淆什么

本次已经确认的不是“任务域完全没有同步实现”，也不是“回填只会在配对成功后跑一次”。

当前真实现状是：

- 任务域已经有 live signal / replication topic 路径
- 回填协调器也已经会在登录后立即跑一次，并在固定间隔、`focus`、`online` 时继续跑
- 但任务域的回填前提被绑在 `confirmed_peer + control-plane authToken` 上
- 而真实设备配对后，通常只形成 `mesh-only confirmed peer`，拿不到远端 runtime 的 control-plane admin token
- 同时，当前回填也没有漂移检测，只是在满足前提时盲跑 snapshot import

所以这次要收敛的结论是：

> **任务同步不能只靠 live signal，也不能把回填理解成“一次性的 pairing 后补偿”；它必须变成持续运行的 reconciliation 机制。**

---

## 二、已确认的现状与 bug 链路

### 2.1 回填触发其实已经是周期性的

[RtDomainBackfillCoordinator.tsx](../../src/ui/app/components/RtDomainBackfillCoordinator.tsx) 当前会：

- 登录后立刻执行一次 `backfillConfirmedPeers()`
- 每 15 秒再次执行
- 在窗口 `focus` 时执行
- 在浏览器 `online` 时执行

因此，问题不在“有没有周期触发”，而在“触发后是否真的能覆盖任务域”。

### 2.2 当前任务回填只对 `confirmed_peer + authToken` 生效

[rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts) 当前会先筛选：

- `trustState === 'confirmed_peer'`
- `hostId` 存在
- `hasRuntimeControlAuth(host)` 为真

只有满足这三个条件的 peer，才会进入：

- `exportTasksAsSqliteSnapshot()`
- `importTasksFromSqliteSnapshot(..., 'merge')`

这意味着：**没有 control-plane Bearer 的 peer，即使已经完成 pairing，也不会进入任务回填。**

### 2.3 pairing 建立的是 mesh peer auth，不是 runtime control auth

[PeerPairingDialog.tsx](../../src/ui/app/components/PeerPairingDialog.tsx) 的配对路径当前交换的是：

- `initiator_inbound_token`
- `responderInboundToken`
- `peer_token`

其中本地注册 peer 用的是 mesh peer token 组合；`setPeerToken(result.peer_token)` 也只是把 token 暴露给 UI 状态。  
[agent-hub-runtime.ts](../../src/lib/types/agent-hub-runtime.ts) 也已经明确写明：

- `authToken` 表示远端 control-plane Bearer
- `mesh pairing secret` 不写入这里

所以 pairing 成功，并不等于 host record 拥有可用于 backfill 的 `authToken`。

### 2.4 host record 还会清洗来源不明的 token

[runtime-host.service.ts](../../src/lib/services/runtime-host.service.ts) 当前 `normalizeRuntimeHostAuth()` 只保留两类来源：

- `manual_seed`
- `external_target`

其他来源的 token 会被清洗掉。  
这进一步放大了当前问题：**就算历史上曾写入过某类未知 peer token，也不一定会继续留在 `RuntimeHostRecord` 里。**

### 2.5 mesh host sync 也不会补齐 control-plane token

[runtime-mesh-host-sync.service.ts](../../src/lib/services/runtime-mesh-host-sync.service.ts) 当前把 mesh peer 同步进 host record 时，主要更新的是：

- `host`
- `port`
- `hostId`
- `trustState`
- 地址相关元数据

它不会为 confirmed peer 自动补写远端 runtime 的 control-plane `authToken`。

### 2.6 因此当前 bug 是真实存在的

综合以上链路，现状可归纳为：

1. pairing 后通常形成的是 `mesh-only confirmed peer`
2. task backfill 需要 `confirmed_peer + authToken`
3. mesh sync 不会提供这个 `authToken`
4. host record 还会清洗来源不明的 token
5. 结果就是 task backfill 长期不触发

所以“事件日志、时间块能同步，但任务在两台设备之间长时间不出现”并不是体感问题，而是**现有实现存在明确闭环缺口**。

---

## 三、已确认决策

### 3.1 任务同步改为持续 reconciliation，不再只依赖 live signal

任务域后续的主语义应当是：

- live signal 负责低延迟传播
- reconciliation 负责持续校验和补偿
- 二者共同构成完整同步闭环

也就是说，live signal 只能算“快路径”，不能再承担“唯一正确路径”。

### 3.2 不再把回填理解成 pairing 后一次性补偿

回填从现在开始应被定义为常规同步机制的一部分，而不是配对成功后的特殊补丁动作。

它至少要在以下时机稳定生效：

- app 启动
- pairing 成功后
- `focus`
- `online`
- 固定时间间隔

其中“周期运行”本身当前已经存在，后续应补的是“持续校验 + 条件触发补偿”，而不是再额外堆一个 pairing 特判。

### 3.3 漂移检测不能只看任务数量

只比较 `count` 会漏掉以下情况：

- 数量相同，但任务状态变了
- 数量相同，但标题、依赖、预估时间等字段变了
- 一边删了一个，另一边新增了一个，但总数相同

因此后续任务域的轻量检测至少应比较：

- `count`
- `max_updated_at`
- `revision` 或 `summary hash`

如果未来能稳定提供更细粒度游标，则可继续扩展为增量级摘要比较；但当前至少不能退化成“只看 count”。

### 3.4 一旦发现 drift，就自动走补偿同步

检测到摘要不一致后，任务域应自动进入补偿路径：

- 优先尝试增量补偿
- 只有在拿不到增量，或者增量能力尚未具备时，才回退到整库 snapshot import

这里的关键不是“永远不用 snapshot”，而是把 snapshot 从常态盲跑，降级为 fallback repair。

### 3.5 任务 backfill 不应依赖 control-plane admin token

这是本次最核心的架构收敛点之一。

既然设备 pairing 已经交换了 peer 级 mesh secret，那么任务回填接口就不应再要求对方 runtime 的 control-plane admin token 才能工作。  
否则设计上天然出现闭环断点：

- pairing 建立了设备互信
- 但回填却还要求另一套更高权限的控制面鉴权
- 结果就是“已配对”不等于“可补偿同步”

因此后续应收敛为：

- **task backfill / reconciliation 路径必须可用 pairing peer auth**
- control-plane auth 只保留给管理面或调试面能力，不再作为任务补偿同步的必要前提

---

## 四、实现顺序决策

后续实现按以下顺序推进，不建议打乱：

### 4.1 第一步：先给任务域补轻量 summary / revision 检测

目标：

- 不再只靠 live signal 猜测同步成功
- 让系统能稳定判断“当前是否存在 drift”

这一层先做轻量摘要，不要求一步到位做复杂 CRDT。

### 4.2 第二步：把 backfill 鉴权从 control-plane auth 改成 pairing peer auth 可用

目标：

- 让真实配对后的 confirmed peer 真正具备任务补偿同步能力
- 彻底去掉“配对成功但 backfill 前提不成立”的结构性断点

这是修闭环，不是附加优化。

### 4.3 第三步：在检测到 drift 时自动走 route 级补偿

目标：

- 让 reconciliation 成为常规同步机制
- 在 drift 发生时自动触发增量补偿或 snapshot fallback

这一层完成后，任务同步才算从“尽量同步”升级到“能持续自我修复”。

---

## 五、明确不建议的做法

以下方向不作为本次主修法：

- 只补一个 pairing 成功后的特判回填
- 继续让任务域只依赖 live signal
- 只比较任务数量是否一致
- 继续把 task backfill 卡在 control-plane admin token 上
- 在没有 drift 检测的前提下长期盲跑整库 snapshot import

这些做法即使能短期缓解个别场景，也不能形成稳定闭环。

---

## 六、后续验收口径

当以下条件满足时，才说明这次决策被正确落实：

1. 两台设备完成 pairing 后，即使没有远端 control-plane admin token，任务域仍可进入 reconciliation。
2. 任务数量相同但内容发生变化时，系统仍能检测出 drift。
3. 一边删除、另一边新增导致“数量未变”时，系统仍能检测出 drift。
4. drift 被检测到后，会自动进入补偿路径，而不是依赖人工重配对或手动导入。
5. 在没有 drift 时，系统不会每轮都无条件做整库 snapshot import。

---

## 七、一句话结论

这次不再把“任务不同步”理解成单点 bug，而是把它明确收敛为一个架构修正：

> **任务同步从“live signal + 偶发 snapshot 回填”升级为“持续校验 + 差异回填”的常规 reconciliation 机制，并且其补偿路径必须建立在 pairing peer auth 上，而不是 control-plane admin token 上。**
