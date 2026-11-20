use exomind_core::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn stamp(core: &Core, ms: i64) -> ClockStamp {
    core.trusted_clock_stamp(Uuid::from_u128(7), ms, ms as u64)
        .unwrap()
}
fn apply(core: &Core, p: ProfileId, ms: i64, action: TimeblockAction) -> EventId {
    let ctx = core.local_human(p).unwrap();
    let at = stamp(core, ms);
    let cmd = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: core.timeblock_snapshot(&ctx, p, &at).unwrap().revision,
        action,
    };
    core.apply_timeblock(&ctx, &cmd, &at).unwrap();
    cmd.event_id
}
fn start(core: &Core, p: ProfileId) -> (TimeblockId, EventId) {
    let b = TimeblockId::new();
    let ev = apply(
        core,
        p,
        1000,
        TimeblockAction::Start {
            block_id: b,
            name: "synthetic B3".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    (b, ev)
}
fn end(core: &Core, p: ProfileId, b: TimeblockId) {
    apply(core, p, 2000, TimeblockAction::EndAction { block_id: b });
    apply(
        core,
        p,
        3000,
        TimeblockAction::SubmitFeedback {
            block_id: b,
            feedback: FeedbackInput::Skipped,
        },
    );
}
fn capture(core: &Core, p: ProfileId, text: &str) -> EventId {
    let cmd = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1500,
        text: text.into(),
        tags: vec![],
        originals: vec![],
    };
    core.submit(&core.local_human(p).unwrap(), &cmd).unwrap();
    cmd.event_id
}
fn tasks(core: &Core, p: ProfileId) -> Vec<SummaryTaskView> {
    core.summary_tasks_page(&core.local_human(p).unwrap(), p, None, 100)
        .unwrap()
        .items
}
fn one(core: &Core, p: ProfileId) -> SummaryTaskView {
    tasks(core, p).pop().unwrap()
}
fn begin(_core: &Core, p: ProfileId, task: &SummaryTaskView) -> SummaryBeginCommand {
    SummaryBeginCommand {
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
    }
}
fn control(core: &Core, p: ProfileId, task: &SummaryTaskView, action: SummaryControlAction) {
    core.control_summary(
        &core.local_human(p).unwrap(),
        &SummaryControlCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            task_id: task.task_id,
            expected_owner_generation: task.owner_generation,
            expected_owner_control_event_id: task.owner_control_event_id,
            expected_control_heads: task.control_heads.clone(),
            action,
        },
    )
    .unwrap();
}
fn output(s: &SummarySourceSnapshot) -> SummaryOutput {
    SummaryOutput {
        narrative: "Synthetic evidence-grounded review.".into(),
        evidence: vec![s.sources[0].event_id],
        read_original_ids: vec![],
        model: SummaryModelMetadata {
            provider: "loopback".into(),
            model: "reported-model".into(),
            role_config_digest: "a".repeat(64),
            request_input_digest: "b".repeat(64),
            prompt_template: "exomind-summary/v1".into(),
            include_suggestions: false,
            max_output_tokens: 512,
            requested_model: "requested-model".into(),
        },
        usage: SummaryUsage {
            input_tokens: Some(1),
            output_tokens: Some(1),
            provider_request_id: None,
        },
    }
}
fn counts(core: &Core) -> (i64, i64, i64) {
    let db = Connection::open(core.database_path()).unwrap();
    db.query_row("SELECT (SELECT count(*) FROM events),(SELECT count(*) FROM command_receipts),(SELECT count(*) FROM summary_attempts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap()
}
fn sync(from: &Core, to: &Core, p: ProfileId) {
    let mut query = OriginPageQuery::default();
    query.max_bytes = MAX_ORIGIN_PAGE_BYTES;
    loop {
        let page = from
            .export_origin_page(&from.local_human(p).unwrap(), p, &query)
            .unwrap();
        let ctx = to
            .trusted_replica_context(p, from.device_id(), page.origin.restoration_epoch, 1)
            .unwrap();
        to.import_origin_page(&ctx, &page).unwrap();
        if !page.has_more {
            break;
        }
        query.after = Some(page.to);
        query.through = Some(page.through);
    }
}
fn pair() -> (tempfile::TempDir, tempfile::TempDir, Core, Core, ProfileId) {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let left = Core::open(a.path()).unwrap();
    let right = Core::open(b.path()).unwrap();
    let p = left.create_profile("P").unwrap();
    right.provision_profile(p, "P").unwrap();
    (a, b, left, right, p)
}

#[test]
fn automatic_trigger_follows_creator_after_offline_remote_feedback_without_ui() {
    let (_a, _b, a, b, p) = pair();
    let (block, creator) = start(&a, p);
    sync(&a, &b, p);
    end(&b, p, block);
    let bx = b.local_summary_executor();
    assert!(b
        .reconcile_summary_triggers(&bx)
        .unwrap()
        .created
        .is_empty());
    sync(&b, &a, p);
    let ax = a.local_summary_executor();
    let first = a.reconcile_summary_triggers(&ax).unwrap();
    assert_eq!(first.created.len(), 1);
    let before = counts(&a);
    assert!(a
        .reconcile_summary_triggers(&ax)
        .unwrap()
        .created
        .is_empty());
    assert_eq!(counts(&a), before);
    let task = one(&a, p);
    assert_eq!(task.creator_event_id, creator);
    assert_eq!(task.owner_device_id, a.device_id());
    sync(&a, &b, p);
    let remote = one(&b, p);
    let before = counts(&b);
    assert!(matches!(
        b.begin_summary_attempt(&bx, &begin(&b, p, &remote)),
        Err(CoreError::SummaryNotOwner)
    ));
    assert_eq!(counts(&b), before);
}

#[test]
fn frozen_cross_page_inputs_late_update_new_artifact_and_timeline_skips_jobs() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let (block, _) = start(&core, p);
    let refs = (0..250)
        .map(|i| capture(&core, p, &format!("synthetic source {i}")))
        .collect::<Vec<_>>();
    end(&core, p, block);
    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&core, p);
    core.summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    let c = counts(&core);
    core.summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    assert_eq!(counts(&core), c);
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    assert_eq!(work.snapshot.sources.len(), 253);
    let input = core.summary_input_records(&executor, &work.ticket).unwrap();
    assert_eq!(input.records.len(), 253);
    assert!(refs
        .iter()
        .all(|id| work.snapshot.sources.iter().any(|r| r.event_id == *id)));
    assert_eq!(input.encoded_bytes, work.snapshot.input_encoded_bytes);
    assert!(input.encoded_bytes <= MAX_SUMMARY_INPUT_BYTES as u64);
    let result = core
        .finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
        .unwrap();
    let SummaryCommitOutcome::Applied {
        artifact_event_id: first,
        ..
    } = result
    else {
        panic!("applied artifact")
    };
    let ctx = core.local_human(p).unwrap();
    let old = serde_json::to_value(
        core.summary_artifacts_page(&ctx, p, task.task_id, None, 100)
            .unwrap()
            .items[0]
            .clone(),
    )
    .unwrap();
    let late = capture(&core, p, "late material");
    let dirty = one(&core, p);
    assert!(dirty.coverage_changed);
    assert_eq!(dirty.state, SummaryState::Succeeded);
    control(
        &core,
        p,
        &dirty,
        SummaryControlAction::QueueUpdate {
            run_id: Uuid::new_v4(),
            selection: work.snapshot.selection.clone(),
            supersedes_artifact_id: Some(first),
        },
    );
    let next = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    assert!(next.snapshot.sources.iter().any(|r| r.event_id == late));
    assert!(!next.snapshot.sources.iter().any(|r| r.event_id == first));
    core.finish_summary_attempt(&executor, &next.ticket, &output(&next.snapshot))
        .unwrap();
    let artifacts = core
        .summary_artifacts_page(&ctx, p, task.task_id, None, 100)
        .unwrap();
    assert_eq!(artifacts.items.len(), 2);
    let historical = artifacts
        .items
        .iter()
        .find(|a| a.event_id == first)
        .unwrap();
    assert_eq!(
        historical.snapshot.digest,
        old["snapshot"]["digest"].as_str().unwrap()
    );
    assert_eq!(
        historical.output.narrative,
        old["output"]["narrative"].as_str().unwrap()
    );
    assert!(!historical.current);
    let mut q = EventQuery {
        limit: 1,
        ..Default::default()
    };
    let mut seen = vec![];
    loop {
        let page = core.timeline_page(&ctx, p, &q).unwrap();
        q.through = Some(page.highwater);
        for item in page.items {
            seen.push(match item {
                TimelineItem::Capture(v) => v.event_id,
                TimelineItem::Timeblock(v) => v.event_id,
                TimelineItem::Summary(v) => v.event_id,
                TimelineItem::AgentSummary(v) => v.event_id,
            });
        }
        if page.next_before.is_none() {
            break;
        }
        q.before = page.next_before;
    }
    assert_eq!(seen.len(), 256);
    assert_eq!(seen.iter().filter(|id| **id == first).count(), 1);
}

