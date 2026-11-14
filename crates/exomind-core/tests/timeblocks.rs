use exomind_core::{
    ClockStamp, CommandId, Core, CoreError, EventId, EventQuery, FeedbackInput, IntervalKind,
    IntervalQuery, ProfileId, StartBlockSpec, TimeblockAction, TimeblockCommand, TimeblockId,
    TimeblockPhase, TimerSpec, WriterContext,
};
use std::sync::{Arc, Barrier};
use uuid::Uuid;

fn stamp(core: &Core, ms: i64) -> ClockStamp {
    core.trusted_clock_stamp(Uuid::from_u128(17), ms, ms as u64)
        .unwrap()
}

#[test]
fn soft_and_hard_deadlines_reconcile_after_restart_without_old_ticket_authority() {
    use exomind_core::{CountdownEndMode, DeadlineOutcome};
    for mode in [CountdownEndMode::Soft, CountdownEndMode::Hard] {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path()).unwrap();
        let p = core.create_profile("synthetic deadline").unwrap();
        let human = core.local_human(p).unwrap();
        let block = TimeblockId::new();
        apply(
            &core,
            &human,
            p,
            1000,
            TimeblockAction::Start {
                block_id: block,
                name: "timer".into(),
                note: String::new(),
                timer: TimerSpec::CountDown {
                    duration_ms: 1000,
                    end_mode: mode,
                },
            },
        );
        let scheduler = core.local_scheduler();
        let old_ticket = core
            .due_deadlines(&scheduler, &stamp(&core, 2000), 10)
            .unwrap()
            .pop()
            .unwrap();
        if mode == CountdownEndMode::Soft {
            assert!(matches!(
                core.complete_deadline(&scheduler, &old_ticket, &stamp(&core, 2000))
                    .unwrap(),
                DeadlineOutcome::Applied(_)
            ));
        }
        drop(core);
        let core = Core::open(root.path()).unwrap();
        let human = core.local_human(p).unwrap();
        let scheduler = core.local_scheduler();
        let now = core
            .trusted_clock_stamp(Uuid::from_u128(18), 6000, 50)
            .unwrap();
        assert!(matches!(
            core.complete_deadline(&scheduler, &old_ticket, &now)
                .unwrap(),
            DeadlineOutcome::Stale
        ));
        let due = core.due_deadlines(&scheduler, &now, 10).unwrap();
        if mode == CountdownEndMode::Soft {
            assert!(due.is_empty());
        } else {
            assert_eq!(due.len(), 1);
            assert!(matches!(
                core.complete_deadline(&scheduler, &due[0], &now).unwrap(),
                DeadlineOutcome::Applied(_)
            ));
            assert!(
                matches!(core.complete_deadline(&scheduler,&due[0],&now).unwrap(),DeadlineOutcome::Applied(receipt) if receipt.replayed)
            );
        }
        let snapshot = core.timeblock_snapshot(&human, p, &now).unwrap();
        assert!(snapshot.clock.epoch_changed);
        let active = snapshot.active.unwrap();
        if mode == CountdownEndMode::Soft {
            assert_eq!(active.phase, TimeblockPhase::Running);
            assert_eq!(active.work_ms, 5000);
            assert!(active.deadline_reached);
        } else {
            assert_eq!(active.phase, TimeblockPhase::FeedbackPending);
            assert_eq!(active.work_ms, 1000);
        }
        assert_eq!(
            core.timeblock_nodes(&human, p, &EventQuery::default())
                .unwrap()
                .items
                .len(),
            2
        );
    }
}

#[test]
fn pause_resume_invalidates_a_late_soft_deadline_ticket_without_losing_the_new_deadline() {
    use exomind_core::{CountdownEndMode, DeadlineOutcome};
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic stale deadline").unwrap();
    let human = core.local_human(p).unwrap();
    let a = TimeblockId::new();
    apply(
        &core,
        &human,
        p,
        1000,
        TimeblockAction::Start {
            block_id: a,
            name: "A".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1000,
                end_mode: CountdownEndMode::Soft,
            },
        },
    );
    let scheduler = core.local_scheduler();
    let old = core
        .due_deadlines(&scheduler, &stamp(&core, 2000), 10)
        .unwrap()
        .pop()
        .unwrap();
    apply(
        &core,
        &human,
        p,
        2000,
        TimeblockAction::Pause { block_id: a },
    );
    assert!(matches!(
        core.complete_deadline(&scheduler, &old, &stamp(&core, 2500))
            .unwrap(),
        DeadlineOutcome::Stale
    ));
    apply(
        &core,
        &human,
        p,
        3000,
        TimeblockAction::Resume { block_id: a },
    );
    let new = core
        .due_deadlines(&scheduler, &stamp(&core, 3000), 10)
        .unwrap();
    assert_eq!(new.len(), 1);
    assert!(matches!(
        core.complete_deadline(&scheduler, &new[0], &stamp(&core, 3000))
            .unwrap(),
        DeadlineOutcome::Applied(_)
    ));
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        4
    );
}

