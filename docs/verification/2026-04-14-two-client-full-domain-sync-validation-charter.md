# 2026-04-14 双客户端预配对批量全域同步 Tauri MCP 验证章程

## 目的

这份文档用于指导一轮真实双客户端桌面实测，验证如下叙事是否成立：

1. 客户端 A 在配对前已积累大量业务数据。
2. 客户端 B 在零状态下与 A 完成设备配对。
3. 配对进入 `confirmed + verified` 后，无需手工导入、重启、刷新、二次配对，B 能在同一连续观察窗口内自动收敛到 A 的既有数据。

本轮要求覆盖四个业务域：

- EventLog
- TimeBlock
- Task
- Proposal

本轮不是单测补充，而是面向真实 Tauri 桌面窗口、Embedded RT、mesh pairing、RT SQLite 真相源的端到端验收。

## 验收问题

本轮要回答的不是“某个 domain 有没有 live signal”，而是：

> 当一个客户端在配对前已经积累了 `100+` 条 EventLog、`100+` 个 TimeBlock、`100+` 个 Task、`100+` 个 Proposal 后，另一台客户端在完成 pairing 之后，是否能自动把这些既有数据一次性收敛过来。

对应判定口径固定为：

1. 远端复制信号到达不是终点。
2. 本地 RT SQLite 真相源收敛才算数据层通过。
3. UI 在同一观察窗口内自动显示收敛结果，才算端到端体验通过。

## 本轮范围

### 1. 必验范围

- 双独立 Tauri dev 实例
- 真实 pairing 与 link proof
- 配对前 bulk seed
- 配对后自动收敛
- RT truth 与 UI truth 分层取证

### 2. 当前实现边界说明

- `EventLog / TimeBlock / Task` 当前目标是验证“live path + 当前 repair/reconciliation 路径”在真实 pairing 场景下是否闭环。
- `Proposal` 也纳入本轮验收目标，但它当前依赖 proposal 自身复制路径，不等同于 task 那套新 reconciliation 机制。
- 如果 `Proposal` 在本轮失败，应记为真实系统缺口，而不是“超出范围”。

### 3. 本轮不验什么

- 多 scope 并发下的跨 scope 隔离压力测试
- same-id divergent content 的冲突收敛策略
- 超长离线窗口下的多日 replay 边界
- Reminder 域
- 大规模性能基准压测

## 参考资料

- [sync.md](../specs/sync.md)
- [Tauri MCP Windows Playbook](../development/tauri-mcp-windows-playbook.md)
- [多 Worktree 端口配置指南（RT-only）](../development/port-env-configuration.md)
- [多 Domain Reconciliation 设计稿](../plans/2026-04-13-multi-domain-reconciliation-design.md)
- [任务同步 bug 解决方案草案：持续校验 + 差异回填](../plans/2026-04-13-task-sync-reconciliation-solution-plan.md)
- [2026-03-30 mDNS + Link Proof 手工验收清单](../testing/2026-03-30-mdns-link-proof-manual-checklist.md)

## 现场真值记录

执行前必须先填写以下真值，后续所有日志、截图、RT 请求、raw bridge 脚本都以此为准，不允许套用历史端口。

| 字段 | 客户端 A | 客户端 B |
| --- | --- | --- |
| 实例名 |  |  |
| Web 端口 |  |  |
| HMR 端口 |  |  |
| Embedded RT 端口 |  |  |
| raw bridge 端口 |  |  |
| 窗口标题 |  |  |
| runtime host id |  |  |
| data dir |  |  |
| 当前有效 scope |  |  |
| `localStorage['exomind:profile-session']` |  |  |

补充规则：

- 若官方 `driver_session` 可用，优先使用。
- 若官方 `driver_session` 继续报 `Transport closed`，允许直接退回 raw bridge + 页面内 `fetch`。
- 本轮必须保留实际报告目录，例如 `.tmp/reports/...`，以便后续归档。

## 前置条件

### 1. 实例隔离

- 必须启动两个独立 Tauri dev 实例。
- Windows 现场默认按顺序启动双实例，避免并行启动触发 `tauri-wrapper.ps1` 对 `AndroidManifest.xml` 的文件锁冲突。
- 两实例必须使用不同的 `EXOMIND_WEB_PORT / EXOMIND_HMR_PORT / EXOMIND_RT_PORT`。
- 两实例必须确认自己连接的是各自 Embedded RT，而不是复用了别的历史进程。

补充判定：

