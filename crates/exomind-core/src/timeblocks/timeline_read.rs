//! Shared bounded reader for visible timeline facts. Internal job facts have
//! their own scoped API and never become visible by guessing their UUID.
use crate::{Core, CoreError, EventId, ProfileId, ReplicatedFact, TimelineItem, WriterContext};
use rusqlite::{OptionalExtension, params};

pub(super) type TimelineRow = (u64, Option<String>, String, Option<String>, Option<String>);
pub(super) fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimelineRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}
pub(super) fn decode(profile: ProfileId, row: TimelineRow) -> Result<TimelineItem, CoreError> {
    let (seq, id, kind, digest, body) = row;
    if seq == 0 {
        return Err(CoreError::RecoveryRequired);
    }
    let id: EventId = id.ok_or(CoreError::RecoveryRequired)?.parse()?;
    let digest = digest.ok_or(CoreError::RecoveryRequired)?;
    let body = body.ok_or(CoreError::RecoveryRequired)?;
    let fact = match kind.as_str() {
        "capture" => ReplicatedFact::Capture(serde_json::from_str(&body)?),
        "timeblock/1" => ReplicatedFact::Timeblock(serde_json::from_str(&body)?),
        "summary/1" => ReplicatedFact::Summary(serde_json::from_str(&body)?),
        "agent_summary/1" => ReplicatedFact::AgentSummary(serde_json::from_str(&body)?),
        _ => return Err(CoreError::RecoveryRequired),
    };
    if fact.event_id() != id || fact.profile_id() != profile || fact.digest() != digest {
        return Err(CoreError::RecoveryRequired);
    }
    fact.validate()?;
    Ok(match fact {
        ReplicatedFact::Capture(mut value) => {
            value.local_seq = seq;
            TimelineItem::Capture(value)
        }
        ReplicatedFact::Timeblock(mut value) => {
            value.local_seq = seq;
            TimelineItem::Timeblock(value)
        }
        ReplicatedFact::Summary(mut value) => {
            value.local_seq = seq;
            TimelineItem::Summary(value)
        }
        ReplicatedFact::AgentSummary(mut value) => {
            value.local_seq = seq;
            TimelineItem::AgentSummary(value)
        }
        ReplicatedFact::SummaryJob(_) | ReplicatedFact::Correction(_) => {
            return Err(CoreError::RecoveryRequired);
        }
    })
}
impl Core {
    /// Precisely reads one visible, validated fact in the authorized profile.
    /// Missing IDs, other profiles' IDs and internal jobs are indistinguishable
    /// here; storage/decoding/integrity failures remain errors. No writes or
    /// projection rebuilding are performed by this read.
    pub fn read_timeline_event(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        event_id: EventId,
    ) -> Result<Option<TimelineItem>, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let value=connection.query_row("SELECT local_seq,CASE WHEN typeof(event_id)='text' AND length(event_id)=36 THEN event_id END,kind,CASE WHEN typeof(digest)='text' AND length(digest)=64 THEN digest END,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?3 THEN body END FROM events WHERE profile_id=?1 AND event_id=?2 AND kind IN ('capture','timeblock/1','summary/1','agent_summary/1') LIMIT 1",params![profile.to_string(),event_id.to_string(),crate::MAX_FACT_BYTES],row).optional()?;
        value.map(|row| decode(profile, row)).transpose()
    }
}
