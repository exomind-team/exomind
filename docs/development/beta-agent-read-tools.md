# Beta Agent 有界等待与只读 bundle

`exomind-beta/1` 的两个读取接口只作用于当前 grant 的档案。管理 owner
不能代替档案授权；每次读取仍核对撤销与 Host 状态。它们不启动模型。

## 等待档案变化

`POST /beta/v1/profiles/P/wait` 接受 `after_local_seq`、`timeout_ms`。
超时为 1–30000ms；序号高于当前 highwater 或未知字段返回 400。
返回 `changed` 或 `timeout` 和已读到的 highwater，不返回事件正文。
高水位覆盖整个档案序列，命中后须再读取权威事件；它不是任务完成通知。

Host 最多接受四个等待。活动请求每 500ms 查询一次；撤销、停机唤醒请求，
满额返回 429。请求 future 拥有循环和 RAII 名额，取消后释放，没有空闲轮询。
已经进入 blocking worker 的单次读取可能在客户端离场后完成。认证和等待
名额申请沿用 Host gate；timeout 是等待观察截止，不能作为整个 HTTP 调度的硬实时保证。

## 固定快照的 bundle

`POST /beta/v1/profiles/P/export-bundle` 首次固定 `coverage.through`；
续页带回该值和 `coverage.next_before`。`after_local_seq` 是排他下界。
每次最多八页，每页一个 typed fact，最终 JSON 上限 1 MiB。

支持 capture、timeblock、summary、agent_summary；不包含 correction、
original lifecycle 或未来未知 fact kind。响应明确写出支持与排除范围，
`complete` 只表示这个子集已读尽，不表示档案完整备份。预算不足保留游标及原因。

默认只返回所选 facts 直接引用的原件 metadata，最多 256 件。只有请求中显式
选择且属于本次返回事实的原件（最多 16 件）才读取字节；通过 Core generation
permit、范围预算和 SHA-256 校验后附 hex。已释放、未到达、读取中状态变化与
真实零字节原件保持区分，不触发后台下载。hex 的两倍空间计入 JSON 预算。

## 近期时间块摘要

`GET /beta/v1/profiles/P/timeblocks/recent` 提供单次只读摘要，沿用当前
档案的 Bearer grant；它不写入时间块、启动模型、读取原件或改变授权。默认最多
返回 5 个已结束块、扫描 200 个 typed nodes、返回 100 个 interval。查询参数
`limit`、`node_limit`、`interval_limit` 分别限制这三项；有效范围是 1–20、
1–500、1–100，越界返回 400。提高上限会增加本次响应大小与读取成本。

响应中的 `profile_id` 标识档案，`revision` 是 Core 时间块投影 revision，
`highwater` 是节点分页使用的档案 `local_seq` 上限，二者不能互换。读取从当前
snapshot 开始，节点页固定在首个 nodes 响应的 highwater；intervals 固定用该
snapshot 的 `revision` 读取；最后再次读 snapshot 并比较 projection revision。
`coverage.revision_stable` 记录 revision 围栏，`coverage.node_highwater_stable`
单独记录分页 highwater 是否稳定。只有两者及节点、父图、interval、因果顺序和
时钟覆盖都完整时，摘要才标记完整。

`state` 为 `empty`、`active`、`complete` 或 `incomplete`。`active` 单独表示当前
活动块；`recent` 按因果 creator 顺序倒序呈现已结束块。`name`、`note`、`timer`、
开始事件和开始时刻来自 `start`／`rotate` typed node。终止原因保留手动结束、
轮转、硬 deadline 的区别；deadline evidence 标记 `applied_soft`、`applied_hard`、
`superseded` 或 `unknown`。硬 deadline 只有在 DAG 中的运行阶段、generation/run
event 和运行设备证据匹配时才成为终止原因；软 deadline 不自动表示结束。
Feedback 保留来源 event ID，文本最多显示 1 KiB UTF-8 预览，并附原始字节长度及
截断标记。区间保留 `running`、`paused`、`feedback`、`gap` 分类和各自 source IDs；
`work_ms` 只累计同一 revision 下 `running` intervals 的时长。它不是墙钟差值，
在 interval 或时钟证据不完整时返回 `null`。

`coverage.complete` 表示本次所选窗口的证据完整；`more_available=true` 表示
仍有较早的块被 `limit` 留在窗口外。它与每个 block 的 `complete` 都是完整性声明，
`reasons` 会指出
`node_scan_limit`、`missing_parent`、`concurrent_parent_branches`、
`revision_changed_during_read`、`interval_projection_incomplete`、时钟不确定或
其他无法核实的边界。遇到分页上限、父节点缺失、并行分支、投影 revision 漂移或
时钟异常时，返回 `incomplete`，不使用墙钟推测缺失因果。`next_before` 是可传给
`/beta/v1/profiles/P/timeblocks/nodes` 的本地序号游标；recent 路由自身不提供块级
续页。最多可将 `limit` 提高到 20；要继续核对更早的历史，Agent 可将 `highwater`
作为 nodes 的 `through`、`next_before` 作为 `before` 逐页读取，并在 intervals
请求中单独使用 projection `revision`。若 `intervals_complete=false`，可用
`coverage.interval_from_ms`、`coverage.interval_to_ms`、
`coverage.next_interval_from_ms` 和 `revision` 调用
`/beta/v1/profiles/P/timeblocks/intervals` 续读区间。

一次 recent 请求最多进行两次 snapshot 读取、ceil(`node_limit`/100) 次 nodes
分页读取和一次 intervals 投影读取。Core 为 intervals 读取会按指定 revision
重新投影 typed history，因此 `interval_limit` 限制响应区间数，不保证把 Core 的
投影计算量限制到同一数量。当前接口为有界摘要，不是完整档案导出。

## 维护与验证

实现入口为 Host 的 `agent_wait*`、`agent_export*`。路由、错误映射、
`access/check` 的能力声明必须一起接线。bundle 持有 Host gate 完成有界读取，
因此同期写入可能短暂等待；它没有取得用户目录遍历或全备份能力。

回归入口：`agent_access`、`agent_wait_http`、`agent_export_http`，以及
`grant_management` 的管理角色能力用例。HTTP 用例实际启动隔离 loopback
服务和合成档案，不能替代 Native 剪贴板交接、外部 Agent 使用或最终候选验收。
