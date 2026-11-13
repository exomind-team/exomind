use super::*;
use exomind_core::{BeginStageCommand, OriginalId, StageId, StageState};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, mpsc},
    time::Duration,
};

struct Fixture {
    _directory: tempfile::TempDir,
    root: std::path::PathBuf,
    host: Arc<BetaHost>,
    owner: Session,
    writer: Session,
    grant: Uuid,
    profile: ProfileId,
    stage: StageId,
}

fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = Arc::new(BetaHost::open(&root).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic verification")
        .unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let writer = host.authenticate(&grant.token).unwrap();
    let command = BeginStageCommand {
        stage_id: StageId::new(),
        original_id: OriginalId::new(),
        profile_id: profile,
        expected_sha256: format!("{:x}", Sha256::digest(b"synthetic original")),
        byte_length: 18,
        file_name: "synthetic.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    host.begin_stage(&writer, &command).unwrap();
    host.write_stage_chunk(&writer, profile, command.stage_id, 0, b"synthetic original")
        .unwrap();
    Fixture {
        _directory: directory,
        root,
        host,
        owner,
        writer,
        grant: grant.grant_id,
        profile,
        stage: command.stage_id,
    }
}

fn pause(
    slot: &Mutex<Option<originals::VerificationPause>>,
) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (entered, receive) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    *slot.lock().unwrap() = Some(originals::VerificationPause {
        entered,
        release: wait,
    });
    (receive, release)
}

fn text(profile: ProfileId) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: exomind_core::EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1,
        text: "text while original is blocked".into(),
        tags: vec![],
        originals: vec![],
    }
}

#[test]
fn blocked_hash_does_not_block_text_or_revocation_and_revoked_job_never_seals() {
    let fixture = fixture();
    let (entered, release) = pause(&fixture.host.verifications.during_hash);
    let host = fixture.host.clone();
    let writer = fixture.writer.clone();
    let profile = fixture.profile;
    let stage = fixture.stage;
    let hashing = std::thread::spawn(move || host.verify_stage(&writer, profile, stage));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let host = fixture.host.clone();
    let writer = fixture.writer.clone();
    let owner = fixture.owner.clone();
    let grant = fixture.grant;
    let (done, receive) = mpsc::channel();
    let concurrent = std::thread::spawn(move || {
        let submitted = host.capture(&writer, &text(profile));
        let revoked = host.revoke_grant(&owner, grant);
        done.send((submitted, revoked)).unwrap();
    });
    let progress = receive.recv_timeout(Duration::from_secs(2));
    // Always release the worker even if a regression retained the transaction gate.
    release.send(()).unwrap();
    concurrent.join().unwrap();
    let (submitted, revoked) =
        progress.expect("text and revoke must complete while hashing is deliberately blocked");
    assert!(submitted.is_ok());
    assert!(revoked.is_ok());
    assert!(matches!(
        hashing.join().unwrap(),
        Err(HostError::Unauthorized)
    ));
    let fresh = fixture
        .host
        .native_human_session(&fixture.owner, profile)
        .unwrap();
    assert_eq!(
        fixture
            .host
            .stage_status(&fresh, profile, stage)
            .unwrap()
            .state,
        StageState::Frozen
    );
    assert_eq!(
        fixture
            .host
            .events_page(&fresh, profile, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(
        fixture
            .host
            .verify_stage(&fresh, profile, stage)
            .unwrap()
            .state,
        StageState::Verified
    );
    fixture.host.stop().unwrap();
}

#[test]
fn a_finished_hash_proof_is_not_authority_after_revocation() {
    let fixture = fixture();
    let (entered, release) = pause(&fixture.host.verifications.after_hash);
    let host = fixture.host.clone();
    let writer = fixture.writer.clone();
    let profile = fixture.profile;
    let stage = fixture.stage;
    let hashing = std::thread::spawn(move || host.verify_stage(&writer, profile, stage));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    fixture
        .host
        .revoke_grant(&fixture.owner, fixture.grant)
        .unwrap();
    release.send(()).unwrap();
    assert!(matches!(
        hashing.join().unwrap(),
        Err(HostError::Unauthorized)
    ));
    let fresh = fixture
        .host
        .native_human_session(&fixture.owner, profile)
        .unwrap();
    assert_eq!(
        fixture
            .host
            .stage_status(&fresh, profile, stage)
            .unwrap()
            .state,
        StageState::Frozen
    );
    fixture.host.stop().unwrap();
}

#[test]
fn stop_timeout_retains_root_until_the_owned_read_connection_exits() {
    let fixture = fixture();
    let (entered, release) = pause(&fixture.host.verifications.during_hash);
    let host = fixture.host.clone();
    let writer = fixture.writer.clone();
    let profile = fixture.profile;
    let stage = fixture.stage;
    let hashing = std::thread::spawn(move || host.verify_stage(&writer, profile, stage));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    fixture.host.request_stop();
    let result = fixture.host.stop_with_timeout(Duration::from_millis(20));
    let can_take_gate = fixture.host.gate.try_lock().is_ok();
    let locked = BetaHost::open(&fixture.root);
    release.send(()).unwrap();
    assert!(matches!(hashing.join().unwrap(), Err(HostError::Stopped)));
    assert!(matches!(result, Err(HostError::Shutdown)));
    assert!(
        can_take_gate,
        "waiting for owned hashes must not retain the admission gate"
    );
    assert!(matches!(locked, Err(HostError::RootInUse)));
    assert!(!fixture.host.status().unwrap().running);
    assert!(matches!(
        fixture.host.capture(&fixture.writer, &text(profile)),
        Err(HostError::Stopped)
    ));
    fixture.host.stop().unwrap();
    let reopened = BetaHost::open(&fixture.root).unwrap();
    let owner = reopened.owner_session().unwrap();
    let human = reopened.native_human_session(&owner, profile).unwrap();
    assert_eq!(
        reopened.stage_status(&human, profile, stage).unwrap().state,
        StageState::Frozen
    );
    assert!(matches!(
        reopened.verify_stage(&fixture.writer, profile, stage),
        Err(HostError::Unauthorized)
    ));
    reopened.stop().unwrap();
}

#[test]
fn a_finished_hash_proof_cannot_seal_after_request_stop() {
    let fixture = fixture();
    let (entered, release) = pause(&fixture.host.verifications.after_hash);
    let host = fixture.host.clone();
    let writer = fixture.writer.clone();
    let profile = fixture.profile;
    let stage = fixture.stage;
    let hashing = std::thread::spawn(move || host.verify_stage(&writer, profile, stage));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    fixture.host.request_stop();
    release.send(()).unwrap();
    assert!(matches!(hashing.join().unwrap(), Err(HostError::Stopped)));
    fixture.host.stop().unwrap();
    let reopened = BetaHost::open(&fixture.root).unwrap();
    let owner = reopened.owner_session().unwrap();
    let human = reopened.native_human_session(&owner, profile).unwrap();
    assert_eq!(
        reopened.stage_status(&human, profile, stage).unwrap().state,
        StageState::Frozen
    );
    reopened.stop().unwrap();
}
