# Beta 本机提交核心

维护源为本 crate，正式实现使用 Rust + SQLite。它不导入或修改旧 Runtime 的数据，不启动旧 `AppState`、Mesh、Signal、任务域或模型。宿主必须传入绝对且独立的目录；非空外来目录、未知 schema 和坏库会报错，不换用 JSON 或内存。

当前实现：随机 UUID 档案和设备身份；无附件文字/标签 capture；不可覆盖事件；命令与持久回执同事务；同请求重试；作用域与作者绑定；读回记录和回执。`local_seq` 表达本机提交顺序，事件的 `occurred_at_ms` 保留原始时间。

`local_human` / `local_agent` 是**受信宿主的本机管理权限**，不是身份认证端点。`WriterContext` 不可反序列化，命令不能携带作者身份。将来 HTTP/IPC 适配器必须先完成真实鉴权及当前档案能力校验，两者调用同一个 `Arc<Core>`，不能把这些管理工厂直接映射成外部请求。旧 context 在另一个 Core 生命周期无效。

首次提交在 `BEGIN IMMEDIATE` 内写入事件和完整回执；唯一约束与 SQLite 锁覆盖不同连接。返回回执之后没有另一个可失败写入动作；通知由宿主负责，不能改变已提交结果。相同事件事实可以在新命令下引用同一序号，同事件 ID 的异内容及同命令 ID 的异请求都拒绝。

尚未接入 HTTP、Tauri 或 React；尚未实现外部 token/成员授权、分页、原件、时间块、复制、模型任务和回收。这些按 Beta 计划继续，不以本机单元测试代替端到端验收。当前固定格式 capture 的规范化由 Rust 权威执行：字段顺序固定、标签排序去重、正文不改写；未实现通用 JSON 数值/媒体内容的跨语言规范化协议。未知 capture 字段在反序列化时拒绝，不静默丢弃附件或作者字段。

```powershell
cargo test -p exomind-core --locked -j 1
cargo fmt --package exomind-core -- --check
```

测试只用合成临时目录；触发器故障注入检查真实事务回滚，两独立连接并发重试检查 SQLite 边界。未进行断电/存储设备故障试验，不宣称掉电安全认证。

数据目录允许 SQLite 自己的 WAL/SHM 与 rollback journal；所有这些项仍拒绝符号链接。首次切换 WAL 之前或恢复过程中崩溃留下的合法 journal，交由 SQLite 恢复，不按“外来文件”拦住。子进程回归实际使用 DELETE journal、小页缓存和未提交事务制造 spill，确认热 journal 头后中断进程；恢复后原身份、记录和回执保留，未提交数据消失。这是进程中断恢复证据，仍不等同物理掉电测试。
