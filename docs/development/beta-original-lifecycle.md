# Beta 原件生命周期：Core10 基础切片

本文定义 Core10 原件生命周期的 Core/Host/peer 基础合同和当前验收边界。它是开发合同，
不代表完整用户功能或已发布候选。Core10、Native 命令与缓存边界已接线；用户界面和恢复取回
的运行所有者仍分别验收。

## 所有者与数据范围

- Core 持有不可变生命周期事实、命令回执和本机原件字节状态投影。状态键是本机档案内的
  `profile_id + original_id`；每次有效状态变化推进 generation。
- Host 持有本机 Human 命令边界、可信 `HostClock` 样本、peer 成员资格和原件传输边界。
  Native 通过当前档案 Human 资格校验后，以本机 owner session 调用 Host；UI 不取得 owner 凭据。
- `orig_lifecycle/1` 事实描述作者设备上的动作。复制到另一设备后只是不可变历史；远端
  `release_local` 事实不会删除接收端字节，也不代替接收端 Human 的本机命令。
- 本机字节删除受 Core 事务中的事实、状态代际、receipt 与窄 SQL gate 约束。成功 receipt
  表示该本机事务已提交；它不表示其他设备或进程外缓存已删除。

## 动作合同

| 决定 | Core 状态与效果 | 硬约束 |
|---|---|---|
| Q04 `Reclaim` | 本机字节仍在，进入可恢复的 reclaimed 状态并记录恢复期限 | 到期本身不删除字节 |
| `Restore` | reclaimed 可直接恢复可用；released/purged/missing 会进入待恢复状态 | 新字节经完整校验后才完成恢复；失败 hash 可在原请求身份下显式重试 |
| Q04 `PurgeReclaimed` | 删除本机已验证原件的 chunk 字节 | 必须已 reclaimed、期限已过并由 Human 显式确认；没有自动到期清理 |
| Q24 `ReleaseLocal` | 直接释放此档案/设备的本机 chunk 字节 | 可从 available 或 reclaimed 直接执行，不要求先回收；是独立显式动作 |
| Q24 远端跟进 | 仅为明确选择的 peer 记录 follow-up 请求 | 请求和可达/可探测状态都不授权删除；对端需本机 Human 确认并执行自己的动作 |

回收期限的工程默认值为 30 天，可通过 Host 配置调整；每次 reclaim 固定保存实际期限，后续
配置变化不改写旧 deadline。成功的 Release/Purge 保留 manifest、capture/source facts、命令与
action receipts、origin/replication 历史以及派生事实（Q25）。它只清理相应本机 Core chunk；
不得描述为释放所有设备字节、清理导出副本，或完成了用户功能。

## 时钟与幂等

Host 在 reclaim 时保存 `wall_ms`、`epoch_id`、`elapsed_ms` 和所选期限。处于同一 epoch 时用
单调 elapsed 时间判断期限；Host 重启/epoch 改变后使用已经固定的 wall deadline。此合同不承诺
抵抗操作系统调钟或跨 epoch 的恶意时间修改。Unix wall time `0` 是合法样本，不能被替换成
“现在”。采样错误被替换成零值的问题已在独立提交中修复，真实 Unix 起点仍是合法样本。

命令 ID 的相同 payload 重放同一持久 receipt，并在返回值标记 `replayed=true`；相同 ID 携带
不同 payload 必须冲突。Release/Purge 重放时，即使 chunks 已删除，原 receipt 的事件、序号、
摘要与持久记录仍保持；capture receipt 和 lifecycle receipt 均继续保留。

## 读取代际与导出边界

`OriginalReadPermit` 是绑定 Core 生命周期、档案、原件及 generation 的 freshness 检查凭证，
不是排他锁，也不持有或固定字节。每段读取前后都会核对状态代际；多段读取完成后，调用方必须
在发布输出文件前调用 `finish_original_read`。generation 改变时读取/finish 失败；permit 不会
阻止并发释放，也不能单独证明 Native 缓存或目的文件的处置状态。

Native 导出与系统打开共用 permit-backed Source，每段读取及发布/handoff 前重新检查。
单段 Native range 命令也执行 begin/read/finish。读取器与 ExportManager 是无窗口模块，
Host 测试直接包含同一份生产代码；不复制一份测试实现。manager 按档案和原件标识区分
占用，释放 reservation 与同一原件的导出/打开互斥，停止后拒绝新任务并等待已有 guard。
permit 检查仍不是跨整个系统的排他锁，外部程序取得的句柄/副本不会被撤回。

Native 的 `beta_native_original_lifecycle.rs` 提供按需状态、能力探测、动作、缓存清理重试与
支持平台上的保留副本定位。`beta_native_open_cache.rs` 独立维护打开缓存的核验与处置；
缓存资格不能从路径归属推导。Windows 使用同一个读/删除句柄核验完整长度与 SHA，再请求
删除；拒绝写入/删除共享、链接或修改内容时保留副本。Unix 缺少等价处置保证，当前只检查
元数据并明确报告保留，不自动 unlink。系统另存文件不属于这个清理范围。

动作返回 Core receipt、可选刷新状态和独立缓存结果。缓存未清理不撤销已提交事实，重试也
不另写生命周期事实。核验在 blocking worker 上按 64 KiB 分段检查停止与预算，默认 5 秒；
本机合成 64 MiB debug 核验实测 874 ms，旧 250 ms 预算只能中断。该观测不承诺所有大小和
硬件均可完成，单次阻塞 OS 调用也不能被预算抢占。超时保留副本并返回未完成。