#[test]
fn post_snapshot_correction_marks_review_changed_without_rewriting_saved_artifact() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let (block, _) = start(&core, p);
    let target = capture(&core, p, "frozen source");
    end(&core, p, block);

    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&core, p);
    core.summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    let target_digest = work
        .snapshot
        .sources
        .iter()
        .find(|source| source.event_id == target)
        .unwrap()
        .digest
        .clone();
    let result = core
        .finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
        .unwrap();
    let SummaryCommitOutcome::Applied {
        artifact_event_id, ..
    } = result
    else {
        panic!("applied artifact")
    };

    let ctx = core.local_human(p).unwrap();
    let artifact_before = core
        .summary_artifacts_page(&ctx, p, task.task_id, None, 100)
        .unwrap()
        .items
        .into_iter()
        .find(|artifact| artifact.event_id == artifact_event_id)
        .unwrap();
    let snapshot_digest_before = artifact_before.snapshot.digest.clone();
    let stored_artifact = |event_id: EventId| {
        let db = Connection::open(core.database_path()).unwrap();
        db.query_row(
            "SELECT body,digest FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='summary/1'",
            rusqlite::params![p.to_string(), event_id.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap()
    };
    let artifact_bytes_and_digest_before = stored_artifact(artifact_event_id);

    core.record_correction(
        &ctx,
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 4_000,
            target_event_id: target,
            target_digest,
            corrected_text: "corrected source".into(),
        },
    )
    .unwrap();

    let current = core.read_summary_task(&ctx, p, task.task_id).unwrap();
    assert!(
        current.coverage_changed,
        "a post-snapshot correction to a selected capture changes review coverage"
    );
    assert_eq!(current.state, SummaryState::Succeeded);
    assert_eq!(current.selection, work.snapshot.selection);
    let current_snapshot = current
        .current_run
        .as_ref()
        .and_then(|run| run.snapshot.as_ref())
        .unwrap();
    assert_eq!(current_snapshot.digest, work.snapshot.digest);
    assert_eq!(current_snapshot.selection, work.snapshot.selection);

    let artifact_after = core
        .summary_artifacts_page(&ctx, p, task.task_id, None, 100)
        .unwrap()
        .items
        .into_iter()
        .find(|artifact| artifact.event_id == artifact_event_id)
        .unwrap();
    assert_eq!(artifact_after.snapshot.digest, snapshot_digest_before);
    assert_eq!(
        stored_artifact(artifact_event_id),
        artifact_bytes_and_digest_before,
        "marking coverage changed must preserve the saved artifact body and digest"
    );
}

