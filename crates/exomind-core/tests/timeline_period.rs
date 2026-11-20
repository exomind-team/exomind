use exomind_core::{
    AgentId, CaptureCommand, CommandId, Core, EventId, EventQuery, ExternalSummaryAppendCommand,
    FeedbackInput, IntervalQuery, ProfileId, SummaryBeginCommand, SummaryCommitOutcome,
    SummaryModelMetadata, SummaryOutput, SummarySourceRef, SummarySourceSnapshot, SummaryUsage,
    TimeblockAction, TimeblockCommand, TimeblockId, TimelineItem, TimelinePeriodQuery, TimerSpec,
};
use std::collections::HashSet;
use uuid::Uuid;

fn period_query(
    from_ms: i64,
    to_ms: i64,
    before: Option<u64>,
    through: Option<u64>,
    limit: usize,
    tag: Option<&str>,
    search: Option<&str>,
) -> TimelinePeriodQuery {
    TimelinePeriodQuery {
        from_ms,
        to_ms,
        before,
        through,
        limit,
        tag: tag.map(str::to_owned),
        search: search.map(str::to_owned),
    }
}

fn capture(
    core: &Core,
    profile: ProfileId,
    occurred_at_ms: i64,
    text: &str,
    tags: &[&str],
) -> (EventId, String) {
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms,
        text: text.to_owned(),
        tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
        originals: vec![],
    };
    let receipt = core
        .submit(&core.local_human(profile).unwrap(), &command)
        .unwrap();
    (command.event_id, receipt.event_digest)
}

fn apply_timeblock(
    core: &Core,
    profile: ProfileId,
    wall_ms: i64,
    action: TimeblockAction,
) -> EventId {
    let context = core.local_human(profile).unwrap();
    let stamp = core
        .trusted_clock_stamp(Uuid::from_u128(17), wall_ms, wall_ms as u64)
        .unwrap();
    let revision = core
        .timeblock_snapshot(&context, profile, &stamp)
        .unwrap()
        .revision;
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        expected_revision: revision,
        action,
    };
    core.apply_timeblock(&context, &command, &stamp).unwrap();
    command.event_id
}

