# Beta Host

这是独立 Rust Beta Core 的宿主和传输适配器，不创建旧 Runtime、旧 `AppState` 或兼容写入路径。当前实现档案管理、按档案授权、文字/原件整组提交、分页/搜索和稳定回执；时间块、peer 同步与模型仍属于后续批次。

```powershell
cargo run -p exomind-beta-host --bin exomind-beta -- --data-dir <新的绝对独立目录> --port 0
# 独立 Web 前端必须显式列入允许的 loopback origin；可重复指定。
cargo run -p exomind-beta-host --bin exomind-beta -- --data-dir <新的绝对独立目录> --port 0 --frontend-origin http://localhost:1420
```

CLI 不打开浏览器，不打印 token 或带凭据 URL。实际地址写入私有 `connection.beta.json` 的 `url`；owner token 只在该描述符中持久化，不能加入源码、日志或外发材料。显式 data root 下保存 `core/`、宿主授权库和 OS 持有的 SQLite 锁库；第二个 Host 拒绝同一 root，不依据 PID 文件抢占或清理进程。退出通过 Ctrl+C 停止自有 listener 和 Core。

Unix 使用私有目录/文件权限；Windows 实际设置受保护、当前用户 FullControl 的 DACL，测试会读取 ACL 验证，不把 `chmod` 当成 Windows 认证。该隔离依赖 OS，不防同一登录用户的恶意代码或管理员接管。未宣称物理掉电安全。

## 共享 Facade

`BetaHost` 持有一个 Core；所有真实提交、撤销、停机都经过同一资格 gate。`Session` 是不可由请求体反序列化的私有能力，绑定当前宿主运行代次，每次操作重新检查撤销状态和档案范围。停机后旧排队工作不能提交，重启后的旧 Session 无效；相同持久 token 可以重新认证取得新 Session。

`request_stop()` 是原生关闭回调可立即调用的非阻塞准入围栏，status 随即不再显示 running；后续取得 gate 的新工作与晚到 listener 启动均被拒绝。此前已经取得资格并进入 gate 的事务可以完成，`stop()` 等待它并清理资源，`RunningServer.stop().await` 再确认自有 listener 退出。不能把等待异步关闭任务开始之前的窗口当成已停止准入。

原件 hash 不占上述 gate：`verify_stage` 在 gate 内冻结 stage 并登记自有工作，使用 Core 私有 ticket 在独立只读连接中分块校验，再进 gate 重验运行代次、当前授权和 stage generation 后 seal。最多同时四项验证；撤销对应 grant 会取消其验证。停止先取消，再在 gate 外最多等待五秒；尚有自有验证未退出时返回关闭错误并保留 Core/root 锁，不把旧只读连接遗留给新 Host。私有 proof 不经 HTTP 或 IPC 反序列化。

可信 Tauri 代码可调用 `owner_session()`，再通过 `native_human_session(owner, profile)` 获取本机 UI 写会话；这些工厂不能映射为匿名 HTTP/任意 WebView 作者选择。HTTP 和未来 IPC 都调用同一组 `profiles/provision_profile/grant/revoke_grant/capture/events_page/receipt/stop`，不会另养一份业务真相。

## HTTP

默认只绑定 loopback。Host header 必须是实际监听地址（或对应 localhost:port），Origin 默认只允许监听器本身的源。显式前端 origin 仅接受无路径、凭据、query、fragment 的 loopback HTTP 源；CORS/OPTIONS 精确匹配，不反射其他源，也不放宽 Host。Vite 代理需要把 Host 改写为目标监听地址。HTTP 的 SQLite 工作在 `spawn_blocking` 执行，最终资格检查在同步 gate 内，而非只在 await 前检查。

除最小 `GET /beta/v1/hello`，其余路由都要求 `Authorization: Bearer <token>`：