#[test]
fn pre_snapshot_and_unmatched_corrections_do_not_change_review_coverage() {
    let (_a, _b, core, peer, p) = pair();
    let q = core.create_profile("Q").unwrap();
    peer.provision_profile(q, "Q").unwrap();
    let (block, _) = start(&core, p);
    let target = capture(&core, p, "selected source");
    let ctx = core.local_human(p).unwrap();
    let target_digest = core
        .events(&ctx, p)
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == target)
        .unwrap()
        .digest;
    core.record_correction(
        &ctx,
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1_600,
            target_event_id: target,
            target_digest: target_digest.clone(),
            corrected_text: "corrected before snapshot".into(),
        },
    )
    .unwrap();
    end(&core, p, block);

    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&core, p);
    core.summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    assert!(work
        .snapshot
        .sources
        .iter()
        .any(|source| source.event_id == target && source.digest == target_digest));
    assert!(matches!(
        core.finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
            .unwrap(),
        SummaryCommitOutcome::Applied { .. }
    ));

    // This checks only post-snapshot freshness; it makes no claim about whether
    // a correction already present at freeze belongs in provider input.
    let outside = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: work.snapshot.selection.to_ms.saturating_add(60_000),
        text: "outside frozen selection".into(),
        tags: vec![],
        originals: vec![],
    };
    assert!(outside.occurred_at_ms > work.snapshot.selection.to_ms);
    let outside_receipt = core.submit(&ctx, &outside).unwrap();
    core.record_correction(
        &ctx,
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: outside.occurred_at_ms,
            target_event_id: outside.event_id,
            target_digest: outside_receipt.event_digest,
            corrected_text: "outside correction".into(),
        },
    )
    .unwrap();

    let conflicting_digest = "0".repeat(64);
    assert_ne!(conflicting_digest, target_digest);
    peer.record_correction(
        &peer.local_human(p).unwrap(),
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 5_000,
            target_event_id: target,
            target_digest: conflicting_digest.clone(),
            corrected_text: "conflicting target digest".into(),
        },
    )
    .unwrap();
    peer.record_correction(
        &peer.local_human(q).unwrap(),
        &RecordCorrectionCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: q,
            occurred_at_ms: 5_001,
            target_event_id: target,
            target_digest: target_digest.clone(),
            corrected_text: "correction scoped to another profile".into(),
        },
    )
    .unwrap();
    sync(&peer, &core, p);
    sync(&peer, &core, q);

    let query = EventQuery {
        limit: 10,
        ..Default::default()
    };
    let p_corrections = core.corrections_page(&ctx, p, &query).unwrap();
    assert!(p_corrections.items.iter().any(|entry| {
        entry.record.target_event_id == target
            && entry.record.target_digest == conflicting_digest
            && entry.target_state == CorrectionTargetState::DigestConflict
    }));
    let q_corrections = core
        .corrections_page(&core.local_human(q).unwrap(), q, &query)
        .unwrap();
    assert!(q_corrections
        .items
        .iter()
        .any(|entry| entry.record.target_event_id == target
            && entry.target_state == CorrectionTargetState::Unresolved));

    let current = core.read_summary_task(&ctx, p, task.task_id).unwrap();
    assert!(!current.coverage_changed);
    assert_eq!(current.state, SummaryState::Succeeded);
    assert_eq!(current.selection, work.snapshot.selection);
    assert_eq!(
        current
            .current_run
            .as_ref()
            .and_then(|run| run.snapshot.as_ref())
            .unwrap()
            .digest,
        work.snapshot.digest
    );
}

