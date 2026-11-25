# 0.6 Beta Host

`exomind-beta-host` 将本机 Core 暴露给独立的 `exomind-beta` 服务、可信 Native 窗口和已授权 peer。Host 判定一个调用者能否在指定档案上执行操作。Core 在同一 SQLite 事务中保存事实和本机命令回执。追踪一条记录可从 `BetaHost::capture` 读到 `Core::submit`。[Host 实现](src/lib.rs) · [Core 提交](../exomind-core/src/store.rs) · [架构导览](../../docs/architecture/README.md)

## 在隔离档案上启动

按[开发快速上手](../../docs/development/quickstart.md)创建独立的绝对数据根。`--port 0` 由系统分配空闲端口，独立 Web 前端用 `--frontend-origin` 指定精确的 loopback HTTP 源。CLI 在终端显示实际监听地址。`Ctrl+C` 关闭该实例。Native 通过 Rust 直接调用 Host，同一应用内的主窗和浮窗各自访问 Native 工作区。[CLI 入口](src/main.rs) · [Native 工作区](../../docs/development/beta-native-workspace.md)

同一根只允许一个 Host 持锁。私有 `connection.beta.json` 保存本机管理凭据与服务地址，授权库存 token hash 和撤销状态。已有身份的根如果缺库、凭据受损或换入另一设备的 Core，应保留现场，按恢复错误查证。重启同一根后，尚有效的持久 grant 可重新认证取得新 `Session`。`runtime_id` 随进程变化。描述符和 Agent handoff 都只在授权环境内交付。[存储与身份绑定](src/storage.rs) · [进程重启与恢复测试](tests/recovery.rs)

## 谁能执行什么

| 调用者 | 作用域与操作 |
|---|---|
| 本机 owner | 列出或创建档案、签发和撤销 grant、管理模型配置。可信 Native 可为本机用户取得指定档案的 Human 会话。 |
| `human` | 读取本档案，写人类记录与更正、暂存原件、控制时间块和回顾。 |
| `observer` | 读取本档案的已公开记录、回执和已发布原件，使用有界等待与 bundle。 |
| `agent_note` | 同档案读取，另可用绑定的 Agent 身份暂存原件、追加 Agent Note。 |
| `summary_producer` | 同档案读取，另可用绑定的 Agent 身份和有据可查的来源追加外部回顾。 |
| 设备成员 | 通过 peer 通道，按档案、密钥、成员代次与能力复制。邀请和来源证明属于这条通道。 |

HTTP `hello` 给出协议、设备和当前运行实例。`access/check` 用实际 bearer 核验档案，返回 `grant_kind`、适用的 `agent_id` 与 `allowed`。Native handoff 含 `grant_id`，此字段的来源是签发材料。要求的能力缺失时，Host 返回 403。真正读取或提交时，Host 再次检查资格。[作用域与能力](src/agent_access.rs) · [Native 签发与撤销](../../docs/development/beta-agent-grants.md)

## HTTP 路由速查

下表省略前缀 `/beta/v1`，`P` 是授权档案的 UUID。`GET /hello` 提供最小发现信息。业务请求使用 Bearer 凭据。HTTP listener 只接受 loopback，浏览器另按实际 Host header 和已允许的精确 Origin 检查。[路由装配](src/http.rs)

