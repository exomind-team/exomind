# Beta 本机提交核心

β27 的新库使用 **Core schema 11**。Core 负责在 SQLite 中提交事实、原件引用和本机命令回执，以及接收其他副本的来源事实与证明。Host 检查档案资格并运行网络、调度和模型任务。[版本常量](src/lib.rs) · [Host](../exomind-beta-host/README.md) · [候选与设备证据](../../docs/AI-CONTEXT.md)

| 维护任务 | 当前合同 |
|---|---|
| 排查重复提交、丢失回执或事件读回 | [本机提交事务](../../docs/development/v0.6-beta-core-contract.md) · [实现](src/store.rs) |
| 按日历窗口读历史，核对回顾是否采用更正 | [Core11 读取与更正](../../docs/development/beta-core11-history-and-review.md) |
| 判断另一设备持有哪些事实、证明和字节 | [多来源复制](../../docs/development/beta-multiorigin-sync.md) · [原件生命周期](../../docs/development/beta-original-lifecycle.md) |
| 在另一安装中接纳一个档案 | [往返包、预览和导入](../../docs/development/beta-profile-archives.md) |

下文保留 schema 1–6 各阶段的设计、迁移依据和专项测试。对应新库版本取决于该节记录的历史阶段。

`read_timeline_event(WriterContext, profile, event_id)` 精确读取一个当前档案的可见 capture / timeblock / summary，不扫描分页历史、不写入或重建投影。其他档案的 ID、内部 summary_job 和不存在的 ID 均返回 `None`；错误档案 context、旧生命周期 context、存储/解码/完整性故障返回错误，不伪装为空。它与 `timeline_page` 共用受 `MAX_FACT_BYTES` 限制的解码器，核对数据库头字段、所属档案、规范摘要及事实校验，返回本机真实 `local_seq`。结果里的原件引用不增加字节读取权限。

## schema 6：持久回顾任务与冻结来源

`summary_job/1` 是任务的追加式控制/执行 DAG，`summary/1` 是不可变的结果记录。两者使用现有 own-origin/hash-chain 复制，不复制本机 `summary_attempts` 或回执。普通 `timeline_page` 只呈现 capture、时间块和结果，在 SQL LIMIT 前排除内部 job，因此任务状态不会挤进消息区或把旧消息分页隐藏。任务/结果分别用有 scope 的 `summary_tasks_page`、`read_summary_task`、`summary_artifacts_page` 读取。schema 6 peers 须协商新类型；旧记录的 canonical、ID、摘要、回执及 origin 游标不改写。

首次回顾键固定为 `(profile,block,first_review/v1)`，默认执行设备是 Start/Rotate 创建块的设备。反馈完成（含明确跳过）使本机候选可执行；`reconcile_summary_triggers` 从私有有界候选游标发现远端结束/反馈，重复扫描不新增任务或 attempt，不依赖 UI。升级不自动回顾全部历史块；历史可显式请求。相同首次键的第二次独立请求返回 `trigger_already_requested`，原任务保留。手动范围请求仍保留全部原文。

控制命令带 owner generation、owner control event 和所见全部 control heads，事务内作 CAS。取消、接管、新 run、更新都保留原事实。并发控制不按标量 generation 猜赢家：显示确定的来源并阻止执行，取消保守有效，显式 ResolveOwner 必须覆盖当前所有 heads；恢复已取消任务还需 `resume_cancelled`。导入事实不自动接管。网络分区期间两个显式操作者仍可能各发外部调用，稳定任务 ID 不等于模型侧恰好一次计费。

`SummaryExecutorContext` / `SummaryRunTicket` 是不可反序列化的 Rust 私有资格，绑定 Core lifecycle、设备、档案、任务、run、attempt、owner token/generation 和 snapshot digest。`begin_summary_attempt` 仅允许 queued / waiting_configuration / 已到退避时间的 retry_wait；失败资格检查不写 attempt、receipt 或事实。`summary_input_records` 与 `validate_summary_run` 均重验资格。finish 在同一 SQLite 事务重验并写结果、发布事实及回执；已取消、导入失资格、Host 停止或旧进程 ticket 的迟到返回为 Stale，不产生新结果。相同已完成输出可重读原回执，不再生成结果。