不把 Core 的本机 chunk 状态推断为缓存状态，不从 UI 文案、Agent/模型输出或
一次 peer 探测推断操作成功。peer probe 仅确认候选端点声称有可用副本；实际 fetch 仍须传输并
通过完整原件 SHA-256 校验。

## 待恢复取回的运行所有者

`Restore` 的 Core 回执只确认恢复请求已记录，不表示字节已经到达。Host 的原件队列在
启动、网络恢复和 Native 明确唤醒后扫描持久 `restore_pending`，复用原来的 job/status/
cancel/stage 路径。它不依赖消息卡片、管理面板或主文档存在。明确的恢复请求绕过普通
自动下载的开关和大小上限；网络关闭、成员授权、来源资格、完整 hash 和显式取消仍约束它。

恢复传输使用新的传输任务 ID，保留原 Core Restore 的 command/event ID 与 stage。hash
不符会阻止自动重试；取消会保留抑制，直到用户明确选择「重试恢复」。该命令只重置失败
阶段或取消抑制并唤醒扫描，不创建新的 Core Restore。重试回执也不能被展示成恢复完成。

恢复失败按档案/原件分别退避五秒并轮换来源，最多保留 256 项内存退避；一个没有持件的
peer 不得持续占住其他原件的恢复。普通自动下载的持久退避保持独立。扫描每页最多 100
项并复用原传输并发上限；这些工作预算不等于已验证手机空闲能耗或大档案扫描成本。
Native 的可用性通知只要求对等客户端重读数据，不改变 Core 回执或取得业务停止权。

已有四项真实 Host/PeerNetwork 回归通过：关闭自动下载后重启续接、超限原件续接、hash
错误停止并保留请求身份，以及三 Host 来源轮换/不阻塞另一原件。Windows Native 14 项
通过，包含取消后重试不另建恢复事实。管理界面与完整候选仍需分别实测。

## Core10 schema 与复制

Core10 将 `orig_lifecycle/1` 纳入 event kind、replicated fact 和 origin schema。Core9→10 迁移
应保留原 event IDs/bodies/digests/local sequence、manifest/reference、origin positions/hash chain、
receipt 和已验证原件。Core10 还校验 F7 的 correction target/sequence expression index；本切片
只包含这个 schema index，不包含 correction target 查询 API、search 行为或 HTTP/UI 接线。

同步 Hello 必须在事实交换前拒绝旧 Core schema。Core8 与 Core9 两项拒绝回归均已通过。
迁移合同与复制合同分开记账：真实 Core8
fixture 与 schema4 manifest/origin 已有结果；复制 helper 已补齐新事实的显式 digest 分支，
复制组 17 项重跑通过。

## 已知证据与未覆盖项

当前共享 worktree 的生命周期回归记录为 Core lifecycle unit 19、Core public 1、Host lifecycle
4、original transfer 19、peer network 14、Core8 Hello strict rejection 1，共 58/58。另有 F5
worker caller-token 回归由红转绿。Core8 真实旧版 CLI fixture（`85f7df92`，1 manifest、1 个
49-byte chunk）升级 Core10 为 1/1；`schema4_manifest_origin` 为 6/6。真实 fixture 不是手工
DDL。`tests/replication.rs` 的 `rechain` helper 补入显式
`ReplicatedFact::OriginalLifecycle` 分支后，复制行为 17 项通过。Core5 红基线各层证据
见外部 `parent-runtime-verification.md`，不作为 Core10 通过证据。

以下依赖仍未覆盖，不能据本切片声称完整 Beta 可编译/可用：

- UI 上 reclaim、restore、release、purge、远端 follow-up 的动作、确认和 receipt 展示。
- restore_pending 的合成 Host 重启续接已覆盖；完整候选、真实设备与能耗仍需验证。
- Native lifecycle 命令与缓存处置接通后的完整候选 CI。
- 跨设备字节处置、Native 缓存字节处置、系统文件导出结果和用户侧完整流程验收。

阶段二的 Native 原件读取/任务占用已有 Windows 本机证据：manager 3 项、原始 Native
export 组 8 项通过；将无窗口 Source 原样移入独立模块后，Host lane 同时运行 manager
与真实 Host/Core 的失效代际行为，共 4 项通过，调整后的 Native export 组 7 项通过。
系统选择器、打开方式与跨端处置仍另验。Source/manager 组加入现有源码 CI，拒绝零测试结果。
Native 生命周期命令与缓存边界的 Windows 单测 13 项通过；同轮原导出回归 7 项通过。
覆盖同原件 busy 时不写事实、修改副本保留、句柄共享冲突、硬链接拒绝、停止/预算中断、
重试不增加事实与能力白名单。定位测试使用回调，不代表已经真实打开文件管理器；完整候选
窗口、Android 和用户动作仍待后续验收。
Core10 生命周期与真实 Core8 fixture 的 CI 已在 `0cc5091a`、`a7d5a191` 通过；本轮新增
Source/manager 门禁的远端结果单独回读，不以本机结果代替。

事实 receipt、字节校验、复制 ACK、UI 展示和模型输出是不同证据层；任一层通过都不能代替其余
层。Beta18/Core9 冻结 payload `66124154` 不因 Core10 worktree 增量而改变；升级与 8 KiB 导出/
进程回收/重新选址/重启链路属于 Beta18 证据，不计作 Core10 生命周期验收。

提交前另用暂存索引的独立源码快照核对依赖闭包：Core 默认测试 164 项通过、13 个原标记入口
跳过。Host 首轮触及整批时限后，保留完整结束的组并按剩余测试文件续跑；合计 272 项通过，
7 个原标记入口跳过。跳过项不计为通过，实模型、专用历史夹具与平台验证继续分别记账。
