use super::*;
use crate::{BetaHost, CreatePeerInvitation, PeerCapabilities, Session};
use exomind_core::{
    CommandId, CountdownEndMode, EventId, EventQuery, ProfileId, TimeblockAction, TimeblockCommand,
    TimeblockId, TimeblockPayload, TimeblockPhase, TimerSpec,
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Fake(Arc<Mutex<Input>>);
struct Input {
    wall: i64,
    boot: u64,
    uptime: u64,
    fail: bool,
}
impl Fake {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Input {
            wall: 1_000_000,
            boot: 1000,
            uptime: 1000,
            fail: false,
        })))
    }
    fn advance(&self, wall: i64, boot: u64, uptime: u64) {
        let mut value = self.0.lock().unwrap();
        value.wall += wall;
        value.boot += boot;
        value.uptime += uptime;
    }
}
impl Source for Fake {
    fn read(&self) -> Result<Reading, HostError> {
        let value = self.0.lock().unwrap();
        if value.fail {
            return Err(HostError::ClockUnavailable);
        }
        Ok(Reading {
            wall_ms: value.wall,
            boot_ms: value.boot,
        })
    }
}
fn setup(
    source: Fake,
) -> (
    tempfile::TempDir,
    Arc<BetaHost>,
    Session,
    Session,
    ProfileId,
    TimeblockId,
) {
    let root = tempfile::tempdir().unwrap();
    let clock = Arc::new(BootClock::new(source).unwrap());
    let host = Arc::new(BetaHost::open_with_clock(root.path(), clock).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic sleep")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let block = TimeblockId::new();
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: host.timeblock_snapshot(&human, p).unwrap().revision,
        action: TimeblockAction::Start {
            block_id: block,
            name: "synthetic".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 10000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    host.apply_timeblock(&human, &command).unwrap();
    (root, host, owner, human, p, block)
}
fn until(mut condition: impl FnMut() -> bool) {
    let limit = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            Instant::now() < limit,
            "finite synthetic scheduler deadline"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn scheduler_facts(host: &BetaHost, human: &Session, p: ProfileId) -> usize {
    host.timeblock_nodes(human, p, &EventQuery::default())
        .unwrap()
        .items
        .iter()
        .filter(|node| matches!(node.payload, TimeblockPayload::RunDeadlineReached { .. }))
        .count()
}

#[test]
fn synthetic_suspend_uses_boot_time_and_wall_rollback_does_not_postpone_same_run() {
    let source = Fake::new();
    let (_root, host, owner, human, p, _block) = setup(source.clone());
    let before = host.local_deadline_alerts(&owner).unwrap().pop().unwrap();
    assert_eq!(before.remaining_ms, 10000);
    source.advance(1000, 1000, 1000);
    assert_eq!(
        host.local_deadline_alerts(&owner).unwrap()[0].remaining_ms,
        9000
    );
    source.advance(-100000, 1000, 1000);
    assert_eq!(
        host.local_deadline_alerts(&owner).unwrap()[0].remaining_ms,
        8000
    );
    // Deep sleep: hardware BOOTTIME and civil time advance, ordinary uptime
    // stays still. The same accepted run must mature immediately on wake.
    source.advance(9000, 9000, 0);
    assert_eq!(source.0.lock().unwrap().uptime, 3000);
    let due = host.local_deadline_alerts(&owner).unwrap().pop().unwrap();
    assert_eq!(due.remaining_ms, 0);
    assert_eq!(due.deadline_id, before.deadline_id);
    host.start_services().unwrap();
    host.wake_services();
    until(|| {
        host.timeblock_snapshot(&human, p)
            .unwrap()
            .active
            .unwrap()
            .phase
            == TimeblockPhase::FeedbackPending
    });
    for _ in 0..3 {
        let alert = host.local_deadline_alerts(&owner).unwrap().pop().unwrap();
        assert!(alert.completed);
        assert_eq!(alert.remaining_ms, 0);
        assert_eq!(alert.deadline_id, before.deadline_id);
    }
    assert_eq!(scheduler_facts(&host, &human, p), 1);
    host.stop().unwrap();
}

#[test]
fn boot_reset_requires_new_epoch_then_restart_uses_persisted_wall_deadline_once() {
    let source = Fake::new();
    let (root, host, owner, _human, p, _block) = setup(source.clone());
    let id = host.local_deadline_alerts(&owner).unwrap()[0].deadline_id;
    host.stop().unwrap();
    drop(host);
    {
        let mut input = source.0.lock().unwrap();
        input.boot = 10;
        input.uptime = 10;
        input.wall += 20000;
    }
    let clock = Arc::new(BootClock::new(source.clone()).unwrap());
    let epoch = clock.sample().unwrap().epoch_id;
    let host = Arc::new(BetaHost::open_with_clock(root.path(), clock).unwrap());
    let owner = host.owner_session().unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let pending = host.local_deadline_alerts(&owner).unwrap().pop().unwrap();
    assert_eq!(pending.deadline_id, id);
    assert_eq!(pending.remaining_ms, 0);
    host.start_services().unwrap();
    until(|| {
        host.timeblock_snapshot(&human, p)
            .unwrap()
            .active
            .unwrap()
            .phase
            == TimeblockPhase::FeedbackPending
    });
    assert_eq!(scheduler_facts(&host, &human, p), 1);
    host.stop().unwrap();
    drop(host);
    let clock = Arc::new(BootClock::new(source).unwrap());
    assert_ne!(clock.sample().unwrap().epoch_id, epoch);
    let host = Arc::new(BetaHost::open_with_clock(root.path(), clock).unwrap());
    let owner = host.owner_session().unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    host.start_services().unwrap();
    assert!(host.local_deadline_alerts(&owner).unwrap()[0].completed);
    assert_eq!(scheduler_facts(&host, &human, p), 1);
    host.stop().unwrap();
}

fn durable(
    host: &BetaHost,
) -> (
    Vec<(String, String)>,
    Vec<(String, String)>,
    i64,
    i64,
    i64,
    String,
) {
    let state = host.active_state().unwrap();
    let r = crate::resources(&state).unwrap();
    let auth = &r.persistence.auth;
    let rows = |table: &str| {
        let mut q = auth
            .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2"))
            .unwrap();
        let out = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<(String, String)>, _>>()
            .unwrap();
        out
    };
    let invitations = rows("peer_invitations");
    let members = {
        let mut q = auth
            .prepare("SELECT device_id,body FROM peer_members ORDER BY profile_id,device_id")
            .unwrap();
        let out = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<(String, String)>, _>>()
            .unwrap();
        out
    };
    let db = rusqlite::Connection::open(r.core.database_path()).unwrap();
    (
        invitations,
        members,
        auth.query_row("SELECT max_wall_ms FROM peer_membership_layout", [], |r| {
            r.get(0)
        })
        .unwrap(),
        db.query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap(),
        db.query_row("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
            .unwrap(),
        db.query_row(
            "SELECT state||':'||deadline_id FROM timeblock_deadlines LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap(),
    )
}
#[test]
fn sample_failure_never_becomes_zero_time_empty_eligibility_or_membership_mutation() {
    let source = Fake::new();
    let (_root, host, owner, human, p, block) = setup(source.clone());
    let request = CreatePeerInvitation {
        invitation_id: Uuid::new_v4(),
        profile_id: p,
        capabilities: PeerCapabilities::FULL,
        candidates: vec!["127.0.0.1:5589".parse().unwrap()],
        ttl_seconds: 120,
    };
    host.create_peer_invitation(&owner, &request).unwrap();
    let before = durable(&host);
    let revision = host.timeblock_snapshot(&human, p).unwrap().revision;
    source.0.lock().unwrap().fail = true;
    assert!(matches!(
        BootClock::new(source.clone()),
        Err(HostError::ClockUnavailable)
    ));
    assert!(matches!(
        host.local_deadline_alerts(&owner),
        Err(HostError::ClockUnavailable)
    ));
    assert!(matches!(
        host.timeblock_snapshot(&human, p),
        Err(HostError::ClockUnavailable)
    ));
    assert!(matches!(
        host.peer_invitation_status(&owner, request.invitation_id),
        Err(HostError::ClockUnavailable)
    ));
    let mut next = request.clone();
    next.invitation_id = Uuid::new_v4();
    assert!(matches!(
        host.create_peer_invitation(&owner, &next),
        Err(HostError::ClockUnavailable)
    ));
    assert!(matches!(
        host.apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: revision,
                action: TimeblockAction::Pause { block_id: block }
            }
        ),
        Err(HostError::ClockUnavailable)
    ));
    assert!(
        durable(&host) == before,
        "failed clock altered accepted intent or membership"
    );
    host.start_services().unwrap();
    until(|| {
        host.service_status()
            .unwrap()
            .unwrap()
            .last_error
            .as_deref()
            == Some("clock_unavailable")
    });
    assert!(
        durable(&host) == before,
        "scheduler clock error altered durable state"
    );
    source.0.lock().unwrap().fail = false;
    assert_eq!(
        host.local_deadline_alerts(&owner).unwrap()[0].remaining_ms,
        10000
    );
    host.stop().unwrap();
}

#[test]
fn backward_boot_sample_is_error_and_does_not_replace_the_clock_epoch() {
    let source = Fake::new();
    let clock = BootClock::new(source.clone()).unwrap();
    let before = clock.sample().unwrap();
    source.0.lock().unwrap().boot = 999;
    assert!(matches!(clock.sample(), Err(HostError::ClockUnavailable)));
    source.0.lock().unwrap().boot = 1001;
    let after = clock.sample().unwrap();
    assert_eq!(after.epoch_id, before.epoch_id);
    assert_eq!(after.elapsed_ms, 1001);
}