Host 负责配置、密钥、模型请求、HTTP 取消和最后授权 gate；Core 不访问模型。配置缺失只有一个持久 waiting 状态，不消耗 attempt。明确限流/不可用才可有限 retry，最高 8 次且不扩大原 run 的已冻结预算；配置变化、未知外部结果等不自动重试。新进程通过 `recover_summary_attempts` 有界标记旧 active 为 `external_outcome_unknown`，保留冻结来源并要求显式新 run，不能重建旧 ticket 后再次付费。`stop_summary_executor` 是本 Core 生命周期的执行停止，不是假造用户取消，重开 Core 才产生新生命周期。

每次 run 第一次 begin 冻结真实来源 ID/kind/digest、反馈 ID、所见 origin heads、范围与材料状态；后续 retry 复用该快照。正文入口只返回该 ticket 冻结的 capture/typed 节点，逐条核摘要，最多 1000 条与 192 KiB（逐记录 JSON 编码长度之和），整条省略通过 `input_byte_limit` 和 `omitted_source_ids` 披露，页截断另标 `page_limit`。capture 时间索引和 block-source 映射先选最多 1001 个候选 ID，再读正文；状态轮询只核来源元数据和冻结 origin 向量，不重读模型正文。覆盖范围始终标远端可见性 unknown，不声称全网完整。已知缺 parent、metadata-only、原件未读分别披露。

原件默认不选、不下载、不读取、不外发。summary 引用不是新的原件发布资格：结果导入不创建原件 stage、manifest 或事实引用权限。输出的 `read_original_ids` 只可取快照中显式选择且 verified 的材料；Host 还须有实际 Reader/授权并核其已读，不把 verified_available 当模型已读。总结结果必须有非空冻结来源及至少一个对应证据；raw Running 与结果也受此约束，origin head 逐个绑定当前档案，coverage 列表须满足去重、长度及材料归属。晚到来源令 `coverage_changed`，按需 QueueUpdate 另起 run/结果，旧结果的 snapshot/output/生成时间和作者设备不变。

5→6 先执行已有 verified online backup，再同事务扩展 events 与 origin kind 检查域、创建任务及来源索引。events 重建保留完整 local_seq/事实列、sqlite_sequence 原 rowid/水位及所有 child FK 名称；开库连接仅在迁移事务外围临时关闭 FK，commit 前作 foreign_key_check，成功或错误均恢复 FK ON 后才返回。原 origin_entries 的 rowid/八列、原 bytes/deadline/receipt 均保留。相同版本缺表/索引/来源映射返回 RecoveryRequired，不静默补库。`tests/schema6_migration.rs` 的 ignored 专项通过 `EXOMIND_CORE_SCHEMA5_FIXTURE` 复制真实旧5库后迁移，对账全部旧表值/rowid/原件块、完整旧5备份和 retained fixture SHA；它不把降版本模拟库冒充旧候选。运行证据由父代理有限监督记录，Core通过不等于模型或端到端验收完成。

## 本机提交与读取

Host 用绝对且独立的数据根打开 Core。对非空外来目录、未知 schema 或损坏数据库，Core 返回相应错误。每个档案和设备有独立 UUID。`local_seq` 表示该副本的接收顺序，`occurred_at_ms` 保留事件发生时间。

`local_human` / `local_agent` 由受信 Rust 宿主使用。HTTP 和 Native IPC 都先由 Host 检查身份与档案资格，再进入同一 Core。`WriterContext` 由本次 Core 生命周期签发，作者来自已验证的身份。[Host 资格检查](../exomind-beta-host/src/lib.rs)

首次提交在 `BEGIN IMMEDIATE` 内写入事件和完整回执；唯一约束与 SQLite 锁覆盖不同连接。返回回执之后没有另一个可失败写入动作；通知由宿主负责，不能改变已提交结果。相同事件事实可以在新命令下引用同一序号，同事件 ID 的异内容及同命令 ID 的异请求都拒绝。

档案管理提供 `profiles` 与 `provision_profile`：列表按显示名与 UUID 稳定排序，同 UUID/同名创建重试返回原对象，异名明确冲突，不能改名覆盖。它们属于受信宿主管理能力，不是匿名档案发现接口。