#[test]
fn replicated_post_snapshot_correction_is_detected_with_lower_receiver_local_seq() {
    let (_source_root, _receiver_root, source, receiver, p) = pair();
    let q = source.create_profile("Source sequence filler").unwrap();
    for index in 0..128 {
        capture(&source, q, &format!("source Q filler {index}"));
    }

    let (block, _) = start(&source, p);
    let target = capture(&source, p, "selected source");
    end(&source, p, block);
    let executor = source.local_summary_executor();
    source.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&source, p);
    source
        .summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    let work = source
        .begin_summary_attempt(&executor, &begin(&source, p, &one(&source, p)))
        .unwrap();
    let target_digest = work
        .snapshot
        .sources
        .iter()
        .find(|item| item.event_id == target)
        .unwrap()
        .digest
        .clone();
    let result = source
        .finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
        .unwrap();
    let SummaryCommitOutcome::Applied {
        artifact_event_id, ..
    } = result
    else {
        panic!("applied artifact")
    };

    let source_ctx = source.local_human(p).unwrap();
    let receiver_ctx = receiver.local_human(p).unwrap();
    // Transfer P only; the source's Q sequence offset is absent on the receiver.
    sync(&source, &receiver, p);
    let before = receiver
        .read_summary_task(&receiver_ctx, p, task.task_id)
        .unwrap();
    assert!(!before.coverage_changed);
    assert_eq!(before.state, SummaryState::Succeeded);
    let snapshot_before = before
        .current_run
        .as_ref()
        .and_then(|run| run.snapshot.as_ref())
        .unwrap()
        .clone();
    assert_eq!(snapshot_before.digest, work.snapshot.digest);
    let selection_before = before.selection.clone();

    let artifact_before = receiver
        .summary_artifacts_page(&receiver_ctx, p, task.task_id, None, 100)
        .unwrap()
        .items
        .into_iter()
        .find(|artifact| artifact.event_id == artifact_event_id)
        .unwrap();
    let artifact_snapshot_digest_before = artifact_before.snapshot.digest.clone();
    let stored_artifact = |core: &Core| {
        let db = Connection::open(core.database_path()).unwrap();
        db.query_row(
            "SELECT body,digest FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='summary/1'",
            rusqlite::params![p.to_string(), artifact_event_id.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap()
    };
    let artifact_bytes_and_digest_before = stored_artifact(&receiver);

    let correction = source
        .record_correction(
            &source_ctx,
            &RecordCorrectionCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 4_000,
                target_event_id: target,
                target_digest: target_digest.clone(),
                corrected_text: "corrected after snapshot".into(),
            },
        )
        .unwrap();
    assert!(correction.local_seq > work.snapshot.through);
    sync(&source, &receiver, p);

    let corrections = receiver
        .corrections_page(
            &receiver_ctx,
            p,
            &EventQuery {
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();
    let received = corrections
        .items
        .iter()
        .find(|entry| entry.record.event_id == correction.event_id)
        .unwrap();
    assert_eq!(received.record.target_event_id, target);
    assert_eq!(received.record.target_digest, target_digest);
    assert_eq!(received.target_state, CorrectionTargetState::DigestMatches);
    assert!(received.record.local_seq <= work.snapshot.through);

    let current = receiver
        .read_summary_task(&receiver_ctx, p, task.task_id)
        .unwrap();
    assert!(
        current.coverage_changed,
        "a replicated post-snapshot correction must survive incomparable local_seq values"
    );
    assert_eq!(current.state, SummaryState::Succeeded);
    assert_eq!(current.selection, selection_before);
    let current_snapshot = current
        .current_run
        .as_ref()
        .and_then(|run| run.snapshot.as_ref())
        .unwrap();
    assert_eq!(current_snapshot.digest, snapshot_before.digest);
    assert_eq!(current_snapshot.selection, snapshot_before.selection);

    let artifact_after = receiver
        .summary_artifacts_page(&receiver_ctx, p, task.task_id, None, 100)
        .unwrap()
        .items
        .into_iter()
        .find(|artifact| artifact.event_id == artifact_event_id)
        .unwrap();
    assert_eq!(
        artifact_after.snapshot.digest,
        artifact_snapshot_digest_before
    );
    assert_eq!(
        stored_artifact(&receiver),
        artifact_bytes_and_digest_before
    );
}

#[test]
fn replicated_prefreeze_correction_is_not_stale_with_higher_receiver_local_seq() {
    let (_source_root, _receiver_root, source, receiver, p) = pair();
    let (block, _) = start(&source, p);
    let target = capture(&source, p, "selected source");
    let source_ctx = source.local_human(p).unwrap();
    let target_digest = source
        .events(&source_ctx, p)
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == target)
        .unwrap()
        .digest;
    let correction = source
        .record_correction(
            &source_ctx,
            &RecordCorrectionCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 1_600,
                target_event_id: target,
                target_digest: target_digest.clone(),
                corrected_text: "corrected before snapshot".into(),
            },
        )
        .unwrap();
    end(&source, p, block);

    let executor = source.local_summary_executor();
    source.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&source, p);
    source
        .summary_wait_for_configuration(&executor, p, task.task_id)
        .unwrap();
    let work = source
        .begin_summary_attempt(&executor, &begin(&source, p, &one(&source, p)))
        .unwrap();
    assert!(correction.local_seq <= work.snapshot.through);
    assert!(work
        .snapshot
        .sources
        .iter()
        .any(|item| item.event_id == target && item.digest == target_digest));
    let result = source
        .finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
        .unwrap();
    let SummaryCommitOutcome::Applied {
        artifact_event_id, ..
    } = result
    else {
        panic!("applied artifact")
    };

    let origin_page = source
        .export_origin_page(
            &source_ctx,
            p,
            &OriginPageQuery {
                max_bytes: MAX_ORIGIN_PAGE_BYTES,
                ..Default::default()
            },
        )
        .unwrap();
    let correction_origin_seq = origin_page
        .entries
        .iter()
        .find(|entry| entry.fact.event_id() == correction.event_id)
        .unwrap()
        .origin_seq;
    let frozen_origin_head = work
        .snapshot
        .origin_heads
        .iter()
        .find(|head| head.origin == origin_page.origin)
        .unwrap();
    assert!(frozen_origin_head.cursor.seq >= correction_origin_seq);

    let q = receiver.create_profile("Receiver sequence filler").unwrap();
    for index in 0..128 {
        capture(&receiver, q, &format!("receiver Q filler {index}"));
    }
    let receiver_ctx = receiver.local_human(p).unwrap();
    // The correction is in the source's frozen origin head; only P is copied.
    sync(&source, &receiver, p);
    let corrections = receiver
        .corrections_page(
            &receiver_ctx,
            p,
            &EventQuery {
                limit: 100,
                ..Default::default()
            },
        )
        .unwrap();
    let received = corrections
        .items
        .iter()
        .find(|entry| entry.record.event_id == correction.event_id)
        .unwrap();
    assert_eq!(received.record.target_event_id, target);
    assert_eq!(received.record.target_digest, target_digest);
    assert_eq!(received.target_state, CorrectionTargetState::DigestMatches);
    assert!(received.record.local_seq > work.snapshot.through);

    let current = receiver
        .read_summary_task(&receiver_ctx, p, task.task_id)
        .unwrap();
    assert!(
        !current.coverage_changed,
        "a source-frozen correction is not later material when copied to a higher-local_seq device"
    );
    assert_eq!(current.state, SummaryState::Succeeded);
    assert_eq!(current.selection, work.snapshot.selection);
    assert_eq!(
        current
            .current_run
            .as_ref()
            .and_then(|run| run.snapshot.as_ref())
            .unwrap()
            .digest,
        work.snapshot.digest
    );

    let stored_artifact = |core: &Core| {
        let db = Connection::open(core.database_path()).unwrap();
        db.query_row(
            "SELECT body,digest FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='summary/1'",
            rusqlite::params![p.to_string(), artifact_event_id.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap()
    };
    let source_artifact_bytes_and_digest = stored_artifact(&source);
    let receiver_artifact_bytes_and_digest = stored_artifact(&receiver);
    assert_eq!(
        receiver_artifact_bytes_and_digest,
        source_artifact_bytes_and_digest
    );
}

#[test]
fn cancel_stop_and_wrong_scope_reject_claims_and_late_seal_without_new_writes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let (block, _) = start(&core, p);
    end(&core, p, block);
    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&core, p);
    let c = counts(&core);
    assert!(matches!(
        core.read_summary_task(&core.local_human(q).unwrap(), p, task.task_id),
        Err(CoreError::ScopeMismatch)
    ));
    assert_eq!(counts(&core), c);
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &task))
        .unwrap();
    control(&core, p, &one(&core, p), SummaryControlAction::Cancel);
    let c = counts(&core);
    assert!(core.summary_input_records(&executor, &work.ticket).is_err());
    assert!(matches!(
        core.finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
            .unwrap(),
        SummaryCommitOutcome::Stale
    ));
    assert!(core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .is_err());
    assert_eq!(counts(&core), c);
    control(
        &core,
        p,
        &one(&core, p),
        SummaryControlAction::TakeOverForSelf {
            run_id: Uuid::new_v4(),
            resume_cancelled: true,
        },
    );
    let next = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    core.stop_summary_executor(&executor).unwrap();
    let c = counts(&core);
    assert!(matches!(
        core.finish_summary_attempt(&executor, &next.ticket, &output(&next.snapshot))
            .unwrap(),
        SummaryCommitOutcome::Stale
    ));
    assert!(matches!(
        core.begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p))),
        Err(CoreError::SummaryExecutorStopped)
    ));
    assert_eq!(counts(&core), c);
}

