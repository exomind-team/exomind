//! Negative-only regression slice: reseal every changed fact so rejection
//! cannot accidentally be attributed to its digest rather than the boundary.
use super::{facts, model::*};
use crate::{
    CoreError, DeviceId, EventId, OriginCursor, OriginIdentity, OriginalId, OriginalRef, ProfileId,
    TimeblockId,
};
use uuid::Uuid;

fn seal(snapshot: &mut SummarySourceSnapshot) {
    snapshot.digest.clear();
    snapshot.digest = facts::hash(snapshot).unwrap();
}
fn source(p: ProfileId) -> SummarySourceSnapshot {
    let original = OriginalRef {
        original_id: OriginalId::new(),
        sha256: "c".repeat(64),
        byte_length: 0,
        file_name: "synthetic.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    let mut value = SummarySourceSnapshot {
        selection: SummarySelection {
            block_ids: vec![TimeblockId::new()],
            from_ms: 1000,
            to_ms: 2000,
            selected_original_ids: vec![],
        },
        sources: vec![SummarySourceRef {
            event_id: EventId::new(),
            kind: "capture".into(),
            digest: "d".repeat(64),
        }],
        feedback_ids: vec![],
        origin_heads: vec![SummaryOriginHead {
            origin: OriginIdentity {
                profile_id: p,
                device_id: DeviceId::new(),
                restoration_epoch: Uuid::new_v4(),
            },
            cursor: OriginCursor {
                seq: 1,
                hash: "e".repeat(64),
            },
        }],
        through: 1,
        input_encoded_bytes: 400,
        materials: vec![SummaryMaterial {
            original: original.clone(),
            selected: false,
            read_state: SummaryMaterialState::NotSelected,
        }],
        coverage: SummaryCoverage {
            page_limit: false,
            input_byte_limit: false,
            omitted_source_ids: vec![],
            read_failures: vec![],
            missing_parents: vec![],
            metadata_only: vec![original.original_id],
            unread_originals: vec![original.original_id],
            remote_visibility: SummaryRemoteVisibility::Unknown,
        },
        digest: String::new(),
    };
    seal(&mut value);
    facts::snapshot(&value).unwrap();
    value
}
fn job(p: ProfileId, source: SummarySourceSnapshot) -> SummaryJobRecord {
    let mut node = SummaryJobRecord {
        event_id: EventId::new(),
        profile_id: p,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        actor_kind: SummaryActorKind::Executor,
        task_id: Uuid::new_v4(),
        parents: vec![],
        occurred_at_ms: 2000,
        payload: SummaryJobPayload::Execution {
            run_id: Uuid::new_v4(),
            owner_generation: 1,
            owner_control_event_id: EventId::new(),
            state: SummaryState::Running,
            reason: None,
            attempt_id: Some(Uuid::new_v4()),
            attempt_number: 1,
            retry_at_ms: None,
            snapshot: Some(source),
            role_config_digest: Some("a".repeat(64)),
            max_attempts: 1,
        },
        digest: String::new(),
        local_seq: 0,
    };
    node.digest = node.computed_digest().unwrap();
    node
}
fn artifact(p: ProfileId, source: SummarySourceSnapshot) -> SummaryArtifactRecord {
    let evidence = source.sources.iter().take(1).map(|s| s.event_id).collect();
    let mut value = SummaryArtifactRecord {
        event_id: EventId::new(),
        profile_id: p,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        task_id: Uuid::new_v4(),
        run_id: Uuid::new_v4(),
        attempt_id: Uuid::new_v4(),
        owner_generation: 1,
        owner_control_event_id: EventId::new(),
        artifact_kind: SummaryArtifactKind::Review,
        snapshot: source,
        output: SummaryOutput {
            narrative: "Synthetic scoped result".into(),
            evidence,
            read_original_ids: vec![],
            model: SummaryModelMetadata {
                provider: "synthetic".into(),
                model: "synthetic".into(),
                role_config_digest: "a".repeat(64),
                request_input_digest: "b".repeat(64),
                prompt_template: "exomind-summary/v1".into(),
                include_suggestions: false,
                max_output_tokens: 64,
                requested_model: "synthetic".into(),
            },
            usage: SummaryUsage {
                input_tokens: None,
                output_tokens: None,
                provider_request_id: None,
            },
        },
        supersedes_artifact_id: None,
        occurred_at_ms: 2000,
        digest: String::new(),
        local_seq: 0,
    };
    value.digest = value.computed_digest().unwrap();
    value
}
fn rejected(result: Result<(), CoreError>) -> bool {
    matches!(result, Err(CoreError::InvalidSummary(_)))
}

