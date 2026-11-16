use super::model::*;
use crate::{
    CoreError, EventId, MAX_SUMMARY_INPUT_BYTES, MAX_SUMMARY_SAFE_COUNTER, MAX_SUMMARY_SOURCES,
    SummaryRemoteVisibility, SummarySourceRef,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub(super) fn invalid(reason: &'static str) -> CoreError {
    CoreError::InvalidExternalSummary(reason)
}
pub(super) fn hash(value: &impl Serialize) -> Result<String, CoreError> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
fn sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(super) fn source_refs(sources: &[SummarySourceRef], through: u64) -> Result<(), CoreError> {
    if sources.is_empty()
        || sources.len() > MAX_SUMMARY_SOURCES
        || through == 0
        || through > MAX_SUMMARY_SAFE_COUNTER
    {
        return Err(invalid("source bounds"));
    }
    let mut ids = HashSet::new();
    if sources.iter().any(|source| {
        !matches!(source.kind.as_str(), "capture" | "timeblock/1")
            || !sha(&source.digest)
            || !ids.insert(source.event_id)
    }) {
        return Err(invalid("source identity"));
    }
    Ok(())
}
pub(super) fn output(
    narrative: &str,
    evidence: &[EventId],
    sources: &[SummarySourceRef],
) -> Result<(), CoreError> {
    if narrative.trim().is_empty()
        || narrative.len() > 128 * 1024
        || evidence.is_empty()
        || evidence.len() > MAX_SUMMARY_SOURCES
    {
        return Err(invalid("output bounds"));
    }
    let mut ids = HashSet::new();
    if evidence
        .iter()
        .any(|id| !ids.insert(*id) || !sources.iter().any(|source| source.event_id == *id))
    {
        return Err(invalid("unknown evidence"));
    }
    Ok(())
}
impl ExternalSummarySnapshot {
    pub(super) fn seal(&mut self) -> Result<(), CoreError> {
        self.digest.clear();
        self.digest = hash(self)?;
        Ok(())
    }
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        source_refs(&self.sources, self.observed_through)?;
        if self.input_encoded_bytes == 0
            || self.input_encoded_bytes > MAX_SUMMARY_INPUT_BYTES as u64
            || self.materials.len() > 256
            || self.coverage.unread_original_ids.len() > 256
            || self.coverage.remote_visibility != SummaryRemoteVisibility::Unknown
        {
            return Err(invalid("snapshot bounds or completeness claim"));
        }
        let mut ids = HashSet::new();
        for material in &self.materials {
            crate::originals::validate_original(material)?;
            if !ids.insert(material.original_id) {
                return Err(invalid("duplicate material"));
            }
        }
        let unread: HashSet<_> = self.coverage.unread_original_ids.iter().copied().collect();
        if unread.len() != self.coverage.unread_original_ids.len() || unread != ids {
            return Err(invalid("materials must all remain unread"));
        }
        let mut copy = self.clone();
        copy.digest.clear();
        if !sha(&self.digest) || hash(&copy)? != self.digest {
            return Err(invalid("snapshot digest"));
        }
        Ok(())
    }
}
#[derive(Serialize)]
struct Fact<'a> {
    kind: &'static str,
    event_id: crate::EventId,
    profile_id: crate::ProfileId,
    device_id: crate::DeviceId,
    producer_agent_id: crate::AgentId,
    occurred_at_ms: i64,
    snapshot: &'a ExternalSummarySnapshot,
    narrative: &'a str,
    evidence: &'a [EventId],
}
impl ExternalSummaryRecord {
    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        Ok(serde_json::to_vec(&Fact {
            kind: EXTERNAL_SUMMARY_FACT_TYPE,
            event_id: self.event_id,
            profile_id: self.profile_id,
            device_id: self.device_id,
            producer_agent_id: self.producer_agent_id,
            occurred_at_ms: self.occurred_at_ms,
            snapshot: &self.snapshot,
            narrative: &self.narrative,
            evidence: &self.evidence,
        })?)
    }
    pub fn computed_digest(&self) -> Result<String, CoreError> {
        Ok(format!(
            "{:x}",
            Sha256::digest(self.canonical_fact_bytes()?)
        ))
    }
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        self.snapshot.validate()?;
        output(&self.narrative, &self.evidence, &self.snapshot.sources)?;
        if self.occurred_at_ms < 0
            || self
                .snapshot
                .sources
                .iter()
                .any(|source| source.event_id == self.event_id)
            || !sha(&self.digest)
            || self.computed_digest()? != self.digest
        {
            return Err(invalid("fact header or digest"));
        }
        crate::fact_encoding::encode_fact(self)?;
        Ok(())
    }
}