#[test]
fn restart_marks_unknown_without_automatic_paid_retry_and_preserves_frozen_input() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let (block, _) = start(&core, p);
    end(&core, p, block);
    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let task = one(&core, p);
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &task))
        .unwrap();
    drop(core);
    let core = Core::open(root.path()).unwrap();
    let fresh = core.local_summary_executor();
    assert!(matches!(
        core.summary_input_records(&executor, &work.ticket),
        Err(CoreError::ForeignContext)
    ));
    assert_eq!(
        one(&core, p).reason.as_deref(),
        Some("external_outcome_unknown")
    );
    let c = counts(&core);
    assert!(core
        .begin_summary_attempt(&fresh, &begin(&core, p, &one(&core, p)))
        .is_err());
    assert_eq!(counts(&core), c);
    assert_eq!(core.recover_summary_attempts(&fresh, 5000).unwrap(), 1);
    assert_eq!(core.recover_summary_attempts(&fresh, 5001).unwrap(), 0);
    assert_eq!(one(&core, p).state, SummaryState::Failed);
    let c = counts(&core);
    assert!(matches!(
        core.finish_summary_attempt(&fresh, &work.ticket, &output(&work.snapshot))
            .unwrap(),
        SummaryCommitOutcome::Stale
    ));
    assert_eq!(counts(&core), c);
}

