use super::*;
use std::{
    sync::{Arc, mpsc},
    time::Duration,
};

fn fixture() -> (tempfile::TempDir, Arc<BetaHost>, ProfileId, Session) {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic stop fence")
        .unwrap();
    let session = host.native_human_session(&owner, profile).unwrap();
    (directory, host, profile, session)
}

fn command(profile: ProfileId) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: exomind_core::EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1,
        text: "synthetic gated capture".into(),
        tags: vec![],
    }
}

#[test]
fn request_stop_is_nonblocking_and_fences_work_queued_behind_the_gate() {
    let (_directory, host, profile, session) = fixture();
    let gate = host.gate.lock().unwrap();
    let (started, waiting) = mpsc::channel();
    let queued_host = host.clone();
    let queued = std::thread::spawn(move || {
        started.send(()).unwrap();
        queued_host.capture(&session, &command(profile))
    });
    waiting.recv_timeout(Duration::from_secs(1)).unwrap();
    host.request_stop();
    let (send, receive) = mpsc::channel();
    let status_host = host.clone();
    let status = std::thread::spawn(move || {
        send.send(status_host.status()).unwrap();
    });
    let observed = receive.recv_timeout(Duration::from_secs(1));
    drop(gate);
    assert!(matches!(queued.join().unwrap(), Err(HostError::Stopped)));
    status.join().unwrap();
    assert!(
        !observed
            .expect("status must not wait for gate after request_stop")
            .unwrap()
            .running
    );
    {
        let state = host.state().unwrap();
        let resources = resources(&state).unwrap();
        let context = resources.core.local_human(profile).unwrap();
        assert!(
            resources
                .core
                .events_page(&context, profile, &EventQuery::default())
                .unwrap()
                .items
                .is_empty()
        );
    }
    host.stop().unwrap();
}

#[test]
fn a_transaction_qualified_before_request_stop_can_finish_but_later_work_cannot() {
    let (_directory, host, profile, session) = fixture();
    let database_path = {
        let state = host.state().unwrap();
        resources(&state)
            .unwrap()
            .core
            .database_path()
            .to_path_buf()
    };
    let external = rusqlite::Connection::open(database_path).unwrap();
    external.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (admitted, receive_admitted) = mpsc::channel();
    *host.capture_admitted.lock().unwrap() = Some(admitted);
    let worker_host = host.clone();
    let worker_session = session.clone();
    let input = command(profile);
    let worker_input = input.clone();
    let worker = std::thread::spawn(move || worker_host.capture(&worker_session, &worker_input));
    let qualified = receive_admitted.recv_timeout(Duration::from_secs(2));
    host.request_stop();
    external.execute_batch("ROLLBACK").unwrap();
    let committed = worker.join().unwrap();
    assert!(
        qualified.is_ok(),
        "the actual facade must have passed final qualification before stop"
    );
    assert_eq!(committed.unwrap().event_id, input.event_id);
    assert!(matches!(
        host.capture(&session, &command(profile)),
        Err(HostError::Stopped)
    ));
    {
        let state = host.state().unwrap();
        let resources = resources(&state).unwrap();
        let context = resources.core.local_human(profile).unwrap();
        assert_eq!(
            resources
                .core
                .events_page(&context, profile, &EventQuery::default())
                .unwrap()
                .items
                .len(),
            1
        );
    }
    host.stop().unwrap();
}

#[test]
fn listener_publication_is_rejected_after_request_stop_before_cleanup() {
    let (_directory, host, _profile, _session) = fixture();
    host.request_stop();
    let (shutdown, _receiver) = tokio::sync::oneshot::channel();
    assert!(matches!(
        host.publish_endpoint("127.0.0.1:19876".parse().unwrap(), shutdown),
        Err(HostError::Stopped)
    ));
    assert!(host.state().unwrap().listener_shutdown.is_none());
    host.stop().unwrap();
}