`events_page` 提供 1–100 条的本机序号倒序分页，默认100条；`before` 严格小于且必须为正，不能超过本次快照上界加1。首个响应的 `highwater` 是当前档案的最大本机序号，后续请求以 `through` 冻结它；空快照上界为0。未来快照和越界游标显式拒绝，空页是成功响应。`search` 对原始正文执行区分大小写的字面子串搜索，中文、`%`、`_`、引号不被解释为 SQL 通配或语法；空搜索串等同匹配全部。读取错误不会改为空页。

Rust 对固定格式的 capture 生成规范字节，固定字段顺序、标签排序去重并保留原文。反序列化时拒绝未知字段和额外的作者身份。对外接入分别经过 HTTP 或 Native 的业务入口。

## schema 4 的直接来源复制合同

这一节记录直接来源协议及迁移约束。Core8 起可以通过获准载体接力其他来源，当前实现依赖原作者签名、已验证前缀和本次成员资格。[多来源复制与 ACK](../../docs/development/beta-multiorigin-sync.md)

`CORE_SCHEMA_VERSION` 是唯一公开版本常量。schema 1/2/3 升级先执行独立、含 live WAL 的一致备份并核对，随后同事务建立 schema 4。`original_manifests` 保存不可变的档案/原件描述；事件引用它，而非要求接收端已有本机暂存。`declare_original_manifest` 只登记元数据，不创建 stage、verified 字节、事件或回执，也不授予读取权限。`original_availability` 在档案事实读取授权后区分 missing 与本机 stage；本机提交仍要求完整 verified 整组。

每个档案在创建/迁移事务里生成独立的持久 restoration epoch，空档案亦如此。`replication_identity` / `origin_checkpoint` 使用本机 `WriterContext`，只读且不生成 epoch。每个真正新 capture/typed timeblock 与其 origin 序号、规范事实摘要、前缀 hash 链及原有 receipt 同事务；重试不重复推进。链绑定档案、设备、epoch、序号、事实类型与事件 ID，不包含接收端 `local_seq`。checkpoint 验证实际链端点及其事实，坏元数据不伪装为空。

在 schema 4 的直连路径中，`ReplicaContext` 由受信宿主绑定已认证的 direct origin 和本次 Core 生命周期。Host 在最终 gate 内核对成员代次并持有成员授权表。`replication_cursor` 只读已确认来源进度；同档案/设备已有另一 restoration epoch 时明确返回 `OriginEpochChanged`，不因新主键缺行而自动从0接收，也不清旧事实。恢复资格和新 epoch 的显式接纳流程仍由后续受信恢复操作衔接。

`export_origin_page(WriterContext, profile, query)` 仅导出本机 own-origin；接收其他设备的事实不构成第三方 relay provenance。`after` 是已知前缀的 seq/hash，`through` 冻结首次响应的来源上界，均核对真实链端点。每页最多100条，按实际 serde JSON 字节计量；默认192 KiB，逻辑页最大 `MAX_ORIGIN_PAGE_BYTES = MAX_FACT_BYTES + 64 KiB`。单条放不下时 `OriginPageOversize` 返回 `required_bytes` 和 `origin_seq`，不跳过该条、不推进游标。Host 可在逻辑上限内增预算并经自己的有界256 KiB物理帧分片。

`import_origin_page(ReplicaContext, page)` 单独执行原始 capture/typed timeblock 事实导入，保留来源设备、作者、原时间和 canonical；接收端只分配自己的 `local_seq`。事实、原件引用、来源条目/head、接收 cursor 和已接受 epoch 同事务，完全不调用本机 submit/apply，也不伪造 command receipt 或 timeblock 请求摘要。固定范围重放核每项链与真实 canonical，而非仅检查 cursor 已够大。相同事件 ID 异内容整页回滚，随后独立事务仅记录 ID、范围、摘要及原因；SQLite busy/IO 等存储失败不伪装为内容冲突。

原件 metadata 可先到而 bytes 缺失：`ImportAck.missing_originals` 只对本页描述去重，不扫描全部档案，不假建 verified stage。远端猜中同档案私有 stage 的 ID/hash/描述也不能靠新引用将其公开；首次引用这种现存未发布本机原件返回 `OriginalConflict`。跨档案同 ID 同样不能借用字节；metadata-first 的正常流程为先导入事实、再由授权本机 stage materialize。

