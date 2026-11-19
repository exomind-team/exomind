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

## 维护与验证

实现入口为 Host 的 `agent_wait*`、`agent_export*`。路由、错误映射、
`access/check` 的能力声明必须一起接线。bundle 持有 Host gate 完成有界读取，
因此同期写入可能短暂等待；它没有取得用户目录遍历或全备份能力。

回归入口：`agent_access`、`agent_wait_http`、`agent_export_http`，以及
`grant_management` 的管理角色能力用例。HTTP 用例实际启动隔离 loopback
服务和合成档案，不能替代 Native 剪贴板交接、外部 Agent 使用或最终候选验收。
