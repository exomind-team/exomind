# 2026-04-13 搬迁性更新调研报告

## 报告目的

本报告不再重复 8 份分主题调查的细节，而是把它们压缩成一个搬迁视角的统一判断：

1. 当前有哪些历史包袱必须主动抛掉，而不是继续兼容。
2. 如果采用“另起炉灶、搬迁代码”的方式，哪些既有探索成果应被保留并迁入新骨架。
3. 新骨架应先重建哪些真相源、作用域原语和服务边界，才能在抛掉历史包袱的同时避免把已验证经验一起丢掉。

## 检索路线与来源选择

本报告只基于仓库内部资料，不做外网扩展。

直接来源是 2026-04-13 新生成的 8 份专题调查：

- `docs/analysis/2026-04-13-eds-crdt-vs-rt-sync-architecture-gap.md`
- `docs/analysis/2026-04-13-headless-runtime-vs-ui-owned-side-effects.md`
- `docs/analysis/2026-04-13-proposal-governance-vs-current-proposal-stack.md`
- `docs/analysis/2026-04-13-archive-scope-migration-vs-profile-user-legacy.md`
- `docs/analysis/2026-04-13-workbench-vs-legacy-pages-architecture-gap.md`
- `docs/analysis/2026-04-13-durable-runtime-vs-fallback-host-port-legacy.md`
- `docs/analysis/2026-04-13-release-distribution-metadata-vs-single-origin-model.md`
- `docs/analysis/2026-04-13-blackboard-knowledge-layer-vs-existing-memory-carriers.md`

这些专题文档已经分别回链到对应计划、架构文档和源码行号。下面的综合判断以它们为直接证据源，不再重复展开全部代码细节。

## 总结论

当前 ExoMind 最大的问题，不是“还没探索出新架构”，而是：

`新架构大多已经在文档和局部实现里成立，但旧骨架仍然掌握真相源、作用域原语、页面所有权和兼容入口。`

因此，“搬迁性更新”的正确目标不是在旧骨架上继续补丁式演化，而是：

1. 明确丢掉哪些旧前提。
2. 把已经验证过的新成果抽成新骨架的正式契约。
3. 通过单向导入和有限兼容窗口，把旧状态迁入新骨架，而不是长期双向 shim。

## 一、必须主动抛掉的历史包袱

### 1. `UI 挂载 = 持续运行职责`

必须抛掉的旧前提：

- reminder 到期推进、peer recovery/backfill、部分 signal projector/materializer、部分 timeblock 同步启停，继续依赖 React 挂载、定时器、focus/online 事件驱动。

为什么必须丢：

- 这会直接阻断 `headless runtime`，并在多窗口、无窗口、分离窗口场景下制造“少挂不跑、多挂重复跑”的双向风险。

对应调查：

- `docs/analysis/2026-04-13-headless-runtime-vs-ui-owned-side-effects.md`

### 2. `profileId / user_id / scopeKey / anonymous` 继续作为底层 canonical scope

必须抛掉的旧前提：

- 继续把 `profileId`、`user_id`、`scopeKey`、`anonymous` 兼容桶当成核心对象与协议作用域。

为什么必须丢：

- 这会让 `archive / ArchiveSession / UiSession / multi-archive / collective archive` 永远只能停留在文档层，无法进入协议、存储和运行时主路径。

对应调查：

- `docs/analysis/2026-04-13-archive-scope-migration-vs-profile-user-legacy.md`

### 3. `旧页面仍掌握工作台主权`

必须抛掉的旧前提：

- `WorkbenchPage` 继续只是 flat shell，真正的 layout、runtime、navigation、persistence ownership 仍散落在 `AgentsPage`、legacy route shim 和两套 local storage schema 中。

为什么必须丢：

- 只要旧页继续掌握状态主权，`WorkbenchSpace + ViewInstance + RuntimeBinding + SurfaceNavigationState` 就无法真正接管。

对应调查：

- `docs/analysis/2026-04-13-workbench-vs-legacy-pages-architecture-gap.md`

### 4. `字段 PATCH + 快照复制` 继续承担未来治理与同步主干

必须抛掉的旧前提：

- proposal 继续用“字段 patch + LWW 快照复制 + approved 即执行”承载治理主队列。
- RT-only 同步继续长期维持“UI projector + RT actor 混合 apply”“snapshot repair 代替统一 convergence”。

为什么必须丢：

- 这套模型可以承载第一阶段的数据面，但承载不了 `proposal-first governance` 和 `EDS/CRDT` 级别的对象合同。

对应调查：

- `docs/analysis/2026-04-13-proposal-governance-vs-current-proposal-stack.md`
- `docs/analysis/2026-04-13-eds-crdt-vs-rt-sync-architecture-gap.md`

### 5. `默认 host/port + fallback 地址` 继续被视为 runtime 真相

必须抛掉的旧前提：

- 桌面宿主和 UI 继续预设一个固定地址，外部 runtime 复用、默认地址回填和上层恢复补丁继续覆盖 runtime 自己的真实启动结果。

为什么必须丢：