时间块读取直接使用 typed events，`timeblock_nodes.request_digest` 仅关联本机命令。导入重建可丢弃的 projection；缺失 parents 时保留 raw事实/cursor、标记 incomplete 并拒绝 current/control，不能返回旧缓存冒充完整。补齐后按 DAG 确定性重建。run device 从 Start/Rotate/Resume 原事实恢复，兼容旧缓存缺字段；导入不会创建远端运行块的本机 deadline，只取消已失效的本机 pending。网络鉴权、恢复授权、Host同步driver及端到端验收仍属独立能力，不以这些 Core API 宣称完整 B2 已验收。

保留的真实 Core3 seed/probe 专项通过 `EXOMIND_SCHEMA3_FIXTURE` 显式运行。它核对 provenance、含原件的 capture/2、typed fact、原 receipt、全部原件字节和含 WAL 的单文件备份，再确认旧程序精确拒绝 schema4，拒写后重开对账。夹具/二进制/数据库不提交源码；独立旧依赖锁与发布二进制的差异必须保留在证据中。

本机事实的 JSON 编码共用 `MAX_FACT_BYTES`（2 MiB）：迁移、origin checkpoint、导入/导出与新事实写入采用同一界限。原有文字、标签和256原件组合同保持，合法控制字符的 JSON 转义膨胀不会导致已回执事实随后不可读。复制默认页预算与物理传输帧独立且更小；单条超预算必须明确报错，不能跳过、截正文或先推进游标。

## B1.2 原件事务与恢复

schema 2 将暂存分块与 verified 原件保存在同一 SQLite 内，默认每块最多 256 KiB；不沿用 Node 的 64 MiB 总文件上限，长度合同上界为 SQLite 的有符号64位字节位置。单次 capture 的整组上限是 `MAX_CAPTURE_ORIGINALS`，字节读写上限来自 `MAX_ORIGINAL_CHUNK_BYTES`。零长度、未知扩展名、未知媒体类型和任意二进制均可保存；不执行附件、不递归收集播放列表引用资源，不自动向模型发送内容。

传输仍接受任意 1…256 KiB 连续追加，包括一字节写入；物理存储按 256 KiB 对齐 block 合并。只有 uploading 尾 block 可以增长，SQL trigger 要求旧前缀逐字节不变、offset/身份不变、长度增加且不越界；满 block 与冻结 block 不可更新。一次追加最多更新一个尾 block 并插入一个新 block，先核验旧 block hash，新 hash/偏移/generation 同事务。任意已确认子 range 重放仍逐字节比较，部分重叠拒绝。每次有界 range 用精确 block offset 读取，最多涉及两个物理 block，不随原先写入调用次数放大查询数。

schema 2 开发期间先后试验过碎片行布局和固定 block 布局。`core_layout` 记录布局 revision 与 block 大小。已有 schema 2 缺少该标记或布局不匹配时返回 `RecoveryRequired`，保留全部字节、事实及回执，以供显式恢复。

`BeginStageCommand` 绑定 StageId、OriginalId、档案、创建作者、SHA-256、长度、文件名和媒体类型。同 stage ID 改描述明确冲突，另一 stage 不借用已有 OriginalId。原件暂存属于 operational state，不追加事件，也不推进 `local_seq`。

- `begin_stage` / `stage_status`：幂等创建、查询已持久偏移与 uploading/frozen/verified/hash_mismatch 状态。
- `write_stage_chunk`：连续位置追加；整块重复与已持久字节相等才幂等。空洞、部分跨越已确认边界、越界与不同内容明确拒绝。字节、服务端分块 SHA-256、下一偏移和 generation 同事务；只有 commit 成功才返回偏移。
- `freeze_stage`：整份字节到齐才冻结；已冻结的重复请求不变更 generation。冻结后 SQL trigger 与公开 API 均不允许修改已有块。
- `VerificationTicket::verify`：私有 ticket 拥有独立只读连接，不占主 Core Mutex。每批短读事务并检查取消（闭包返回 true），再计算整份 SHA-256；不保留整份文件在内存，也不长期钉住 WAL 读快照。ticket/proof 不可反序列化。
- `finish_stage`：受信 Host 必须重新检查停止/撤销/当前档案后调用；Core 再检查 lifecycle、generation、作者与描述。错误 hash 持久标记 hash_mismatch 并返回错误，字节保留；不自动删坏件或换 ID 重试。旧生命周期 proof 不能登记成功。
- `read_stage_range`：仅创建作者的私有暂存预览，元数据中的 SHA 是期望值，不代表已 verified。Host 必须排除 observer；Core 的本机 context 工厂本身不构成外部认证。
- `read_original_range`：必须存在该档案已提交事件对原件的引用，hash 不是读取凭据；未引用 verified 原件仍是私有草稿。整组第一次引用也只能由创建者提交；引用后按档案能力共享。