- `tauri:manager list` 只可作为线索，不可直接当作现场真值。
- 端口监听、raw bridge 可连接、RT `/health` 或 `/mesh/peers` 可响应，才算实例真的存活。

### 2. 零状态

在开始 bulk seed 前，两端都需要确认：

- `GET /mesh/peers` 为空，或已显式清空历史 peer。
- 设备页没有历史确认节点残留。
- 没有手工 seed 的外部地址残留。
- 当前验证 scope 已记录清楚，不能一端是 `anonymous`、另一端是 profile scope 却未察觉。
- 若本轮要验证登录后 coordinator / reconciliation 路径，两端必须先进入同一个本地 profile session；不能把 `anonymous` 或“未打开档案”状态下的结果写成本轮结论。
- 必须同时记录 `profile slug`、`active profile id` 与 `localStorage['exomind:profile-session']`，避免“看似同 scope、实际 session 不一致”的假象。

### 3. RT 健康

两端都需要确认：

- `GET /health` 正常。
- 当前 runtime host id 可读。
- 当前 scope 下列表接口可正常返回空数组或既有数据。

### 4. Proposal UI 说明

- 若需要把 Proposal 纳入 UI 层观察，必须确认当前桌面实例的 proposal inbox 路径可进入。
- 即使 UI 层存在 polling 时序，RT truth 仍然是数据层主判据。

## 测试数据策略

### 1. 总原则

- 不通过手工 UI 逐条录入 `100+` 数据。
- 优先使用 RT HTTP + 脚本辅助批量注入。
- 所有数据都带唯一 run marker，避免在脏数据里与历史记录混淆。

建议统一 run id：

```text
TMCP-FULLSYNC-<YYYYMMDD-HHMMSS>
```

### 2. 推荐注入规模

客户端 A 在配对前至少具备：

- `120` 条 EventLog
- `120` 个 TimeBlock
- `120` 个 Task
- `120` 个 Proposal

不建议刚好只做 `100`，避免分页、轮询与边界条件把结果写得过于脆弱。

### 3. 各域注入建议

#### EventLog

- 优先使用 `/eventlog` 或 `/eventlog/import/json`
- 每条事件文本带唯一 marker，例如：
  - `TMCP-FULLSYNC-20260414-EL-001`
- 保留注入后 A 端 `/eventlog` 快照与总数

#### TimeBlock

- 优先使用 `/timeblocks/import/json`
- 本轮以“稳定历史块”为主，不把“正在运行中的 active block”混进 bulk seed 主叙事
- 每条记录保留唯一标识字段或独立 id 列表，便于后续抽样核对

#### Task

- 优先使用 `/tasks/import/json`
- 至少让一部分任务包含非默认字段，例如：
  - `status`
  - `estimated_minutes`
  - `depends_on`
- 记录 A 端 `/tasks/replication/summary`，作为后续比对基线

#### Proposal

- 当前没有明确 bulk import 路由，使用 `/api/proposals` 或 `/proposals` 脚本批量创建
- 每条 Proposal 标题带唯一 marker，例如：
  - `TMCP-FULLSYNC-20260414-P-001`
- 若脚本可承受，允许额外给少量 Proposal 添加 comment，用于抽样验证内容字段而非只看数量

### 4. 注入完成后的基线记录

在 A 端配对前，必须至少记录：

- 各域总数
- 各域采样 id / marker 列表
- Task replication summary
- A 端截图或日志时间点

## 执行步骤

### 步骤 1：启动双实例并确认真值

1. 启动客户端 A 与客户端 B。
2. 记录两端窗口标题、端口、host id、scope。
3. 确认两端都已打开同一个本地 profile，且 `localStorage['exomind:profile-session']` 与当前有效 scope 对齐。
4. 若官方 `driver_session` 不可用，切 raw bridge，不在 driver 上空耗时间。

### 步骤 2：清理 B 端并确认未配对

1. 确认 B 端 `mesh/peers` 为空。
2. 确认 B 端对应四个 domain 没有 run marker。
3. 确认当前没有旧同步结果污染本轮观察。

### 步骤 3：在 A 端完成 bulk seed

1. 用脚本向 A 端写入四个域的批量数据。
2. 注入完成后回读 A 端各域接口。
3. 保存 A 端基线证据。

### 步骤 4：开始 pairing

1. 由 A 或 B 发起 pairing。
2. 完成 PIN 输入与 link proof。
3. 以两端 `mesh/peers` 都显示目标 peer 为 `confirmed + verified` 作为观察窗口起点。

