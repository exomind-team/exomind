# Beta 多来源复制合同

> 多来源复制合同始于 Core8／Host auth5。β27 采用 Core11、Host auth7 和 `exomind-peer-sync/2`。本文解释事件、投影、来源证明与原件的各项结果。按[版本状态](../AI-CONTEXT.md)找到对应制品和设备验证。[B1a 连接配置与实际选路边界](../plans/2026-11-22-beta26-b1a-connection-store.md)

## 要解决的缺口

A 与 B 共同操作一个时间块后，A 已保存 B 的父节点。若 C 只连接 A，而 A 只导出自己的 origin，C 会收到子节点却缺 B 的父节点。同步界面仅看 A 自身游标也会漏掉 A 刚从 B 收到的更新。关联 `8d49542c`、`68e5bd54`、`ac1dcc95`、`90d8bd80`；隔离案例不是现场手机数据库的唯一根因证明。

复制单位是 P 中各来源的不可变规范事实及其位置链，不是接收设备重新发表的记录。导入不创建接收端的 human 回执，不改原 event ID、作者、digest 或原件引用。

## 权限与真实性分开核验

| 层 | 负责什么 | 不能证明什么 |
| --- | --- | --- |
| 当前 TLS / `PeerProfileScope` | 当前载体的 pin、P、runtime、channel、双方成员代次及能力；每次 Core/ACK 操作重核 | 第三来源的作者身份、原件到达 |
| 载体历史背书 `SourceOffer` | 当前有 P 追加能力的成员，明确为它持有的来源 key、epoch、已物化 head 和可提供证明的 head 背书 | 新设备成员、owner、Agent grant、全局身份或原作者在线 |
| 原作者位置签名 | 原作者 key 对每个位置以及 frozen head 独立签名 | P 网络成员资格；只签最终 head 也不足以安全提交中间页 |
| Core 导入事务 | 规范字节/digest、链连续、epoch、重放、引用、事实与游标/证明原子提交 | 远端原件字节已保存 |

接收端首次接受来源 key 的依据是当前 P 追加成员的显式背书与原作者签名，属于 P 内的历史数据信任，不是全局公钥 PKI。已固定来源 key 不可被后来的背书替换；本机已知成员的 pin、能力、pending/revoked 状态优先检查。既有撤销不能由另一个载体转发旧签名绕过。已经保存的事实继续保留。

发送仍要求 `local.append_facts && remote.read_timeline`，接收要求 `local.read_timeline && remote.append_facts`。来源历史不创建配对/邀请/凭据；外部 Agent 的档案 grant 不变，设备邀请不能充当 observer token。原件读取能力另行核验。

关键代码：[来源背书和最终资格](../../crates/exomind-beta-host/src/peers/source_history.rs)、[原作者签名](../../crates/exomind-beta-host/src/peers/origin_proof.rs)、[channel/成员围栏](../../crates/exomind-beta-host/src/peers/authorization.rs)。

## 两种游标

接收端的 data cursor 表示事实已经落库，verified-prefix 表示逐位置证明已保留。旧 Core7 历史可能为 `data=N, verified=0, proofs_present=false`，不能把它当作已认证的空源或全量完整。

回补从 verified-prefix 开始。Core 会重新核对已存在事实的规范字节，但不重复造事实或回执；data ACK 可以继续为 N，证明前缀逐页推进。空来源也须一次性保存原作者签名的 genesis 和 accepted epoch，之后无变化不反复导入空页。

Core8 将公开来源 key、位置证明、verified-prefix 与事实/data cursor 放入同一 SQLite 事务。证明写失败、key 冲突、证明空洞、错 epoch、非法引用或正文冲突会回滚整个页。Host 的私钥和成员/授权仍在私有存储，不进入 Core 的公开来源表。Core7 升级先保护性备份，旧 rowid/值/BLOB/回执保持；同版坏 schema 不静默重建。

关键代码：[证明存储与受信任上下文](../../crates/exomind-core/src/replication/provenance.rs)、[同事务导入](../../crates/exomind-core/src/replication/ingest.rs)、[迁移](../../crates/exomind-core/src/migrations.rs)。

## 会话、预算与 ACK

每端冻结本次来源目录，独立报告可传来源与缺证明来源；接收端自己的 origin 不经载体回送。缺证明、预算耗尽或断线不会被当作完整。实际事实页沿用现有规范校验，载体不为第三方事实重新署名。

目录有 256 来源上限，超限明确失败而非静默截断；每页最多 100 条，字节和有限会话截止另有限制。两个方向各共用 `max_pages` 总预算，按已验证前缀进度分配来源，避免固定首来源持续增长时饿死后续来源。大原件仍走独立队列。

ACK 按 P / 原始来源 device+epoch / 目标 device 持久保存，并经当前资格门验证真实前缀。服务端在发送目录前捕获会话基线，逐页回复前另捕获 RPC 基线；推送端在查询游标/发送页之前捕获对应基线。并发新 ACK 不得把早已发出的旧请求误判为回滚；全局高水位只增，新会话仍拒绝回退已持久确认的游标。不能通过清库、降游标或替换 epoch 假装恢复。

关键代码：[sync/2 会话](../../crates/exomind-beta-host/src/peers/multi_sync.rs)、[ACK 存储](../../crates/exomind-beta-host/src/peers/sync_store.rs)。

## 闲置判变与完整度

闲置 memo/probe 比较整个 P 的来源 head 和 verified-head 指纹，并检查当前成员代次与 peer runtime；缺少指纹不命中旧缓存。指纹只用于决定是否补齐，不可代替签名、事实 ACK 或授权。它在目录冻结时记录；传输中新到事实会使下一次探测失配，而不会被误计为已经发送。

`origin_inventory` 使用有界、按来源排序的元数据查询，检查 head/proof endpoint、签名长度及 key 元数据的存在；不读取事实正文或原件。Native 闲置路径不为判变解码末条正文，也不提高原有轮询频率。实际资源收益仍需同候选真机测量。

以下结果分别解释，不能合并成一个“已同步”承诺：

- `events_complete`：本次冻结目录的事实及证明补齐结果。
- `local/peer_projection_complete`：时间块父节点及投影是否可解释。
- `local/peer_missing_originals`：引用原件是否仍缺；原件传输还须独立字节/hash验收。

关键代码：[元数据 inventory](../../crates/exomind-core/src/replication/origin.rs)、[Native memo/probe](../../crates/exomind-beta-host/src/peers/network.rs)、[服务探测](../../crates/exomind-beta-host/src/peers/service.rs)。

## 回归与边界

[Host 同步案例](../../crates/exomind-beta-host/src/peers/synchronization_tests.rs)覆盖三端共同操作、历史补签、空源代次、错 P/key/载体、撤销、丢 ACK/重启、小页预算饥饿及并发 ACK 基线。[Native controller 案例](../../crates/exomind-beta-host/src/peers/network_tests.rs)分别覆盖局域网自动路由、无发现提示时任一端收到第三来源更新，以及无变化保留轻量 probe。[Core 案例](../../crates/exomind-core/tests/origin_provenance.rs)覆盖事务失败、重启、scope 与仅补证明的元数据判变。

这些测试不能替代同版 Windows/Android、新旧记录及真实原件矩阵；也不覆盖 UI 黑影的全部报告、能耗根因或未来遥测。Core8/sync2 未完成旧版兼容回退；候选必须按精确源码和版本成组核对。
