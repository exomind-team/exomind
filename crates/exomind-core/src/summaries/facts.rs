use super::model::*;
use crate::{CoreError, EventId};
use serde::Serialize;
use sha2::{Digest, Sha256};
pub(super) fn hash(value: &impl Serialize) -> Result<String, CoreError> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
pub(super) fn sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(super) fn invalid(reason: &'static str) -> CoreError {
    CoreError::InvalidSummary(reason)
}
pub(super) fn selection(value: &SummarySelection) -> Result<(), CoreError> {
    if value.block_ids.is_empty()
        || value.block_ids.len() > 100
        || value.from_ms < 0
        || value.to_ms < value.from_ms
        || value.selected_original_ids.len() > 256
    {
        return Err(invalid("selection bounds"));
    }
    let mut ids = std::collections::HashSet::new();
    if value.block_ids.iter().any(|id| !ids.insert(id)) {
        return Err(invalid("duplicate blocks"));
    }
    let mut ids = std::collections::HashSet::new();
    if value.selected_original_ids.iter().any(|id| !ids.insert(id)) {
        return Err(invalid("duplicate materials"));
    }
    Ok(())
}
pub(super) fn snapshot(value: &SummarySourceSnapshot) -> Result<(), CoreError> {
    selection(&value.selection)?;
    if value.sources.len() > MAX_SUMMARY_SOURCES
        || value.materials.len() > 256
        || value.input_encoded_bytes > MAX_SUMMARY_INPUT_BYTES as u64
        || value.through > MAX_SUMMARY_SAFE_COUNTER
        || value.origin_heads.len() > 256
        || value.coverage.omitted_source_ids.len() > MAX_SUMMARY_SOURCES
        || value.coverage.read_failures.len() > MAX_SUMMARY_SOURCES
        || value.coverage.missing_parents.len() > 128
        || value.coverage.metadata_only.len() > 256
        || value.coverage.unread_originals.len() > 256
    {
        return Err(invalid("snapshot bounds"));
    }
    let mut ids = std::collections::HashSet::new();
    for source in &value.sources {
        if !matches!(source.kind.as_str(), "capture" | "timeblock/1" | "correction/1")
            || !sha(&source.digest)
            || !ids.insert(source.event_id)
        {
            return Err(invalid("snapshot source"));
        }
    }
    if value.feedback_ids.iter().any(|id| {
        !value
            .sources
            .iter()
            .any(|s| s.event_id == *id && s.kind == "timeblock/1")
    }) {
        return Err(invalid("feedback outside sources"));
    }
    if value.origin_heads.iter().any(|head| {
        head.cursor.seq > MAX_SUMMARY_SAFE_COUNTER
            || !sha(&head.cursor.hash)
            || head.origin.restoration_epoch.is_nil()
    }) {
        return Err(invalid("origin head bounds"));
    }
    let mut material_ids = std::collections::HashSet::new();
    for material in &value.materials {
        crate::originals::validate_original(&material.original)?;
        if !material_ids.insert(material.original.original_id) {
            return Err(invalid("duplicate material"));
        }
        if material.selected
            != value
                .selection
                .selected_original_ids
                .contains(&material.original.original_id)
        {
            return Err(invalid("material selection"));
        }
    }
    if value
        .selection
        .selected_original_ids
        .iter()
        .any(|id| !material_ids.contains(id))
    {
        return Err(invalid("selected material missing"));
    }
    for list in [
        &value.coverage.metadata_only,
        &value.coverage.unread_originals,
    ] {
        let mut seen = std::collections::HashSet::new();
        if list
            .iter()
            .any(|id| !material_ids.contains(id) || !seen.insert(*id))
        {
            return Err(invalid("coverage material set"));
        }
    }
    let mut omitted = std::collections::HashSet::new();
    if value
        .coverage
        .omitted_source_ids
        .iter()
        .any(|id| ids.contains(id) || !omitted.insert(*id))
    {
        return Err(invalid("omitted source set"));
    }
    for list in [
        &value.coverage.read_failures,
        &value.coverage.missing_parents,
    ] {
        let mut seen = std::collections::HashSet::new();
        if list.iter().any(|id| !seen.insert(*id)) {
            return Err(invalid("coverage gap set"));
        }
    }
    let mut copy = value.clone();
    copy.digest.clear();
    if !sha(&value.digest) || hash(&copy)? != value.digest {
        return Err(invalid("snapshot digest"));
    }
    Ok(())
}
#[derive(Serialize)]
struct Job<'a> {
    kind: &'static str,
    event_id: EventId,
    profile_id: crate::ProfileId,
    device_id: crate::DeviceId,
    author_id: uuid::Uuid,
    actor_kind: SummaryActorKind,
    task_id: SummaryTaskId,
    parents: &'a [EventId],
    occurred_at_ms: i64,
    payload: &'a SummaryJobPayload,
}
impl SummaryJobRecord {
    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        Ok(serde_json::to_vec(&Job {
            kind: "summary_job/1",
            event_id: self.event_id,
            profile_id: self.profile_id,
            device_id: self.device_id,
            author_id: self.author_id,
            actor_kind: self.actor_kind,
            task_id: self.task_id,
            parents: &self.parents,
            occurred_at_ms: self.occurred_at_ms,
            payload: &self.payload,
        })?)
    }
    pub fn computed_digest(&self) -> Result<String, CoreError> {
        Ok(format!(
            "{:x}",
            Sha256::digest(self.canonical_fact_bytes()?)
        ))
    }
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        if self.author_id.is_nil()
            || self.task_id.is_nil()
            || self.occurred_at_ms < 0
            || self.parents.len() > 128
        {
            return Err(invalid("job header"));
        }
        let mut parents = std::collections::HashSet::new();
        if self
            .parents
            .iter()
            .any(|id| *id == self.event_id || !parents.insert(id))
        {
            return Err(invalid("job parents"));
        }
        match &self.payload {
            SummaryJobPayload::Requested {
                selection: query,
                trigger_key,
                initial_run_id,
                artifact_kind,
                ..
            } => {
                selection(query)?;
                if trigger_key.is_empty()
                    || trigger_key.len() > 256
                    || initial_run_id.is_nil()
                    || *artifact_kind == SummaryArtifactKind::ExternalSummary
                {
                    return Err(invalid("job request"));
                }
            }
            SummaryJobPayload::Controlled {
                expected_owner_generation,
                action,
                ..
            } => {
                if self.actor_kind != SummaryActorKind::Human
                    || *expected_owner_generation == 0
                    || *expected_owner_generation >= MAX_SUMMARY_SAFE_COUNTER
                {
                    return Err(invalid("control authority"));
                }
                match action {
                    SummaryControlAction::TakeOverForSelf { run_id, .. }
                    | SummaryControlAction::ResolveOwner { run_id, .. }
                        if run_id.is_nil() =>
                    {
                        return Err(invalid("nil run"));
                    }
                    SummaryControlAction::QueueUpdate {
                        run_id,
                        selection: query,
                        ..
                    } => {
                        if run_id.is_nil() {
                            return Err(invalid("nil run"));
                        }
                        selection(query)?;
                    }
                    _ => {}
                }
            }
            SummaryJobPayload::Execution {
                run_id,
                owner_generation,
                attempt_number,
                snapshot: source,
                role_config_digest,
                max_attempts,
                reason,
                retry_at_ms,
                state,
                attempt_id,
                ..
            } => {
                if self.actor_kind != SummaryActorKind::Executor
                    || run_id.is_nil()
                    || *owner_generation == 0
                    || *owner_generation > MAX_SUMMARY_SAFE_COUNTER
                    || *attempt_number > MAX_SUMMARY_ATTEMPTS
                    || *max_attempts == 0
                    || *max_attempts > MAX_SUMMARY_ATTEMPTS
                    || reason.as_ref().is_some_and(|s| s.len() > 64)
                    || retry_at_ms.is_some_and(|ms| ms < 0)
                {
                    return Err(invalid("execution bounds"));
                }
                if !matches!(
                    state,
                    SummaryState::WaitingConfiguration
                        | SummaryState::Running
                        | SummaryState::RetryWait
                        | SummaryState::Failed
                ) {
                    return Err(invalid("execution state"));
                }
                if *state == SummaryState::WaitingConfiguration {
                    if attempt_id.is_some()
                        || *attempt_number != 0
                        || source.is_some()
                        || role_config_digest.is_some()
                    {
                        return Err(invalid("configuration cannot claim attempt"));
                    }
                } else if attempt_id.is_none_or(|id| id.is_nil())
                    || *attempt_number == 0
                    || *attempt_number > *max_attempts
                    || source.is_none()
                    || role_config_digest.is_none()
                {
                    return Err(invalid("attempt qualification"));
                }
                if let Some(source) = source {
                    snapshot(source)?;
                    if source
                        .origin_heads
                        .iter()
                        .any(|head| head.origin.profile_id != self.profile_id)
                    {
                        return Err(invalid("snapshot origin profile"));
                    }
                    if *state == SummaryState::Running && source.sources.is_empty() {
                        return Err(invalid("running source required"));
                    }
                }
                if role_config_digest.as_ref().is_some_and(|s| !sha(s)) {
                    return Err(invalid("role digest"));
                }
            }
            SummaryJobPayload::Published {
                run_id,
                attempt_id,
                owner_generation,
                ..
            } => {
                if self.actor_kind != SummaryActorKind::Executor
                    || run_id.is_nil()
                    || attempt_id.is_nil()
                    || *owner_generation == 0
                    || *owner_generation > MAX_SUMMARY_SAFE_COUNTER
                {
                    return Err(invalid("published authority"));
                }
            }
        }
        if self.computed_digest()? != self.digest {
            return Err(invalid("job digest"));
        }
        crate::fact_encoding::encode_fact(self)?;
        Ok(())
    }
}
#[derive(Serialize)]
struct Artifact<'a> {
    kind: &'static str,
    event_id: EventId,
    profile_id: crate::ProfileId,
    device_id: crate::DeviceId,
    author_id: uuid::Uuid,
    task_id: SummaryTaskId,
    run_id: SummaryRunId,
    attempt_id: SummaryAttemptId,
    owner_generation: u64,
    owner_control_event_id: EventId,
    artifact_kind: SummaryArtifactKind,
    snapshot: &'a SummarySourceSnapshot,
    output: &'a SummaryOutput,
    supersedes_artifact_id: Option<EventId>,
    occurred_at_ms: i64,
}
impl SummaryArtifactRecord {
    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        Ok(serde_json::to_vec(&Artifact {
            kind: "summary/1",
            event_id: self.event_id,
            profile_id: self.profile_id,
            device_id: self.device_id,
            author_id: self.author_id,
            task_id: self.task_id,
            run_id: self.run_id,
            attempt_id: self.attempt_id,
            owner_generation: self.owner_generation,
            owner_control_event_id: self.owner_control_event_id,
            artifact_kind: self.artifact_kind,
            snapshot: &self.snapshot,
            output: &self.output,
            supersedes_artifact_id: self.supersedes_artifact_id,
            occurred_at_ms: self.occurred_at_ms,
        })?)
    }
    pub fn computed_digest(&self) -> Result<String, CoreError> {
        Ok(format!(
            "{:x}",
            Sha256::digest(self.canonical_fact_bytes()?)
        ))
    }
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        snapshot(&self.snapshot)?;
        if self
            .snapshot
            .origin_heads
            .iter()
            .any(|head| head.origin.profile_id != self.profile_id)
        {
            return Err(invalid("snapshot origin profile"));
        }
        output(&self.output, &self.snapshot)?;
        if self.task_id.is_nil()
            || self.run_id.is_nil()
            || self.attempt_id.is_nil()
            || self.author_id.is_nil()
            || self.owner_generation == 0
            || self.owner_generation > MAX_SUMMARY_SAFE_COUNTER
            || self.occurred_at_ms < 0
            || self.computed_digest()? != self.digest
        {
            return Err(invalid("artifact header/digest"));
        }
        crate::fact_encoding::encode_fact(self)?;
        Ok(())
    }
}
pub(super) fn output(
    value: &SummaryOutput,
    source: &SummarySourceSnapshot,
) -> Result<(), CoreError> {
    if value.narrative.trim().is_empty()
        || value.narrative.len() > 128 * 1024
        || value.evidence.len() > MAX_SUMMARY_SOURCES
        || source.sources.is_empty()
        || value.evidence.is_empty()
        || value.model.prompt_template.is_empty()
        || value.model.prompt_template.len() > 128
        || value.model.requested_model.is_empty()
        || value.model.requested_model.len() > 256
        || value.model.max_output_tokens == 0
        || value.model.max_output_tokens > 131072
        || value.model.provider.is_empty()
        || value.model.provider.len() > 128
        || value.model.model.is_empty()
        || value.model.model.len() > 256
        || !sha(&value.model.role_config_digest)
        || !sha(&value.model.request_input_digest)
        || value
            .usage
            .input_tokens
            .is_some_and(|n| n > MAX_SUMMARY_SAFE_COUNTER)
        || value
            .usage
            .output_tokens
            .is_some_and(|n| n > MAX_SUMMARY_SAFE_COUNTER)
        || value
            .usage
            .provider_request_id
            .as_ref()
            .is_some_and(|s| s.len() > 256)
    {
        return Err(invalid("output bounds"));
    }
    let mut evidence = std::collections::HashSet::new();
    for id in &value.evidence {
        if !evidence.insert(id) || !source.sources.iter().any(|s| s.event_id == *id) {
            return Err(invalid("unknown evidence"));
        }
    }
    let mut ids = std::collections::HashSet::new();
    for id in &value.read_original_ids {
        if !ids.insert(id)
            || !source.materials.iter().any(|m| {
                m.original.original_id == *id
                    && m.selected
                    && m.read_state == SummaryMaterialState::VerifiedAvailable
            })
        {
            return Err(invalid("unselected or unreadable material"));
        }
    }
    Ok(())
}
