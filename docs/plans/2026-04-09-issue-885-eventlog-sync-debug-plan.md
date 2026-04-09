# Issue #885 前提下的 EventLog 同步 Debug Plan

**状态**: Draft  
**基线**: `dev@24122938`  
**前提 Issue**: `#885 bug(sync/pairing): RT id 未做设备级持久化，RT 重启后 host_id 漂移导致配对关系不稳定`  
**相关 Issues**: `#868`, `#527`

---

## 背景

2026-04-08 的双端实机记录表明，EventLog 同步当前至少同时存在两类问题：

1. **漏同步**
   - 手机端存在 `23:11 手机新登录`、`23:11 新登录状态下没有同步`
   - 电脑端对应快照里没有这两条
2. **重复同步**
   - 两端都出现了重复消息，至少包括 `电脑在手机下线后的消息`

对应实验材料：
- `temp/2026-04-08 电脑手机增量同步与恢复性同步@事件日志/手机端.md`
- `temp/2026-04-08 电脑手机增量同步与恢复性同步@事件日志/电脑端.md`

当前代码排查表明：
- `rt-sqlite` 默认链路下，`eventlog.replication.appended` 的前端投影与 RT 内部 `replication_actor` 可能同时落同一条远端事件，形成重复
- live sync 只依赖内存 signal window，recovery/backfill 又依赖 `confirmed_peer + control auth` 且只在挂载 / 15s / focus / online 触发，形成漏窗

---

## 为什么必须先做 #885

`#885` 必须先落地，因为它直接决定这次 EventLog debug 是否有稳定前提：

1. `host_id` 漂移会破坏配对关系连续性
   - RT 重启后若 `host_id` 变化，旧 peer 关系和 mesh 身份会断裂
2. recovery/backfill 只认当前有效 peer
   - 若 peer 身份漂移，EventLog 缺失到底是“同步没补上”还是“节点已经不是同一个 RT”，无法分辨
3. 只有固定设备级 `RT id / host_id`，才能把问题真正收敛到 EventLog 域
   - 否则每次重启、重新登录、重新配对都会把身份问题混入数据同步问题

一句话：**先固定节点身份，再调 EventLog；否则观察结果不干净。**

---

## 目标

在 `#885` 解决后，针对 EventLog 建立一条可复现、可观测、可修复的 debug 主线，回答三件事：

1. 在稳定 `host_id` 前提下，EventLog 重复是否仍会发生
2. 在稳定 `host_id` 前提下，EventLog 缺失是否仍会发生
3. 若仍发生，分别由哪条实现链路负责，修复后如何验证彻底收口

---

## 不在本计划内

- 不在本计划内处理 Task / TimeBlock / Proposal 的冲突契约
- 不在本计划内完成全域机会同步 contract 收口
- 不在本计划内处理账号级 identity 合并
- 不在本计划内扩展 control-plane token 治理

---

## 当前假设

### 假设 A：重复来自“双重投影”

当前默认 `rt-sqlite` 链路下：
- 前端收到 `eventlog.replication.appended` 后会调用 `projectEventLogReplicationAppend()`
- 如果本地尚未见到该 `event.id`，会再次走 `appendEventData()`
- 但 `EventLogRtAdapter` 写 `/eventlog` 时不带 `id`
- Rust `/eventlog` 路由会生成新的 UUID
- 与此同时，RT 内部 `replication_actor` 还会按原始 `event.id` 再落一次

结果：**同一逻辑事件可能被写成两条不同 `id` 的事件记录。**

### 假设 B：缺失来自“live/recovery 漏窗”

- live sync 只靠 mesh stream + in-memory signal window
- RT 重启、重新登录、验证失败、短暂离线都会中断这个窗口
- recovery/backfill 不是立刻触发，也不是 durable queue，而是“条件满足后再按时机 merge 拉快照”

结果：**事件不会永久丢，但会在某些时段表现为已配对设备不完全一致。**

### 假设 C：4 月 8 日的问题里，#885 与 EventLog 域问题是叠加而不是二选一

- `host_id` 漂移 / 重启换 RT ID 解释了为什么那次观察中 live sync 链路极不稳定
- 但即便 #885 修完，EventLog 仍有独立的重复写入漏洞，不能把所有问题都归到身份漂移

---

## Debug 路线

### Phase 0：先关闭 #885 前提

**目标**：确保同一设备 RT 重启前后 `host_id` 稳定，旧配对关系可延续。

**聚焦文件**
- `crates/exomind-runtime/src/lib.rs`
- `crates/exomind-runtime/src/mesh/mod.rs`
- `src-tauri/src/lib.rs`
- 以及 `#885` 相关持久化接线文件

**验收**
- 同设备重启前后 `/topology.host_id` 不变
- 重启后 `/mesh/peers` 中原已确认 peer 仍有效
- 不需要重新配对即可恢复互通

**完成条件**
- 未完成 `#885` 前，不进入 EventLog 结论性 debug

### Phase 1：重建 EventLog 复现场景与观测面

