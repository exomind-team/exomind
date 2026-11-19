use exomind_core::*;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn capture(core: &Core, p: ProfileId, text: &str, originals: Vec<OriginalRef>) -> CaptureCommand {
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1000,
        text: text.into(),
        tags: vec!["tag".into()],
        originals,
    };
    core.submit(&core.local_human(p).unwrap(), &command)
        .unwrap();
    command
}
fn correction(
    p: ProfileId,
    target_event_id: EventId,
    target_digest: &str,
) -> RecordCorrectionCommand {
    RecordCorrectionCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 2000,
        target_event_id,
        target_digest: target_digest.to_owned(),
        corrected_text: "corrected by its human author".into(),
    }
}
fn peer(core: &Core, p: ProfileId, source: &Core) -> ReplicaContext {
    let origin = source
        .replication_identity(&source.local_human(p).unwrap(), p)
        .unwrap();
    core.trusted_replica_context(p, source.device_id(), origin.restoration_epoch, 1)
        .unwrap()
}
fn page(source: &Core, p: ProfileId) -> OriginPage {
    source
        .export_origin_page(
            &source.local_human(p).unwrap(),
            p,
            &OriginPageQuery::default(),
        )
        .unwrap()
}
fn pair() -> (tempfile::TempDir, tempfile::TempDir, Core, Core, ProfileId) {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let source = Core::open(a.path()).unwrap();
    let destination = Core::open(b.path()).unwrap();
    let p = ProfileId::new();
    source.provision_profile(p, "replicated profile").unwrap();
    destination
        .provision_profile(p, "replicated profile")
        .unwrap();
    (a, b, source, destination, p)
}
fn verified(core: &Core, p: ProfileId, original: OriginalRef, bytes: &[u8]) -> StageId {
    let human = core.local_human(p).unwrap();
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            original_id: original.original_id,
            profile_id: p,
            expected_sha256: original.sha256.clone(),
            byte_length: original.byte_length,
            file_name: original.file_name.clone(),
            media_type: original.media_type.clone(),
        },
    )
    .unwrap();
    if !bytes.is_empty() {
        core.write_stage_chunk(&human, stage, 0, bytes).unwrap();
    }
    let proof = core
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap();
    stage
}
fn original(bytes: &[u8]) -> OriginalRef {
    OriginalRef {
        original_id: OriginalId::new(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "opaque.bin".into(),
        media_type: "application/octet-stream".into(),
    }
}

#[test]
fn correction_imports_before_its_source_and_resolves_when_the_source_arrives() {
    let source_a_root = tempfile::tempdir().unwrap();
    let source_b_root = tempfile::tempdir().unwrap();
    let receiver_root = tempfile::tempdir().unwrap();
    let source_a = Core::open(source_a_root.path()).unwrap();
    let source_b = Core::open(source_b_root.path()).unwrap();
    let receiver = Core::open(receiver_root.path()).unwrap();
    let profile = ProfileId::new();
    for core in [&source_a, &source_b, &receiver] {
        core.provision_profile(profile, "synthetic shared profile")
            .unwrap();
    }

    let source_b_context = source_b.local_human(profile).unwrap();
    let target = capture(&source_b, profile, "arrives after its correction", vec![]);
    let target_digest = source_b
        .events(&source_b_context, profile)
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == target.event_id)
        .unwrap()
        .digest;
    let command = correction(profile, target.event_id, &target_digest);
    let source_a_context = source_a.local_human(profile).unwrap();
    let receipt = source_a
        .record_correction(&source_a_context, &command)
        .unwrap();
    let correction_page = page(&source_a, profile);
    let source_canonical = correction_page.entries[0]
        .fact
        .canonical_fact_bytes()
        .unwrap();

    let first_ack = receiver
        .import_origin_page(&peer(&receiver, profile, &source_a), &correction_page)
        .unwrap();
    let pending = receiver
        .corrections_page(
            &receiver.local_human(profile).unwrap(),
            profile,
            &EventQuery::default(),
        )
        .unwrap();
    let target_page = page(&source_b, profile);
    let target_ack = receiver
        .import_origin_page(&peer(&receiver, profile, &source_b), &target_page)
        .unwrap();
    let resolved = receiver
        .corrections_page(
            &receiver.local_human(profile).unwrap(),
            profile,
            &EventQuery::default(),
        )
        .unwrap();
    let replicated_tag_page = receiver
        .events_page_with_tag(
            &receiver.local_human(profile).unwrap(),
            profile,
            &EventQuery::default(),
            Some("tag"),
        )
        .unwrap();

    assert_eq!(first_ack.inserted, 1);
    assert_eq!(first_ack.cursor, correction_page.to);
    assert_eq!(
        pending.items[0].target_state,
        CorrectionTargetState::Unresolved
    );
    assert_eq!(target_ack.inserted, 1);
    assert_eq!(
        resolved.items[0].target_state,
        CorrectionTargetState::DigestMatches
    );
    assert_eq!(resolved.items[0].record.target_event_id, target.event_id);
    assert_eq!(resolved.items[0].record.target_digest, target_digest);
    assert_eq!(
        resolved.items[0].record.canonical_fact_bytes().unwrap(),
        source_canonical
    );
    assert!(
        replicated_tag_page
            .items
            .iter()
            .any(|event| event.event_id == target.event_id)
    );
    assert_eq!(
        receiver
            .receipt(&receiver.local_human(profile).unwrap(), command.command_id,)
            .unwrap(),
        None,
        "replication must not invent a receiver-local human receipt"
    );
    assert_eq!(receipt.event_id, command.event_id);
}

