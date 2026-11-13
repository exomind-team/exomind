# Beta 本机提交核心

维护源为本 crate，正式实现使用 Rust + SQLite。它不导入或修改旧 Runtime 的数据，不启动旧 `AppState`、Mesh、Signal、任务域或模型。宿主必须传入绝对且独立的目录；非空外来目录、未知 schema 和坏库会报错，不换用 JSON 或内存。

当前实现：随机 UUID 档案和设备身份；文字/标签及固定整组原件 capture；不可覆盖事件；命令与持久回执同事务；同请求重试；作用域与作者绑定；读回记录和回执。`local_seq` 表达本机提交顺序，事件的 `occurred_at_ms` 保留原始时间。

`local_human` / `local_agent` 是**受信宿主的本机管理权限**，不是身份认证端点。`WriterContext` 不可反序列化，命令不能携带作者身份。将来 HTTP/IPC 适配器必须先完成真实鉴权及当前档案能力校验，两者调用同一个 `Arc<Core>`，不能把这些管理工厂直接映射成外部请求。旧 context 在另一个 Core 生命周期无效。

首次提交在 `BEGIN IMMEDIATE` 内写入事件和完整回执；唯一约束与 SQLite 锁覆盖不同连接。返回回执之后没有另一个可失败写入动作；通知由宿主负责，不能改变已提交结果。相同事件事实可以在新命令下引用同一序号，同事件 ID 的异内容及同命令 ID 的异请求都拒绝。

档案管理提供 `profiles` 与 `provision_profile`：列表按显示名与 UUID 稳定排序，同 UUID/同名创建重试返回原对象，异名明确冲突，不能改名覆盖。它们属于受信宿主管理能力，不是匿名档案发现接口。

`events_page` 提供 1–100 条的本机序号倒序分页，默认100条；`before` 严格小于且必须为正，不能超过本次快照上界加1。首个响应的 `highwater` 是当前档案的最大本机序号，后续请求以 `through` 冻结它；空快照上界为0。未来快照和越界游标显式拒绝，空页是成功响应。`search` 对原始正文执行区分大小写的字面子串搜索，中文、`%`、`_`、引号不被解释为 SQL 通配或语法；空搜索串等同匹配全部。读取错误不会改为空页。

HTTP、Tauri、React 由独立 Host/Native/UI 适配器接入，本 crate 不持有外部 token。时间块、复制、模型任务和回收按 Beta 计划继续，不以本机单元测试代替端到端验收。固定格式 capture 的规范化由 Rust 权威执行：字段顺序固定、标签排序去重、正文不改写；未实现通用 JSON 数值/媒体内容的跨语言规范化协议。未知 capture 字段在反序列化时拒绝，不静默丢弃作者字段。

## B1.2 原件事务与恢复

schema 2 将暂存分块与 verified 原件保存在同一 SQLite 内，默认每块最多 256 KiB；不沿用 Node 的 64 MiB 总文件上限，长度合同上界为 SQLite 的有符号64位字节位置。单次 capture 的整组上限是 `MAX_CAPTURE_ORIGINALS`，字节读写上限来自 `MAX_ORIGINAL_CHUNK_BYTES`。零长度、未知扩展名、未知媒体类型和任意二进制均可保存；不执行附件、不递归收集播放列表引用资源，不自动向模型发送内容。

传输仍接受任意 1…256 KiB 连续追加，包括一字节写入；物理存储按 256 KiB 对齐 block 合并。只有 uploading 尾 block 可以增长，SQL trigger 要求旧前缀逐字节不变、offset/身份不变、长度增加且不越界；满 block 与冻结 block 不可更新。一次追加最多更新一个尾 block 并插入一个新 block，先核验旧 block hash，新 hash/偏移/generation 同事务。任意已确认子 range 重放仍逐字节比较，部分重叠拒绝。每次有界 range 用精确 block offset 读取，最多涉及两个物理 block，不随原先写入调用次数放大查询数。

本轮 schema 2 尚未发布或用于日用；早期合成实验采用碎片行布局，与固定 block 布局不兼容。现在由 `core_layout` 明确记录布局 revision 与 block 大小；已有 schema 2 缺少或不匹配该标记时返回 `RecoveryRequired`，保留全部字节、事实及回执，不静默重排、清空或重新初始化。

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

重启后可查询已落盘偏移继续上传；frozen 可重新验证；verified 可直接查证；已提交但丢 receipt 按原 command ID 重试。草稿移除和 verified 孤儿物理释放尚未在本单元实现，留给明确的后续生命周期；不自动清理原件、坏件或备份。UI 草稿及瞬时来源的本地字节恢复由适配器负责，不把不可恢复的浏览器 File 对象声明为已暂存。

## schema 1 → 2

在 `BEGIN IMMEDIATE` 排除其他写入后，用独立只读 source 执行 SQLite online backup，包含尚在 WAL 的事实；不简单复制主数据库。备份位于 `backups/schema-1-<UUID>.sqlite3`，新建不覆盖。备份自身 checkpoint 后固定 DELETE journal 模式，确保单个主文件可独立恢复，不能依赖旁边的 WAL/SHM。升级前检查备份 application/schema、integrity 以及四张旧业务表的逐字段摘要。备份或检查失败则不迁移；备份残留保留以供显式检查。随后事务建立新表与 trigger 并推进 user_version；不自动从备份覆盖恢复。回归实际只复制这个主备份到另一合成 root，重新打开后逐项核对身份、档案、完整事件 payload 与原 receipt。

未知 schema、外来数据库和符号链接拒绝；backups 目录及条目有明确白名单。Host 需递归按真实类型设置权限，不能把目录当普通文件设置权限。旧二进制不能降级写 schema 2；备份恢复需先到独立 root 验证，不能让两个实例共享同一写入身份。

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