fn start_block(core: &Core, profile: ProfileId, at_ms: i64) -> TimeblockId {
    let block_id = TimeblockId::new();
    apply_timeblock(
        core,
        profile,
        at_ms,
        TimeblockAction::Start {
            block_id,
            name: "synthetic period fixture".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    block_id
}

fn finish_block(core: &Core, profile: ProfileId, block_id: TimeblockId) {
    apply_timeblock(
        core,
        profile,
        2_000,
        TimeblockAction::EndAction { block_id },
    );
    apply_timeblock(
        core,
        profile,
        3_000,
        TimeblockAction::SubmitFeedback {
            block_id,
            feedback: FeedbackInput::Skipped,
        },
    );
}

fn summary_output(snapshot: &SummarySourceSnapshot) -> SummaryOutput {
    SummaryOutput {
        narrative: "Synthetic timeline summary.".into(),
        evidence: vec![snapshot.sources[0].event_id],
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

fn create_internal_summary(core: &Core, profile: ProfileId) -> EventId {
    let executor = core.local_summary_executor();
    core.reconcile_summary_triggers(&executor).unwrap();
    let context = core.local_human(profile).unwrap();
    let task = core
        .summary_tasks_page(&context, profile, None, 100)
        .unwrap()
        .items
        .into_iter()
        .next()
        .expect("feedback fixture creates one summary task");
    core.summary_wait_for_configuration(&executor, profile, task.task_id)
        .unwrap();
    let work = core
        .begin_summary_attempt(
            &executor,
            &SummaryBeginCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                task_id: task.task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: task.current_run.as_ref().unwrap().run_id,
                attempt_id: Uuid::new_v4(),
                role_config_digest: "a".repeat(64),
                max_attempts: 2,
                now_ms: 4_000,
            },
        )
        .unwrap();
    match core
        .finish_summary_attempt(&executor, &work.ticket, &summary_output(&work.snapshot))
        .unwrap()
    {
        SummaryCommitOutcome::Applied {
            artifact_event_id, ..
        } => artifact_event_id,
        other => panic!("summary fixture must commit an artifact: {other:?}"),
    }
}

fn create_agent_summary(
    core: &Core,
    profile: ProfileId,
    source_event_id: EventId,
    source_digest: String,
) -> EventId {
    let context = core.local_human(profile).unwrap();
    let through = core
        .events_page(&context, profile, &EventQuery::default())
        .unwrap()
        .highwater;
    let command = ExternalSummaryAppendCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 4_000,
        observed_through: through,
        sources: vec![SummarySourceRef {
            event_id: source_event_id,
            kind: "capture".into(),
            digest: source_digest,
        }],
        narrative: "Synthetic explicit-source Agent summary.".into(),
        evidence: vec![source_event_id],
    };
    let producer = core
        .local_external_summary_producer(profile, AgentId::new())
        .unwrap();
    core.append_external_summary(&producer, &command)
        .unwrap()
        .event_id
}

fn capture_ids(items: &[TimelineItem]) -> Vec<(EventId, u64)> {
    items
        .iter()
        .filter_map(|item| match item {
            TimelineItem::Capture(record) => Some((record.event_id, record.local_seq)),
            _ => None,
        })
        .collect()
}

#[test]
fn period_reads_four_typed_facts_and_same_window_intervals_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("timeline period").unwrap();
    let human = core.local_human(profile).unwrap();

    let block_id = start_block(&core, profile, 1_000);
    let (capture_id, capture_digest) = capture(&core, profile, 1_500, "period source", &["focus"]);
    finish_block(&core, profile, block_id);
    let internal_summary_id = create_internal_summary(&core, profile);
    let agent_summary_id = create_agent_summary(&core, profile, capture_id, capture_digest);
    let before_read = core
        .events_page(&human, profile, &EventQuery::default())
        .unwrap()
        .highwater;

    let page = core
        .timeline_period_page(
            &human,
            profile,
            &period_query(0, i64::MAX, None, None, 100, None, None),
        )
        .unwrap();
    assert_eq!(page.highwater, before_read);
    assert!(page.items.iter().any(
        |item| matches!(item, TimelineItem::Capture(record) if record.event_id == capture_id)
    ));
    assert!(
        page.items
            .iter()
            .any(|item| matches!(item, TimelineItem::Timeblock(_)))
    );
    assert!(page.items.iter().any(|item| matches!(item, TimelineItem::Summary(record) if record.event_id == internal_summary_id)));
    assert!(page.items.iter().any(|item| matches!(item, TimelineItem::AgentSummary(record) if record.event_id == agent_summary_id)));

    let intervals = core
        .timeblock_intervals(
            &human,
            profile,
            &IntervalQuery {
                from_ms: 0,
                to_ms: 5_000,
                through: None,
                limit: 100,
            },
        )
        .unwrap();
    assert!(!intervals.items.is_empty());
    assert!(
        intervals
            .items
            .iter()
            .all(|item| item.from_ms >= 0 && item.from_ms < item.to_ms && item.to_ms <= 5_000)
    );
    let pinned_intervals = core
        .timeblock_intervals(
            &human,
            profile,
            &IntervalQuery {
                from_ms: 0,
                to_ms: 5_000,
                through: Some(intervals.revision.clone()),
                limit: 100,
            },
        )
        .unwrap();
    assert_eq!(pinned_intervals.revision, intervals.revision);
    assert_eq!(
        core.events_page(&human, profile, &EventQuery::default())
            .unwrap()
            .highwater,
        before_read,
        "ordinary browsing must not append facts or advance the snapshot"
    );

    let empty = core
        .timeline_period_page(
            &human,
            profile,
            &period_query(8_000_000, 8_000_001, None, None, 100, None, None),
        )
        .unwrap();
    assert!(empty.items.is_empty());
    assert!(empty.next_before.is_none());
    assert!(
        core.timeline_period_page(
            &human,
            profile,
            &period_query(5_000, 5_000, None, None, 100, None, None),
        )
        .is_err()
    );
}

#[test]
fn half_open_boundaries_cover_day_month_and_dst_repeated_hour_with_tag_and_search() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("calendar boundaries").unwrap();

    let windows = [
        // UTC day boundary: 2026-10-31 23:30 through 2026-11-01 00:30.
        (1_793_489_400_000_i64, 1_793_493_000_000_i64),
        // UTC month boundary: 2026-11-30 23:30 through 2026-12-01 00:30.
        (1_796_081_400_000_i64, 1_796_085_000_000_i64),
        // New York's repeated 01:30: 05:30Z EDT through 06:30Z EST.
        (1_793_511_000_000_i64, 1_793_514_600_000_i64),
    ];

    for (from_ms, to_ms) in windows {
        let (at_start, _) = capture(&core, profile, from_ms, "needle at start", &["focus"]);
        let (inside_last_ms, _) =
            capture(&core, profile, to_ms - 1, "needle before end", &["focus"]);
        capture(
            &core,
            profile,
            from_ms - 1,
            "needle before window",
            &["focus"],
        );
        capture(&core, profile, to_ms, "needle at exclusive end", &["focus"]);
        capture(&core, profile, from_ms + 1, "needle wrong tag", &["other"]);
        capture(&core, profile, from_ms + 2, "different text", &["focus"]);

        let page = core
            .timeline_period_page(
                &core.local_human(profile).unwrap(),
                profile,
                &period_query(
                    from_ms,
                    to_ms,
                    None,
                    None,
                    20,
                    Some("focus"),
                    Some("needle"),
                ),
            )
            .unwrap();
        let found: HashSet<_> = capture_ids(&page.items)
            .into_iter()
            .map(|(event_id, _)| event_id)
            .collect();
        assert_eq!(found, HashSet::from([at_start, inside_last_ms]));
    }

    let empty = core
        .timeline_period_page(
            &core.local_human(profile).unwrap(),
            profile,
            &period_query(
                1_800_000_000_000,
                1_800_000_000_001,
                None,
                None,
                20,
                None,
                None,
            ),
        )
        .unwrap();
    assert!(empty.items.is_empty());
}

