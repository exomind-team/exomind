//! Boundary regressions: reseal every changed fact so rejection
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

// Build the entire source/block/request/run/attempt/publication with the real
// local APIs first. Only the exported portable fact under test is changed;
// neither source database nor a historical artifact body is rewritten.
fn portable_kind_fixture() -> (ProfileId, crate::OriginPage, SummaryArtifactRecord) {
    use crate::{
        CaptureCommand, CommandId, Core, FeedbackInput, TimeblockAction, TimeblockCommand,
        TimerSpec,
    };
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let p = core
        .create_profile("portable artifact kind binding")
        .unwrap();
    let human = core.local_human(p).unwrap();
    let block = TimeblockId::new();
    let actions = [
        (
            1000,
            TimeblockAction::Start {
                block_id: block,
                name: "actual source block".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        ),
        (2000, TimeblockAction::EndAction { block_id: block }),
        (
            3000,
            TimeblockAction::SubmitFeedback {
                block_id: block,
                feedback: FeedbackInput::Skipped,
            },
        ),
    ];
    for (ms, action) in actions {
        let at = core
            .trusted_clock_stamp(Uuid::from_u128(7), ms, ms as u64)
            .unwrap();
        let command = TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: core.timeblock_snapshot(&human, p, &at).unwrap().revision,
            action,
        };
        core.apply_timeblock(&human, &command, &at).unwrap();
    }
    let capture = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1500,
        text: "Real portable evidence for kind binding".into(),
        tags: vec![],
        originals: vec![],
    };
    core.submit(&human, &capture).unwrap();
    let selection = core.summary_block_selection(&human, p, block).unwrap();
    core.request_summary(
        &human,
        &SummaryRequestCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::CompressedBlock,
            selection,
        },
    )
    .unwrap();
    let task = core
        .summary_tasks_page(&human, p, None, 25)
        .unwrap()
        .items
        .pop()
        .unwrap();
    let executor = core.local_summary_executor();
    let work = core
        .begin_summary_attempt(
            &executor,
            &SummaryBeginCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                task_id: task.task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: task.current_run.as_ref().unwrap().run_id,
                attempt_id: Uuid::new_v4(),
                role_config_digest: "a".repeat(64),
                max_attempts: 2,
                now_ms: 4000,
            },
        )
        .unwrap();
    assert!(
        work.snapshot
            .sources
            .iter()
            .any(|source| source.event_id == capture.event_id)
    );
    let output = artifact(p, work.snapshot.clone()).output;
    core.finish_summary_attempt(&executor, &work.ticket, &output)
        .unwrap();
    let completed = core.read_summary_task(&human, p, task.task_id).unwrap();
    assert_eq!(completed.state, SummaryState::Succeeded);
    let page = core
        .export_origin_page(
            &human,
            p,
            &crate::OriginPageQuery {
                max_bytes: crate::MAX_ORIGIN_PAGE_BYTES,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!page.has_more);
    assert_eq!(page.to, page.through);
    let result = page
        .entries
        .iter()
        .find_map(|entry| match &entry.fact {
            crate::ReplicatedFact::Summary(value) => Some(value.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(result.local_seq, 0);
    assert_eq!(result.artifact_kind, SummaryArtifactKind::CompressedBlock);
    result.validate().unwrap();
    (p, page, result)
}

fn reseal_portable_kind_page(page: &mut crate::OriginPage) {
    // Exactly the published origin-entry encoding, including its valid prefix.
    // Recomputing every following chain hash prevents a transport/hash failure
    // from substituting for the artifact/task semantic qualification assertion.
    let mut previous = page.from.hash.clone();
    for entry in &mut page.entries {
        entry.fact.validate().unwrap();
        entry.chain_hash = facts::hash(&(
            "exomind-origin-entry/1",
            page.origin.profile_id,
            page.origin.device_id,
            page.origin.restoration_epoch,
            entry.origin_seq,
            entry.fact.fact_type(),
            entry.fact.event_id(),
            entry.fact.digest(),
            &previous,
        ))
        .unwrap();
        previous = entry.chain_hash.clone();
    }
    page.to.hash = previous;
    page.through = page.to.clone();
}

fn import_portable_kind_page(
    p: ProfileId,
    page: &crate::OriginPage,
) -> (tempfile::TempDir, crate::Core) {
    let directory = tempfile::tempdir().unwrap();
    let receiver = crate::Core::open(directory.path()).unwrap();
    receiver
        .provision_profile(p, "portable artifact kind binding")
        .unwrap();
    let authority = receiver
        .trusted_replica_context(p, page.origin.device_id, page.origin.restoration_epoch, 1)
        .unwrap();
    let ack = receiver.import_origin_page(&authority, page).unwrap();
    assert_eq!(ack.inserted, page.entries.len() as u64);
    assert_eq!(ack.cursor, page.to);
    (directory, receiver)
}

fn assert_portable_kind_is_not_current(
    p: ProfileId,
    page: &crate::OriginPage,
    original: &SummaryArtifactRecord,
) {
    let (_directory, receiver) = import_portable_kind_page(p, page);
    let human = receiver.local_human(p).unwrap();
    let before: (String, String) = receiver
        .connection()
        .unwrap()
        .query_row(
            "SELECT body,digest FROM events WHERE event_id=?1",
            [original.event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let task = receiver
        .read_summary_task(&human, p, original.task_id)
        .unwrap();
    let artifacts = receiver
        .summary_artifacts_page(&human, p, original.task_id, None, 25)
        .unwrap();
    assert_eq!(artifacts.items.len(), 1);
    let retained = &artifacts.items[0];
    assert_eq!(retained.event_id, original.event_id);
    assert_eq!(retained.snapshot.digest, original.snapshot.digest);
    assert_eq!(retained.output.narrative, original.output.narrative);
    assert_ne!(retained.artifact_kind, task.artifact_kind);
    let after: (String, String) = receiver
        .connection()
        .unwrap()
        .query_row(
            "SELECT body,digest FROM events WHERE event_id=?1",
            [original.event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        before, after,
        "qualification reads must not rewrite historical bytes/digests"
    );
    assert!(
        task.latest_artifact_id != Some(original.event_id)
            && task.state != SummaryState::Succeeded
            && !retained.current,
        "valid portable result with kind {:?} must not qualify as current for task kind {:?}; task state {:?}, latest {:?}, artifact current {}",
        retained.artifact_kind,
        task.artifact_kind,
        task.state,
        task.latest_artifact_id,
        retained.current
    );
}

#[test]
fn portable_artifact_kind_mismatch_cannot_become_internal_current() {
    let (p, mut page, original) = portable_kind_fixture();
    for entry in &mut page.entries {
        if let crate::ReplicatedFact::Summary(value) = &mut entry.fact {
            value.artifact_kind = SummaryArtifactKind::CompressedMessage;
            value.digest = value.computed_digest().unwrap();
            value.validate().unwrap();
            assert_eq!(value.snapshot.digest, original.snapshot.digest);
            assert_eq!(
                value.owner_control_event_id,
                original.owner_control_event_id
            );
            assert_eq!(
                (
                    value.task_id,
                    value.run_id,
                    value.attempt_id,
                    value.owner_generation
                ),
                (
                    original.task_id,
                    original.run_id,
                    original.attempt_id,
                    original.owner_generation
                )
            );
        }
    }
    reseal_portable_kind_page(&mut page);
    assert_portable_kind_is_not_current(p, &page, &original);
}

#[test]
fn portable_artifact_kind_external_reserved_cannot_become_internal_current() {
    let (p, mut page, original) = portable_kind_fixture();
    for entry in &mut page.entries {
        if let crate::ReplicatedFact::Summary(value) = &mut entry.fact {
            value.artifact_kind = SummaryArtifactKind::ExternalSummary;
            value.digest = value.computed_digest().unwrap();
            value.validate().unwrap();
            assert_eq!(value.snapshot.digest, original.snapshot.digest);
            assert_eq!(
                value.owner_control_event_id,
                original.owner_control_event_id
            );
            assert_eq!(
                (
                    value.task_id,
                    value.run_id,
                    value.attempt_id,
                    value.owner_generation
                ),
                (
                    original.task_id,
                    original.run_id,
                    original.attempt_id,
                    original.owner_generation
                )
            );
        }
    }
    reseal_portable_kind_page(&mut page);
    assert_portable_kind_is_not_current(p, &page, &original);
}

#[test]
fn portable_artifact_kind_old_record_cannot_satisfy_different_task_kind() {
    let (p, mut page, original) = portable_kind_fixture();
    let original_bytes = original.canonical_fact_bytes().unwrap();
    for entry in &mut page.entries {
        if let crate::ReplicatedFact::SummaryJob(value) = &mut entry.fact {
            if let SummaryJobPayload::Requested { artifact_kind, .. } = &mut value.payload {
                *artifact_kind = SummaryArtifactKind::CompressedMessage;
                value.digest = value.computed_digest().unwrap();
                value.validate().unwrap();
            }
        }
    }
    let retained = page
        .entries
        .iter()
        .find_map(|entry| match &entry.fact {
            crate::ReplicatedFact::Summary(value) => Some(value),
            _ => None,
        })
        .unwrap();
    assert_eq!(retained.canonical_fact_bytes().unwrap(), original_bytes);
    assert_eq!(retained.digest, original.digest);
    reseal_portable_kind_page(&mut page);
    assert_portable_kind_is_not_current(p, &page, &original);
}

#[test]
fn portable_artifact_kind_matching_result_remains_internal_current() {
    let (p, page, original) = portable_kind_fixture();
    let (_directory, receiver) = import_portable_kind_page(p, &page);
    let human = receiver.local_human(p).unwrap();
    let task = receiver
        .read_summary_task(&human, p, original.task_id)
        .unwrap();
    let artifacts = receiver
        .summary_artifacts_page(&human, p, original.task_id, None, 25)
        .unwrap();
    assert_eq!(task.state, SummaryState::Succeeded);
    assert_eq!(task.latest_artifact_id, Some(original.event_id));
    assert_eq!(task.artifact_kind, original.artifact_kind);
    assert_eq!(artifacts.items.len(), 1);
    assert!(artifacts.items[0].current);
    assert_eq!(artifacts.items[0].event_id, original.event_id);
}
#[test]
fn genuine_legacy_summary_snapshot_fixture_stays_valid_without_rewriting_raw_body() {
    use sha2::{Digest, Sha256};
    use std::{env, fs, path::PathBuf};

    let fixture_dir = PathBuf::from(
        env::var_os("EXOMIND_PREFREEZE_FIXTURE_DIR")
            .expect("run the old-baseline generator and point at its raw fixture directory"),
    );
    let body_path = fixture_dir.join("summary-body.json");
    let raw_body = fs::read(&body_path).unwrap();
    let stored_digest = fs::read_to_string(fixture_dir.join("summary-digest.txt")).unwrap();
    let stored_digest = stored_digest.trim_end();
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture_dir.join("manifest.json")).unwrap()).unwrap();

    let body_digest = format!("{:x}", Sha256::digest(&raw_body));
    assert_eq!(
        manifest["artifact_body_sha256"].as_str(),
        Some(body_digest.as_str()),
        "raw body SHA is separate provenance; it is not the domain artifact digest"
    );
    assert_eq!(
        manifest["artifact_digest"].as_str(),
        Some(stored_digest)
    );
    assert_eq!(
        manifest["baseline_commit"].as_str(),
        Some("5708e0baf5cdc896559fab5172dc13805531ba33")
    );
    assert_eq!(
        manifest["core10_payload_commit"].as_str(),
        Some("cc3bc937c4196d1a6a838b10a82018dc37d66480")
    );

    // Decode the exact stored body, including its digest and bookkeeping fields.
    // Production computed_digest() hashes canonical_fact_bytes(), not these raw
    // storage bytes; do not compare the domain digest to the body SHA.
    let record: SummaryArtifactRecord = serde_json::from_slice(&raw_body).unwrap();
    assert_eq!(record.digest.as_str(), stored_digest);
    facts::snapshot(&record.snapshot).unwrap();
    record.validate().unwrap();
    assert_eq!(record.computed_digest().unwrap(), stored_digest);
    let snapshot = &record.snapshot;
    assert_eq!(
        snapshot.digest,
        manifest["snapshot_digest"].as_str().unwrap()
    );
    assert_eq!(
        fs::read_to_string(fixture_dir.join("snapshot-digest.txt")).unwrap().trim_end(),
        snapshot.digest
    );

    let capture_id: EventId = manifest["capture_event_id"].as_str().unwrap().parse().unwrap();
    let correction_id: EventId = manifest["correction_event_id"].as_str().unwrap().parse().unwrap();
    assert!(snapshot.sources.iter().any(|source| {
        source.event_id == capture_id && source.kind == "capture"
    }));
    assert!(!snapshot.sources.iter().any(|source| source.event_id == correction_id));

    // This test only reads the exact legacy body bytes; it does not create a new DTO
    // and serialize it in place of the historical artifact.
    assert_eq!(fs::read(body_path).unwrap(), raw_body);
}
