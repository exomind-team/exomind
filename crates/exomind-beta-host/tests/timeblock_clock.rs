use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, HostClock, HostClockSample, HostError};
use exomind_core::{
    CommandId, CountdownEndMode, EventId, EventQuery, ProfileId, TimeblockAction, TimeblockCommand,
    TimeblockId, TimeblockPhase, TimerSpec,
};
use std::{
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};
use uuid::Uuid;

struct Pause {
    entered: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
}
struct ManualClock {
    value: Mutex<HostClockSample>,
    pause: Mutex<Option<Pause>>,
}
impl ManualClock {
    fn new() -> Self {
        Self {
            value: Mutex::new(HostClockSample {
                epoch_id: Uuid::from_u128(31),
                wall_ms: 1000,
                elapsed_ms: 1000,
            }),
            pause: Mutex::new(None),
        }
    }
    fn set(&self, epoch: u128, wall_ms: i64, elapsed_ms: u64) {
        *self.value.lock().unwrap() = HostClockSample {
            epoch_id: Uuid::from_u128(epoch),
            wall_ms,
            elapsed_ms,
        };
    }
    fn block_next_sample(&self) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (entered, receive) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        *self.pause.lock().unwrap() = Some(Pause {
            entered,
            release: wait,
        });
        (receive, release)
    }
}
impl HostClock for ManualClock {
    fn sample(&self) -> HostClockSample {
        let pause = self.pause.lock().unwrap().take();
        if let Some(pause) = pause {
            let _ = pause.entered.send(());
            pause.release.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        self.value.lock().unwrap().clone()
    }
}
fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "owned Scheduler did not complete the controlled deadline"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn native_without_http_has_one_idempotent_scheduler_and_revoked_human_intent_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let clock = Arc::new(ManualClock::new());
    let host = Arc::new(BetaHost::open_with_clock(&root, clock.clone()).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic native clock")
        .unwrap();
    let writer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let human = host.authenticate(&writer.token).unwrap();
    let reader = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let revision = host.timeblock_snapshot(&human, p).unwrap().revision;
    let block = TimeblockId::new();
    host.apply_timeblock(
        &human,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: revision,
            action: TimeblockAction::Start {
                block_id: block,
                name: "timer".into(),
                note: String::new(),
                timer: TimerSpec::CountDown {
                    duration_ms: 1000,
                    end_mode: CountdownEndMode::Hard,
                },
            },
        },
    )
    .unwrap();
    host.revoke_grant(&owner, writer.grant_id).unwrap();
    assert!(matches!(
        host.authenticate(&writer.token),
        Err(HostError::Unauthorized)
    ));
    host.stop().unwrap();
    drop(host);
    clock.set(32, 5000, 50);
    let host = Arc::new(BetaHost::open_with_clock(&root, clock).unwrap());
    let observer = host.authenticate(&reader.token).unwrap();
    // No serve(), HTTP Router, browser timer, or ambient Tokio runtime exists.
    let first = host.start_services().unwrap();
    let second = host.start_services().unwrap();
    assert!(first.running);
    assert_eq!(first.instance_id, second.instance_id);
    wait_until(|| {
        host.timeblock_snapshot(&observer, p)
            .unwrap()
            .active
            .is_some_and(|active| active.phase == TimeblockPhase::FeedbackPending)
    });
    let snapshot = host.timeblock_snapshot(&observer, p).unwrap();
    assert_eq!(snapshot.active.unwrap().work_ms, 1000);
    assert_eq!(
        host.timeblock_nodes(&observer, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
    host.stop().unwrap();
}

#[test]
fn delayed_clock_sample_cannot_append_or_restart_services_after_request_stop() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let clock = Arc::new(ManualClock::new());
    let host = Arc::new(BetaHost::open_with_clock(&root, clock.clone()).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic late clock")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let revision = host.timeblock_snapshot(&human, p).unwrap().revision;
    host.apply_timeblock(
        &human,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: revision,
            action: TimeblockAction::Start {
                block_id: TimeblockId::new(),
                name: "timer".into(),
                note: String::new(),
                timer: TimerSpec::CountDown {
                    duration_ms: 1000,
                    end_mode: CountdownEndMode::Hard,
                },
            },
        },
    )
    .unwrap();
    host.start_services().unwrap();
    let (entered, release) = clock.block_next_sample();
    clock.set(31, 2000, 2000);
    host.wake_services();
    let reached = entered.recv_timeout(Duration::from_secs(2));
    host.request_stop();
    let _ = release.send(());
    assert!(reached.is_ok());
    host.stop().unwrap();
    assert!(matches!(host.start_services(), Err(HostError::Stopped)));
    // Inspect only persisted Core facts; starting a fresh Host's services may
    // legitimately reconcile the still-pending deadline in its new lifecycle.
    let reopened = exomind_core::Core::open(&root.join("core")).unwrap();
    let human = reopened.local_human(p).unwrap();
    assert_eq!(
        reopened
            .timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn matured_hard_deadline_wins_new_control_but_an_old_request_replays_before_reconcile() {
    let directory = tempfile::tempdir().unwrap();
    let clock = Arc::new(ManualClock::new());
    let host = BetaHost::open_with_clock(&directory.path().join("host"), clock.clone()).unwrap();
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "delayed worker admission")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let block = TimeblockId::new();
    let input = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: host.timeblock_snapshot(&human, p).unwrap().revision,
        action: TimeblockAction::Start {
            block_id: block,
            name: "hard".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    let original = host.apply_timeblock(&human, &input).unwrap();
    let active = host.timeblock_snapshot(&human, p).unwrap();
    clock.set(31, 2000, 2000);
    let replay = host.apply_timeblock(&human, &input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event_digest, original.event_digest);
    assert_eq!(
        host.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    let pause = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: active.revision,
        action: TimeblockAction::Pause { block_id: block },
    };
    assert!(matches!(
        host.apply_timeblock(&human, &pause),
        Err(HostError::Core(exomind_core::CoreError::TimeblockConflict))
    ));
    let current = host.timeblock_snapshot(&human, p).unwrap().active.unwrap();
    assert_eq!(current.phase, TimeblockPhase::FeedbackPending);
    assert_eq!(current.work_ms, 1000);
    assert_eq!(
        host.timeblock_nodes(&human, p, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
    assert!(host.receipt(&human, p, pause.command_id).unwrap().is_none());
    host.stop().unwrap();
}