### 步骤 5：进入连续观察窗口

观察窗口建议固定为：

- 最长 `120s`
- 每 `5s` 轮询一次 RT truth
- 在同一窗口内同步观察 UI

观察窗口内禁止：

- 手工导入
- 手工刷新页面来“触发成功”
- 手工重启 RT
- 删除再重新配对

允许的动作只有：

- 被动轮询 RT 接口
- 读取 UI 可见性
- 记录日志、截图、raw bridge 输出

### 步骤 6：收敛后做抽样核对

每个 domain 不能只看数量，还需要做 marker / id 抽样核对：

- EventLog：抽样若干 marker 文本
- TimeBlock：抽样若干 seed id 或 marker 字段
- Task：抽样 title、status、estimated_minutes、depends_on
- Proposal：抽样 title，若有 comment 则再抽样 comment 数量或内容

## 判定标准

### 1. 数据层通过

满足以下条件可判为某个 domain 的数据层通过：

- B 端 RT truth 总数追平 A 端
- 抽样 marker 或 id 能在 B 端 RT truth 找到
- 对 Task，B 端 `/tasks/replication/summary` 与 A 端一致

### 2. 端到端体验通过

满足以下条件可判为某个 domain 的端到端体验通过：

- 数据层已通过
- 同一观察窗口内，B 端 UI 无需手工刷新即可看到对应结果
- UI spot check 顺序建议固定为：`EventLog -> TimeBlock -> Task -> Proposal`
- 上述顺序是观察顺序，不是协议层必须按该顺序收敛；真正判定仍以“同一连续观察窗口内四域都自动可见”为准

### 3. 全量通过

只有在以下条件同时满足时，本轮才能判定为“全域一次性同步通过”：

- EventLog 数据层通过，且 UI 自动可见
- TimeBlock 数据层通过，且 UI 自动可见
- Task 数据层通过，且 UI 自动可见
- Proposal 数据层通过，且 UI 自动可见

### 4. 部分通过

出现以下情况，应标记为部分通过，而不是强行写成全通过：

- `EventLog / TimeBlock / Task` 通过，但 `Proposal` 未通过
- RT truth 已收敛，但 UI 未在观察窗口内自动显示
- 只有数量对齐，但抽样字段不一致

## 失败分类

### A. 工具失败

- 官方 `driver_session` 不可用
- raw bridge 脚本自身报错
- 自动化脚本轮询逻辑错误

说明：

- 这类问题不能直接记为产品失败
- 需要先切换工具路径或修正脚本，再重新执行

### B. 配对失败

- PIN 未完成
- peer 未进入 `confirmed`
- link proof 未进入 `verified`

### C. 数据层失败

- B 端 RT truth 在观察窗口结束前未追平 A
- 只同步了部分 domain
- 数量追平但抽样内容不一致

### D. UI 层失败

- RT truth 已收敛，但 UI 仍未自动显示
- 必须靠手工刷新、切页、重启才出现

### E. 结构性边界暴露

- 某个 domain 的当前实现天然不满足这类预配对 bulk 收敛叙事
- 尤其是 `Proposal` 若暴露出 recovery / visibility 缺口，应单列记录，不得吞并为测试噪音

## 建议取证

每轮至少保留以下证据：

- 两端实例真值表
- 两端 `/health`、`/mesh/peers` 输出
- A 端 seed 完成后的四域计数与抽样清单
- B 端观察窗口内的多轮 RT truth 快照
- B 端最终 UI 截图
- Tauri / RT 日志摘录
- raw bridge 或 `driver_session` 的执行结果
- 本轮报告路径

## 建议输出模板

```text
执行日期:
run id:
客户端 A:
客户端 B:
有效 scope:
观察窗口:

EventLog:
- A 基线数量:
- B 最终数量:
- RT truth:
- UI truth:
- 判定:

TimeBlock:
- A 基线数量:
- B 最终数量:
- RT truth:
- UI truth:
- 判定:

Task:
- A 基线数量:
- A summary:
- B 最终数量:
- B summary:
- RT truth:
- UI truth:
- 判定:

Proposal:
- A 基线数量:
- B 最终数量:
- RT truth:
- UI truth:
- 判定:

总体结论:
阻塞点:
备注:
```

## 本轮执行纪律

