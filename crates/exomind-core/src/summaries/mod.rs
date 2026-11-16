//! Durable review/control facts and local execution qualification. Model I/O,
//! credentials, transport authorization and outbound media consent are Host.
#[cfg(test)]
mod boundary_tests;
mod events_schema;
mod facts;
mod model;
mod projection;
mod schema;
mod sources;
mod store;
use crate::{
    CoreError, DeviceId, EventId, ProfileId, TimeblockAction, TimeblockId, TimeblockNodeRecord,
    TimeblockPayload,
};
pub(crate) use events_schema::{migrate as migrate_events, validate as validate_events};
pub use model::*;
use rusqlite::{Transaction, params};
pub(crate) use schema::index as index_import;
pub(crate) use schema::{migrate, provision, validate as validate_schema};
#[derive(Debug, Clone)]
pub(crate) struct BlockAnchor {
    pub creator_event_id: EventId,
    pub creator_device_id: DeviceId,
    pub from_ms: i64,
    pub to_ms: i64,
    pub eligible: bool,
}
pub(crate) fn note_timeblock(
    tx: &Transaction<'_>,
    node: &TimeblockNodeRecord,
) -> Result<(), CoreError> {
    index_timeblock(tx, node)?;
    let block = match &node.payload {
        TimeblockPayload::Action {
            action: TimeblockAction::Start { block_id, .. },
        } => Some(*block_id),
        TimeblockPayload::Action {
            action: TimeblockAction::Rotate { next, .. },
        } => Some(next.block_id),
        _ => None,
    };
    if let Some(block) = block {
        tx.execute(
            "INSERT OR IGNORE INTO summary_auto_candidates VALUES(?1,?2,?3,'pending')",
            params![
                node.profile_id.to_string(),
                block.to_string(),
                node.event_id.to_string()
            ],
        )?;
    }
    Ok(())
}
pub(crate) fn note_capture(
    tx: &Transaction<'_>,
    value: &crate::EventRecord,
) -> Result<(), CoreError> {
    tx.execute(
        "INSERT INTO summary_capture_sources VALUES(?1,?2,?3)",
        params![
            value.event_id.to_string(),
            value.profile_id.to_string(),
            value.occurred_at_ms
        ],
    )?;
    Ok(())
}
pub(crate) fn index_timeblock(
    tx: &Transaction<'_>,
    value: &TimeblockNodeRecord,
) -> Result<(), CoreError> {
    let blocks = match &value.payload {
        TimeblockPayload::Action {
            action:
                TimeblockAction::Rotate {
                    from_block_id,
                    next,
                },
        } => vec![*from_block_id, next.block_id],
        TimeblockPayload::Action {
            action:
                TimeblockAction::Start { block_id, .. }
                | TimeblockAction::Pause { block_id }
                | TimeblockAction::Resume { block_id }
                | TimeblockAction::EndAction { block_id }
                | TimeblockAction::SubmitFeedback { block_id, .. }
                | TimeblockAction::AppendFeedback { block_id, .. },
        }
        | TimeblockPayload::DeadlineReached { block_id, .. }
        | TimeblockPayload::RunDeadlineReached { block_id, .. } => vec![*block_id],
    };
    for block in blocks {
        tx.execute(
            "INSERT INTO summary_block_sources VALUES(?1,?2,?3)",
            params![
                value.profile_id.to_string(),
                block.to_string(),
                value.event_id.to_string()
            ],
        )?;
    }
    Ok(())
}
pub(super) fn first_key(p: ProfileId, block: TimeblockId) -> String {
    format!("{p}/{block}/first_review/v1")
}
pub(super) fn derived_uuid(domain: &str, values: &[&str]) -> uuid::Uuid {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(domain.as_bytes());
    for value in values {
        h.update((value.len() as u64).to_le_bytes());
        h.update(value.as_bytes());
    }
    let digest = h.finalize();
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 15) | 0x80;
    bytes[8] = (bytes[8] & 63) | 0x80;
    uuid::Uuid::from_bytes(bytes)
}
pub(super) fn first_id(p: ProfileId, block: TimeblockId) -> SummaryTaskId {
    derived_uuid(
        "exomind-first-review/1",
        &[&p.to_string(), &block.to_string()],
    )
}