| 操作 | 方法与路径 | 接收结果或适用范围 |
|---|---|---|
| 管理档案与授权 | `GET /profiles`、`PUT /profiles/P`、`POST /grants`、`DELETE /grants/{id}` | owner。签发 `agent_note` 或 `summary_producer` 时绑定 Agent ID。 |
| 预检档案授权 | `POST /profiles/P/access/check` | 请求体中的 `required` 指定这次业务所需能力。 |
| 发送及查证 | `POST /capture`、`GET /profiles/P/receipts/{command}` | Human 或 Agent Note 角色写入。原命令的本机回执可由同档案读 grant 查证，未找到回执返回 404。 |
| 读历史与更正 | `GET /profiles/P/timeline`、`GET /profiles/P/timeline/events/{event}`、`GET /profiles/P/events`、`GET /profiles/P/corrections` | `timeline` 提供 capture、时间块与两类摘要。`events` 是 capture 视图。更正另有分页和精确读取。`POST /profiles/P/corrections` 限 Human。 |
| 时间块与回顾 | `GET /profiles/P/timeblocks/current`、`GET /profiles/P/timeblocks/recent`、`POST /profiles/P/timeblocks/commands`、`GET /profiles/P/summaries/tasks`、`POST /profiles/P/external-summaries` | 时间块控制限 Human，外部摘要追加限 producer。节点、区间、回顾控制与结果的其余入口见[时间块路由](src/timeblocks_http.rs)、[回顾路由](src/summary_jobs_http.rs)和[外部回顾](src/external_summaries_http.rs)。 |
| 等变化、取 bundle | `POST /profiles/P/wait`、`POST /profiles/P/export-bundle` | 等待返回高水位。bundle 声明所含类型、完成范围与后续游标。[等待与 bundle 合同](../../docs/development/beta-agent-read-tools.md) |
| 暂存和读取原件 | `PUT` / `GET /profiles/P/stages/{stage}`、`PUT …/chunks?offset=`、`POST …/verify`、`GET …/bytes?offset=&length=`、`GET /profiles/P/originals/{id}/bytes?offset=&length=` | 暂存和暂存预览归创建作者。读已发布原件须有同档案事实引用及可读字节，单次最多 256 KiB。[原件路由](src/originals_http.rs) |

首个历史页给出本副本的 `highwater`。后续页固定 `through`，按该 feed 的 `before` 读完。写入结果未知时，保留原 `command_id`，查回执后用 `event_id` 核对实际记录。跨端结论另看目标副本对该来源的 ACK。带原件的记录还需在目标端读到字节、核对长度与 SHA-256。[读取合同](../../docs/development/beta-core11-history-and-review.md) · [复制合同](../../docs/development/beta-multiorigin-sync.md)

## 后台作业和恢复

- `request_stop()` 立即停止接纳新工作。`stop()` 等待已经取得资格的工作并释放资源。原件校验在资格检查之外分块计算 hash，返回时复核运行代次、stage generation、授权与撤销。整组原件通过验证后，`capture` 才能提交。[Host](src/lib.rs) · [原件测试](tests/originals.rs)
- Host 的 Scheduler 接手已接受的本机计时意图。原生声音和系统通知由对应平台交付。内部回顾 worker 只为已启用相应模型配置的档案发起请求，外部 producer 的追加另由自己的授权结算。[时间块测试](tests/timeblocks.rs) · [回顾 worker](src/summary_jobs.rs) · [材料与同意](../../docs/development/beta-summary-originals.md)
- β27 使用 Core11、Host auth7 和多来源复制协议 `exomind-peer-sync/2`。Native 已接入首配，peer 服务负责发现、重连、来源复制和原件传输。B1a 保存连接配置及本端启停，实际 worker 从档案／设备路由选拨号地址。定位「停用后是否还会拨」时检查实际拨号，定位「可以关闭源设备了吗」时检查接收端已持有的事实和原件。[peer 维护图](src/peers/README.md) · [连接配置范围](../../docs/plans/2026-11-22-beta26-b1a-connection-store.md)

## 验证

从仓库根运行 `cargo test --locked -p exomind-beta-host --test host real_http_authentication_scope_author_and_receipts`，使用合成档案、真实 loopback HTTP 与 SQLite 检查角色、提交及回读。按问题另选[授权](tests/agent_access.rs)、[外部回顾](tests/external_summaries.rs)、[Native 工作区](tests/native_workspace.rs)或[网络回归](src/peers/network_tests.rs)。精确制品与目标设备的结果在[版本状态](../../docs/AI-CONTEXT.md)查阅。早期 auth2、单邀请 TLS 与直接来源阶段的详细设计保存在[旧版 Host 手册](https://github.com/exomind-team/exomind/blob/4a241cebe19078305e751cc4293db98ae9a90f7d/crates/exomind-beta-host/README.md)。
