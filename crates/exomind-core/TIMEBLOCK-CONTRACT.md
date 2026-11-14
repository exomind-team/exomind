# B1.3 时间块合同与验证边界

本文件冻结 B1.3 公开接缝。Core/Host 实现已落源码，执行证据由父代理串行验证；不得把源码存在当作 UI、Android 通知或跨端同步通过。当前 Native 媒体验收使用独立 immutable staging，不与本轮 schema-3 工作源码混版。

## Core 接缝

`TimeblockId` 为非 nil UUID；`TimeblockRevision` 是排序后 causal heads 的稳定摘要，可序列化但不能当作者凭据。所有 JSON DTO 拒绝未知字段。

```rust
TimeblockCommand { command_id: CommandId, event_id: EventId, profile_id: ProfileId,
    expected_revision: TimeblockRevision, action: TimeblockAction }
StartBlockSpec { block_id: TimeblockId, name: String, note: String, timer: TimerSpec }
TimeblockAction = Start { block_id, name, note, timer }
    | Pause { block_id } | Resume { block_id }
    | Rotate { from_block_id, next: StartBlockSpec }
    | EndAction { block_id }
    | SubmitFeedback { block_id, feedback: FeedbackInput }
    | AppendFeedback { block_id, text: String }
TimerSpec = CountUp | CountDown { duration_ms: u64, end_mode: CountdownEndMode }
CountdownEndMode = Soft | Hard
FeedbackInput = Text { text: String } | Skipped
```

Action wire tag 为 `kind`，TimerSpec 为 `mode`，反馈为 `kind`，枚举值统一 snake_case。timeblock JSON 不接收时间、作者、source、scheduler、deadline generation。Start 创建新身份；已有活动块须显式 Rotate，不隐式覆盖。

```rust
Core::trusted_clock_stamp(epoch: Uuid, wall_ms: i64, elapsed_ms: u64) -> Result<ClockStamp>
Core::apply_timeblock(&WriterContext, &TimeblockCommand, &ClockStamp) -> Result<Receipt>
Core::timeblock_snapshot(&WriterContext, ProfileId, &ClockStamp) -> Result<TimeblockSnapshot>
Core::timeblock_nodes(&WriterContext, ProfileId, &EventQuery) -> Result<TimeblockNodePage>
Core::timeblock_intervals(&WriterContext, ProfileId, &IntervalQuery) -> Result<IntervalPage>
Core::local_scheduler() -> SchedulerContext
Core::due_deadlines(&SchedulerContext, &ClockStamp, limit: usize) -> Result<Vec<DeadlineTicket>>
Core::complete_deadline(&SchedulerContext, &DeadlineTicket, &ClockStamp) -> Result<DeadlineOutcome>
project_timeblocks(ProfileId, &[TimeblockNodeRecord], &ProjectionQuery) -> Result<TimeblockProjection>
```

ClockStamp、SchedulerContext、DeadlineTicket 字段私有、不可 serde，绑定 Core lifecycle；clock 构造仅供受信 Rust 嵌入与可控测试，不得映射外部接口。普通 local_agent 不自动有控制权，observer 由 Host 拒写。新增语义错误至少包含 `TimeblockConflict`（revision/非法状态，409）、`TimeblockControlDenied`（403）；旧 request/caller 仍用 CommandConflict、跨 profile/context 保留既有类别。

`apply_timeblock` 先验证 scope/control，再以稳定 request+caller 查询命令幂等，最后才处理新操作的 expected_revision/clock。request 摘要排除 server clock；同命令更晚重试回读原 Receipt，不能因新 now 或 stale revision 误冲突。同命令异 request/caller 明确冲突。事实、投影/deadline 变更和完整 Receipt 在同一 SQLite 事务，无事后可失败动作改变成功结论。

## 快照与投影

TimeblockSnapshot 至少含 profile_id、revision、heads、active、pending_feedback、clock。active 含 block_id、phase、work_ms、timer、deadline_reached、deadline；phase 为 running/paused/feedback_pending/completed。ClockStatus 提供 server_now_ms、epoch_changed、wall_clock_moved_back，读快照不写业务事实。TimeblockProjection 含 active_block_id、heads、retained_event_ids、conflicts、intervals，便于直接核对保留事实与确定性投影。

Pause 不增加工作时长；Resume 创建新运行切片。EndAction 关闭行动、进入反馈待填；SubmitFeedback 完成原反馈流程，AppendFeedback 保留所有前文。Rotate 是一个稳定 event_id 的 typed 复合事实，同事务关闭旧行动、启动新块；旧反馈待填保留。旧反馈后来提交不能结束新块或清理新稿。

IntervalQuery { from_ms, to_ms, through: Option<TimeblockRevision>, limit }；IntervalPage.items 为 from_ms/to_ms/kind/source_event_ids，kind 至少 running/paused/feedback/gap。查询窗口和覆盖完整性明确，分页未完不声称完整。ProjectionQuery 仅提供显示窗口（from_ms/to_ms）。确定性投影先满足因果边；并发 ready 节点按 canonical (device_id,event_id) 升序处理，同一并发前沿选较大稳定 key 为当前候选。保留所有竞争节点及裁决说明，不采用 local_seq 或物理时间作胜负。物理时间仅定位区间，逆序边界夹取并显式标记异常；缺失因果父节点不得假装完整。

