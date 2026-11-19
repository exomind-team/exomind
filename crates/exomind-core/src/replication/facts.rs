use crate::{
    CoreError, CorrectionRecord, DeviceId, EventId, EventRecord, OriginalLifecycleRecord,
    OriginalRef, ProfileId,
    TimeblockNodeRecord,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "record", deny_unknown_fields)]
pub enum ReplicatedFact {
    #[serde(rename = "capture")]
    Capture(EventRecord),
    #[serde(rename = "timeblock/1")]
    Timeblock(TimeblockNodeRecord),
    #[serde(rename = "summary_job/1")]
    SummaryJob(crate::SummaryJobRecord),
    #[serde(rename = "summary/1")]
    Summary(crate::SummaryArtifactRecord),
    #[serde(rename = "agent_summary/1")]
    AgentSummary(crate::ExternalSummaryRecord),
    #[serde(rename = "correction/1")]
    Correction(CorrectionRecord),
    #[serde(rename = "orig_lifecycle/1")]
    OriginalLifecycle(OriginalLifecycleRecord),
}
impl ReplicatedFact {
    pub fn event_id(&self) -> EventId {
        match self {
            Self::Capture(v) => v.event_id,
            Self::Timeblock(v) => v.event_id,
            Self::SummaryJob(v) => v.event_id,
            Self::Summary(v) => v.event_id,
            Self::AgentSummary(v) => v.event_id,
            Self::Correction(v) => v.event_id,
            Self::OriginalLifecycle(v) => v.event_id,
        }
    }
    pub fn profile_id(&self) -> ProfileId {
        match self {
            Self::Capture(v) => v.profile_id,
            Self::Timeblock(v) => v.profile_id,
            Self::SummaryJob(v) => v.profile_id,
            Self::Summary(v) => v.profile_id,
            Self::AgentSummary(v) => v.profile_id,
            Self::Correction(v) => v.profile_id,
            Self::OriginalLifecycle(v) => v.profile_id,
        }
    }
    pub fn device_id(&self) -> DeviceId {
        match self {
            Self::Capture(v) => v.device_id,
            Self::Timeblock(v) => v.device_id,
            Self::SummaryJob(v) => v.device_id,
            Self::Summary(v) => v.device_id,
            Self::AgentSummary(v) => v.device_id,
            Self::Correction(v) => v.device_id,
            Self::OriginalLifecycle(v) => v.device_id,
        }
    }
    pub fn digest(&self) -> &str {
        match self {
            Self::Capture(v) => &v.digest,
            Self::Timeblock(v) => &v.digest,
            Self::SummaryJob(v) => &v.digest,
            Self::Summary(v) => &v.digest,
            Self::AgentSummary(v) => &v.digest,
            Self::Correction(v) => &v.digest,
            Self::OriginalLifecycle(v) => &v.digest,
        }
    }
    pub fn fact_type(&self) -> &'static str {
        match self {
            Self::Capture(v) if v.originals.is_empty() => "capture/1",
            Self::Capture(_) => "capture/2",
            Self::Timeblock(_) => "timeblock/1",
            Self::SummaryJob(_) => "summary_job/1",
            Self::Summary(_) => "summary/1",
            Self::AgentSummary(_) => "agent_summary/1",
            Self::Correction(_) => "correction/1",
            Self::OriginalLifecycle(_) => "orig_lifecycle/1",
        }
    }
    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        match self {
            Self::Capture(v) => v.canonical_fact_bytes(),
            Self::Timeblock(v) => v.canonical_fact_bytes(),
            Self::SummaryJob(v) => v.canonical_fact_bytes(),
            Self::Summary(v) => v.canonical_fact_bytes(),
            Self::AgentSummary(v) => v.canonical_fact_bytes(),
            Self::Correction(v) => v.canonical_fact_bytes(),
            Self::OriginalLifecycle(v) => crate::fact_encoding::encode_fact(v).map(String::into_bytes),
        }
    }
    pub(super) fn originals(&self) -> &[OriginalRef] {
        match self {
            Self::Capture(v) => &v.originals,
            Self::Timeblock(_)
            | Self::SummaryJob(_)
            | Self::Summary(_)
            | Self::AgentSummary(_)
            | Self::Correction(_) => &[],
            Self::OriginalLifecycle(_) => &[],
        }
    }
    pub(super) fn portable(&self) -> Self {
        let mut value = self.clone();
        match &mut value {
            Self::Capture(v) => v.local_seq = 0,
            Self::Timeblock(v) => v.local_seq = 0,
            Self::SummaryJob(v) => v.local_seq = 0,
            Self::Summary(v) => v.local_seq = 0,
            Self::AgentSummary(v) => v.local_seq = 0,
            Self::Correction(v) => v.local_seq = 0,
            Self::OriginalLifecycle(v) => v.local_seq = 0,
        };
        value
    }
    pub(super) fn body(&self) -> Result<String, CoreError> {
        match self {
            Self::Capture(v) => crate::fact_encoding::encode_fact(v),
            Self::Timeblock(v) => crate::fact_encoding::encode_fact(v),
            Self::SummaryJob(v) => crate::fact_encoding::encode_fact(v),
            Self::Summary(v) => crate::fact_encoding::encode_fact(v),
            Self::AgentSummary(v) => crate::fact_encoding::encode_fact(v),
            Self::Correction(v) => crate::fact_encoding::encode_fact(v),
            Self::OriginalLifecycle(v) => crate::fact_encoding::encode_fact(v),
        }
    }
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        match self {
            Self::Capture(v) => {
                if v.author_id.is_nil()
                    || v.occurred_at_ms < 0
                    || v.text.len() > 128 * 1024
                    || (v.text.trim().is_empty() && v.originals.is_empty())
                    || v.tags.len() > 64
                    || v.tags
                        .iter()
                        .any(|tag| tag.trim().is_empty() || tag.len() > 128)
                    || v.originals.len() > crate::MAX_CAPTURE_ORIGINALS
                {
                    return Err(CoreError::InvalidReplication("invalid capture fact"));
                }
                let mut ids = std::collections::HashSet::new();
                for original in &v.originals {
                    crate::originals::validate_original(original)?;
                    if !ids.insert(original.original_id) {
                        return Err(CoreError::InvalidReplication("duplicate capture original"));
                    }
                }
                if v.computed_digest()? != v.digest {
                    return Err(CoreError::InvalidReplication("capture digest mismatch"));
                }
            }
            Self::Timeblock(v) => {
                crate::timeblocks::validate_import_node(v)?;
                if v.computed_digest()? != v.digest {
                    return Err(CoreError::InvalidReplication("timeblock digest mismatch"));
                }
            }
            Self::SummaryJob(v) => v.validate()?,
            Self::Summary(v) => v.validate()?,
            Self::AgentSummary(v) => v.validate()?,
            Self::Correction(v) => v.validate()?,
            Self::OriginalLifecycle(v) => v.validate()?,
        }
        self.body()?;
        Ok(())
    }
}
pub(super) fn load_fact(
    connection: &Connection,
    event: EventId,
) -> Result<Option<ReplicatedFact>, CoreError> {
    let row:Option<(Option<String>,Option<String>,Option<String>,Option<String>)>=connection.query_row("SELECT CASE WHEN typeof(kind)='text' AND length(kind)<=16 THEN kind END,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?2 THEN body END,CASE WHEN length(profile_id)=36 THEN profile_id END,CASE WHEN length(digest)=64 THEN digest END FROM events WHERE event_id=?1",rusqlite::params![event.to_string(),crate::MAX_FACT_BYTES],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
    row.map(|(kind, body, profile, digest)| {
        let kind = kind.ok_or(CoreError::RecoveryRequired)?;
        let body = body.ok_or(CoreError::RecoveryRequired)?;
        let fact = match kind.as_str() {
            "capture" => ReplicatedFact::Capture(serde_json::from_str(&body)?),
            "timeblock/1" => ReplicatedFact::Timeblock(serde_json::from_str(&body)?),
            "summary_job/1" => ReplicatedFact::SummaryJob(serde_json::from_str(&body)?),
            "summary/1" => ReplicatedFact::Summary(serde_json::from_str(&body)?),
            "agent_summary/1" => ReplicatedFact::AgentSummary(serde_json::from_str(&body)?),
            "correction/1" => ReplicatedFact::Correction(serde_json::from_str(&body)?),
            "orig_lifecycle/1" => ReplicatedFact::OriginalLifecycle(serde_json::from_str(&body)?),
            _ => return Err(CoreError::RecoveryRequired),
        };
        if fact.event_id() != event
            || Some(fact.profile_id().to_string()) != profile
            || Some(fact.digest()) != digest.as_deref()
        {
            return Err(CoreError::RecoveryRequired);
        }
        fact.validate()?;
        Ok(fact.portable())
    })
    .transpose()
}