#[test]
fn fixed_profile_snapshot_pages_do_not_repeat_omit_or_admit_late_records() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let other_profile = core.create_profile("Q").unwrap();
    let expected: HashSet<_> = (0..5)
        .map(|index| {
            capture(
                &core,
                profile,
                1_200 + index * 100,
                &format!("needle record {index}"),
                &["focus"],
            )
            .0
        })
        .collect();
    let foreign = capture(
        &core,
        other_profile,
        1_400,
        "needle foreign profile",
        &["focus"],
    )
    .0;

    let first = core
        .timeline_period_page(
            &core.local_human(profile).unwrap(),
            profile,
            &period_query(1_000, 2_000, None, None, 2, Some("focus"), Some("needle")),
        )
        .unwrap();
    let highwater = first.highwater;
    assert_eq!(first.items.len(), 2);
    let late = capture(&core, profile, 1_250, "needle late arrival", &["focus"]).0;

    let mut received: Vec<_> = first
        .items
        .iter()
        .filter_map(|item| match item {
            TimelineItem::Capture(record) => Some(record.event_id),
            _ => None,
        })
        .collect();
    let mut before = first.next_before;
    while let Some(cursor) = before {
        let page = core
            .timeline_period_page(
                &core.local_human(profile).unwrap(),
                profile,
                &period_query(
                    1_000,
                    2_000,
                    Some(cursor),
                    Some(highwater),
                    2,
                    Some("focus"),
                    Some("needle"),
                ),
            )
            .unwrap();
        assert_eq!(page.highwater, highwater);
        assert!(page.items.iter().all(|item| match item {
            TimelineItem::Capture(record) =>
                record.local_seq < cursor && record.local_seq <= highwater,
            _ => false,
        }));
        received.extend(page.items.iter().filter_map(|item| match item {
            TimelineItem::Capture(record) => Some(record.event_id),
            _ => None,
        }));
        before = page.next_before;
    }

    let unique: HashSet<_> = received.iter().copied().collect();
    assert_eq!(received.len(), expected.len());
    assert_eq!(unique, expected);
    assert!(!unique.contains(&late));
    assert!(!unique.contains(&foreign));

    let fresh = core
        .timeline_period_page(
            &core.local_human(profile).unwrap(),
            profile,
            &period_query(
                1_000,
                2_000,
                None,
                None,
                100,
                Some("focus"),
                Some("late arrival"),
            ),
        )
        .unwrap();
    assert!(
        fresh
            .items
            .iter()
            .any(|item| matches!(item, TimelineItem::Capture(record) if record.event_id == late))
    );
}
