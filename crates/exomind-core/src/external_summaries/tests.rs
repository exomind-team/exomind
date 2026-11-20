use crate::*;
use rusqlite::params;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn fixture() -> (
    tempfile::TempDir,
    Core,
    ProfileId,
    AgentId,
    ExternalSummaryAppendCommand,
) {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let p = core.create_profile("external P").unwrap();
    let source = capture(&core, p, "actual scoped source", vec![]);
    let observed = core
        .events_page(&core.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap()
        .highwater;
    let command = ExternalSummaryAppendCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 2000,
        observed_through: observed,
        sources: vec![source],
        narrative: "External Agent's explicit-source attestation".into(),
        evidence: vec![],
    };
    let evidence = command.sources[0].event_id;
    (
        directory,
        core,
        p,
        AgentId::new(),
        ExternalSummaryAppendCommand {
            evidence: vec![evidence],
            ..command
        },
    )
}
fn capture(core: &Core, p: ProfileId, text: &str, originals: Vec<OriginalRef>) -> SummarySourceRef {
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1500,
        text: text.into(),
        tags: vec![],
        originals,
    };
    let receipt = core
        .submit(&core.local_human(p).unwrap(), &command)
        .unwrap();
    SummarySourceRef {
        event_id: receipt.event_id,
        kind: "capture".into(),
        digest: receipt.event_digest,
    }
}
fn counts(core: &Core) -> (i64, i64, i64) {
    core.connection().unwrap().query_row("SELECT (SELECT count(*) FROM events),(SELECT count(*) FROM command_receipts),(SELECT count(*) FROM summary_nodes)",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap()
}
fn external(core: &Core, p: ProfileId, event: EventId) -> ExternalSummaryRecord {
    match core
        .read_timeline_event(&core.local_human(p).unwrap(), p, event)
        .unwrap()
        .unwrap()
    {
        TimelineItem::AgentSummary(record) => record,
        _ => panic!("external typed fact required"),
    }
}
fn page(core: &Core, p: ProfileId) -> OriginPage {
    core.export_origin_page(
        &core.local_human(p).unwrap(),
        p,
        &OriginPageQuery {
            max_bytes: MAX_ORIGIN_PAGE_BYTES,
            ..Default::default()
        },
    )
    .unwrap()
}
fn import(receiver: &Core, input: &OriginPage) -> Result<ImportAck, CoreError> {
    let authority = receiver
        .trusted_replica_context(
            input.origin.profile_id,
            input.origin.device_id,
            input.origin.restoration_epoch,
            1,
        )
        .unwrap();
    receiver.import_origin_page(&authority, input)
}
fn reseal(input: &mut OriginPage) {
    let mut previous = input.from.hash.clone();
    for entry in &mut input.entries {
        entry.chain_hash = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    "exomind-origin-entry/1",
                    input.origin.profile_id,
                    input.origin.device_id,
                    input.origin.restoration_epoch,
                    entry.origin_seq,
                    entry.fact.fact_type(),
                    entry.fact.event_id(),
                    entry.fact.digest(),
                    &previous
                ))
                .unwrap()
            )
        );
        previous = entry.chain_hash.clone();
    }
    input.to.hash = previous;
    input.through = input.to.clone();
}
fn verified(core: &Core, p: ProfileId, id: OriginalId) -> OriginalRef {
    let human = core.local_human(p).unwrap();
    let stage = StageId::new();
    let bytes = b"private source bytes";
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            profile_id: p,
            original_id: id,
            expected_sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
            file_name: "synthetic.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    )
    .unwrap();
    core.write_stage_chunk(&human, stage, 0, bytes).unwrap();
    let proof = core
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap().original
}