#[test]
fn late_target_with_a_different_digest_leaves_correction_explicitly_conflicted() {
    let source_a_root = tempfile::tempdir().unwrap();
    let source_b_root = tempfile::tempdir().unwrap();
    let receiver_root = tempfile::tempdir().unwrap();
    let source_a = Core::open(source_a_root.path()).unwrap();
    let source_b = Core::open(source_b_root.path()).unwrap();
    let receiver = Core::open(receiver_root.path()).unwrap();
    let profile = ProfileId::new();
    for core in [&source_a, &source_b, &receiver] {
        core.provision_profile(profile, "synthetic shared profile")
            .unwrap();
    }
    let target = capture(&source_b, profile, "actual source content", vec![]);
    let actual_digest = source_b
        .events(&source_b.local_human(profile).unwrap(), profile)
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == target.event_id)
        .unwrap()
        .digest;
    let wrong_digest = format!(
        "{}{}",
        if actual_digest.starts_with('0') {
            "1"
        } else {
            "0"
        },
        &actual_digest[1..]
    );
    let command = correction(profile, target.event_id, &wrong_digest);
    source_a
        .record_correction(&source_a.local_human(profile).unwrap(), &command)
        .unwrap();
    receiver
        .import_origin_page(
            &peer(&receiver, profile, &source_a),
            &page(&source_a, profile),
        )
        .unwrap();
    receiver
        .import_origin_page(
            &peer(&receiver, profile, &source_b),
            &page(&source_b, profile),
        )
        .unwrap();

    let result = receiver
        .corrections_page(
            &receiver.local_human(profile).unwrap(),
            profile,
            &EventQuery::default(),
        )
        .unwrap();

    assert_eq!(
        result.items[0].target_state,
        CorrectionTargetState::DigestConflict
    );
    assert_eq!(result.items[0].record.target_digest, wrong_digest);
    assert_eq!(result.items[0].record.target_event_id, target.event_id);
}

#[test]
fn source_inventory_notices_imports_when_the_receivers_own_origin_does_not_change() {
    let (_a, _b, source, destination, p) = pair();
    let reader = destination.local_human(p).unwrap();
    let original_own = destination.origin_checkpoint(&reader, p).unwrap();
    let before = destination.origin_inventory(&reader, p, 8).unwrap();
    capture(&source, p, "another device changes the profile", vec![]);
    let input = page(&source, p);
    destination
        .import_origin_page(&peer(&destination, p, &source), &input)
        .unwrap();
    let after = destination.origin_inventory(&reader, p, 8).unwrap();
    assert_ne!(before, after);
    assert_eq!(
        destination.origin_checkpoint(&reader, p).unwrap(),
        original_own
    );
    assert!(
        after
            .iter()
            .any(|s| s.origin == input.origin && s.head == input.to)
    );
    assert!(destination.origin_inventory(&reader, p, 1).is_err());
    assert!(destination.origin_inventory(&reader, p, 0).is_err());
    assert!(destination.origin_inventory(&reader, p, 4097).is_err());
    let q = destination.create_profile("other inventory scope").unwrap();
    assert!(
        destination
            .origin_inventory(&destination.local_human(q).unwrap(), p, 8)
            .is_err()
    );
}