TimeblockNodeRecord 是 typed 事件记录，保存 causal parents、source、原始/有效时间与 payload。用户 capture 的任意 tags 不会变成节点。主时间线使用显式 kind/payload；旧 capture/1、capture/2 canonical 和原 Receipt 不重写。

## Deadline

Soft 到点只追加一次 DeadlineReached，继续超时；Hard 到点一次结束行动，停在反馈待填。pause/resume/rotate/end 使旧 deadline generation 失效。DeadlineOutcome 为 Applied(Receipt) 或 Stale；同已执行 ticket 重试返回 Applied 且 receipt.replayed=true，不新增节点。旧 lifecycle ticket 不得提交。

Deadline 预留稳定 command_id/event_id；重启由受信 Host 显式 reconcile。相同 clock epoch 使用 elapsed 单调时间，跨 epoch 采用已持久 UTC 边界并显示重新锚定/回拨异常，不负计时、不重写历史。UI 只按服务快照平滑显示，到零不调用结束。

Native 通知使用 envelope：runtime_id/device_id/profile_id/block_id/deadline_id/generation/projection_revision/due_at_ms/remaining_ms/end_mode/owner_device_id/eligibility。Java 只提示到点、保存 handoff；不从 Intent 构造 Scheduler 来源或结束事实。单一 Host owner 排程，主窗/浮窗均不直接拥有 Alarm。

## schema 2 → 3

迁移首先在 BEGIN IMMEDIATE 排除并发写，使用独立只读源做完整 schema-2 online backup；保留原件块/hash、引用、layout、全部事实与回执。目标 checkpoint 并持久 DELETE mode，验证 app/schema/integrity 与全部表的有序逻辑摘要，关闭/fsync 后才升级。备份命名 `schema-2-<uuid>.sqlite3`，扩展明确白名单；失败不升级、不自动 restore。旧实验 schema-2 layout 缺 marker 仍 RecoveryRequired。

新空库直接初始化 schema 3；已提交 schema 1 先完整备份 schema 1，再在同一事务加入原件/时间块结构到 3；已提交 schema 2 备份 schema 2 后升到 3。不能在同一未提交迁移中创建“中间 schema 2”再用另一只读连接备份它，该连接只能读到此前已提交状态。已经是 schema 3 的库验证版本/布局后直接打开，不重复备份。

新增 typed event kind 与 timeblock_nodes（event_id FK）、timeblock_state（可重建投影缓存）、deadline operational rows。原始事实只增，投影不是第二权威；Rotate 不生成临时子事件 ID。保留旧 capture/1 与 capture/2 canonical 原字节、主键和序号。真实 schema-2 CLI fixture 经环境变量指定，独立副本升级后旧 binary 必须拒写。单文件备份恢复后应逐项核对身份、文字/原件 byte+hash、引用、Receipt 与 typed 节点。

## Host 接缝与验证顺序

HostClock: Send+Sync，sample()->HostClockSample { epoch_id:Uuid, wall_ms:i64, elapsed_ms:u64 }，非 serde，仅受信嵌入注入。BetaHost::open_with_clock(root,Arc<dyn HostClock>)；既有 open 使用系统时钟。Host 的 apply_timeblock/session+command、snapshot/session+profile、nodes/intervals 与 Core 同名，时钟由 Host 添加。

start_services(self:&Arc<Self>)->ServiceStatus{instance_id,running} 幂等，wake_services() 唤醒自有 scheduler；不依赖 HTTP serve。request_stop 立即禁止新提交，stop 取消且有界等待自有服务后释放 root。旧唤醒/clock 返回/通知 envelope 不得恢复停止代次。

权限裁决：成功 human Start 已形成既定用户意图，随后撤销该 human grant 仅拒绝其后续控制，不撤回已接受动作，也不取消独立私有 Scheduler 的持久 deadline；重启仍按该规则 reconcile。尚未准入的调用继续服从 grant 撤销 gate。显式 pause/end/rotate、Profile/Device 成员或 Scheduler owner 资格撤销、Host stop/lifecycle 更换使对应旧 ticket 失效。B2 前保留 owner_device_id/owner_generation 验证接缝，不伪造尚未存在的成员撤销协议，不建立 human grant→deadline 的错误取消关联。

HTTP GET `/beta/v1/profiles/{p}/timeblocks/current`；POST同前缀 `/commands`，body 为 command_id/event_id/expected_revision/action，profile 来自路径。当前档案 observer 可读，human 可控制，agent_note 拒绝控制。typed nodes/intervals 后续接对应只读端点；无匿名 Scheduler/clock/ticket API。

先行 Host HTTP 反例已确认真实404行为红；Core/HostClock 新 API 反例在未实现时为编译红，不记成行为证据。当前公开 structs 与实现已落，父串行复验 Core53项、Host34项以及真实 schema-1/schema-2 旧 binary 专项各1项通过。Native命令、UI、媒体验收、跨端和Android后台仍分别记证据，不能由这些库测试代替。

完整记录流使用 `timeline_page(ctx, profile, EventQuery)` / `GET /beta/v1/profiles/{p}/timeline`，items 为 `{"kind":"capture"|"timeblock","record":...}`，共用同一 events/highwater 与分页游标。旧 `events/events_page` 明确只作 capture 兼容投影，不能声称全量覆盖。timeblock_nodes 只索引同一 events.body，不复制事实；Chat/Agent/同步完整覆盖应接统一 timeline，不能分别分页再猜测合并。