#[test]
fn concurrent_cancel_and_takeover_converge_blocking_until_explicit_causal_resolution() {
    let (_a, _b, a, b, p) = pair();
    let (block, _) = start(&a, p);
    end(&a, p, block);
    let executor = a.local_summary_executor();
    a.reconcile_summary_triggers(&executor).unwrap();
    sync(&a, &b, p);
    let initial = one(&a, p);
    let work = a
        .begin_summary_attempt(&executor, &begin(&a, p, &initial))
        .unwrap();
    control(&a, p, &one(&a, p), SummaryControlAction::Cancel);
    control(
        &b,
        p,
        &one(&b, p),
        SummaryControlAction::TakeOverForSelf {
            run_id: Uuid::new_v4(),
            resume_cancelled: false,
        },
    );
    sync(&a, &b, p);
    sync(&b, &a, p);
    let left = one(&a, p);
    let right = one(&b, p);
    assert_eq!(
        serde_json::to_value(&left).unwrap(),
        serde_json::to_value(&right).unwrap()
    );
    assert!(!left.conflicts.is_empty());
    assert_eq!(left.state, SummaryState::Cancelled);
    let c = counts(&a);
    assert!(matches!(
        a.finish_summary_attempt(&executor, &work.ticket, &output(&work.snapshot))
            .unwrap(),
        SummaryCommitOutcome::Stale
    ));
    assert_eq!(counts(&a), c);
    control(
        &b,
        p,
        &right,
        SummaryControlAction::ResolveOwner {
            run_id: Uuid::new_v4(),
            owner_device_id: b.device_id(),
            resume_cancelled: true,
        },
    );
    sync(&b, &a, p);
    assert!(one(&a, p).conflicts.is_empty());
    let bx = b.local_summary_executor();
    let new = b
        .begin_summary_attempt(&bx, &begin(&b, p, &one(&b, p)))
        .unwrap();
    b.finish_summary_attempt(&bx, &new.ticket, &output(&new.snapshot))
        .unwrap();
    sync(&b, &a, p);
    assert_eq!(one(&a, p).state, SummaryState::Succeeded);
    assert!(a
        .begin_summary_attempt(&executor, &begin(&a, p, &one(&a, p)))
        .is_err());
}