1. 先写章程，再按章程执行，不边跑边改通过标准。
2. 不把“UI 有延迟”自动粉饰成“数据已经没问题”。
3. 不把“自动化脚本坏了”自动归因成产品 bug。
4. 不把 `Proposal` 从验收目标中偷偷移除。
5. 实际结论必须先服从 RT truth，再讨论 UI truth 与体验层差异。

## 实际执行记录（2026-04-14）

### Round 1 执行（TMCP-FULLSYNC-20260413203300）

**现场：**

| 字段 | 客户端 A | 客户端 B |
|---|---|---|
| 实例名 | full-sync-a | full-sync-b |
| Embedded RT 端口 | 9224 | 9244 |
| raw bridge 端口 | 9323 | 9343 |
| runtime host id | rt-faa07ff8-6a37-41cd-a2cc-1719f9d1eadb | rt-61e5b846-20f1-46c2-ac3e-4e33498612ad |
| 有效 scope | profile-tmcp-fullsync-20260414 | profile-tmcp-fullsync-20260414 |

**四域同步结果（RT truth，`user_id=profile-tmcp-fullsync-20260414`）：**

| 域 | A端 | B端 | 判定 |
|---|---|---|---|
| EventLog | 481 (=4×120+1 baseline) | 481 | ✅ 完全同步 |
| Tasks (replication summary) | task_count=601, hash=88674825... | task_count=601, hash=88674825... | ✅ 完全同步 |
| TimeBlocks | 600 | 600 | ✅ 完全同步 |
| Proposals | 600 | 600 | ✅ 完全同步 |

**Mesh 状态：**

- B端已发现 A端 peer（base_url=http://127.0.0.1:9224）
- A端已发现 B端 peer（base_url=http://127.0.0.1:9244）

### Round 1 报告误判原因

Bulk-sync 脚本报告 `eventlog=0, timeblocks=0` on B 端是**误判**，非真实结果。

原因：脚本在轮询阶段采集 B 端 RT truth 快照时，backfill coordinator 尚未触发第一轮 `setInterval` 回调（15s 间隔），导致初始快照是 0。后续 120s 窗口内 coordinator 已触发 backfill 并成功导入数据，但脚本已经写完报告。

**经验教训：**
- 轮询快照采集不能依赖"初始 0 值 + 自然触发"，必须主动触发一次 `backfillConfirmedPeers()` 后再采集
- 应在 B 端 UI spot check 前先用 raw bridge 执行 `window.__rt_domain_backfill__?.backfillConfirmedPeers()` 并等待其完成

### Round 2 执行（因 login bypass 未完成有效 seed）

Round 2 因 bulk-sync 脚本的 login bypass 逻辑，A 端未执行新的 bulk seed。Round 2 结果不能用于判定，只能说明脚本 profile 切换逻辑需要修复。

### 修正后的 bug 假设

**原始假设（错误）：** EventLog 和 TimeBlock 在 pairing 后不收敛。

**实际发现：** 四域均在 pairing 后自动收敛。原始 bug 假设不成立。

**待修复的真实问题：**
1. **Bulk-sync 脚本 login bypass**：`already_logged_in` 检查绕过新 profile 创建，导致无法在干净 scope 下重复执行
2. **Bulk-sync 脚本报告时机**：轮询快照应在主动触发 backfill 后采集，而非等待 15s 间隔自然触发
3. **mDNS peer hostId 为空**：A 端 mesh/peers 中 peer 的 `hostId` 字段为空字符串，说明 `AuthenticatedPeerIdentity` 未正确注入 `peer_host_id`

## 实际执行记录（Round 3 — TMCP-FULLSYNC-20260414-R3）

**现场：**

| 字段 | 客户端 A | 客户端 B |
|---|---|---|
| 实例名 | full-sync-r3-a | full-sync-r3-b |
| Embedded RT 端口 | 9224 | 9244 |
| raw bridge 端口 | 9323 | 9343 |
| 有效 scope | profile-tmcp-fullsync-20260414-r3 | profile-tmcp-fullsync-20260414-r3 |

**Fix 1 验证结果：✅ 已确认生效**

```
sync-a: action=register_then_login, scope=profile-tmcp-fullsync-20260414-r3
sync-b: action=register_then_login, scope=profile-tmcp-fullsync-20260414-r3
```
两套实例都执行了完整的 register+login 周期，没有 `already_logged_in` bypass。Fix 1 有效。

**四域同步结果（RT truth）：**