#[test]
fn wall_clock_rollback_does_not_reverse_work_or_rewrite_the_original_node() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic rollback").unwrap();
    let human = core.local_human(p).unwrap();
    let first = core
        .trusted_clock_stamp(Uuid::from_u128(17), 5000, 1000)
        .unwrap();
    let input = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: core.timeblock_snapshot(&human, p, &first).unwrap().revision,
        action: start(TimeblockId::new(), "A"),
    };
    core.apply_timeblock(&human, &input, &first).unwrap();
    let moved_back = core
        .trusted_clock_stamp(Uuid::from_u128(17), 4000, 2000)
        .unwrap();
    let snapshot = core.timeblock_snapshot(&human, p, &moved_back).unwrap();
    assert!(snapshot.clock.wall_clock_moved_back);
    assert_eq!(snapshot.active.unwrap().work_ms, 1000);
    let nodes = core
        .timeblock_nodes(&human, p, &EventQuery::default())
        .unwrap();
    assert_eq!(nodes.items.len(), 1);
    assert_eq!(nodes.items[0].occurred_at_ms, 5000);
}

#[test]
fn concurrent_node_arrival_order_and_local_sequence_never_choose_the_timeline_winner() {
    use exomind_core::{ProjectionQuery, project_timeblocks};
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let a = Core::open(root_a.path()).unwrap();
    let b = Core::open(root_b.path()).unwrap();
    let p = ProfileId::new();
    a.provision_profile(p, "P").unwrap();
    b.provision_profile(p, "P").unwrap();
    let ca = a.local_human(p).unwrap();
    let cb = b.local_human(p).unwrap();
    let ba = TimeblockId::new();
    let bb = TimeblockId::new();
    apply(&a, &ca, p, 5000, start(ba, "A"));
    apply(&b, &cb, p, 1000, start(bb, "B"));
    let na = a
        .timeblock_nodes(&ca, p, &EventQuery::default())
        .unwrap()
        .items
        .remove(0);
    let nb = b
        .timeblock_nodes(&cb, p, &EventQuery::default())
        .unwrap()
        .items
        .remove(0);
    let expected = if (na.device_id.to_string(), na.event_id.to_string())
        > (nb.device_id.to_string(), nb.event_id.to_string())
    {
        ba
    } else {
        bb
    };
    let query = ProjectionQuery {
        from_ms: 0,
        to_ms: 6000,
    };
    let left = project_timeblocks(p, &[na.clone(), nb.clone()], &query).unwrap();
    let right = project_timeblocks(p, &[nb, na], &query).unwrap();
    assert_eq!(
        serde_json::to_value(&left).unwrap(),
        serde_json::to_value(&right).unwrap()
    );
    assert_eq!(left.active_block_id, Some(expected));
    assert_eq!(left.retained_event_ids.len(), 2);
    assert!(!left.conflicts.is_empty());
}

#[test]
fn agent_context_cannot_control_or_replay_a_human_timeblock_command() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic source").unwrap();
    let human = core.local_human(p).unwrap();
    let agent = core.local_agent(p, exomind_core::AgentId::new()).unwrap();
    let input = command(&core, &human, p, 1000, start(TimeblockId::new(), "A"));
    assert!(matches!(
        core.apply_timeblock(&agent, &input, &stamp(&core, 1000)),
        Err(CoreError::TimeblockControlDenied)
    ));
    core.apply_timeblock(&human, &input, &stamp(&core, 1000))
        .unwrap();
    assert!(matches!(
        core.apply_timeblock(&agent, &input, &stamp(&core, 2000)),
        Err(CoreError::TimeblockControlDenied)
    ));
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
}
fn command(
    core: &Core,
    context: &WriterContext,
    profile: ProfileId,
    ms: i64,
    action: TimeblockAction,
) -> TimeblockCommand {
    let revision = core
        .timeblock_snapshot(context, profile, &stamp(core, ms))
        .unwrap()
        .revision;
    TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        expected_revision: revision,
        action,
    }
}
fn start(block_id: TimeblockId, name: &str) -> TimeblockAction {
    TimeblockAction::Start {
        block_id,
        name: name.into(),
        note: String::new(),
        timer: TimerSpec::CountUp,
    }
}
fn apply(
    core: &Core,
    context: &WriterContext,
    profile: ProfileId,
    ms: i64,
    action: TimeblockAction,
) {
    let input = command(core, context, profile, ms, action);
    core.apply_timeblock(context, &input, &stamp(core, ms))
        .unwrap();
}