- runtime 底层已经具备 durable identity、`port=0`、真实端口回传；继续保留旧宿主假设，只会让库层正确、宿主层混合、UI 层补丁长期共存。

对应调查：

- `docs/analysis/2026-04-13-durable-runtime-vs-fallback-host-port-legacy.md`

### 6. `GitHub 单 origin` 继续作为默认下载真相

必须抛掉的旧前提：

- 控制面虽已切到 Pages metadata，但数据面仍默认“每个 asset 一个最终 URL，且这个 URL 本质上还是 GitHub Release”。

为什么必须丢：

- 只要 source 不是显式维度，多源切换就永远只能停留在 issue 愿景，不能成为发布合同的一部分。

对应调查：

- `docs/analysis/2026-04-13-release-distribution-metadata-vs-single-origin-model.md`

### 7. `共享记忆 = 复用 Agent 私有 workspace/knowledge`

必须抛掉的旧前提：

- 把未来 blackboard / shared knowledge layer 直接做成 `AgentWorkspace/knowledge` 的扩展或别名。

为什么必须丢：

- 私有长期记忆、共享工作记忆、业务真相 carrier 的 owner、scope、删除语义和审计语义都不同，硬复用只会继续混层。

对应调查：

- `docs/analysis/2026-04-13-blackboard-knowledge-layer-vs-existing-memory-carriers.md`

## 二、这些成果不该丢，应该搬进新骨架

下面这些不是历史包袱，而是已经付出代价探索出来、应该保留的有效成果。

### 1. RT 已经摸清了一批真实对象语义

应该保留：

- Task 的 terminal precedence、active timeblock 的 phase monotonicity / version rule、proposal 与 reminder 的现有最小冲突规则。

为什么要保留：

- 这些规则不是“坏实现细节”，而是未来对象级冲突合同的原始素材。新骨架应该重写承载方式，不该重做语义摸索。

来源：

- `docs/analysis/2026-04-13-eds-crdt-vs-rt-sync-architecture-gap.md`
- `docs/analysis/2026-04-13-proposal-governance-vs-current-proposal-stack.md`

### 2. RT durable 基础已经前进

应该保留：

- `host_id` 设备级持久化
- `port=0` 随机端口契约
- 固定端口失败时退随机端口
- 多个域的 SQLite store 与运行时测试护栏

为什么要保留：

- 这是新 runtime 骨架最可靠的基础，不应该被桌面层历史默认值拖回去。

来源：

- `docs/analysis/2026-04-13-durable-runtime-vs-fallback-host-port-legacy.md`

### 3. `single-tag + Pages metadata` 控制面已经成立

应该保留：

- `preview/release/timeline` 静态 metadata
- 官网与桌面更新都消费 Pages JSON

为什么要保留：

- 这条链路已经把“版本控制面”从旧动态路径中抽出来了。后续只需要把 `source` 升级成显式维度，不应该推倒重来。

来源：

- `docs/analysis/2026-04-13-release-distribution-metadata-vs-single-origin-model.md`

### 4. Workbench 长期对象模型已经足够清晰

应该保留：

- `WorkbenchSpace`
- `ViewInstance / SurfaceSlot / SurfaceNavigationState`
- `RuntimeBinding / RuntimeAttachment`
- `FocusRun / EventTape`

为什么要保留：

- 这套模型已经把“布局层、语义层、运行时归属、事实层”分开了。问题不在模型定义，而在旧页还没交权。

来源：

- `docs/analysis/2026-04-13-workbench-vs-legacy-pages-architecture-gap.md`

### 5. Archive OS 命名与会话分层已经想清楚

应该保留：

- `archive` 作为核心对象
- `ArchiveSession / UiSession` 分层
- 多档案与集体档案同型

为什么要保留：

- 这是未来 scope、身份、会话和运行时模型统一的前提。不要再退回 `profile/account/user` 混合心智。

来源：

- `docs/analysis/2026-04-13-archive-scope-migration-vs-profile-user-legacy.md`

### 6. Proposal-first 与 blackboard 的边界已经有清楚决策

应该保留：

- proposal-first 治理的角色边界、`in_review` 语义、人类终审前提
- blackboard 的 owner、容量、弹出、route 回送、与 eventlog/proposal 的边界

为什么要保留：

- 这些都是高成本讨论换来的产品/架构合同。实现未跟上，不等于可以回到模糊状态。

来源：

- `docs/analysis/2026-04-13-proposal-governance-vs-current-proposal-stack.md`
- `docs/analysis/2026-04-13-blackboard-knowledge-layer-vs-existing-memory-carriers.md`

### 7. Backfill、snapshot、projector 不是最终形态，但可作为迁移桥

应该保留：

- 当前的 sqlite snapshot export/import、backfill repair、projector 经验、signal stream hydration 与节流护栏。

为什么要保留：

- 它们不适合作为最终架构主干，但很适合作为搬迁窗口中的导入器、repair 机制和一致性补丁。

来源：

- `docs/analysis/2026-04-13-eds-crdt-vs-rt-sync-architecture-gap.md`
- `docs/analysis/2026-04-13-headless-runtime-vs-ui-owned-side-effects.md`

## 三、搬迁的核心原则

