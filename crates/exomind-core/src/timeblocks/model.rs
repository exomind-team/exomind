use crate::{CommandId, DeviceId, EventId, ProfileId, Receipt, TimeblockId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TimeblockRevision(pub(super) String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CountdownEndMode {
    Soft,
    Hard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum TimerSpec {
    CountUp,
    CountDown {
        duration_ms: u64,
        end_mode: CountdownEndMode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartBlockSpec {
    pub block_id: TimeblockId,
    pub name: String,
    pub note: String,
    pub timer: TimerSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FeedbackInput {
    Text { text: String },
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TimeblockAction {
    Start {
        block_id: TimeblockId,
        name: String,
        note: String,
        timer: TimerSpec,
    },
    Pause {
        block_id: TimeblockId,
    },
    Resume {
        block_id: TimeblockId,
    },
    Rotate {
        from_block_id: TimeblockId,
        next: StartBlockSpec,
    },
    EndAction {
        block_id: TimeblockId,
    },
    SubmitFeedback {
        block_id: TimeblockId,
        feedback: FeedbackInput,
    },
    AppendFeedback {
        block_id: TimeblockId,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeblockCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub expected_revision: TimeblockRevision,
    pub action: TimeblockAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeblockPhase {
    Running,
    Paused,
    FeedbackPending,
    Completed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntervalKind {
    Running,
    Paused,
    Feedback,
    Gap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeClock {
    pub epoch_id: Uuid,
    pub elapsed_ms: u64,
}
#[derive(Debug, Clone)]
pub struct ClockStamp {
    pub(super) lifecycle: Uuid,
    pub(super) wall_ms: i64,
    pub(super) clock: NodeClock,
}
#[derive(Debug, Clone)]
pub struct SchedulerContext {
    pub(super) lifecycle: Uuid,
    pub(super) device_id: DeviceId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeblockSourceKind {
    Human,
    Scheduler,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeblockSource {
    pub kind: TimeblockSourceKind,
    pub author_id: Uuid,
    pub owner_generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TimeblockPayload {
    Action {
        action: TimeblockAction,
    },
    DeadlineReached {
        block_id: TimeblockId,
        deadline_id: Uuid,
        generation: u64,
        end_mode: CountdownEndMode,
        due_wall_ms: i64,
        due_elapsed_ms: u64,
        clock_epoch: Uuid,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeblockNodeRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub source: TimeblockSource,
    pub parents: Vec<EventId>,
    pub occurred_at_ms: i64,
    pub effective_at_ms: i64,
    pub clock: NodeClock,
    pub payload: TimeblockPayload,
    pub digest: String,
    pub local_seq: u64,
}
#[derive(Debug, Clone, Serialize)]
pub struct TimeblockNodePage {
    pub items: Vec<TimeblockNodeRecord>,
    pub next_before: Option<u64>,
    pub highwater: u64,
}
#[derive(Debug, Clone, Serialize)]
pub struct ClockStatus {
    pub server_now_ms: i64,
    pub epoch_changed: bool,
    pub wall_clock_moved_back: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct DeadlineSnapshot {
    pub deadline_id: Uuid,
    pub generation: u64,
    pub owner_device_id: DeviceId,
    pub owner_generation: u64,
    pub due_at_ms: i64,
    pub remaining_ms: u64,
    pub end_mode: CountdownEndMode,
    pub eligible: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ActiveTimeblock {
    pub block_id: TimeblockId,
    pub name: String,
    pub note: String,
    pub timer: TimerSpec,
    pub phase: TimeblockPhase,
    pub work_ms: u64,
    pub deadline_reached: bool,
    pub deadline: Option<DeadlineSnapshot>,
}
#[derive(Debug, Clone, Serialize)]
pub struct TimeblockSnapshot {
    pub profile_id: ProfileId,
    pub revision: TimeblockRevision,
    pub heads: Vec<EventId>,
    pub active: Option<ActiveTimeblock>,
    pub pending_feedback: Vec<TimeblockId>,
    pub clock: ClockStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntervalQuery {
    pub from_ms: i64,
    pub to_ms: i64,
    pub through: Option<TimeblockRevision>,
    pub limit: usize,
}
#[derive(Debug, Clone)]
pub struct ProjectionQuery {
    pub from_ms: i64,
    pub to_ms: i64,
}
#[derive(Debug, Clone, Serialize)]
pub struct TimeblockInterval {
    pub from_ms: i64,
    pub to_ms: i64,
    pub kind: IntervalKind,
    pub block_id: Option<TimeblockId>,
    pub source_event_ids: Vec<EventId>,
}
#[derive(Debug, Clone, Serialize)]
pub struct IntervalPage {
    pub items: Vec<TimeblockInterval>,
    pub revision: TimeblockRevision,
    pub next_from_ms: Option<i64>,
    pub complete: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct TimeblockProjection {
    pub active_block_id: Option<TimeblockId>,
    pub heads: Vec<EventId>,
    pub retained_event_ids: Vec<EventId>,
    pub conflicts: Vec<String>,
    pub intervals: Vec<TimeblockInterval>,
}
#[derive(Debug)]
pub enum DeadlineOutcome {
    Applied(Receipt),
    Stale,
}
#[derive(Debug, Clone)]
pub struct DeadlineTicket {
    pub(super) lifecycle: Uuid,
    pub(super) deadline_id: Uuid,
    pub(super) profile_id: ProfileId,
    pub(super) block_id: TimeblockId,
    pub(super) generation: u64,
    pub(super) owner_generation: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "record", rename_all = "snake_case")]
pub enum TimelineItem {
    Capture(crate::EventRecord),
    Timeblock(TimeblockNodeRecord),
}
#[derive(Debug, Clone, Serialize)]
pub struct TimelinePage {
    pub items: Vec<TimelineItem>,
    pub next_before: Option<u64>,
    pub highwater: u64,
}