| 路由 | 凭据与语义 |
|---|---|
| `GET /beta/v1/profiles` | owner，列档案 |
| `PUT /beta/v1/profiles/{uuid}` `{name}` | owner，稳定 UUID 幂等创建；同 UUID 异名冲突 |
| `POST /beta/v1/grants` `{profile_id,kind,agent_id?}` | owner；kind 为 observer/human/agent_note；agent_note 必须有 agent_id，其他类别不允许冒领 agent_id |
| `DELETE /beta/v1/grants/{uuid}` | owner，撤销已签发能力 |
| `POST /beta/v1/capture` | profile human/agent_note，输入为 Core `CaptureCommand`；不能自报作者 |
| `GET /beta/v1/profiles/{uuid}/events?before=&through=&limit=&q=` | 同档案 grant，冻结 highwater 的分页与字面搜索 |
| `GET /beta/v1/profiles/{uuid}/receipts/{command_uuid}` | 同档案 grant，回读原回执；未知为 404 |
| `PUT /beta/v1/profiles/{uuid}/stages/{stage_uuid}` | creator writer，元数据 `{original_id,expected_sha256,byte_length,file_name,media_type}`；同 stage 同元数据幂等 |
| `GET /beta/v1/profiles/{uuid}/stages/{stage_uuid}` | creator writer，回读私有 stage 状态与确认 offset |
| `PUT /beta/v1/profiles/{uuid}/stages/{stage_uuid}/chunks?offset=` | creator writer，`application/octet-stream` 二进制块，最多 256 KiB；相同块重试幂等，冲突拒绝 |
| `POST /beta/v1/profiles/{uuid}/stages/{stage_uuid}/verify` | creator writer，冻结、hash、重新授权 seal；返回 StageStatus |
| `GET /beta/v1/profiles/{uuid}/stages/{stage_uuid}/bytes?offset=&length=` | creator writer，预览已暂存原始字节；状态尚未 verified 时不是真实性声明 |
| `GET /beta/v1/profiles/{uuid}/originals/{original_uuid}/bytes?offset=&length=` | 同档案读 grant；必须已有本档案事实引用，UUID/hash 不是读取凭据 |

owner 不是隐式 human writer，必须先签发档案能力。observer 不能写，普通接入不能自行选 human；作者由已认证 grant 映射。签发 token 仅在响应中返回一次，授权库存 hash；撤销持久保留。body 有 1 MiB 上界，未知字段/作者字段拒绝；错误为 `{error:{code,message}}`，不回显正文、token、原始 SQLite 或文件路径错误。

hello 的 `capabilities` 声明 `originals: true` 与 `max_original_chunk_bytes: 262144`。原件读取是有界查询，不采用整文件/base64 body；length 必须为 1…262144，响应为二进制且 `Cache-Control: no-store`。stage 的状态、元数据和字节均为作者私有草稿，observer 即使可读档案事实也不可读 stage。verified 尚未被事实引用时仍保持私有；坏 hash 保留原字节供查证，不能自动转为可引用原件。

CaptureCommand 可携带稳定有序的 `originals` 元数据组；任一成员未 verified 时整个事实与回执均不提交。省略或留空 originals 保留既有纯文字路径。原件原始字节、长度、hash 与事实引用均以 Core SQLite 为权威，不由传输层猜测。

首次启动先完整写入并原子替换私有描述符，再提交 owner hash；中断后复用已持久化 token。已有 owner hash 而描述符缺失/损坏时拒绝启动，不静默轮换权限。宿主 schema 当前为 1，Core schema 独立校验，不猜测迁移或覆盖旧库。

Core 自行处理 schema-1 到 schema-2 的备份迁移；宿主在打开前拒绝 core 树内 symlink/reparse point，并在 Core 完成所有权校验后按真实文件/目录递归应用私有权限，包括 `core/backups/`。这不会读取或导入 0.5/Alpha 的业务库。

成功打开 Core 后，auth schema-1 内兼容新增的 `core_binding` 表持久绑定 device；后续通过 `Core::open_bound` 在迁移前核验，不自动重绑替换库。已有 owner/初始化证据而 Core 主库或 auth 库丢失/空白时拒绝重新创建，CLI/HTTP 明确报告 `recovery_required`；备份不自动恢复或覆盖。旧 Host 的合法现存 Core 可在首次升级时建立绑定；已有 owner 却没有合法 Core 的半初始化现场需显式恢复。描述符已存但首次 owner 插入失败、且从未创建 Core 的状态仍可复用原凭据完成初始化。

## 验证边界

```powershell
cargo test -p exomind-beta-host --offline -j 1 -- --test-threads=1
```

测试使用全新合成目录、真实 Axum HTTP 与 SQLite，覆盖鉴权、档案隔离、来源、回执重试、重启、根目录互斥、撤销/stop 晚提交、Host/Origin/CORS、请求体上界和凭据初始化失败恢复。另有真实 `exomind-beta` 子进程验收：通过 HTTP 建档、签发能力和提交，随后只对自己创建的 Child 强制终止并 wait，再验证 root 锁释放、身份/凭据/事件与回执恢复。这证明进程崩溃恢复，不是物理掉电保证。Windows ACL 案例只在 Windows 执行；使用 WinPS5.1 的 .NET ACL API，避免跨版本 PSModulePath 导致 `Get-Acl` 模块自动加载失败。源代码和这些测试不等于正式 Tauri UI、Android 本机、跨设备同步或真实模型已验收；具体执行结果由主代理保存。