任一范围读取先检查涉及分块的服务端 SHA-256，即使只取1字节也拒绝同长度坏内容；验证期间亦检查分块 SHA。完整性错误不删除坏字节、不改写历史事实或 receipt。磁盘介质故障不会被伪装为成功读取。

`CaptureCommand.originals` 是有序、不可变的完整原件描述组。空正文但有原件允许提交；整组任何一项未 verified、内容描述不一致或未授权，事件与回执均不产生。事件、关系表与 receipt 同事务，失败不会出现部分附件。空 originals 的文字仍使用原 `capture/1` 规范字节；有原件使用 `capture/2`，旧事件默认空组，旧摘要/receipt 不重写。

重启后按已落盘偏移继续上传。frozen 可重新验证，verified 可直接查证。已提交但丢失回执时按原 command ID 重试。UI 草稿及瞬时来源的字节由适配器恢复。清理已发布原件的接口、设备范围与显式确认条件见[原件生命周期](../../docs/development/beta-original-lifecycle.md)。

## schema 1 → 2

在 `BEGIN IMMEDIATE` 排除其他写入后，用独立只读 source 执行 SQLite online backup，包含尚在 WAL 的事实；不简单复制主数据库。备份位于 `backups/schema-1-<UUID>.sqlite3`，新建不覆盖。备份自身 checkpoint 后固定 DELETE journal 模式，确保单个主文件可独立恢复，不能依赖旁边的 WAL/SHM。升级前检查备份 application/schema、integrity 以及四张旧业务表的逐字段摘要。备份或检查失败则不迁移；备份残留保留以供显式检查。随后事务建立新表与 trigger 并推进 user_version；不自动从备份覆盖恢复。回归实际只复制这个主备份到另一合成 root，重新打开后逐项核对身份、档案、完整事件 payload 与原 receipt。

未知 schema、外来数据库和符号链接拒绝；backups 目录及条目有明确白名单。Host 需递归按真实类型设置权限，不能把目录当普通文件设置权限。旧二进制不能降级写升级后的 schema；备份恢复需先到独立 root 验证，不能让两个实例共享同一写入身份。

```powershell
cargo test -p exomind-core --locked -j 1
cargo fmt --package exomind-core -- --check
```

测试只用合成临时目录；触发器故障注入检查真实事务回滚，两独立连接并发重试检查 SQLite 边界。未进行断电/存储设备故障试验，不宣称掉电安全认证。

原件新增回归包含真实 `SQLITE_FULL`（pager max_page_count）和 SQLite query_only 写拒绝、同长度 SQL 坏件检测、独立连接并发块、固定整组事务、取消/旧 proof、带 WAL 的旧格式备份、子进程实际强杀四个持久化边界。query_only 不等同 Windows ACL 拒绝，SQLITE_FULL 不等同实际卷空间耗尽；OS ACL、卷满和物理断电需分别验收。

实际旧 CLI 兼容测试默认 ignored，需要显式提供父代理保留的、SHA-256 固定的 schema-1 二进制，不复制到源码。它让该 CLI 初始化独立临时 Host root，再升级 Core 并确认旧 CLI 拒绝启动且 Core/backup 字节不变：

```powershell
$env:EXOMIND_SCHEMA1_CLI = '<actual retained schema-1 executable>'
cargo test -p exomind-core --locked -j 1 --test original_migration actual_schema_one_cli_rejects_an_upgraded_root -- --ignored
```

本次实现的完整测试与宿主验收由父代理串行执行；源码静态收尾不代表这些新增用例已经全部通过。