#[test]
fn materialized_origin_export_preserves_provenance_without_receipts_or_cursor_writes() {
    let (_a, _b, source, destination, p) = pair();
    for i in 0..3 {
        capture(&source, p, &format!("portable history {i}"), vec![]);
    }
    let original = page(&source, p);
    let context = peer(&destination, p, &source);
    destination.import_origin_page(&context, &original).unwrap();
    let reader = destination.local_human(p).unwrap();
    let before = destination.replication_cursor(&context).unwrap();
    let copy = destination
        .export_known_origin_page(&reader, &original.origin, &OriginPageQuery::default())
        .unwrap();
    assert_eq!(
        serde_json::to_vec(&copy).unwrap(),
        serde_json::to_vec(&original).unwrap()
    );
    assert_eq!(destination.replication_cursor(&context).unwrap(), before);
    let db = rusqlite::Connection::open(destination.database_path()).unwrap();
    let receipts: i64 = db
        .query_row("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(receipts, 0);
    // The existing public own-origin export remains own-origin only.
    assert!(page(&destination, p).entries.is_empty());
    let mut unknown = original.origin.clone();
    unknown.device_id = DeviceId::new();
    assert!(
        destination
            .export_known_origin_page(&reader, &unknown, &OriginPageQuery::default())
            .is_err()
    );
    let mut changed_epoch = original.origin;
    changed_epoch.restoration_epoch = Uuid::new_v4();
    assert!(matches!(
        destination.export_known_origin_page(&reader, &changed_epoch, &OriginPageQuery::default()),
        Err(CoreError::OriginEpochChanged)
    ));
    let q = destination.create_profile("other profile").unwrap();
    assert!(
        destination
            .export_known_origin_page(
                &destination.local_human(q).unwrap(),
                &copy.origin,
                &OriginPageQuery::default()
            )
            .is_err()
    );
}

#[test]
fn direct_capture_import_preserves_fact_without_forging_receipt_and_recovers_a_lost_ack() {
    let (_a, b, source, destination, p) = pair();
    let bytes = b"remote unknown\0\xff";
    let original = original(bytes);
    verified(&source, p, original.clone(), bytes);
    let command = capture(&source, p, "from peer", vec![original.clone()]);
    capture(&destination, p, "receiver local ordering", vec![]);
    let context = peer(&destination, p, &source);
    let input = page(&source, p);
    let before = destination.replication_cursor(&context).unwrap();
    assert_eq!(before, input.from);
    let ack = destination.import_origin_page(&context, &input).unwrap();
    assert_eq!(ack.inserted, 1);
    assert_eq!(ack.missing_originals, vec![original.clone()]);
    assert_eq!(ack.cursor, input.to);
    let human = destination.local_human(p).unwrap();
    let imported = destination
        .events(&human, p)
        .unwrap()
        .into_iter()
        .find(|v| v.event_id == command.event_id)
        .unwrap();
    assert_eq!(
        ReplicatedFact::Capture(imported.clone())
            .canonical_fact_bytes()
            .unwrap(),
        input.entries[0].fact.canonical_fact_bytes().unwrap()
    );
    assert_eq!(imported.device_id, source.device_id());
    assert_eq!(imported.local_seq, 2);
    assert!(
        destination
            .receipt(&human, command.command_id)
            .unwrap()
            .is_none()
    );
    assert!(
        matches!(destination.original_availability(&human,p,original.original_id).unwrap(),OriginalAvailability::Missing{original:known} if known==original)
    );
    assert!(matches!(
        destination.read_original_range(&human, p, original.original_id, 0, 1),
        Err(CoreError::OriginalNotReady)
    ));
    let receiver_own = destination.origin_checkpoint(&human, p).unwrap();
    assert_eq!(receiver_own.seq, 1);
    drop(destination);
    let reopened = Core::open(b.path()).unwrap();
    let context = peer(&reopened, p, &source);
    let retried = reopened.import_origin_page(&context, &input).unwrap();
    assert!(retried.replayed);
    assert_eq!(retried.inserted, 0);
    assert_eq!(retried.cursor, input.to);
    assert_eq!(
        reopened
            .events(&reopened.local_human(p).unwrap(), p)
            .unwrap()
            .len(),
        2
    );
    verified(&reopened, p, original.clone(), bytes);
    assert_eq!(
        reopened
            .read_original_range(
                &reopened.local_human(p).unwrap(),
                p,
                original.original_id,
                0,
                bytes.len()
            )
            .unwrap()
            .bytes,
        bytes
    );
}

#[test]
fn guessed_same_profile_private_stage_cannot_be_published_by_import() {
    let (_a, _b, source, destination, p) = pair();
    let bytes = b"private same-profile draft";
    let original = original(bytes);
    let stage = verified(&destination, p, original.clone(), bytes);
    verified(&source, p, original.clone(), bytes);
    capture(
        &source,
        p,
        "guessing all metadata grants nothing",
        vec![original.clone()],
    );
    let context = peer(&destination, p, &source);
    let input = page(&source, p);
    assert!(matches!(
        destination.import_origin_page(&context, &input),
        Err(CoreError::OriginalConflict)
    ));
    let human = destination.local_human(p).unwrap();
    assert!(destination.events(&human, p).unwrap().is_empty());
    assert_eq!(
        destination.replication_cursor(&context).unwrap(),
        input.from
    );
    assert!(matches!(
        destination.read_original_range(&human, p, original.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert_eq!(
        destination
            .read_stage_range(&human, stage, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
}

#[test]
fn typed_import_rebuilds_current_but_never_takes_the_remote_scheduler() {
    let (_a, _b, source, destination, p) = pair();
    let human = source.local_human(p).unwrap();
    let stamp = source.trusted_clock_stamp(Uuid::new_v4(), 1000, 0).unwrap();
    let block = TimeblockId::new();
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: source
            .timeblock_snapshot(&human, p, &stamp)
            .unwrap()
            .revision,
        action: TimeblockAction::Start {
            block_id: block,
            name: "remote countdown".into(),
            note: "preserve source".into(),
            timer: TimerSpec::CountDown {
                duration_ms: 1000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    source.apply_timeblock(&human, &command, &stamp).unwrap();
    let input = page(&source, p);
    let context = peer(&destination, p, &source);
    let ack = destination.import_origin_page(&context, &input).unwrap();
    assert!(ack.projection_complete);
    let local = destination.local_human(p).unwrap();
    let future = destination
        .trusted_clock_stamp(Uuid::new_v4(), 9000, 8000)
        .unwrap();
    let active = destination
        .timeblock_snapshot(&local, p, &future)
        .unwrap()
        .active
        .unwrap();
    assert_eq!(active.block_id, block);
    assert_eq!(active.phase, TimeblockPhase::Running);
    assert!(active.deadline.is_none());
    assert!(
        destination
            .due_deadlines(&destination.local_scheduler(), &future, 100)
            .unwrap()
            .is_empty()
    );
    assert!(
        destination
            .receipt(&local, command.command_id)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        destination
            .timeblock_nodes(&local, p, &EventQuery::default())
            .unwrap()
            .items[0]
            .canonical_fact_bytes()
            .unwrap(),
        input.entries[0].fact.canonical_fact_bytes().unwrap()
    );
}

#[test]
fn export_frozen_snapshot_uses_origin_positions_and_actual_encoded_page_budget() {
    let (_a, _b, source, _destination, p) = pair();
    for i in 0..7 {
        capture(&source, p, &format!("{i} {}", "x".repeat(1200)), vec![]);
    }
    let human = source.local_human(p).unwrap();
    let mut query = OriginPageQuery {
        limit: 100,
        max_bytes: 4500,
        ..Default::default()
    };
    let first = source.export_origin_page(&human, p, &query).unwrap();
    assert!(first.entries.len() < 7 && first.has_more);
    assert!(serde_json::to_vec(&first).unwrap().len() <= 4500);
    query.through = Some(first.through.clone());
    query.after = Some(first.to.clone());
    capture(&source, p, "after snapshot", vec![]);
    let mut events = first
        .entries
        .iter()
        .map(|v| v.fact.event_id())
        .collect::<Vec<_>>();
    loop {
        let page = source.export_origin_page(&human, p, &query).unwrap();
        assert!(serde_json::to_vec(&page).unwrap().len() <= 4500);
        events.extend(page.entries.iter().map(|v| v.fact.event_id()));
        if !page.has_more {
            break;
        }
        query.after = Some(page.to);
    }
    assert_eq!(events.len(), 7);
    assert_eq!(
        events
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        7
    );
    let error = source
        .export_origin_page(
            &human,
            p,
            &OriginPageQuery {
                max_bytes: 1000,
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(
        matches!(error,CoreError::OriginPageOversize{origin_seq:1,required_bytes} if required_bytes>1000)
    );
}

// A hostile authenticated direct peer can send internally consistent changed
// facts. Build their protocol hash explicitly instead of bypassing Core's DB.
fn genesis(id: &OriginIdentity) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                "exomind-origin-genesis/1",
                id.profile_id,
                id.device_id,
                id.restoration_epoch
            ))
            .unwrap()
        )
    )
}
fn rechain(page: &mut OriginPage) {
    let mut previous = page.from.clone();
    for entry in &mut page.entries {
        match &mut entry.fact {
            ReplicatedFact::Capture(v) => v.digest = v.computed_digest().unwrap(),
            ReplicatedFact::Timeblock(v) => v.digest = v.computed_digest().unwrap(),
            ReplicatedFact::SummaryJob(v) => v.digest = v.computed_digest().unwrap(),
            ReplicatedFact::Summary(v) => v.digest = v.computed_digest().unwrap(),
            ReplicatedFact::AgentSummary(v) => v.digest = v.computed_digest().unwrap(),
            ReplicatedFact::Correction(v) => v.digest = v.computed_digest().unwrap(),
        }
        entry.origin_seq = previous.seq + 1;
        entry.chain_hash = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    "exomind-origin-entry/1",
                    page.origin.profile_id,
                    page.origin.device_id,
                    page.origin.restoration_epoch,
                    entry.origin_seq,
                    entry.fact.fact_type(),
                    entry.fact.event_id(),
                    entry.fact.digest(),
                    &previous.hash
                ))
                .unwrap()
            )
        );
        previous = OriginCursor {
            seq: entry.origin_seq,
            hash: entry.chain_hash.clone(),
        };
    }
    page.to = previous;
    page.through = page.to.clone();
    page.has_more = false;
}
#[test]
fn a_cursor_write_fault_rolls_back_facts_references_and_epoch_without_conflict_evidence() {
    let (_a, _b, source, destination, p) = pair();
    capture(&source, p, "first", vec![]);
    capture(&source, p, "second", vec![]);
    let input = page(&source, p);
    let context = peer(&destination, p, &source);
    let db = rusqlite::Connection::open(destination.database_path()).unwrap();
    db.execute_batch("CREATE TRIGGER fail_receiver BEFORE UPDATE ON receive_cursors BEGIN SELECT RAISE(ABORT,'synthetic receipt-free cursor fault'); END;").unwrap();
    assert!(matches!(
        destination.import_origin_page(&context, &input),
        Err(CoreError::Storage(_))
    ));
    assert!(
        destination
            .events(&destination.local_human(p).unwrap(), p)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        destination.replication_cursor(&context).unwrap(),
        input.from
    );
    let counts:(u64,u64,u64)=db.query_row("SELECT (SELECT count(*) FROM import_conflicts),(SELECT count(*) FROM accepted_origin_epochs),(SELECT count(*) FROM command_receipts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(counts, (0, 0, 0));
    db.execute_batch("DROP TRIGGER fail_receiver").unwrap();
    assert_eq!(
        destination
            .import_origin_page(&context, &input)
            .unwrap()
            .inserted,
        2
    );
}
#[test]
fn same_event_changed_body_rolls_back_the_whole_page_and_records_only_conflict_metadata() {
    let (_a, _b, source, destination, p) = pair();
    let first = capture(&source, p, "incoming first must roll back", vec![]);
    let second = capture(&source, p, "incoming ID collision", vec![]);
    let local = destination.local_human(p).unwrap();
    let local_command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: second.event_id,
        profile_id: p,
        occurred_at_ms: 1000,
        text: "receiver original preserved".into(),
        tags: vec![],
        originals: vec![],
    };
    destination.submit(&local, &local_command).unwrap();
    let context = peer(&destination, p, &source);
    let input = page(&source, p);
    assert!(
        matches!(destination.import_origin_page(&context,&input),Err(CoreError::ReplicationConflict{event_id,origin_seq:2}) if event_id==second.event_id)
    );
    let facts = destination.events(&local, p).unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].text, local_command.text);
    assert!(!facts.iter().any(|v| v.event_id == first.event_id));
    assert_eq!(
        destination.replication_cursor(&context).unwrap(),
        input.from
    );
    let db = rusqlite::Connection::open(destination.database_path()).unwrap();
    let evidence: (u64, String, u64) = db
        .query_row(
            "SELECT count(*),event_id,origin_seq FROM import_conflicts",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(evidence, (1, second.event_id.to_string(), 2));
    assert!(
        destination
            .receipt(&local, first.command_id)
            .unwrap()
            .is_none()
    );
}
#[test]
fn replay_rechecks_the_range_body_and_chain_instead_of_trusting_an_advanced_cursor() {
    let (_a, _b, source, destination, p) = pair();
    let first = capture(&source, p, "one", vec![]);
    capture(&source, p, "two", vec![]);
    let input = page(&source, p);
    let context = peer(&destination, p, &source);
    destination.import_origin_page(&context, &input).unwrap();
    let mut altered = input.clone();
    if let ReplicatedFact::Capture(v) = &mut altered.entries[0].fact {
        v.text = "different but correctly hashed content".into();
    }
    rechain(&mut altered);
    assert!(matches!(
        destination.import_origin_page(&context, &altered),
        Err(CoreError::ReplicationConflict { origin_seq: 1, .. })
    ));
    let db = rusqlite::Connection::open(destination.database_path()).unwrap();
    let body: String = db
        .query_row(
            "SELECT body FROM events WHERE event_id=?1",
            [first.event_id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    let mut corrupt: serde_json::Value = serde_json::from_str(&body).unwrap();
    corrupt["text"] = "local corruption behind advanced head".into();
    db.execute(
        "UPDATE events SET body=?1 WHERE event_id=?2",
        rusqlite::params![
            serde_json::to_string(&corrupt).unwrap(),
            first.event_id.to_string()
        ],
    )
    .unwrap();
    assert!(destination.import_origin_page(&context, &input).is_err());
    db.execute(
        "UPDATE events SET body=?1 WHERE event_id=?2",
        rusqlite::params![body, first.event_id.to_string()],
    )
    .unwrap();
    assert!(
        destination
            .import_origin_page(&context, &input)
            .unwrap()
            .replayed
    );
}
#[test]
fn a_new_epoch_cannot_reset_an_existing_origins_cursor_and_other_authenticated_devices_cannot_relay()
 {
    let (_a, _b, source, destination, p) = pair();
    capture(&source, p, "lineage", vec![]);
    let input = page(&source, p);
    let context = peer(&destination, p, &source);
    destination.import_origin_page(&context, &input).unwrap();
    let next = Uuid::new_v4();
    let new_context = destination
        .trusted_replica_context(p, source.device_id(), next, 1)
        .unwrap();
    assert!(matches!(
        destination.replication_cursor(&new_context),
        Err(CoreError::OriginEpochChanged)
    ));
    let mut new_page = input.clone();
    new_page.origin.restoration_epoch = next;
    new_page.from = OriginCursor {
        seq: 0,
        hash: genesis(&new_page.origin),
    };
    rechain(&mut new_page);
    assert!(matches!(
        destination.import_origin_page(&new_context, &new_page),
        Err(CoreError::OriginEpochChanged)
    ));
    let relay = destination
        .trusted_replica_context(p, DeviceId::new(), input.origin.restoration_epoch, 1)
        .unwrap();
    assert!(destination.import_origin_page(&relay, &input).is_err());
    assert_eq!(destination.replication_cursor(&context).unwrap(), input.to);
}
#[test]
fn a_gap_is_not_acknowledged_and_an_identical_command_on_two_connections_has_one_fact() {
    let (_a, b, source, destination, p) = pair();
    capture(&source, p, "first", vec![]);
    capture(&source, p, "second", vec![]);
    let full = page(&source, p);
    let mut tail = full.clone();
    let first = tail.entries.remove(0);
    tail.from = OriginCursor {
        seq: 1,
        hash: first.chain_hash,
    };
    let context = peer(&destination, p, &source);
    assert!(destination.import_origin_page(&context, &tail).is_err());
    assert_eq!(destination.replication_cursor(&context).unwrap(), full.from);
    let other = Core::open(b.path()).unwrap();
    let other_context = peer(&other, p, &source);
    let gate = std::sync::Arc::new(std::sync::Barrier::new(3));
    let mut handles = vec![];
    for (core, context) in [(destination, context), (other, other_context)] {
        let gate = gate.clone();
        let full = full.clone();
        handles.push(std::thread::spawn(move || {
            gate.wait();
            core.import_origin_page(&context, &full).unwrap()
        }));
    }
    gate.wait();
    let a = handles.remove(0).join().unwrap();
    let b_ack = handles.remove(0).join().unwrap();
    assert_eq!(a.inserted + b_ack.inserted, 2);
    let reopened = Core::open(b.path()).unwrap();
    assert_eq!(
        reopened
            .events(&reopened.local_human(p).unwrap(), p)
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn typed_child_before_parent_is_explicitly_incomplete_and_later_rebuilds_without_a_scheduler() {
    let (_a, _b, source, destination, p) = pair();
    let human = source.local_human(p).unwrap();
    let stamp = source.trusted_clock_stamp(Uuid::new_v4(), 1000, 0).unwrap();
    let block = TimeblockId::new();
    source
        .apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: source
                    .timeblock_snapshot(&human, p, &stamp)
                    .unwrap()
                    .revision,
                action: TimeblockAction::Start {
                    block_id: block,
                    name: "parent arrives later".into(),
                    note: String::new(),
                    timer: TimerSpec::CountUp,
                },
            },
            &stamp,
        )
        .unwrap();
    let mut input = page(&source, p);
    let mut parent = input.entries[0].fact.clone();
    let parent_id = parent.event_id();
    let mut child = parent.clone();
    if let ReplicatedFact::Timeblock(v) = &mut child {
        v.event_id = EventId::new();
        v.parents = vec![parent_id];
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::Pause { block_id: block },
        };
        v.clock.elapsed_ms = 10;
        v.occurred_at_ms = 1010;
        v.effective_at_ms = 1010;
    }
    if let ReplicatedFact::Timeblock(v) = &mut parent {
        v.local_seq = 0;
    }
    input.entries = vec![
        OriginEntry {
            origin_seq: 1,
            chain_hash: String::new(),
            fact: child,
        },
        OriginEntry {
            origin_seq: 2,
            chain_hash: String::new(),
            fact: parent,
        },
    ];
    rechain(&mut input);
    let mut first = input.clone();
    first.entries.truncate(1);
    first.to = OriginCursor {
        seq: 1,
        hash: first.entries[0].chain_hash.clone(),
    };
    first.has_more = true;
    let context = peer(&destination, p, &source);
    assert!(
        !destination
            .import_origin_page(&context, &first)
            .unwrap()
            .projection_complete
    );
    let local = destination.local_human(p).unwrap();
    let now = destination
        .trusted_clock_stamp(Uuid::new_v4(), 2000, 0)
        .unwrap();
    assert_eq!(
        destination.replication_health(&local, p).unwrap(),
        (false, false)
    );
    assert!(matches!(
        destination.timeblock_snapshot(&local, p, &now),
        Err(CoreError::InvalidTimeblockHistory)
    ));
    assert_eq!(
        destination
            .timeblock_nodes(&local, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    let mut second = input;
    second.from = first.to;
    second.entries.remove(0);
    let ack = destination.import_origin_page(&context, &second).unwrap();
    assert!(ack.projection_complete);
    assert_eq!(
        destination.replication_health(&local, p).unwrap(),
        (true, false)
    );
    let active = destination
        .timeblock_snapshot(&local, p, &now)
        .unwrap()
        .active
        .unwrap();
    assert_eq!(active.block_id, block);
    assert_eq!(active.phase, TimeblockPhase::Paused);
    assert!(active.deadline.is_none());
}

#[test]
fn beta09_cross_device_history_requires_each_origin_and_recovers_without_discarding_facts() {
    // Field events 8d49542c/68e5bd54/ac1dcc95/90d8bd80: a phone can
    // receive all desktop facts while still lacking a tablet's causal parent.
    // This synthetic topology is a reproduction condition, not a claim about
    // the unavailable field phone's database or membership.
    let (_a, _b, desktop, tablet, p) = pair();
    let phone_dir = tempfile::tempdir().unwrap();
    let phone = Core::open(phone_dir.path()).unwrap();
    phone.provision_profile(p, "replicated profile").unwrap();
    let block = TimeblockId::new();
    let epochs = [
        (desktop.device_id(), Uuid::new_v4()),
        (tablet.device_id(), Uuid::new_v4()),
        (phone.device_id(), Uuid::new_v4()),
    ];
    let apply = |core: &Core, elapsed: u32, action| {
        let epoch = epochs
            .iter()
            .find(|(device, _)| *device == core.device_id())
            .unwrap()
            .1;
        let human = core.local_human(p).unwrap();
        let stamp = core
            .trusted_clock_stamp(epoch, 1000 + i64::from(elapsed), u64::from(elapsed))
            .unwrap();
        let command = TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: core.timeblock_snapshot(&human, p, &stamp).unwrap().revision,
            action,
        };
        core.apply_timeblock(&human, &command, &stamp).unwrap();
    };
    apply(
        &desktop,
        0,
        TimeblockAction::Start {
            block_id: block,
            name: "synthetic desktop block".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    tablet
        .import_origin_page(&peer(&tablet, p, &desktop), &page(&desktop, p))
        .unwrap();
    apply(&tablet, 10, TimeblockAction::Pause { block_id: block });
    desktop
        .import_origin_page(&peer(&desktop, p, &tablet), &page(&tablet, p))
        .unwrap();
    apply(&desktop, 20, TimeblockAction::Resume { block_id: block });
    let text = capture(
        &desktop,
        p,
        "text arrives independently of projection",
        vec![],
    );
    let desktop_context = peer(&phone, p, &desktop);
    let desktop_page = page(&desktop, p);
    let ack = phone
        .import_origin_page(&desktop_context, &desktop_page)
        .unwrap();
    assert!(!ack.projection_complete);
    let partial = phone
        .timeline_page(&phone.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap();
    assert!(partial.items.iter().any(
        |item| matches!(item, TimelineItem::Capture(event) if event.event_id == text.event_id)
    ));
    assert_eq!(
        partial
            .items
            .iter()
            .filter(|item| matches!(item, TimelineItem::Timeblock(_)))
            .count(),
        2
    );
    assert_eq!(
        phone.replication_cursor(&desktop_context).unwrap(),
        desktop_page.to
    );
    let human = phone.local_human(p).unwrap();
    assert!(
        phone
            .events(&human, p)
            .unwrap()
            .iter()
            .any(|event| event.event_id == text.event_id)
    );
    assert_eq!(
        phone
            .timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
    let stamp = phone.trusted_clock_stamp(Uuid::new_v4(), 2000, 0).unwrap();
    assert!(matches!(
        phone.timeblock_snapshot(&human, p, &stamp),
        Err(CoreError::InvalidTimeblockHistory)
    ));
    // Replaying the desktop stream cannot manufacture the absent tablet fact.
    assert!(
        !phone
            .import_origin_page(&desktop_context, &desktop_page)
            .unwrap()
            .projection_complete
    );
    assert!(
        phone
            .import_origin_page(&peer(&phone, p, &tablet), &page(&tablet, p))
            .unwrap()
            .projection_complete
    );
    let restored = phone
        .timeblock_snapshot(&human, p, &stamp)
        .unwrap()
        .active
        .unwrap();
    assert_eq!(restored.block_id, block);
    assert_eq!(restored.phase, TimeblockPhase::Running);
    let facts = |core: &Core| {
        let mut facts: Vec<_> = core
            .timeblock_nodes(&core.local_human(p).unwrap(), p, &EventQuery::default())
            .unwrap()
            .items
            .into_iter()
            .map(|node| (node.event_id.to_string(), node.digest))
            .collect();
        facts.sort();
        facts
    };
    assert_eq!(facts(&phone), facts(&desktop));
    apply(&phone, 30, TimeblockAction::EndAction { block_id: block });
    apply(
        &phone,
        40,
        TimeblockAction::SubmitFeedback {
            block_id: block,
            feedback: FeedbackInput::Skipped,
        },
    );
    apply(
        &phone,
        50,
        TimeblockAction::Start {
            block_id: TimeblockId::new(),
            name: "new phone record after recovery".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    drop(phone);
    let reopened = Core::open(phone_dir.path()).unwrap();
    let reader = reopened.local_human(p).unwrap();
    let stamp = reopened
        .trusted_clock_stamp(Uuid::new_v4(), 3000, 0)
        .unwrap();
    assert_eq!(
        reopened
            .timeblock_snapshot(&reader, p, &stamp)
            .unwrap()
            .active
            .unwrap()
            .name,
        "new phone record after recovery"
    );
    assert_eq!(
        reopened
            .timeblock_nodes(&reader, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        6
    );
    assert!(
        reopened
            .events(&reader, p)
            .unwrap()
            .iter()
            .any(|event| event.event_id == text.event_id)
    );
}

#[test]
fn importing_a_remote_pause_cancels_a_previously_issued_local_deadline_ticket() {
    let (_a, _b, source, destination, p) = pair();
    let local = destination.local_human(p).unwrap();
    let epoch = Uuid::new_v4();
    let stamp = destination.trusted_clock_stamp(epoch, 1000, 0).unwrap();
    let block = TimeblockId::new();
    let start = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: destination
            .timeblock_snapshot(&local, p, &stamp)
            .unwrap()
            .revision,
        action: TimeblockAction::Start {
            block_id: block,
            name: "local countdown".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    destination.apply_timeblock(&local, &start, &stamp).unwrap();
    let due = destination.trusted_clock_stamp(epoch, 3000, 2000).unwrap();
    let scheduler = destination.local_scheduler();
    let ticket = destination
        .due_deadlines(&scheduler, &due, 100)
        .unwrap()
        .pop()
        .unwrap();
    let source_human = source.local_human(p).unwrap();
    let remote_stamp = source.trusted_clock_stamp(Uuid::new_v4(), 1100, 0).unwrap();
    source
        .apply_timeblock(
            &source_human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: source
                    .timeblock_snapshot(&source_human, p, &remote_stamp)
                    .unwrap()
                    .revision,
                action: TimeblockAction::Start {
                    block_id: TimeblockId::new(),
                    name: "template".into(),
                    note: String::new(),
                    timer: TimerSpec::CountUp,
                },
            },
            &remote_stamp,
        )
        .unwrap();
    let mut input = page(&source, p);
    if let ReplicatedFact::Timeblock(v) = &mut input.entries[0].fact {
        v.parents = vec![start.event_id];
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::Pause { block_id: block },
        };
    }
    rechain(&mut input);
    destination
        .import_origin_page(&peer(&destination, p, &source), &input)
        .unwrap();
    assert_eq!(
        destination
            .timeblock_snapshot(&local, p, &due)
            .unwrap()
            .active
            .unwrap()
            .phase,
        TimeblockPhase::Paused
    );
    assert!(
        destination
            .due_deadlines(&scheduler, &due, 100)
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        destination
            .complete_deadline(&scheduler, &ticket, &due)
            .unwrap(),
        DeadlineOutcome::Stale
    ));
}

#[test]
fn remote_profile_metadata_cannot_reuse_a_different_profiles_private_local_bytes() {
    let (_a, _b, source, destination, p) = pair();
    let q = destination.create_profile("private Q").unwrap();
    let bytes = b"Q only";
    let original = original(bytes);
    let stage = verified(&destination, q, original.clone(), bytes);
    verified(&source, p, original.clone(), bytes);
    capture(&source, p, "P cannot borrow Q", vec![original.clone()]);
    let input = page(&source, p);
    let context = peer(&destination, p, &source);
    assert!(matches!(
        destination.import_origin_page(&context, &input),
        Err(CoreError::OriginalConflict)
    ));
    assert_eq!(
        destination.replication_cursor(&context).unwrap(),
        input.from
    );
    assert!(
        destination
            .events(&destination.local_human(p).unwrap(), p)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        destination
            .read_stage_range(&destination.local_human(q).unwrap(), stage, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
}
