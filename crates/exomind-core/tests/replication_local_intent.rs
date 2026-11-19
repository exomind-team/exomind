use exomind_core::*;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn command(
    core: &Core,
    p: ProfileId,
    stamp: &ClockStamp,
    action: TimeblockAction,
) -> TimeblockCommand {
    let human = core.local_human(p).unwrap();
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: core.timeblock_snapshot(&human, p, stamp).unwrap().revision,
        action,
    };
    core.apply_timeblock(&human, &command, stamp).unwrap();
    command
}
fn start(core: &Core, p: ProfileId, stamp: &ClockStamp, duration_ms: u64) -> TimeblockCommand {
    command(
        core,
        p,
        stamp,
        TimeblockAction::Start {
            block_id: TimeblockId::new(),
            name: "accepted local hard run".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms,
                end_mode: CountdownEndMode::Hard,
            },
        },
    )
}
fn block(command: &TimeblockCommand) -> TimeblockId {
    match &command.action {
        TimeblockAction::Start { block_id, .. } => *block_id,
        _ => unreachable!(),
    }
}
fn peers() -> (tempfile::TempDir, tempfile::TempDir, Core, Core, ProfileId) {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut remote = Core::open(a.path()).unwrap();
    let mut local = Core::open(b.path()).unwrap();
    // Ensure a concurrent remote Pause sorts before the already accepted local
    // Pause/Resume. This makes the final Resume identical while its g changes.
    if remote.device_id().to_string() > local.device_id().to_string() {
        std::mem::swap(&mut remote, &mut local);
    }
    let p = ProfileId::new();
    remote.provision_profile(p, "P").unwrap();
    local.provision_profile(p, "P").unwrap();
    (a, b, remote, local, p)
}
fn context(local: &Core, page: &OriginPage) -> ReplicaContext {
    local
        .trusted_replica_context(
            page.origin.profile_id,
            page.origin.device_id,
            page.origin.restoration_epoch,
            1,
        )
        .unwrap()
}
fn template(remote: &Core, p: ProfileId) -> OriginPage {
    let stamp = remote.trusted_clock_stamp(Uuid::new_v4(), 1100, 0).unwrap();
    start(remote, p, &stamp, 1000);
    remote
        .export_origin_page(
            &remote.local_human(p).unwrap(),
            p,
            &OriginPageQuery::default(),
        )
        .unwrap()
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
type Accepted = (String, String, String, i64, u64, String, u64);
fn accepted(core: &Core, p: ProfileId) -> Accepted {
    Connection::open(core.database_path()).unwrap().query_row("SELECT deadline_id,command_id,event_id,due_wall_ms,due_elapsed_ms,clock_epoch,owner_generation FROM timeblock_deadlines WHERE profile_id=?1 AND state='pending'",[p.to_string()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?))).unwrap()
}

#[test]
fn incomplete_then_complete_keeps_accepted_local_hard_due_and_does_not_block_other_profile() {
    let (_a, _b, remote, local, p) = peers();
    let q = local.create_profile("independent Q").unwrap();
    let epoch = Uuid::new_v4();
    let initial = local.trusted_clock_stamp(epoch, 1000, 0).unwrap();
    let local_start = start(&local, p, &initial, 1000);
    let _q_start = start(&local, q, &initial, 500);
    let saved = accepted(&local, p);
    let scheduler = local.local_scheduler();
    let due = local.trusted_clock_stamp(epoch, 3000, 2000).unwrap();
    let old_ticket = local
        .due_deadlines_for_profile(&scheduler, p, &due)
        .unwrap()
        .pop()
        .unwrap();
    let mut all = template(&remote, p);
    let mut parent = all.entries[0].fact.clone();
    let missing = EventId::new();
    if let ReplicatedFact::Timeblock(v) = &mut parent {
        v.event_id = missing;
        v.parents = vec![local_start.event_id];
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::AppendFeedback {
                block_id: block(&local_start),
                text: "late parent annotation".into(),
            },
        };
    }
    let mut child = parent.clone();
    if let ReplicatedFact::Timeblock(v) = &mut child {
        v.event_id = EventId::new();
        v.parents = vec![local_start.event_id, missing];
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::AppendFeedback {
                block_id: block(&local_start),
                text: "child annotation".into(),
            },
        };
    }
    all.entries = vec![
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
    rechain(&mut all);
    let mut first = all.clone();
    first.entries.truncate(1);
    first.to = OriginCursor {
        seq: 1,
        hash: first.entries[0].chain_hash.clone(),
    };
    first.has_more = true;
    let peer = context(&local, &first);
    assert!(
        !local
            .import_origin_page(&peer, &first)
            .unwrap()
            .projection_complete
    );
    assert!(
        local
            .due_deadlines_for_profile(&scheduler, p, &due)
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        local
            .complete_deadline(&scheduler, &old_ticket, &due)
            .unwrap(),
        DeadlineOutcome::Stale
    ));
    let q_ticket = local
        .due_deadlines(&scheduler, &due, 100)
        .unwrap()
        .pop()
        .unwrap();
    assert!(matches!(
        local
            .complete_deadline(&scheduler, &q_ticket, &due)
            .unwrap(),
        DeadlineOutcome::Applied(_)
    ));
    let mut second = all;
    second.from = first.to;
    second.entries.remove(0);
    assert!(
        local
            .import_origin_page(&peer, &second)
            .unwrap()
            .projection_complete
    );
    let active = local
        .timeblock_snapshot(&local.local_human(p).unwrap(), p, &due)
        .unwrap()
        .active
        .unwrap();
    let restored = active
        .deadline
        .expect("same accepted local run must resume deadline eligibility after parents arrive");
    assert_eq!(restored.deadline_id.to_string(), saved.0);
    assert_eq!(restored.due_at_ms, saved.3);
    assert!(restored.eligible);
    assert_eq!(accepted(&local, p), saved);
    let tickets = local
        .due_deadlines_for_profile(&scheduler, p, &due)
        .unwrap();
    assert_eq!(tickets.len(), 1);
    assert!(matches!(
        local
            .complete_deadline(&scheduler, &tickets[0], &due)
            .unwrap(),
        DeadlineOutcome::Applied(_)
    ));
}