#[test]
fn stable_request_retry_ignores_new_server_now_and_stale_revision_but_not_changed_content() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic timer").unwrap();
    let human = core.local_human(p).unwrap();
    let input = command(
        &core,
        &human,
        p,
        1000,
        start(TimeblockId::new(), "original"),
    );
    let first = core
        .apply_timeblock(&human, &input, &stamp(&core, 1000))
        .unwrap();
    let repeated = core
        .apply_timeblock(&human, &input, &stamp(&core, 9000))
        .unwrap();
    assert!(repeated.replayed);
    assert_eq!(repeated.event_digest, first.event_digest);
    assert_eq!(repeated.local_seq, first.local_seq);
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    let mut changed = input.clone();
    changed.action = start(TimeblockId::new(), "changed");
    assert!(matches!(
        core.apply_timeblock(&human, &changed, &stamp(&core, 10000)),
        Err(CoreError::CommandConflict)
    ));
}

#[test]
fn same_revision_concurrent_starts_commit_one_fact_and_report_the_other_conflict() {
    let root = tempfile::tempdir().unwrap();
    let core = Arc::new(Core::open(root.path()).unwrap());
    let p = core.create_profile("synthetic concurrency").unwrap();
    let human = core.local_human(p).unwrap();
    let inputs = [
        command(&core, &human, p, 1000, start(TimeblockId::new(), "A")),
        command(&core, &human, p, 1000, start(TimeblockId::new(), "B")),
    ];
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = inputs
        .into_iter()
        .map(|input| {
            let core = core.clone();
            let human = human.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                core.apply_timeblock(&human, &input, &stamp(&core, 1000))
            })
        })
        .collect();
    let results: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|item| item.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|item| matches!(item, Err(CoreError::TimeblockConflict)))
            .count(),
        1
    );
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn rotate_receipt_failure_rolls_back_old_end_new_start_and_the_single_composite_node() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic rotate").unwrap();
    let human = core.local_human(p).unwrap();
    let a = TimeblockId::new();
    let b = TimeblockId::new();
    apply(&core, &human, p, 1000, start(a, "A"));
    let input = command(
        &core,
        &human,
        p,
        2000,
        TimeblockAction::Rotate {
            from_block_id: a,
            next: StartBlockSpec {
                block_id: b,
                name: "B".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
    );
    let database = rusqlite::Connection::open(core.database_path()).unwrap();
    database.execute_batch(&format!("CREATE TRIGGER interrupt_timer_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id='{}' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",input.command_id)).unwrap();
    assert!(
        core.apply_timeblock(&human, &input, &stamp(&core, 2000))
            .is_err()
    );
    let unchanged = core
        .timeblock_snapshot(&human, p, &stamp(&core, 2500))
        .unwrap();
    assert_eq!(unchanged.active.unwrap().block_id, a);
    assert_eq!(unchanged.revision, input.expected_revision);
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    assert!(core.receipt(&human, input.command_id).unwrap().is_none());
    database
        .execute_batch("DROP TRIGGER interrupt_timer_receipt")
        .unwrap();
    core.apply_timeblock(&human, &input, &stamp(&core, 3000))
        .unwrap();
    let rotated = core
        .timeblock_snapshot(&human, p, &stamp(&core, 3500))
        .unwrap();
    assert_eq!(rotated.active.unwrap().block_id, b);
    assert!(rotated.pending_feedback.contains(&a));
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn paused_time_is_not_work_and_feedback_and_idle_gaps_partition_the_window() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic intervals").unwrap();
    let human = core.local_human(p).unwrap();
    let a = TimeblockId::new();
    apply(&core, &human, p, 1000, start(a, "A"));
    apply(
        &core,
        &human,
        p,
        4000,
        TimeblockAction::Pause { block_id: a },
    );
    let paused = core
        .timeblock_snapshot(&human, p, &stamp(&core, 9000))
        .unwrap()
        .active
        .unwrap();
    assert_eq!(paused.phase, TimeblockPhase::Paused);
    assert_eq!(paused.work_ms, 3000);
    apply(
        &core,
        &human,
        p,
        10000,
        TimeblockAction::Resume { block_id: a },
    );
    apply(
        &core,
        &human,
        p,
        12000,
        TimeblockAction::EndAction { block_id: a },
    );
    assert_eq!(
        core.timeblock_snapshot(&human, p, &stamp(&core, 12500))
            .unwrap()
            .active
            .unwrap()
            .work_ms,
        5000
    );
    apply(
        &core,
        &human,
        p,
        13000,
        TimeblockAction::SubmitFeedback {
            block_id: a,
            feedback: FeedbackInput::Skipped,
        },
    );
    let intervals = core
        .timeblock_intervals(
            &human,
            p,
            &IntervalQuery {
                from_ms: 1000,
                to_ms: 15000,
                through: None,
                limit: 100,
            },
        )
        .unwrap();
    let rows: Vec<_> = intervals
        .items
        .iter()
        .map(|item| (item.from_ms, item.to_ms, item.kind))
        .collect();
    assert_eq!(
        rows,
        vec![
            (1000, 4000, IntervalKind::Running),
            (4000, 10000, IntervalKind::Paused),
            (10000, 12000, IntervalKind::Running),
            (12000, 13000, IntervalKind::Feedback),
            (13000, 15000, IntervalKind::Gap)
        ]
    );
}

#[test]
fn late_feedback_for_a_rotated_old_block_never_ends_the_new_active_block() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic old feedback").unwrap();
    let human = core.local_human(p).unwrap();
    let a = TimeblockId::new();
    let b = TimeblockId::new();
    apply(&core, &human, p, 1000, start(a, "A"));
    apply(
        &core,
        &human,
        p,
        2000,
        TimeblockAction::Rotate {
            from_block_id: a,
            next: StartBlockSpec {
                block_id: b,
                name: "B".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
    );
    apply(
        &core,
        &human,
        p,
        3000,
        TimeblockAction::SubmitFeedback {
            block_id: a,
            feedback: FeedbackInput::Text {
                text: "old block feedback".into(),
            },
        },
    );
    apply(
        &core,
        &human,
        p,
        4000,
        TimeblockAction::AppendFeedback {
            block_id: a,
            text: "additional note".into(),
        },
    );
    let snapshot = core
        .timeblock_snapshot(&human, p, &stamp(&core, 4500))
        .unwrap();
    let active = snapshot.active.unwrap();
    assert_eq!(active.block_id, b);
    assert_eq!(active.phase, TimeblockPhase::Running);
    assert_eq!(active.work_ms, 2500);
    assert!(!snapshot.pending_feedback.contains(&a));
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        4
    );
}

#[test]
fn mixed_typed_timeline_uses_one_global_highwater_and_never_omits_a_kind_between_pages() {
    use exomind_core::{CaptureCommand, TimelineItem};
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("mixed stream").unwrap();
    let human = core.local_human(p).unwrap();
    let note = |text: &str| CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1000,
        text: text.into(),
        tags: vec![],
        originals: vec![],
    };
    core.submit(&human, &note("before")).unwrap();
    let block = TimeblockId::new();
    apply(&core, &human, p, 1000, start(block, "timer"));
    core.submit(&human, &note("during")).unwrap();
    apply(
        &core,
        &human,
        p,
        2000,
        TimeblockAction::Pause { block_id: block },
    );
    let mut query = EventQuery {
        limit: 1,
        ..EventQuery::default()
    };
    let mut kinds = vec![];
    let mut sequences = vec![];
    loop {
        let page = core.timeline_page(&human, p, &query).unwrap();
        assert_eq!(page.highwater, 4);
        query.through = Some(page.highwater);
        for item in page.items {
            match item {
                TimelineItem::Capture(event) => {
                    kinds.push("capture");
                    sequences.push(event.local_seq);
                }
                TimelineItem::Timeblock(node) => {
                    kinds.push("timeblock");
                    sequences.push(node.local_seq);
                }
            }
        }
        if page.next_before.is_none() {
            break;
        }
        query.before = page.next_before;
    }
    assert_eq!(sequences, vec![4, 3, 2, 1]);
    assert_eq!(kinds, vec!["timeblock", "capture", "timeblock", "capture"]);
    assert_eq!(core.events(&human, p).unwrap().len(), 2);
}

#[test]
fn explicit_scheduler_owner_revocation_invalidates_already_issued_tickets() {
    use exomind_core::{CountdownEndMode, DeadlineOutcome};
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("owner boundary").unwrap();
    let human = core.local_human(p).unwrap();
    apply(
        &core,
        &human,
        p,
        1000,
        TimeblockAction::Start {
            block_id: TimeblockId::new(),
            name: "A".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    );
    let scheduler = core.local_scheduler();
    let ticket = core
        .due_deadlines(&scheduler, &stamp(&core, 2000), 10)
        .unwrap()
        .pop()
        .unwrap();
    core.revoke_scheduler_owner(&scheduler).unwrap();
    assert!(matches!(
        core.complete_deadline(&scheduler, &ticket, &stamp(&core, 2000))
            .unwrap(),
        DeadlineOutcome::Stale
    ));
    assert!(
        core.due_deadlines(&scheduler, &stamp(&core, 2000), 10)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        core.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
}