#[test]
fn raw_job_snapshot_origin_head_cannot_cross_profile() {
    let p = ProfileId::new();
    let mut snapshot = source(p);
    job(p, snapshot.clone()).validate().unwrap();
    snapshot.origin_heads[0].origin.profile_id = ProfileId::new();
    seal(&mut snapshot);
    assert!(
        rejected(job(p, snapshot).validate()),
        "valid-digest job must reject a Q origin head in its P snapshot"
    );
}

#[test]
fn raw_artifact_snapshot_origin_head_cannot_cross_profile() {
    let p = ProfileId::new();
    let mut snapshot = source(p);
    artifact(p, snapshot.clone()).validate().unwrap();
    snapshot.origin_heads[0].origin.profile_id = ProfileId::new();
    seal(&mut snapshot);
    assert!(
        rejected(artifact(p, snapshot).validate()),
        "valid-digest artifact must reject a Q origin head in its P snapshot"
    );
}

fn empty_source(p: ProfileId) -> SummarySourceSnapshot {
    let mut value = source(p);
    value.sources.clear();
    value.materials.clear();
    value.coverage.metadata_only.clear();
    value.coverage.unread_originals.clear();
    value.input_encoded_bytes = 0;
    seal(&mut value);
    value
}

#[test]
fn raw_running_job_requires_nonempty_frozen_sources() {
    let p = ProfileId::new();
    assert!(
        rejected(job(p, empty_source(p)).validate()),
        "raw Running must not bypass begin's empty-source refusal"
    );
}

#[test]
fn raw_artifact_requires_nonempty_source_and_evidence() {
    let p = ProfileId::new();
    assert!(
        rejected(artifact(p, empty_source(p)).validate()),
        "raw artifact with no source and no evidence cannot be a successful result"
    );
}

#[test]
fn coverage_material_lists_are_unique_bounded_subsets_of_materials() {
    let p = ProfileId::new();
    let base = source(p);
    let original = base.materials[0].original.original_id;
    let mut accepted = vec![];
    for unread in [false, true] {
        for mode in 0..3 {
            let mut value = base.clone();
            let ids = match mode {
                0 => vec![original, original],
                1 => vec![OriginalId::new()],
                _ => vec![original; 257],
            };
            if unread {
                value.coverage.unread_originals = ids;
            } else {
                value.coverage.metadata_only = ids;
            }
            seal(&mut value);
            if facts::snapshot(&value).is_ok() {
                accepted.push((unread, mode));
            }
        }
    }
    assert!(
        accepted.is_empty(),
        "accepted malformed coverage (unread,mode): {accepted:?}"
    );
}

#[test]
fn coverage_omitted_sources_are_unique_and_excluded_from_frozen_sources() {
    let base = source(ProfileId::new());
    let mut accepted = vec![];
    for duplicate in [false, true] {
        let mut value = base.clone();
        let omitted = if duplicate {
            let id = EventId::new();
            vec![id, id]
        } else {
            vec![base.sources[0].event_id]
        };
        value.coverage.input_byte_limit = true;
        value.coverage.omitted_source_ids = omitted;
        seal(&mut value);
        if facts::snapshot(&value).is_ok() {
            accepted.push(duplicate);
        }
    }
    assert!(
        accepted.is_empty(),
        "accepted malformed omitted coverage (duplicate): {accepted:?}"
    );
}

#[test]
fn coverage_read_failures_and_missing_parents_are_sets() {
    let base = source(ProfileId::new());
    let mut accepted = vec![];
    for missing_parent in [false, true] {
        let mut value = base.clone();
        let id = EventId::new();
        if missing_parent {
            value.coverage.missing_parents = vec![id, id];
        } else {
            value.coverage.read_failures = vec![id, id];
        }
        seal(&mut value);
        if facts::snapshot(&value).is_ok() {
            accepted.push(missing_parent);
        }
    }
    assert!(
        accepted.is_empty(),
        "accepted repeated gap identifiers (missing_parent): {accepted:?}"
    );
}
