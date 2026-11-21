# Beta26 B1a：外心环境与连接持久层

> 状态：实现与定向源码验证完成（2026-11-22）；不代表 Beta26 候选或设备验收通过。
> 上游设计：[Beta26 外心环境与多连接设计](2026-11-21-beta26-environments-connections-design.md)

## 本轮目标

先建立用户可见、可恢复的环境与连接真值，不切换现有同步选路：

- 一个远端环境由稳定 `device_id` 标识；
- 同一对设备可保存多条连接；
- 每条连接有独立本端启停、端点顺序、最近测试和 revision；
- 远端启停是带观察时间的可空三态，不能由超时、广播或本端关闭推导；
- 现有 `peer_network_routes` 继续作为 B1a 同步拨号来源，迁移不改写它。
- 新的、经过验证的成员与路由写入会在同一 Host auth 事务里刷新环境/legacy 连接投影，避免本地列表停留在迁移时的快照。

环境、连接、档案成员和授权仍是四层不同事实。建立连接不会产生 membership、
grant、profile 访问或“已验证在线”。

## v7 数据模型

Host auth schema 从 v6 升级到 v7，并在一个事务中：

1. 验证 v6 全部布局；
2. 创建 `peer_environments`、`peer_connections`、
   `peer_connection_endpoints`；
3. 从已验证成员和有界旧路由生成环境与 `legacy` 连接；
4. 验证新布局后在提交前写入 `user_version=7`。

`peer_environments` 只保存 `device_id` 与本机记录时间。显示名称继续来自
pin 绑定的 alias claim，不在环境表中复制身份或授权。

`peer_connections` 保存稳定连接 ID、远端设备、连接类型、本端开关、可空远端
观察值及观察时间、端点首选项、测试状态、成功/错误时间、revision 与记录时间。
迁移连接默认：

- `kind=legacy`
- `local_enabled=true`
- `remote_enabled_observed=NULL`
- `last_test_state=untested`

`peer_connection_endpoints` 按连接保存有序、去重端点。普通连接最多 8 个端点；迁移
legacy 连接最多 2048 个端点（256 条旧路由 × 每条 8 个），可保守合并旧档案级路由，
但不得把该历史并集转成新的拨号扇出。

## 上限与恢复

- 环境：最多 512；
- 连接：最多 4096；
- endpoint：最多 32768；
- 新写入单连接普通端点：最多 8；
- 所有 UUID、设备 ID、pin、SocketAddr、枚举、时间、revision 和文本长度在
  解码进 Rust 大对象前检查。

坏 UUID、损坏 JSON、端点、弱 DDL、部分新表或越界计数必须 fail closed。迁移
中途 DDL 失败必须回滚，旧 v6 的成员、邀请、alias、路由和设置保持可读。

## Host 边界

B1a 提供 Owner 级环境/连接读取与本端连接开关 CAS 写入。改变本端开关不会撤销
membership；修改远端观察状态只允许 Host 内部在 pin、设备 ID、协议与连接证据
都核验后写入，不通过普通 UI/Native 命令直接赋值。

连接启用与全局网络开关分别展示。未来生效条件至少包含“全局网络允许且这条连接的
本端开启”；远端未知时不能显示为远端开启或关闭。

## 一键邀请口径

用户已确认的目标交互：

1. 邀请方在档案内定点选择已发现环境并点击“邀请”；这次点击就是发送方确认并立即定点发送。
2. 接收方收到“设备 X 邀请你加入档案 Y，是否加入？”的可核对邀请弹层；点击“确认加入”就是接收方授权，Host 随后自动执行 claim、成员确认和首次同步，不需要用户复制邀请、输入配对码、手填地址或再次确认连接地址。
3. 投递连接只负责将 proposal 送达。TLS pin、邀请签名、协议/schema、目标设备、
   档案 membership 和代次仍按原安全边界核验。
4. 自动投递失败时必须保留单次签发邀请，提供重试与旧版文本邀请退路；不能重复
   消耗 secret，也不能把“未确认送达”显示成成功。
5. 接收方关闭弹层只表示稍后处理；拒绝、过期、不可达、成员已接受和首次同步
   完成必须是不同状态。

该流程在 B1a 连接稳定对象之后实现；B1a 不提前创建尚未定型的邀请投递表。

## 验收边界

B1a 通过条件包括 v1–v7 升级链、v6→v7 保值/回滚、旧 route 归并、三态远端状态、
CAS revision、上限、损坏恢复和 Owner/grant 隔离。B1a 源码通过不代表：

- 新连接已经用于实际同步选路；
- 一键邀请已经实现；
- Windows/Android 真机连接矩阵通过；
- Beta26 候选或完整 Beta 通过。

源码验证记录：连接存储回归 **18/18**；旧 auth1–4 升级、auth5→v7 迁移与受控
HostClock 过期回归分别重跑通过；Beta-only Tauri 检查、Host 检查、TypeScript
检查和 `git diff --check` 通过。完整 Host 串行套件首轮为 309 passed、1 failed、
2 ignored；唯一失败来自 auth1–4 测试夹具未删除新加的 v7 表，已修夹具并单独重跑
该迁移用例通过。完整套件未在夹具修正后重跑。