数据目录允许 SQLite 自己的 WAL/SHM 与 rollback journal；所有这些项仍拒绝符号链接。首次切换 WAL 之前或恢复过程中崩溃留下的合法 journal，交由 SQLite 恢复，不按“外来文件”拦住。子进程回归实际使用 DELETE journal、小页缓存和未提交事务制造 spill，确认热 journal 头后中断进程；恢复后原身份、记录和回执保留，未提交数据消失。这是进程中断恢复证据，仍不等同物理掉电测试。

恢复拒绝边界：全新空 root 可以初始化；已有 backups/WAL/SHM/journal 而主库丢失、已有空白主库或未完成的 schema-0 库不能变成新身份，返回 `RecoveryRequired`。不自动从备份覆盖主库。合法主库仍交给 SQLite 恢复真实 hot journal。宿主可用 `open_bound(root, expected_device)` 在 journal 恢复后、迁移前核验持久设备绑定，换库失败不会先迁移另一设备的数据。无历史证据的旧半初始化目录若不能证明完整初始化，应保留现场并显式处理。

## B1.3 typed 时间块与完整时间线

schema 3 新增开始/暂停/恢复/轮转/行动结束/反馈等 typed 节点及私有 Scheduler deadline，合同见 [TIMEBLOCK-CONTRACT.md](TIMEBLOCK-CONTRACT.md)。human 控制，agent_note 不自动获得控制权；ClockStamp/SchedulerContext 无 serde 来源入口。稳定 request+caller 先回读幂等，server now 不进 request 摘要；Rotate 为单个稳定复合事实，节点/状态/deadline 与 Receipt 同事务。原 capture/1 与 capture/2 canonical、原件 byte/hash、旧 Receipt 不重写。

`timeline_page` 是完整 typed 流，capture 与 timeblock 共用同一 events 序号、高水位及冻结分页。旧 `events/events_page` 仅保留 capture-only 兼容投影，timeblock_nodes 只是事件索引，不是另一份事实；不能把旧接口返回当作全量覆盖。

在 schema 3 阶段，新库直接初始化为 3。旧 schema 1/2 升级前完整备份入口版本的所有表，包括原件块、引用、layout、事实和回执。备份固定为 DELETE journal 模式并校验单文件恢复。布局缺失、缺库、换库的恢复约束继续生效。当前新库的版本取自本页开头的 `CORE_SCHEMA_VERSION`。

## schema 5：保留本机已接受的计时意图

deadline 的稳定身份是本机已接受的 Start/Rotate/Resume 事件 ID，而不是合并后可变化的投影计数。私有 deadline 行保存该 `run_event_id`，继续保留原 due、command/event/deadline ID 与 owner generation。导入缺少父节点时只暂停该档案的到点资格；独立档案仍可计时。父节点补齐后，同一本机 run 恢复资格并重绑当前投影 generation，不重算原 due。显式撤销、已结束或另一个 run 不会复活，远端 run 不会在接收端产生调度意图。倒计时剩余量也读取这个既定 due，而不被新到历史中的 work 计算改写。

新到点事实使用 `run_deadline_reached`，按稳定 run ID 和来源设备判断是否仍适用。旧 `deadline_reached` 的字段顺序与 canonical 字节保持原样可读。schema 5 的协商阻止不理解该变体的旧 peer 写入；本机请求回执不随远端事实复制。

真实 schema4 升级先备份完整 4，再严格对照旧 raw DAG、已接受命令回执、缓存/时钟和 owner 绑定 pending run；无法证明时拒绝恢复，不猜测绑定。旧非 pending 行可没有 run 绑定，且不能重新获得资格。旧 1/2/3 一次事务升级到 5，只备份入口已提交版本，不为未提交的中间 4 创建伪备份。旧原件、事实、回执与 origin epoch/head/cursor不重置。

`tests/schema5_migration.rs` 的真实旧4专项通过 `EXOMIND_SCHEMA4_FIXTURE` 指向保留的独立 Core4 seed/probe。验证旧 Start 与暂停/恢复后的 pending hard deadline、完整字节、原回执及源链；核对单文件 schema4 备份可被旧程序打开，并在旧程序拒绝新5后检查数据未改。它是旧源码独立依赖锁的实际夹具，不冒称精确发布候选。源码仅经格式与静态复核，运行结果由父代理有限监督串行记录。
