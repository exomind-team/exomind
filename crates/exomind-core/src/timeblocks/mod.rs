mod model;
mod projection;
mod scheduler_schema;
mod store;
mod timeline_period_schema;
pub use model::*;
pub use projection::project_timeblocks;
pub(crate) use scheduler_schema::{migrate as migrate_scheduler, validate as validate_scheduler};
pub(crate) use store::rebuild_after_import;
pub(crate) use store::summary_anchor;
pub use store::timeline_period::TimelinePeriodQuery;
pub(crate) use timeline_period_schema::{
    migrate as migrate_timeline_period_schema, validate as validate_timeline_period_schema,
};

pub(crate) fn validate_import_node(node: &TimeblockNodeRecord) -> Result<(), crate::CoreError> {
    use crate::CoreError;
    if node.occurred_at_ms < 0
        || node.effective_at_ms < 0
        || node.clock.epoch_id.is_nil()
        || node.clock.elapsed_ms > i64::MAX as u64
        || node.source.author_id.is_nil()
        || node.parents.contains(&node.event_id)
        || node
            .parents
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != node.parents.len()
    {
        return Err(CoreError::InvalidReplication("invalid timeblock fact"));
    }
    match (&node.payload, node.source.kind) {
        (TimeblockPayload::Action { action }, TimeblockSourceKind::Human) => {
            if node.source.owner_generation.is_some() {
                return Err(CoreError::InvalidReplication("human scheduler claim"));
            }
            match action {
                TimeblockAction::Start {
                    block_id,
                    name,
                    note,
                    timer,
                } => projection::validate_spec(&StartBlockSpec {
                    block_id: *block_id,
                    name: name.clone(),
                    note: note.clone(),
                    timer: *timer,
                })?,
                TimeblockAction::Rotate { next, .. } => projection::validate_spec(next)?,
                TimeblockAction::SubmitFeedback {
                    feedback: FeedbackInput::Text { text },
                    ..
                }
                | TimeblockAction::AppendFeedback { text, .. }
                    if text.trim().is_empty() || text.len() > projection::MAX_NOTE_BYTES =>
                {
                    return Err(CoreError::InvalidReplication("invalid feedback fact"));
                }
                _ => {}
            }
        }
        (
            TimeblockPayload::DeadlineReached {
                deadline_id,
                generation,
                due_wall_ms,
                due_elapsed_ms,
                clock_epoch,
                ..
            }
            | TimeblockPayload::RunDeadlineReached {
                deadline_id,
                generation,
                due_wall_ms,
                due_elapsed_ms,
                clock_epoch,
                ..
            },
            TimeblockSourceKind::Scheduler,
        ) => {
            if node.source.author_id.to_string() != node.device_id.to_string()
                || !node.source.owner_generation.is_some_and(|v| v > 0)
                || deadline_id.is_nil()
                || *generation == 0
                || *due_wall_ms < 0
                || *due_elapsed_ms > i64::MAX as u64
                || clock_epoch.is_nil()
            {
                return Err(CoreError::InvalidReplication("invalid scheduler fact"));
            }
        }
        _ => return Err(CoreError::InvalidReplication("timeblock source mismatch")),
    }
    Ok(())
}

pub(crate) const SCHEMA: &str = "
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1'));
CREATE TABLE timeblock_nodes(event_id TEXT PRIMARY KEY REFERENCES events(event_id),request_digest TEXT NOT NULL);
CREATE TABLE timeblock_state(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),revision TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE timeblock_scheduler_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,generation INTEGER NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)));
INSERT INTO timeblock_scheduler_owner SELECT 1,device_id,1,1 FROM identity WHERE singleton=1;
CREATE TABLE timeblock_deadlines(deadline_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,generation INTEGER NOT NULL,owner_generation INTEGER NOT NULL,command_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('pending','done','cancelled')),due_wall_ms INTEGER NOT NULL,due_elapsed_ms INTEGER NOT NULL,clock_epoch TEXT NOT NULL,end_mode TEXT NOT NULL CHECK(end_mode IN ('soft','hard')),UNIQUE(profile_id,block_id,generation));
CREATE INDEX timeblock_deadline_due ON timeblock_deadlines(state,due_wall_ms);
";