#[test]
fn byte_omissions_unknown_evidence_and_read_claims_are_explicit_and_retry_is_finite() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let (block, _) = start(&core, p);
    let a = capture(&core, p, &"a".repeat(100_000));
    let b = capture(&core, p, &"b".repeat(100_000));
    end(&core, p, block);
    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    assert!(work.snapshot.coverage.input_byte_limit);
    assert!(
        work.snapshot.coverage.omitted_source_ids.contains(&a)
            || work.snapshot.coverage.omitted_source_ids.contains(&b)
    );
    assert!(work.snapshot.input_encoded_bytes <= 196608);
    let mut bad = output(&work.snapshot);
    bad.evidence = vec![EventId::new()];
    let c = counts(&core);
    assert!(core
        .finish_summary_attempt(&executor, &work.ticket, &bad)
        .is_err());
    bad.evidence.clear();
    assert!(core
        .finish_summary_attempt(&executor, &work.ticket, &bad)
        .is_err());
    bad = output(&work.snapshot);
    bad.read_original_ids = vec![OriginalId::new()];
    assert!(core
        .finish_summary_attempt(&executor, &work.ticket, &bad)
        .is_err());
    assert_eq!(counts(&core), c);
    assert!(matches!(
        core.fail_summary_attempt(
            &executor,
            &work.ticket,
            SummaryFailureKind::RateLimited,
            Some(5000)
        )
        .unwrap(),
        SummaryAttemptOutcome::Applied { .. }
    ));
    let mut early = begin(&core, p, &one(&core, p));
    assert!(core.begin_summary_attempt(&executor, &early).is_err());
    early.now_ms = 5000;
    let retry = core.begin_summary_attempt(&executor, &early).unwrap();
    assert_eq!(work.snapshot.digest, retry.snapshot.digest);
    core.fail_summary_attempt(
        &executor,
        &retry.ticket,
        SummaryFailureKind::RateLimited,
        Some(6000),
    )
    .unwrap();
    let c = counts(&core);
    let mut exhausted = begin(&core, p, &one(&core, p));
    exhausted.now_ms = 7000;
    assert!(core.begin_summary_attempt(&executor, &exhausted).is_err());
    assert_eq!(counts(&core), c);
    assert_eq!(one(&core, p).state, SummaryState::Failed);
}

