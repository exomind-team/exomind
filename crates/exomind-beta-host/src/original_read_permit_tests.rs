use crate::{BetaHost, GrantKind, GrantRequest, HostError, Session};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, CoreError, EventId, OriginalId,
    OriginalLifecycleAction, OriginalLifecycleCommand, OriginalRef, ProfileId, StageId, StageState,
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use uuid::Uuid;

struct Fixture {
    root: PathBuf,
    host: BetaHost,
    owner: Session,
    reader: Session,
    reader_grant: Uuid,
    profile: ProfileId,
    original: OriginalRef,
    bytes: Vec<u8>,
    // Close the Host before removing its files when unwinding a failed case.
    _directory: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic original read permit")
        .unwrap();

    let writer_grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let writer = host.authenticate(&writer_grant.token).unwrap();

    let reader_grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let reader = host.authenticate(&reader_grant.token).unwrap();

    let bytes = b"synthetic permit bytes with deterministic SHA-256".to_vec();
    let command = BeginStageCommand {
        stage_id: StageId::new(),
        original_id: OriginalId::new(),
        profile_id: profile,
        expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
        byte_length: bytes.len() as u64,
        file_name: "synthetic.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    host.begin_stage(&writer, &command).unwrap();
    host.write_stage_chunk(&writer, profile, command.stage_id, 0, &bytes)
        .unwrap();
    let verified = host
        .verify_stage(&writer, profile, command.stage_id)
        .unwrap();
    assert_eq!(verified.state, StageState::Verified);

    // Clone the reference before capture submits it, so the fixture keeps its
    // own expected metadata for hash and identity assertions.
    let original = verified.original.clone();
    host.capture(
        &writer,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1,
            text: "synthetic original read permit fixture".into(),
            tags: vec![],
            originals: vec![original.clone()],
        },
    )
    .unwrap();

    Fixture {
        _directory: directory,
        root,
        host,
        owner,
        reader,
        reader_grant: reader_grant.grant_id,
        profile,
        original,
        bytes,
    }
}

#[test]
fn observer_permit_reads_multiple_ranges_and_finishes() {
    let fixture = fixture();
    let permit = fixture
        .host
        .begin_original_read(
            &fixture.reader,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();

    let first_length = 13;
    let first = fixture
        .host
        .read_original_range_with_permit(&fixture.reader, &permit, 0, first_length)
        .unwrap();
    let second = fixture
        .host
        .read_original_range_with_permit(
            &fixture.reader,
            &permit,
            first_length as u64,
            fixture.bytes.len() - first_length,
        )
        .unwrap();

    assert_eq!(first.offset, 0);
    assert_eq!(second.offset, first_length as u64);
    let mut assembled = first.bytes;
    assembled.extend(second.bytes);
    assert_eq!(assembled, fixture.bytes);
    assert_eq!(
        fixture.original.sha256,
        format!("{:x}", Sha256::digest(&assembled))
    );
    fixture
        .host
        .finish_original_read(&fixture.reader, &permit)
        .unwrap();
}

#[test]
fn release_rejects_old_permit_reads_and_finish() {
    let fixture = fixture();
    let permit = fixture
        .host
        .begin_original_read(
            &fixture.reader,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();
    let status = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();

    fixture
        .host
        .apply_original_lifecycle(
            &fixture.owner,
            &OriginalLifecycleCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: fixture.profile,
                original_id: fixture.original.original_id,
                expected_generation: status.local.generation,
                occurred_at_ms: 2,
                action: OriginalLifecycleAction::ReleaseLocal,
                cleanup_confirmed: true,
                follow_up_device_ids: vec![],
                responds_to_event_id: None,
            },
        )
        .unwrap();

    assert!(matches!(
        fixture
            .host
            .read_original_range_with_permit(&fixture.reader, &permit, 0, 1),
        Err(HostError::Core(CoreError::StaleOriginalRead))
    ));
    assert!(matches!(
        fixture.host.finish_original_read(&fixture.reader, &permit),
        Err(HostError::Core(CoreError::StaleOriginalRead))
    ));
}

#[test]
fn revoked_observer_grant_is_rechecked_for_read_and_finish() {
    let fixture = fixture();
    let permit = fixture
        .host
        .begin_original_read(
            &fixture.reader,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();
    fixture
        .host
        .revoke_grant(&fixture.owner, fixture.reader_grant)
        .unwrap();

    assert!(matches!(
        fixture
            .host
            .read_original_range_with_permit(&fixture.reader, &permit, 0, 1),
        Err(HostError::Unauthorized)
    ));
    assert!(matches!(
        fixture.host.finish_original_read(&fixture.reader, &permit),
        Err(HostError::Unauthorized)
    ));
}

#[test]
fn permit_cannot_cross_a_reopened_host_core_generation() {
    let fixture = fixture();
    let permit = fixture
        .host
        .begin_original_read(
            &fixture.reader,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();
    let root = fixture.root.clone();
    let profile = fixture.profile;
    let original_id = fixture.original.original_id;
    let expected_bytes = fixture.bytes.clone();

    fixture.host.stop().unwrap();
    drop(fixture.host);

    let reopened = BetaHost::open(&root).unwrap();
    let owner = reopened.owner_session().unwrap();
    let reader = reopened.native_human_session(&owner, profile).unwrap();
    let fresh = reopened
        .begin_original_read(&reader, profile, original_id)
        .unwrap();
    let chunk = reopened
        .read_original_range_with_permit(&reader, &fresh, 0, expected_bytes.len())
        .unwrap();
    assert_eq!(chunk.bytes, expected_bytes);
    reopened.finish_original_read(&reader, &fresh).unwrap();

    assert!(matches!(
        reopened.read_original_range_with_permit(&reader, &permit, 0, 1),
        Err(HostError::Core(CoreError::ForeignContext))
    ));
    assert!(matches!(
        reopened.finish_original_read(&reader, &permit),
        Err(HostError::Core(CoreError::ForeignContext))
    ));
    reopened.stop().unwrap();
}