### 原则 1：只迁移“已验证语义”，不迁移“旧壳层所有权”

应迁移：

- 业务对象语义
- durable runtime 契约
- Workbench / Archive / Proposal / Blackboard 的正式模型
- 现有 backfill / import/export 经验

不应迁移：

- UI-owned scheduler / projector / worker supervisor
- `profileId / user_id / scopeKey / anonymous` 旧作用域词汇
- `AgentsPage` 持有的 layout/runtime/navigation ownership
- `approved == execute now`、`single downloadUrl == single source` 这类过时绑定

### 原则 2：先建新 canonical primitive，再搬实现

新骨架必须先定的不是页面，而是这些 canonical primitive：

- `archive_id`：替代 `profileId / user_id / scopeKey`
- `runtime instance truth`：替代默认 host/port 与外部地址回填
- `RT-only apply authority`：替代 UI projector 与 RT actor 混合 apply
- `proposal governance commands + history`：替代字段 patch 状态机
- `distribution source`：替代单 `downloadUrl`
- `archive-owned blackboard`：替代 agent-private knowledge 扩展

这些 primitive 不先定，所谓搬迁只会复制旧债。

### 原则 3：采用单向导入，不做长期双向 shim

推荐方式：

- 旧数据只读导入到新骨架
- 旧入口有限兼容，但写操作逐步收口到新服务
- 兼容层必须有明确删除条件

不推荐方式：

- 新旧骨架长期双写
- 新页继续跳回旧页处理关键生命周期
- 新语义继续借旧字段名或旧路由名硬套

## 四、建议的搬迁顺序

### 阶段 A：先重建底层真相源

优先级最高：

1. `archive_id` 与 canonical wire scope
2. runtime 启动真相与实例标识
3. RT-only apply authority
4. headless actor 化的 reminder / recovery / signal materialization

理由：

- 这些是其他搬迁的共同前提；不先做，后面所有新页面、新对象层都会继续挂在旧真相源上。

### 阶段 B：再重建新骨架服务层

此阶段建立：

1. `WorkbenchService / RuntimeBindingService / SessionInteropAdapter`
2. `Proposal governance service` 与命令面
3. `Blackboard store / route / tool`
4. `Distribution source-aware metadata schema`

理由：

- 到这一阶段，模型、所有权和持久层开始一致，新 UI 才不会变成旧实现的壳。

### 阶段 C：最后搬页面与兼容入口

此阶段才适合：

1. 用真正 `space-first` 的 Workbench 起页流程替换 legacy handoff
2. 用 archive switcher 替换 profile/account 切换器
3. 用 proposal 主队列 UI 替换当前 inbox/data browser
4. 用 source-aware download/update UI 替换单链接消费层

理由：

- 页面搬迁应该是新骨架成形后的结果，不该先于底层 canonical primitive。

## 五、按主题给出“抛掉什么 / 复用什么 / 如何搬”

| 主题 | 必须抛掉 | 必须复用 | 建议搬法 |
|---|---|---|---|
| 同步与 EDS | UI projector + RT actor 双 apply、Pouch 心智继续主导 | 领域冲突规则、snapshot/backfill 经验、SourceChain 方向 | 先收口 RT-only apply，再决定哪些对象真的进入 EDS/CRDT |
| Headless runtime | UI 挂载即业务 daemon | RT store、signal stream hydration、已有测试护栏 | 先把 reminder/recovery/materializer actor 化，再缩 UI 到平台执行器 |
| Archive / scope | `profileId/user_id/scopeKey/anonymous` 继续做 canonical scope | Archive OS、ArchiveSession/UiSession 边界 | 先定 `archive_id` 与 wire scope，再做旧数据双读单写导入 |
| Workbench | `/workbench` 继续做 legacy launcher | WorkbenchSpace 等长期模型 | 先建 service/binding 层，再迁 layout/runtime/navigation ownership |
| Proposal | 字段 PATCH、`approved == execute` | proposal-first 角色边界、终审语义 | 先建命令面/history，再拆开治理决议与副作用执行 |
| Runtime 宿主 | 预设 host/port 和 fallback 地址 | durable runtime 契约与启动测试 | 让桌面层只消费 runtime 真实启动结果，不再伪造默认真相 |
| Release/update | 单 `downloadUrl` = 单 source | Pages metadata 控制面 | 把 `source` 加进 schema/store/UI/test，再保留 GitHub 作为一个 source |
| Blackboard | 共享层复用 AgentWorkspace/knowledge | blackboard 边界决策、life/proposal 闭环经验 | 单独建 archive-owned store/route/tool，只把蒸馏结果写入 blackboard |

## 六、一句话决策

如果要做“搬迁性更新”，正确路线不是“在旧系统上继续补新概念”，而是：

`先砍掉旧真相源与旧作用域原语，再把已经验证过的对象语义、durable runtime 契约、Pages metadata 控制面和 Workbench/Archive/Proposal/Blackboard 正式模型搬进新骨架。`

做不到这一步，项目就会继续停留在“新架构是对的，但只能以 adapter、shim、projector、fallback 的形式寄生在旧系统上”。
