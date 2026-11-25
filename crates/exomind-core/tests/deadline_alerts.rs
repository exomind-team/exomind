use exomind_core::*;
use uuid::Uuid;
fn stamp(core: &Core, wall: i64, elapsed: u64) -> ClockStamp {
    core.trusted_clock_stamp(Uuid::from_u128(91), wall, elapsed)
        .unwrap()
}
fn apply(core: &Core, p: ProfileId, at: i64, action: TimeblockAction) {
    let human = core.local_human(p).unwrap();
    let now = stamp(core, at, at as u64);
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: core.timeblock_snapshot(&human, p, &now).unwrap().revision,
        action,
    };
    core.apply_timeblock(&human, &command, &now).unwrap();
}
fn start(core: &Core, p: ProfileId, block: TimeblockId) {
    start_with_details(
        core,
        p,
        block,
        "timer fixture",
        "",
    );
}
fn start_with_details(core: &Core, p: ProfileId, block: TimeblockId, name: &str, note: &str) {
    apply(
        core,
        p,
        1000,
        TimeblockAction::Start {
            block_id: block,
            name: name.into(),
            note: note.into(),
            timer: TimerSpec::CountDown {
                duration_ms: 10000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    );
}

#[test]
fn local_deadline_alerts_project_name_and_note_from_each_owner_scoped_block() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let p_block = TimeblockId::new();
    let q_block = TimeblockId::new();
    start_with_details(&core, p, p_block, "课程复习", "复习公式和例题");
    start_with_details(&core, q, q_block, "写作", "只属于 Q 的备注");

    let alerts = core
        .local_deadline_alerts(&core.local_scheduler(), &stamp(&core, 2000, 2000))
        .unwrap();
    let p_alert = alerts.iter().find(|alert| alert.profile_id == p).unwrap();
    assert_eq!(p_alert.block_id, p_block);
    assert_eq!(p_alert.block_name, "课程复习");
    assert_eq!(p_alert.block_note, "复习公式和例题");
    let q_alert = alerts.iter().find(|alert| alert.profile_id == q).unwrap();
    assert_eq!(q_alert.block_id, q_block);
    assert_eq!(q_alert.block_name, "写作");
    assert_eq!(q_alert.block_note, "只属于 Q 的备注");
}

#[test]
fn all_profiles_pause_resume_and_owner_revoke_converge_without_rewriting_intent() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let a = TimeblockId::new();
    let b = TimeblockId::new();
    start(&core, p, a);
    start(&core, q, b);
    let scheduler = core.local_scheduler();
    let now = stamp(&core, 2000, 2000);
    let all = core.local_deadline_alerts(&scheduler, &now).unwrap();
    assert_eq!(all.len(), 2);
    let original = all
        .iter()
        .find(|row| row.profile_id == p)
        .unwrap()
        .deadline_id;
    // One profile's missing parents cannot conceal another profile's timer.
    let db = rusqlite::Connection::open(core.database_path()).unwrap();
    // Actual schema4 caches lack run IDs. Read fallback must still discover
    // the accepted pending row and reconstruct authority from raw nodes.
    db.execute(
        "UPDATE timeblock_state SET body=json_remove(body,?2,?3) WHERE profile_id=?1",
        rusqlite::params![
            p.to_string(),
            format!("$.blocks.\"{a}\".run_event_id"),
            format!("$.blocks.\"{a}\".run_device_id")
        ],
    )
    .unwrap();
    assert_eq!(
        core.local_deadline_alerts(&scheduler, &now)
            .unwrap()
            .iter()
            .find(|r| r.profile_id == p)
            .unwrap()
            .deadline_id,
        original
    );
    db.execute("UPDATE replication_projection_status SET status='incomplete',missing_parents=1 WHERE profile_id=?1",[p.to_string()]).unwrap();
    let only_q = core.local_deadline_alerts(&scheduler, &now).unwrap();
    assert_eq!(only_q.len(), 1);
    assert_eq!(only_q[0].profile_id, q);
    db.execute("UPDATE replication_projection_status SET status='complete',missing_parents=0 WHERE profile_id=?1",[p.to_string()]).unwrap();
    assert_eq!(
        core.local_deadline_alerts(&scheduler, &now)
            .unwrap()
            .iter()
            .find(|r| r.profile_id == p)
            .unwrap()
            .deadline_id,
        original
    );
    apply(&core, p, 3000, TimeblockAction::Pause { block_id: a });
    assert_eq!(
        core.local_deadline_alerts(&scheduler, &stamp(&core, 3000, 3000))
            .unwrap()
            .len(),
        1
    );
    apply(&core, p, 4000, TimeblockAction::Resume { block_id: a });
    let resumed = core
        .local_deadline_alerts(&scheduler, &stamp(&core, 4000, 4000))
        .unwrap();
    assert_ne!(
        resumed
            .iter()
            .find(|r| r.profile_id == p)
            .unwrap()
            .deadline_id,
        original
    );
    core.revoke_scheduler_owner(&scheduler).unwrap();
    assert!(
        core.local_deadline_alerts(&scheduler, &stamp(&core, 1000, 4500))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn done_is_visible_until_feedback_without_history_replay_and_clock_rollback_cannot_revive() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let a = TimeblockId::new();
    start(&core, p, a);
    let scheduler = core.local_scheduler();
    let before = core
        .local_deadline_alerts(&scheduler, &stamp(&core, 2000, 2000))
        .unwrap()
        .pop()
        .unwrap();
    let rolled = core
        .local_deadline_alerts(&scheduler, &stamp(&core, 500, 3000))
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(rolled.remaining_ms, 8000);
    assert_eq!(rolled.deadline_id, before.deadline_id);
    let due = stamp(&core, 11000, 11000);
    let ticket = core
        .due_deadlines(&scheduler, &due, 10)
        .unwrap()
        .pop()
        .unwrap();
    core.complete_deadline(&scheduler, &ticket, &due).unwrap();
    let done = core
        .local_deadline_alerts(&scheduler, &due)
        .unwrap()
        .pop()
        .unwrap();
    assert!(done.completed);
    assert_eq!(done.remaining_ms, 0);
    assert_eq!(done.deadline_id, before.deadline_id);
    // Repeated reads have no receipt/fact/stage effects.
    let db = rusqlite::Connection::open(core.database_path()).unwrap();
    let receipts: i64 = db
        .query_row("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
        .unwrap();
    for _ in 0..3 {
        assert!(
            core.local_deadline_alerts(&scheduler, &stamp(&core, 1000, 12000))
                .unwrap()[0]
                .completed
        );
    }
    assert_eq!(
        db.query_row::<i64, _, _>("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
            .unwrap(),
        receipts
    );
    apply(
        &core,
        p,
        13000,
        TimeblockAction::SubmitFeedback {
            block_id: a,
            feedback: FeedbackInput::Skipped,
        },
    );
    assert!(
        core.local_deadline_alerts(&scheduler, &stamp(&core, 13000, 13000))
            .unwrap()
            .is_empty()
    );
    drop(db);
    drop(core);
    let core = Core::open(root.path()).unwrap();
    assert!(
        core.local_deadline_alerts(&core.local_scheduler(), &stamp(&core, 2000, 100))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn capacity_is_an_explicit_error_instead_of_a_partial_profile_list() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    for i in 0..=MAX_LOCAL_DEADLINE_ALERTS {
        let p = core.create_profile(&format!("P{i}")).unwrap();
        start(&core, p, TimeblockId::new());
    }
    assert!(matches!(
        core.local_deadline_alerts(&core.local_scheduler(), &stamp(&core, 2000, 2000)),
        Err(CoreError::InvalidQuery("deadline alert capacity"))
    ));
}