#[test]
fn manual_requests_are_scoped_and_internal_job_only_ranges_do_not_hide_older_visible_rows() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let source = capture(&core, p, "visible older record");
    capture(&core, q, "private Q");
    let ctx = core.local_human(p).unwrap();
    let request = SummaryRequestCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        purpose: SummaryPurpose::ManualCompressV1,
        artifact_kind: SummaryArtifactKind::CompressedMessage,
        selection: SummarySelection {
            block_ids: vec![TimeblockId::new()],
            from_ms: 1000,
            to_ms: 2000,
            selected_original_ids: vec![],
        },
    };
    core.request_summary(&ctx, &request).unwrap();
    assert!(core.request_summary(&ctx, &request).unwrap().replayed);
    let page = core
        .timeline_page(
            &ctx,
            p,
            &EventQuery {
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(page.next_before.is_none());
    assert!(matches!(&page.items[0],TimelineItem::Capture(v) if v.event_id==source));
    let executor = core.local_summary_executor();
    let work = core
        .begin_summary_attempt(&executor, &begin(&core, p, &one(&core, p)))
        .unwrap();
    assert_eq!(work.snapshot.sources.len(), 1);
    let input = core.summary_input_records(&executor, &work.ticket).unwrap();
    assert!(
        matches!(&input.records[0],SummaryInputRecord::Capture(v)if v.text=="visible older record")
    );
}

#[test]
fn remote_metadata_stays_unread_by_default_and_explicit_missing_original_never_claims_attempt() {
    let (_a, _b, a, b, p) = pair();
    let (block, _) = start(&a, p);
    let human = a.local_human(p).unwrap();
    let bytes = b"synthetic media\0\xff";
    let original = OriginalRef {
        original_id: OriginalId::new(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "opaque.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    let stage = StageId::new();
    a.begin_stage(
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
    a.write_stage_chunk(&human, stage, 0, bytes).unwrap();
    let proof = a
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    a.finish_stage(&human, &proof).unwrap();
    a.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1500,
            text: "media source".into(),
            tags: vec![],
            originals: vec![original.clone()],
        },
    )
    .unwrap();
    end(&a, p, block);
    a.reconcile_summary_triggers(&a.local_summary_executor())
        .unwrap();
    sync(&a, &b, p);
    control(
        &b,
        p,
        &one(&b, p),
        SummaryControlAction::TakeOverForSelf {
            run_id: Uuid::new_v4(),
            resume_cancelled: false,
        },
    );
    let bx = b.local_summary_executor();
    let work = b
        .begin_summary_attempt(&bx, &begin(&b, p, &one(&b, p)))
        .unwrap();
    assert_eq!(
        work.snapshot.materials[0].read_state,
        SummaryMaterialState::NotSelected
    );
    assert_eq!(
        work.snapshot.coverage.metadata_only,
        vec![original.original_id]
    );
    assert_eq!(
        work.snapshot.coverage.unread_originals,
        vec![original.original_id]
    );
    assert!(b
        .read_original_range(&b.local_human(p).unwrap(), p, original.original_id, 0, 1)
        .is_err());
    let mut lie = output(&work.snapshot);
    lie.read_original_ids = vec![original.original_id];
    assert!(b.finish_summary_attempt(&bx, &work.ticket, &lie).is_err());
    b.fail_summary_attempt(
        &bx,
        &work.ticket,
        SummaryFailureKind::UnsupportedMaterial,
        None,
    )
    .unwrap();
    let mut selection = work.snapshot.selection;
    selection.selected_original_ids = vec![original.original_id];
    control(
        &b,
        p,
        &one(&b, p),
        SummaryControlAction::QueueUpdate {
            run_id: Uuid::new_v4(),
            selection,
            supersedes_artifact_id: None,
        },
    );
    let before = counts(&b);
    assert!(matches!(
        b.begin_summary_attempt(&bx, &begin(&b, p, &one(&b, p))),
        Err(CoreError::SummaryBlocked("originals_missing"))
    ));
    assert_eq!(counts(&b), before);
}