**目标**：在稳定 `host_id` 基础上，重新验证“重复”和“缺失”是否仍存在。

**观测端点**
- `/topology`
- `/mesh/peers`
- `/signals/history`
- `/eventlog`
- 必要时 `/eventlog/backup/sqlite`

**最小复现场景**
1. `在线直连场景`
   - A 写事件，B 应尽快看到
   - B 写事件，A 应尽快看到
2. `断链恢复场景`
   - B 暂时离线
   - A 在离线窗口继续写事件
   - B 恢复在线后，应 eventually 补齐
3. `RT 重启场景`
   - A/B 先配对
   - 重启 A 的 RT
   - 不重新配对，继续互写事件，验证是否仍有缺失或重复

**必须记录的证据**
- 每次写入前后两端 `/eventlog` 快照
- 对应 `/signals/history` 里的复制 topic
- 对应 `/mesh/peers` 状态
- 写入事件的原始 `id`、`timestamp`、`source.deviceName`

### Phase 2：先收掉“重复”链路

**目标**：让一条远端事件在本地只落一次。

**聚焦文件**
- `src/lib/services/ecs-eventlog-replication.service.ts`
- `src/lib/adapters/eventlog-rt-adapter.ts`
- `crates/exomind-runtime/src/routes/eventlog.rs`
- `crates/exomind-runtime/src/signal/actors/replication_actor.rs`

**调试原则**
- 必须明确 EventLog replicated append 的唯一落库入口
- `same event.id` 只能对应一条逻辑事件
- 不允许“前端投影一条 + RT actor 再投一条”

**决策目标**
二选一必须收敛为一种：
1. `rt-sqlite` 下关闭前端 EventLog replication projector，只保留 RT 内部 actor 落库
2. 保留前端 projector，但 RT append 路由必须支持保留远端 `event.id`，并保证幂等

**验收**
- 同一条远端事件跨设备最终只有一条
- recovery import 后也不会把重复永久保留下来

### Phase 3：再收掉“漏窗”链路

**目标**：让“已配对设备暂时断链后恢复”能够及时补齐 EventLog。

**聚焦文件**
- `crates/exomind-runtime/src/routes/mesh.rs`
- `crates/exomind-runtime/src/mesh/mod.rs`
- `crates/exomind-runtime/src/signal/window.rs`
- `src/lib/services/rt-domain-backfill.service.ts`
- `src/ui/app/components/RtDomainBackfillCoordinator.tsx`
- `src/lib/services/runtime-mesh-host-sync.service.ts`

**调试原则**
- live sync 错过不应等于数据长期缺失
- recovery sync 不能只靠“用户碰巧 focus 或等下一次轮询”
- pairing / reconnect / auth ready 之后，应有更明确的 EventLog backfill 触发点

**决策目标**
至少收敛一条：
1. `confirmed_peer + auth ready` 后立即触发一次 EventLog backfill
2. mesh reconnect 成功后立即触发一次 EventLog backfill
3. 明确 durable replay 边界，超出 replay window 必须立刻走 snapshot merge

**验收**
- 离线窗口内产生的事件，在重连后无需手动刷新和二次配对即可补齐
- “已配对但暂时不一致”的窗口明显缩短，并且有可解释的上界

### Phase 4：补自动化与回归证据

**目标**：让这次 debug 不停留在人工观察。

**建议测试层级**
- 单元测试
  - replicated append 幂等
  - preserve remote event id / duplicate reject
- 集成测试
  - RT actor 与前端 projector 不会双写
  - backfill merge 不引入重复
- 双实例 / 真机验证
  - 两实例互写无重复
  - 断线恢复补齐
  - RT 重启后不重配即可继续补齐

---

## 依赖关系

```text
#885 稳定 RT host_id
  -> EventLog debug 可得出干净结论
    -> 先修重复链路
      -> 再修漏窗 / recovery 触发
        -> 为 #868 提供可靠事件日志基线
```

---

## 验收矩阵

| 场景 | 操作 | 预期 |
| --- | --- | --- |
| 在线互写 | A/B 双端分别写事件 | 对端能看到，且无重复 |
| 短暂离线 | B 离线时 A 连续写 3 条 | B 恢复后全部补齐 |
| RT 重启 | 重启 A 的 RT 后继续互写 | 不需重配，仍可互通 |
| recovery import | 触发一次 EventLog backfill | 只补缺，不制造重复 |
| 重放边界 | 超出 live replay window 的事件 | 仍能通过 recovery 收敛 |

---

## 计划产物

本计划完成后，应至少产出：

1. `#885` 的稳定身份实现与验证证据
2. EventLog 重复链路的根因修复
3. EventLog recovery 触发时机的明确合同
4. 一组可重复执行的双实例 / 双端验收步骤

---

## 当前建议执行顺序

1. 先完成 `#885`
2. 在稳定 `host_id` 条件下重跑 2026-04-08 类似场景
3. 若仍重复，先修“重复”
4. 若仍漏窗，再修“恢复性同步触发”
5. 最后补自动化和 issue 证据回填