#[test]
fn external_append_is_typed_idempotent_and_never_an_internal_job() {
    let (_directory, core, p, agent, command) = fixture();
    let producer = core.local_external_summary_producer(p, agent).unwrap();
    let before = counts(&core);
    let receipt = core.append_external_summary(&producer, &command).unwrap();
    let replay = core.append_external_summary(&producer, &command).unwrap();
    assert!(replay.replayed);
    assert_eq!(receipt.event_id, replay.event_id);
    assert_eq!(receipt.event_digest, replay.event_digest);
    assert_eq!(counts(&core), (before.0 + 1, before.1 + 1, before.2));
    let record = external(&core, p, receipt.event_id);
    assert_eq!(record.producer_agent_id, agent);
    assert_eq!(record.snapshot.sources, command.sources);
    assert_eq!(
        record.snapshot.coverage.remote_visibility,
        SummaryRemoteVisibility::Unknown
    );
    assert_eq!(
        record.snapshot.coverage.source_delivery,
        ExternalSummarySourceDelivery::NotAttested
    );
    let mut portable = record.clone();
    portable.local_seq = 0;
    assert_eq!(
        record.canonical_fact_bytes().unwrap(),
        portable.canonical_fact_bytes().unwrap()
    );
    assert_eq!(record.computed_digest().unwrap(), record.digest);
    let human = core.local_human(p).unwrap();
    let timeline = core
        .timeline_page(
            &human,
            p,
            &EventQuery {
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        matches!(&timeline.items[0],TimelineItem::AgentSummary(value)if value.event_id==receipt.event_id)
    );
    assert!(timeline.next_before.is_some());
    assert_eq!(
        core.events_page(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    assert!(
        core.summary_tasks_page(&human, p, None, 25)
            .unwrap()
            .items
            .is_empty()
    );
    assert!(
        core.reconcile_summary_triggers(&core.local_summary_executor())
            .unwrap()
            .created
            .is_empty()
    );
}

#[test]
fn external_rejects_invalid_sources_observation_evidence_and_output_without_writes() {
    let (_directory, core, p, agent, command) = fixture();
    let producer = core.local_external_summary_producer(p, agent).unwrap();
    let before = counts(&core);
    let mut cases = vec![];
    let mut value = command.clone();
    value.sources.clear();
    cases.push(value);
    let mut value = command.clone();
    value.sources.push(value.sources[0].clone());
    cases.push(value);
    let mut value = command.clone();
    value.sources[0].digest = "0".repeat(64);
    cases.push(value);
    let mut value = command.clone();
    value.sources[0].event_id = EventId::new();
    value.evidence = vec![value.sources[0].event_id];
    cases.push(value);
    let mut value = command.clone();
    value.sources[0].kind = "summary/1".into();
    cases.push(value);
    let mut value = command.clone();
    value.observed_through = 0;
    cases.push(value);
    let mut value = command.clone();
    value.observed_through += 100;
    cases.push(value);
    let mut value = command.clone();
    value.observed_through = MAX_SUMMARY_SAFE_COUNTER + 1;
    cases.push(value);
    let mut value = command.clone();
    value.sources = (0..=MAX_SUMMARY_SOURCES)
        .map(|_| SummarySourceRef {
            event_id: EventId::new(),
            kind: "capture".into(),
            digest: command.sources[0].digest.clone(),
        })
        .collect();
    value.evidence = vec![value.sources[0].event_id];
    cases.push(value);
    let mut value = command.clone();
    value.evidence.clear();
    cases.push(value);
    let mut value = command.clone();
    value.evidence = vec![EventId::new()];
    cases.push(value);
    let mut value = command.clone();
    value.evidence.push(value.evidence[0]);
    cases.push(value);
    let mut value = command.clone();
    value.narrative = " \n".into();
    cases.push(value);
    let mut value = command.clone();
    value.narrative = "x".repeat(128 * 1024 + 1);
    cases.push(value);
    let mut value = command.clone();
    value.occurred_at_ms = -1;
    cases.push(value);
    for value in cases {
        assert!(matches!(
            core.append_external_summary(&producer, &value),
            Err(CoreError::InvalidExternalSummary(_))
        ));
        assert_eq!(counts(&core), before);
    }
}

#[test]
fn external_scope_lifecycle_and_actor_bound_receipt_cannot_be_reused() {
    let (directory, core, p, agent, command) = fixture();
    let producer = core.local_external_summary_producer(p, agent).unwrap();
    let q = core.create_profile("Q").unwrap();
    let foreign = capture(&core, q, "private Q", vec![]);
    let before = counts(&core);
    let mut crossed = command.clone();
    crossed.sources = vec![foreign.clone()];
    crossed.evidence = vec![foreign.event_id];
    assert!(matches!(
        core.append_external_summary(&producer, &crossed),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    assert_eq!(counts(&core), before);
    crossed.profile_id = q;
    assert!(matches!(
        core.append_external_summary(&producer, &crossed),
        Err(CoreError::ScopeMismatch)
    ));
    let receipt = core.append_external_summary(&producer, &command).unwrap();
    let mut changed = command.clone();
    changed.narrative.push('!');
    assert!(matches!(
        core.append_external_summary(&producer, &changed),
        Err(CoreError::CommandConflict)
    ));
    let other = core
        .local_external_summary_producer(p, AgentId::new())
        .unwrap();
    assert!(matches!(
        core.append_external_summary(&other, &command),
        Err(CoreError::CommandConflict)
    ));
    let capture = CaptureCommand {
        command_id: command.command_id,
        event_id: command.event_id,
        profile_id: p,
        occurred_at_ms: command.occurred_at_ms,
        text: command.narrative.clone(),
        tags: vec![],
        originals: vec![],
    };
    assert!(matches!(
        core.submit(&core.local_agent(p, agent).unwrap(), &capture),
        Err(CoreError::CommandConflict)
    ));
    drop(core);
    let reopened = Core::open(directory.path()).unwrap();
    assert!(matches!(
        reopened.append_external_summary(&producer, &command),
        Err(CoreError::ForeignContext)
    ));
    let valid = reopened.local_external_summary_producer(p, agent).unwrap();
    let replay = reopened.append_external_summary(&valid, &command).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event_id, receipt.event_id);
}

#[test]
fn external_materials_are_derived_from_sources_and_all_remain_unread() {
    let (_directory, core, p, agent, mut command) = fixture();
    let original = verified(&core, p, OriginalId::new());
    let source = capture(&core, p, "attachment metadata", vec![original.clone()]);
    command.sources = vec![source.clone()];
    command.evidence = vec![source.event_id];
    command.observed_through = core
        .events_page(&core.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap()
        .highwater;
    let receipt = core
        .append_external_summary(
            &core.local_external_summary_producer(p, agent).unwrap(),
            &command,
        )
        .unwrap();
    let record = external(&core, p, receipt.event_id);
    assert_eq!(record.snapshot.materials, vec![original.clone()]);
    assert_eq!(
        record.snapshot.coverage.unread_original_ids,
        vec![original.original_id]
    );
    for key in [
        "producer_agent_id",
        "current",
        "coverage",
        "read_original_ids",
        "task_id",
        "run_id",
    ] {
        let mut raw = serde_json::to_value(&command).unwrap();
        raw[key] = serde_json::json!([]);
        assert!(serde_json::from_value::<ExternalSummaryAppendCommand>(raw).is_err());
    }
    let mut forged = record.clone();
    forged.snapshot.coverage.unread_original_ids.clear();
    forged.snapshot.seal().unwrap();
    forged.digest = forged.computed_digest().unwrap();
    assert!(matches!(
        forged.validate(),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    let mut forged = record;
    forged.snapshot.coverage.remote_visibility = SummaryRemoteVisibility::FrozenKnownHeads;
    forged.snapshot.seal().unwrap();
    forged.digest = forged.computed_digest().unwrap();
    assert!(matches!(
        forged.validate(),
        Err(CoreError::InvalidExternalSummary(_))
    ));
}

#[test]
fn external_portable_material_and_unread_bounds_are_not_silently_clipped() {
    let (_directory, core, p, agent, command) = fixture();
    let receipt = core
        .append_external_summary(
            &core.local_external_summary_producer(p, agent).unwrap(),
            &command,
        )
        .unwrap();
    let record = external(&core, p, receipt.event_id);
    let mut too_many = record.clone();
    too_many.snapshot.materials = (0..257)
        .map(|_| OriginalRef {
            original_id: OriginalId::new(),
            sha256: "a".repeat(64),
            byte_length: 0,
            file_name: "synthetic".into(),
            media_type: "application/octet-stream".into(),
        })
        .collect();
    too_many.snapshot.coverage.unread_original_ids = too_many
        .snapshot
        .materials
        .iter()
        .map(|item| item.original_id)
        .collect();
    too_many.snapshot.seal().unwrap();
    too_many.digest = too_many.computed_digest().unwrap();
    assert!(matches!(
        too_many.validate(),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    let mut unbound = record;
    unbound
        .snapshot
        .coverage
        .unread_original_ids
        .push(OriginalId::new());
    unbound.snapshot.seal().unwrap();
    unbound.digest = unbound.computed_digest().unwrap();
    assert!(matches!(
        unbound.validate(),
        Err(CoreError::InvalidExternalSummary(_))
    ));
}

#[test]
fn external_rejects_oversized_frozen_inputs_and_derived_recursion_without_truncation() {
    let (_directory, core, p, agent, command) = fixture();
    let producer = core.local_external_summary_producer(p, agent).unwrap();
    let first = core.append_external_summary(&producer, &command).unwrap();
    let mut recursive = command.clone();
    recursive.command_id = CommandId::new();
    recursive.event_id = EventId::new();
    recursive.sources = vec![SummarySourceRef {
        event_id: first.event_id,
        kind: "capture".into(),
        digest: first.event_digest,
    }];
    recursive.evidence = vec![first.event_id];
    recursive.observed_through = first.local_seq;
    let before = counts(&core);
    assert!(matches!(
        core.append_external_summary(&producer, &recursive),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    assert_eq!(counts(&core), before);
    let left = capture(&core, p, &"a".repeat(128 * 1024), vec![]);
    let right = capture(&core, p, &"b".repeat(128 * 1024), vec![]);
    let mut oversized = command;
    oversized.command_id = CommandId::new();
    oversized.event_id = EventId::new();
    oversized.sources = vec![left.clone(), right];
    oversized.evidence = vec![left.event_id];
    oversized.observed_through = core
        .events_page(&core.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap()
        .highwater;
    let before = counts(&core);
    assert!(matches!(
        core.append_external_summary(&producer, &oversized),
        Err(CoreError::InvalidExternalSummary("input byte limit"))
    ));
    assert_eq!(counts(&core), before);
}

#[test]
fn external_derived_fact_inside_time_range_is_not_an_internal_model_input() {
    let (_directory, core, p, agent, command) = fixture();
    let receipt = core
        .append_external_summary(
            &core.local_external_summary_producer(p, agent).unwrap(),
            &command,
        )
        .unwrap();
    let human = core.local_human(p).unwrap();
    let block = TimeblockId::new();
    for (ms, action) in [
        (
            1000,
            TimeblockAction::Start {
                block_id: block,
                name: "internal source block".into(),
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
    ] {
        let at = core
            .trusted_clock_stamp(Uuid::from_u128(7), ms, ms as u64)
            .unwrap();
        core.apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: core.timeblock_snapshot(&human, p, &at).unwrap().revision,
                action,
            },
            &at,
        )
        .unwrap();
    }
    core.request_summary(
        &human,
        &SummaryRequestCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::Review,
            selection: core.summary_block_selection(&human, p, block).unwrap(),
        },
    )
    .unwrap();
    let task = core
        .summary_tasks_page(&human, p, None, 25)
        .unwrap()
        .items
        .pop()
        .unwrap();
    let work = core
        .begin_summary_attempt(
            &core.local_summary_executor(),
            &SummaryBeginCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                task_id: task.task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: task.current_run.unwrap().run_id,
                attempt_id: Uuid::new_v4(),
                role_config_digest: "a".repeat(64),
                max_attempts: 1,
                now_ms: 4000,
            },
        )
        .unwrap();
    assert!(
        work.snapshot
            .sources
            .iter()
            .any(|source| source.event_id == command.sources[0].event_id)
    );
    assert!(
        !work
            .snapshot
            .sources
            .iter()
            .any(|source| source.event_id == receipt.event_id)
    );
    let input = core
        .summary_input_records(&core.local_summary_executor(), &work.ticket)
        .unwrap();
    assert_eq!(input.records.len(), work.snapshot.sources.len());
}

#[test]
fn external_direct_origin_replication_preserves_unknown_sources_without_comparing_receiver_sequences()
 {
    let (_source_dir, source, p, _, base) = fixture();
    let producer_dir = tempfile::tempdir().unwrap();
    let producer_core = Core::open(producer_dir.path()).unwrap();
    producer_core.provision_profile(p, "external P").unwrap();
    import(&producer_core, &page(&source, p)).unwrap();
    let agent = AgentId::new();
    let authority = producer_core
        .local_external_summary_producer(p, agent)
        .unwrap();
    let receipt = producer_core
        .append_external_summary(&authority, &base)
        .unwrap();
    let input = page(&producer_core, p);
    assert_eq!(input.entries.len(), 1);
    let receiver_dir = tempfile::tempdir().unwrap();
    let receiver = Core::open(receiver_dir.path()).unwrap();
    receiver.provision_profile(p, "external P").unwrap();
    for index in 0..4 {
        capture(&receiver, p, &format!("receiver padding {index}"), vec![]);
    }
    let ack = import(&receiver, &input).unwrap();
    assert_eq!(ack.inserted, 1);
    let record = external(&receiver, p, receipt.event_id);
    assert!(record.local_seq > record.snapshot.observed_through);
    assert_eq!(
        record.snapshot.coverage.remote_visibility,
        SummaryRemoteVisibility::Unknown
    );
    assert!(
        receiver
            .read_timeline_event(
                &receiver.local_human(p).unwrap(),
                p,
                base.sources[0].event_id
            )
            .unwrap()
            .is_none()
    );
    import(&receiver, &page(&source, p)).unwrap();
    let replay = import(&receiver, &input).unwrap();
    assert_eq!(replay.duplicates, 1);
    assert_eq!(
        external(&receiver, p, receipt.event_id).digest,
        record.digest
    );
    let wrong = receiver
        .trusted_replica_context(p, DeviceId::new(), input.origin.restoration_epoch, 1)
        .unwrap();
    assert!(matches!(
        receiver.import_origin_page(&wrong, &input),
        Err(CoreError::InvalidReplication(_))
    ));
    let q = receiver.create_profile("other scope").unwrap();
    let wrong = receiver
        .trusted_replica_context(q, input.origin.device_id, input.origin.restoration_epoch, 1)
        .unwrap();
    assert!(matches!(
        receiver.import_origin_page(&wrong, &input),
        Err(CoreError::ScopeMismatch)
    ));
}

#[test]
fn external_portable_known_source_material_lie_is_rejected_with_valid_fact_and_chain_hashes() {
    let (_directory, core, p, agent, command) = fixture();
    core.append_external_summary(
        &core.local_external_summary_producer(p, agent).unwrap(),
        &command,
    )
    .unwrap();
    let mut input = page(&core, p);
    for entry in &mut input.entries {
        if let ReplicatedFact::AgentSummary(record) = &mut entry.fact {
            let original = OriginalRef {
                original_id: OriginalId::new(),
                sha256: "a".repeat(64),
                byte_length: 0,
                file_name: "not-in-source".into(),
                media_type: "application/octet-stream".into(),
            };
            record.snapshot.materials.push(original.clone());
            record
                .snapshot
                .coverage
                .unread_original_ids
                .push(original.original_id);
            record.snapshot.seal().unwrap();
            record.digest = record.computed_digest().unwrap();
            record.validate().unwrap();
        }
    }
    reseal(&mut input);
    let target = tempfile::tempdir().unwrap();
    let receiver = Core::open(target.path()).unwrap();
    receiver.provision_profile(p, "external P").unwrap();
    let before = counts(&receiver);
    assert!(matches!(
        import(&receiver, &input),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    assert_eq!(counts(&receiver), before);
}

#[test]
fn external_fact_cannot_publish_a_private_original_by_knowing_its_metadata() {
    let (_directory, core, p, agent, mut command) = fixture();
    let original = verified(&core, p, OriginalId::new());
    let source = capture(&core, p, "committed source", vec![original.clone()]);
    command.sources = vec![source.clone()];
    command.evidence = vec![source.event_id];
    command.observed_through = core
        .events_page(&core.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap()
        .highwater;
    // A separate producer origin knows the original source, then emits only
    // its own derived fact. The target has an uncommitted private stage with
    // the same UUID/hash, which the attestation must not publish.
    let middle_dir = tempfile::tempdir().unwrap();
    let middle = Core::open(middle_dir.path()).unwrap();
    middle.provision_profile(p, "external P").unwrap();
    import(&middle, &page(&core, p)).unwrap();
    let producer = middle.local_external_summary_producer(p, agent).unwrap();
    let receipt = middle.append_external_summary(&producer, &command).unwrap();
    let target = tempfile::tempdir().unwrap();
    let receiver = Core::open(target.path()).unwrap();
    receiver.provision_profile(p, "external P").unwrap();
    let private = verified(&receiver, p, original.original_id);
    assert_eq!(private, original);
    import(&receiver, &page(&middle, p)).unwrap();
    assert!(matches!(
        receiver.read_original_range(
            &receiver.local_human(p).unwrap(),
            p,
            original.original_id,
            0,
            1
        ),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert_eq!(
        external(&receiver, p, receipt.event_id)
            .snapshot
            .coverage
            .unread_original_ids,
        vec![original.original_id]
    );
    let links: i64 = receiver
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM event_originals WHERE event_id=?1",
            params![receipt.event_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(links, 0);
}
#[test]
fn external_summary_evidence_rejects_internal_correction_source_kind() {
    let (_directory, core, profile, agent, mut command) = fixture();
    let producer = core.local_external_summary_producer(profile, agent).unwrap();
    let source = command.sources[0].clone();
    let receipt = core.record_correction(
        &core.local_human(profile).unwrap(),
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 2_001,
            target_event_id: source.event_id,
            target_digest: source.digest,
            corrected_text: "Synthetic internal-only correction.".into(),
        },
    ).unwrap();
    command.command_id = CommandId::new();
    command.event_id = EventId::new();
    command.occurred_at_ms = 2_002;
    command.observed_through = core.events_page(
        &core.local_human(profile).unwrap(),
        profile,
        &EventQuery::default(),
    ).unwrap().highwater;
    command.sources = vec![SummarySourceRef {
        event_id: receipt.event_id,
        kind: "correction/1".into(),
        digest: receipt.event_digest,
    }];
    command.evidence = vec![receipt.event_id];

    let before = counts(&core);
    assert!(matches!(
        core.append_external_summary(&producer, &command),
        Err(CoreError::InvalidExternalSummary(_))
    ));
    assert_eq!(counts(&core), before);
}