#[test]
fn concurrent_generation_shift_keeps_the_same_local_resume_deadline_ids_and_due() {
    let (_a, _b, remote, local, p) = peers();
    let epoch = Uuid::new_v4();
    let initial = local.trusted_clock_stamp(epoch, 1000, 0).unwrap();
    let started = start(&local, p, &initial, 1000);
    let pause = local.trusted_clock_stamp(epoch, 1100, 100).unwrap();
    command(
        &local,
        p,
        &pause,
        TimeblockAction::Pause {
            block_id: block(&started),
        },
    );
    let resume = local.trusted_clock_stamp(epoch, 1200, 200).unwrap();
    let resumed = command(
        &local,
        p,
        &resume,
        TimeblockAction::Resume {
            block_id: block(&started),
        },
    );
    let saved = accepted(&local, p);
    let mut incoming = template(&remote, p);
    if let ReplicatedFact::Timeblock(v) = &mut incoming.entries[0].fact {
        v.parents = vec![started.event_id];
        v.occurred_at_ms = 1050;
        v.effective_at_ms = 1050;
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::Pause {
                block_id: block(&started),
            },
        };
    }
    rechain(&mut incoming);
    local
        .import_origin_page(&context(&local, &incoming), &incoming)
        .unwrap();
    let mid = local.trusted_clock_stamp(epoch, 1300, 300).unwrap();
    let shown = local
        .timeblock_snapshot(&local.local_human(p).unwrap(), p, &mid)
        .unwrap()
        .active
        .unwrap()
        .deadline
        .unwrap();
    assert_eq!(
        shown.remaining_ms,
        saved.4 - 300,
        "the display follows the accepted due, not reordered projected work"
    );
    let due = local.trusted_clock_stamp(epoch, 3000, 2000).unwrap();
    let active = local
        .timeblock_snapshot(&local.local_human(p).unwrap(), p, &due)
        .unwrap()
        .active
        .unwrap();
    assert_eq!(active.phase, TimeblockPhase::Running);
    let deadline = active
        .deadline
        .expect("an extra causal Pause must not discard the unchanged local Resume intent");
    assert!(deadline.eligible);
    assert_eq!(deadline.deadline_id.to_string(), saved.0);
    assert_eq!(accepted(&local, p), saved);
    let raw = local
        .timeblock_nodes(&local.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap();
    assert!(
        raw.items
            .iter()
            .any(|node| node.event_id == resumed.event_id)
    );
    let scheduler = local.local_scheduler();
    let tickets = local
        .due_deadlines_for_profile(&scheduler, p, &due)
        .unwrap();
    assert_eq!(tickets.len(), 1);
    let result = local
        .complete_deadline(&scheduler, &tickets[0], &due)
        .unwrap();
    assert!(matches!(result, DeadlineOutcome::Applied(_)));
    assert!(matches!(
        local
            .complete_deadline(&scheduler, &tickets[0], &due)
            .unwrap(),
        DeadlineOutcome::Applied(_)
    ));
}

#[test]
fn remote_import_does_not_revive_explicitly_revoked_local_scheduler_owner() {
    let (_a, _b, remote, local, p) = peers();
    let epoch = Uuid::new_v4();
    let stamp = local.trusted_clock_stamp(epoch, 1000, 0).unwrap();
    let started = start(&local, p, &stamp, 1000);
    let scheduler = local.local_scheduler();
    local.revoke_scheduler_owner(&scheduler).unwrap();
    let mut incoming = template(&remote, p);
    if let ReplicatedFact::Timeblock(v) = &mut incoming.entries[0].fact {
        v.parents = vec![started.event_id];
        v.payload = TimeblockPayload::Action {
            action: TimeblockAction::AppendFeedback {
                block_id: block(&started),
                text: "annotation is not owner admission".into(),
            },
        };
    }
    rechain(&mut incoming);
    local
        .import_origin_page(&context(&local, &incoming), &incoming)
        .unwrap();
    let due = local.trusted_clock_stamp(epoch, 3000, 2000).unwrap();
    assert!(
        local
            .due_deadlines(&scheduler, &due, 100)
            .unwrap()
            .is_empty()
    );
    let count: u64 = Connection::open(local.database_path())
        .unwrap()
        .query_row(
            "SELECT count(*) FROM timeblock_deadlines WHERE profile_id=?1 AND state='pending'",
            params![p.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
