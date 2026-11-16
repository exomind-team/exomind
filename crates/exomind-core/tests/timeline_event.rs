use exomind_core::*;
use rusqlite::{Connection, OpenFlags, params, types::Value};
use std::collections::BTreeMap;
use uuid::Uuid;

fn snapshot(core: &Core) -> BTreeMap<String, Vec<Vec<Value>>> {
    let c = Connection::open_with_flags(core.database_path(), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap();
    let names = c
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let mut q = c
                .prepare(&format!(
                    "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
                    name.replace('"', "\"\"")
                ))
                .unwrap();
            let count = q.column_count();
            let values = q
                .query_map([], |r| {
                    (0..count)
                        .map(|i| r.get(i))
                        .collect::<Result<Vec<Value>, _>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            (name, values)
        })
        .collect()
}
fn capture(core: &Core, p: ProfileId) -> Receipt {
    core.submit(
        &core.local_human(p).unwrap(),
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1000,
            text: "synthetic exact source".into(),
            tags: vec![],
            originals: vec![],
        },
    )
    .unwrap()
}
fn request(core: &Core, p: ProfileId, block: TimeblockId) -> Receipt {
    core.request_summary(
        &core.local_human(p).unwrap(),
        &SummaryRequestCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::CompressedBlock,
            selection: SummarySelection {
                block_ids: vec![block],
                from_ms: 0,
                to_ms: 2000,
                selected_original_ids: vec![],
            },
        },
    )
    .unwrap()
}
fn id(value: &TimelineItem) -> EventId {
    match value {
        TimelineItem::Capture(v) => v.event_id,
        TimelineItem::Timeblock(v) => v.event_id,
        TimelineItem::Summary(v) => v.event_id,
    }
}

#[test]
fn exact_visible_capture_timeblock_and_summary_equal_validated_paged_records_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let human = core.local_human(p).unwrap();
    let captured = capture(&core, p);
    let block = TimeblockId::new();
    let stamp = core.trusted_clock_stamp(Uuid::new_v4(), 1000, 0).unwrap();
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: core.timeblock_snapshot(&human, p, &stamp).unwrap().revision,
        action: TimeblockAction::Start {
            block_id: block,
            name: "synthetic source block".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    };
    let typed = core.apply_timeblock(&human, &command, &stamp).unwrap();
    request(&core, p, block);
    let task = core
        .summary_tasks_page(&human, p, None, 100)
        .unwrap()
        .items
        .pop()
        .unwrap();
    let exec = core.local_summary_executor();
    let work = core
        .begin_summary_attempt(
            &exec,
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
                now_ms: 2000,
            },
        )
        .unwrap();
    let output = SummaryOutput {
        narrative: "Synthetic scoped review".into(),
        evidence: vec![captured.event_id],
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
    };
    let SummaryCommitOutcome::Applied {
        artifact_event_id, ..
    } = core
        .finish_summary_attempt(&exec, &work.ticket, &output)
        .unwrap()
    else {
        panic!("applied synthetic result")
    };
    let before = snapshot(&core);
    let page = core
        .timeline_page(&human, p, &EventQuery::default())
        .unwrap();
    assert_eq!(page.items.len(), 3);
    for event in [captured.event_id, typed.event_id, artifact_event_id] {
        let exact = core.read_timeline_event(&human, p, event).unwrap().unwrap();
        let paged = page.items.iter().find(|item| id(item) == event).unwrap();
        assert_eq!(
            serde_json::to_value(exact).unwrap(),
            serde_json::to_value(paged).unwrap()
        );
    }
    assert_eq!(snapshot(&core), before);
}

#[test]
fn internal_jobs_other_profiles_unknown_ids_and_foreign_context_cannot_open_sources() {
    let root = tempfile::tempdir().unwrap();
    let foreign_root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let foreign = Core::open(foreign_root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    foreign.provision_profile(p, "P").unwrap();
    let pctx = core.local_human(p).unwrap();
    let qctx = core.local_human(q).unwrap();
    let qrecord = capture(&core, q);
    let job = request(&core, p, TimeblockId::new());
    let before = snapshot(&core);
    for event in [qrecord.event_id, job.event_id, EventId::new()] {
        assert!(core.read_timeline_event(&pctx, p, event).unwrap().is_none());
    }
    assert!(matches!(
        core.read_timeline_event(&pctx, q, qrecord.event_id),
        Err(CoreError::ScopeMismatch)
    ));
    assert!(matches!(
        core.read_timeline_event(&foreign.local_human(p).unwrap(), p, job.event_id),
        Err(CoreError::ForeignContext)
    ));
    assert!(matches!(
        core.read_timeline_event(&qctx, q, qrecord.event_id)
            .unwrap(),
        Some(TimelineItem::Capture(_))
    ));
    assert_eq!(snapshot(&core), before);
}

#[test]
fn bad_body_digest_or_header_is_an_error_in_both_readers_and_never_repaired() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let human = core.local_human(p).unwrap();
    let receipt = capture(&core, p);
    let db = Connection::open(core.database_path()).unwrap();
    let (body, digest): (String, String) = db
        .query_row(
            "SELECT body,digest FROM events WHERE event_id=?1",
            [receipt.event_id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let mut wrong_header: EventRecord = serde_json::from_str(&body).unwrap();
    wrong_header.profile_id = ProfileId::new();
    wrong_header.digest = wrong_header.computed_digest().unwrap();
    let cases = [
        ("{".into(), digest.clone()),
        ("x".repeat(MAX_FACT_BYTES + 1), digest.clone()),
        (body.clone(), "f".repeat(64)),
        (
            serde_json::to_string(&wrong_header).unwrap(),
            wrong_header.digest,
        ),
    ];
    for (bad_body, bad_digest) in cases {
        db.execute(
            "UPDATE events SET body=?1,digest=?2 WHERE event_id=?3",
            params![bad_body, bad_digest, receipt.event_id.to_string()],
        )
        .unwrap();
        let before = snapshot(&core);
        assert!(
            core.read_timeline_event(&human, p, receipt.event_id)
                .is_err()
        );
        assert!(
            core.timeline_page(&human, p, &EventQuery::default())
                .is_err()
        );
        assert_eq!(snapshot(&core), before);
    }
    db.execute(
        "UPDATE events SET body=?1,digest=?2 WHERE event_id=?3",
        params![body, digest, receipt.event_id.to_string()],
    )
    .unwrap();
    assert!(
        core.read_timeline_event(&human, p, receipt.event_id)
            .unwrap()
            .is_some()
    );
}

#[test]
fn database_failure_is_not_a_missing_event_or_an_empty_page() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let human = core.local_human(p).unwrap();
    let receipt = capture(&core, p);
    let db = Connection::open(core.database_path()).unwrap();
    db.pragma_update(None, "foreign_keys", false).unwrap();
    db.execute("DROP TABLE events", []).unwrap();
    let before = snapshot(&core);
    assert!(matches!(
        core.read_timeline_event(&human, p, receipt.event_id),
        Err(CoreError::Storage(_))
    ));
    assert!(matches!(
        core.timeline_page(&human, p, &EventQuery::default()),
        Err(CoreError::Storage(_))
    ));
    assert_eq!(snapshot(&core), before);
}