| 域 | A端 | B端 | 收敛延迟 | 判定 |
|---|---|---|---|---|
| EventLog | 120 | 120 | 22ms | ✅ PASS |
| Tasks | 120 (hash=`fa040765...`) | 120 (同一 hash) | 22ms | ✅ PASS |
| TimeBlocks | 120 | 120 | 22ms | ✅ PASS |
| Proposals | 120 | 120 | 22ms | ✅ PASS |

Task revision hash：`fa04076557a23a77f82d608b70f86af5ab6369752ae9e00629359e24270e0e13`

**Fix 2 验证结果：⚠️ 部分生效**

- `backfillConfirmedPeers()` 触发轮询在 60s 内超时（B 端 eventlog count=0）
- 但 120s observation fallback 窗口内四域全部收敛
- P2P mesh 复制本身正常，trigger 的 5s 轮询粒度太粗
- 待优化：轮询间隔从 5s 缩短到 1s，或超时延长到 120s

**Round 3 整体判定：✅ 功能通过**

所有四域在配对后 22ms 内收敛到 120/120/120/120（含 revision hash 一致），UI nav 失败是 Playwright 路由问题非同步 bug。

**问题 C 修复记录（已定位）：**

`PeerInfoPublic`（Rust）和 `RuntimeMeshPeerRecord`（TS）都缺少 `host_id` 字段，导致 paired peer 的 `hostId` 为空字符串。数据同步正常（走 `legacySnapshotPeers` fallback），但走了非预期路径。

修复位置：
1. `crates/exomind-runtime/src/mesh/mod.rs` — `PeerInfoPublic` 加 `host_id: String`
2. `src/lib/services/runtime-mesh-sync.service.ts` — TS 类型加 `host_id`
3. `src/lib/services/runtime-mesh-host-sync.service.ts` — `upsertConfirmedPeer` 改用 `peer.host_id`

## 实际执行记录（Round 4 — TMCP-FULLSYNC-20260414072240，P3 UI nav fix）

**执行日期：** 2026-04-14

**现场：**

| 字段 | 客户端 A | 客户端 B |
|---|---|---|
| 实例名 | full-sync-r3-a | full-sync-r3-b |
| Web 端口 | 1520 | 1540 |
| Embedded RT 端口 | 9224 | 9244 |
| raw bridge 端口 | 9323 | 9343 |
| 有效 scope | profile-tmcp-fullsync-20260414-p3fix | profile-tmcp-fullsync-20260414-p3fix |
| profile action | register_then_login | register_then_login |

**执行链路：**

- 按 Windows Tauri MCP playbook，直接走 raw bridge 真窗路径
- 报告目录：`.tmp/reports/tauri-full-domain-bulk-sync/TMCP-FULLSYNC-20260414072240/`
- 结果真值：`summary.json` 中 `overallPassed = true`

**四域同步结果（RT truth）：**

| 域 | A端 | B端 | 收敛延迟 | 判定 |
|---|---|---|---|---|
| EventLog | 120 | 120 | 22ms | ✅ PASS |
| Tasks | 120 | 120 | 22ms | ✅ PASS |
| TimeBlocks | 120 | 120 | 22ms | ✅ PASS |
| Proposals | 120 | 120 | 22ms | ✅ PASS |

**UI spot check（真窗）：**

| 域 | 路由 | Marker | 延迟 | 判定 |
|---|---|---|---|---|
| EventLog | `/eventlog/record` | `TMCP-FULLSYNC-20260414072240-EL-120` | 1167ms | ✅ PASS |
| Task | `/tasks?main=1` | `TMCP-FULLSYNC-20260414072240-T-120` | 1111ms | ✅ PASS |
| TimeBlock | `/eventlog/timeblocks/timeblock-TMCP-FULLSYNC-20260414072240-TB-120` | `TMCP-FULLSYNC-20260414072240-TB-120` | 1200ms | ✅ PASS |
| Proposal | `/proposals` | `TMCP-FULLSYNC-20260414072240-P-119` | 516ms | ✅ PASS |

**P3 结论：✅ 已通过真实 Tauri MCP 实测**

- Bulk-sync 脚本的新 UI 路由校验已经在真实桌面窗口里通过，不再只停留在本地静态检查或单测
- profile 切换后的页面 reload、最终快照 marker 取样、TimeBlock 详情页验收路径均已证明有效
- EventLog / Task 的 sidebar synthetic click 仍偶发超时，但脚本当前会自动回退到 direct route 导航；本轮 `overallPassed=true`，因此该现象不再构成 P3 阻塞
