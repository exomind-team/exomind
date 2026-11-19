use super::export::ExportManager;
use super::{open_cache as cache, original_lifecycle::*};
use exomind_beta_host::{native_workspace::NativeWorkspace, BetaHost, HostError, Session};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, OriginalBytesState, OriginalId,
    OriginalLifecycleAction, OriginalLifecycleCommand, OriginalRef, ProfileId, StageId,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

const ORIGINAL_BYTES: &[u8] = b"native lifecycle original bytes";

struct Fixture {
    host: Arc<BetaHost>,
    owner: Session,
    workspace: NativeWorkspace,
    profile: ProfileId,
    original: OriginalRef,
    _root: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&root.path().join("beta-host")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic Native lifecycle")
        .unwrap();
    let workspace = NativeWorkspace::new(host.clone(), owner.clone());
    let human = workspace.human_session(profile).unwrap();
    let original_id = OriginalId::new();
    let stage_id = StageId::new();
    host.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id,
            original_id,
            profile_id: profile,
            expected_sha256: format!("{:x}", Sha256::digest(ORIGINAL_BYTES)),
            byte_length: ORIGINAL_BYTES.len() as u64,
            file_name: "native-lifecycle-original.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    )
    .unwrap();
    host.write_stage_chunk(&human, profile, stage_id, 0, ORIGINAL_BYTES)
        .unwrap();
    let verified = host.verify_stage(&human, profile, stage_id).unwrap();
    let original = verified.original;
    host.capture(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1,
            text: "synthetic original reference".into(),
            tags: vec![],
            originals: vec![original.clone()],
        },
    )
    .unwrap();

    Fixture {
        host,
        owner,
        workspace,
        profile,
        original,
        _root: root,
    }
}

fn validated_profile(fixture: &Fixture) -> NativeHumanProfile {
    validate_native_profile(fixture.profile, |profile| {
        fixture.workspace.human_session(profile)
    })
    .unwrap()
}

fn release_command(profile: ProfileId, original_id: OriginalId) -> OriginalLifecycleCommand {
    OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        original_id,
        expected_generation: 0,
        occurred_at_ms: 2,
        action: OriginalLifecycleAction::ReleaseLocal,
        cleanup_confirmed: true,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    }
}

#[test]
fn lifecycle_api_entrypoint_status_returns_host_owned_state() {
    let fixture = fixture();
    let status = native_lifecycle_status(
        &fixture.host,
        &fixture.owner,
        validated_profile(&fixture),
        fixture.original.original_id,
        None,
    )
    .unwrap();
    assert_eq!(
        status.lifecycle.local.bytes_state,
        OriginalBytesState::Available
    );
}

#[test]
fn status_validates_native_human_then_uses_host_owner_authority() {
    let fixture = fixture();
    let human = fixture.workspace.human_session(fixture.profile).unwrap();
    assert!(matches!(
        fixture.host.original_lifecycle_status(
            &human,
            fixture.profile,
            fixture.original.original_id
        ),
        Err(HostError::Unauthorized | HostError::Forbidden)
    ));

    let validated = validated_profile(&fixture);
    let status = native_lifecycle_status(
        &fixture.host,
        &fixture.owner,
        validated,
        fixture.original.original_id,
        None,
    )
    .unwrap();
    assert_eq!(
        status.lifecycle.local.bytes_state,
        OriginalBytesState::Available
    );
}

#[test]
fn status_only_reports_a_modified_open_cache_and_leaves_it_untouched() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"edited by an external application").unwrap();

    let status = native_lifecycle_status(
        &fixture.host,
        &fixture.owner,
        validated_profile(&fixture),
        fixture.original.original_id,
        Some(cache_root.path()),
    )
    .unwrap();

    assert_eq!(status.cache_presence, CachePresence::Present);
    assert_eq!(
        fs::read(path).unwrap(),
        b"edited by an external application"
    );
}

#[test]
fn cache_cleanup_preserves_modified_open_copy_for_recovery() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"valuable external edits").unwrap();

    let outcome =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);

    assert_eq!(outcome, cache::OpenCacheCleanupOutcome::Modified);
    assert_eq!(fs::read(path).unwrap(), b"valuable external edits");
}

#[cfg(windows)]
#[test]
fn cache_verification_stop_after_one_small_read_returns_incomplete() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();
    let mut file = fs::File::open(&path).unwrap();
    let mut checkpoints = 0;

    let outcome = cache::cache_file_matches_with_control(
        &mut file,
        &fixture.original,
        Duration::from_secs(5),
        || {
            checkpoints += 1;
            checkpoints == 6
        },
    )
    .unwrap();

    assert_eq!(outcome, cache::OpenCacheVerificationOutcome::Incomplete);
    assert_eq!(checkpoints, 6);
    assert_eq!(fs::read(path).unwrap(), ORIGINAL_BYTES);
}

#[cfg(unix)]
#[test]
fn unix_cleanup_retains_even_matching_cache_when_delete_cannot_be_bound_to_verified_handle() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();

    let outcome =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);

    assert_eq!(outcome, cache::OpenCacheCleanupOutcome::Unsupported);
    assert_eq!(fs::read(path).unwrap(), ORIGINAL_BYTES);
}

#[cfg(unix)]
#[test]
fn unix_same_length_changed_content_stays_unsupported_without_full_hash() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let changed = vec![b'x'; ORIGINAL_BYTES.len()];
    fs::write(&path, &changed).unwrap();

    let outcome =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);

    assert_eq!(outcome, cache::OpenCacheCleanupOutcome::Unsupported);
    assert_eq!(fs::read(path).unwrap(), changed);
}

#[cfg(windows)]
#[test]
fn windows_cleanup_waits_when_editor_handle_denies_delete_sharing_and_preserves_new_edits() {
    use std::io::{Seek, SeekFrom, Write};
    use std::os::windows::fs::OpenOptionsExt;

    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();
    let mut editor = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0x0000_0001 | 0x0000_0002)
        .open(&path)
        .unwrap();

    let blocked =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);
    assert_eq!(blocked, cache::OpenCacheCleanupOutcome::Partial);

    editor.seek(SeekFrom::Start(0)).unwrap();
    editor.write_all(b"edited while opened by viewer").unwrap();
    editor
        .set_len(b"edited while opened by viewer".len() as u64)
        .unwrap();
    drop(editor);

    let retained =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);
    assert_eq!(retained, cache::OpenCacheCleanupOutcome::Modified);
    assert_eq!(fs::read(path).unwrap(), b"edited while opened by viewer");
}

#[cfg(windows)]
#[test]
fn windows_cleanup_deletes_only_after_complete_same_handle_verification() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();

    let outcome =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);

    assert_eq!(outcome, cache::OpenCacheCleanupOutcome::Complete);
    assert!(!path.exists());
}

#[cfg(windows)]
#[test]
fn windows_cleanup_refuses_a_cache_file_with_an_external_hard_link() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();
    let external_link = cache_root.path().join("user-kept-file.bin");
    fs::hard_link(&path, &external_link).unwrap();

    let outcome =
        cache::cleanup_beta_open_cache(Some(cache_root.path()), fixture.profile, &fixture.original);

    assert_eq!(outcome, cache::OpenCacheCleanupOutcome::UnsafePath);
    assert_eq!(fs::read(path).unwrap(), ORIGINAL_BYTES);
    assert_eq!(fs::read(external_link).unwrap(), ORIGINAL_BYTES);
}

#[test]
fn same_key_export_makes_release_busy_without_a_core_receipt_while_other_key_can_reserve() {
    let fixture = fixture();
    let manager = Arc::new(ExportManager::default());
    let request_id = uuid::Uuid::new_v4();
    let active = manager
        .begin(request_id, fixture.profile, fixture.original.original_id)
        .unwrap();
    let command = release_command(fixture.profile, fixture.original.original_id);

    let result = apply_original_lifecycle(
        &fixture.host,
        &fixture.owner,
        &manager,
        &AtomicBool::new(false),
        None,
        validated_profile(&fixture),
        command.clone(),
        cache::DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
        || false,
    );

    let error = result.err().expect("same-key release must be rejected");
    assert_eq!(error.code, "original_busy");
    let status = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap();
    assert_eq!(status.local.generation, 0);
    let human = fixture.workspace.human_session(fixture.profile).unwrap();
    assert!(fixture
        .host
        .receipt(&human, fixture.profile, command.command_id)
        .unwrap()
        .is_none());

    let other_key = OriginalId::new();
    let other_reservation = manager.reserve_release(fixture.profile, other_key).unwrap();
    drop(other_reservation);
    drop(active);
}

#[test]
fn export_manager_stop_interrupts_cleanup_and_keeps_the_core_receipt() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, ORIGINAL_BYTES).unwrap();
    let manager = Arc::new(ExportManager::default());
    let command = release_command(fixture.profile, fixture.original.original_id);
    let stop_manager = manager.clone();

    let applied = apply_original_lifecycle(
        &fixture.host,
        &fixture.owner,
        &manager,
        &AtomicBool::new(false),
        Some(cache_root.path()),
        validated_profile(&fixture),
        command.clone(),
        Duration::from_secs(5),
        move || {
            stop_manager.request_stop();
            false
        },
    )
    .unwrap();

    assert_eq!(applied.cache_cleanup.status, CacheCleanupStatus::Partial);
    assert_eq!(
        applied.cache_cleanup.reason,
        Some(CacheCleanupReason::VerificationIncomplete)
    );
    assert_eq!(fs::read(&path).unwrap(), ORIGINAL_BYTES);
    let lifecycle = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap()
        .local;
    assert_eq!(lifecycle.bytes_state, OriginalBytesState::Released);
    assert_eq!(lifecycle.generation, 1);
    let human = fixture.workspace.human_session(fixture.profile).unwrap();
    assert_eq!(
        fixture
            .host
            .receipt(&human, fixture.profile, command.command_id)
            .unwrap(),
        Some(applied.receipt)
    );
}

#[test]
fn reveal_uses_host_owned_cache_path_after_release_without_opening_or_mutating() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let edited = b"recovery copy retained after release";
    fs::write(&path, edited).unwrap();
    let manager = Arc::new(ExportManager::default());
    let command = release_command(fixture.profile, fixture.original.original_id);
    let applied = apply_original_lifecycle(
        &fixture.host,
        &fixture.owner,
        &manager,
        &AtomicBool::new(false),
        Some(cache_root.path()),
        validated_profile(&fixture),
        command.clone(),
        Duration::ZERO,
        || false,
    )
    .unwrap();
    assert_eq!(applied.cache_cleanup.status, CacheCleanupStatus::Partial);
    assert_eq!(
        applied.cache_cleanup.reason,
        Some(CacheCleanupReason::VerificationIncomplete)
    );
    assert_eq!(fs::read(&path).unwrap(), edited);
    let before = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap()
        .local;
    let mut revealed_paths = Vec::new();

    reveal_original_cache(
        &fixture.host,
        &fixture.owner,
        &manager,
        Some(cache_root.path()),
        validated_profile(&fixture),
        fixture.original.original_id,
        |revealed| {
            revealed_paths.push(revealed.to_path_buf());
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(revealed_paths, vec![path.clone()]);
    assert_eq!(fs::read(&path).unwrap(), edited);
    let after = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap()
        .local;
    assert_eq!(after.bytes_state, before.bytes_state);
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.latest_event_id, before.latest_event_id);
    let human = fixture.workspace.human_session(fixture.profile).unwrap();
    assert_eq!(
        fixture
            .host
            .receipt(&human, fixture.profile, command.command_id)
            .unwrap(),
        Some(applied.receipt)
    );
}

#[test]
fn cache_cleanup_retry_does_not_write_a_second_lifecycle_fact() {
    let fixture = fixture();
    let cache_root = tempfile::tempdir().unwrap();
    let path = cache::beta_open_cache_path(cache_root.path(), fixture.profile, &fixture.original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"edited after the system opened this file").unwrap();
    let manager = Arc::new(ExportManager::default());
    let command = release_command(fixture.profile, fixture.original.original_id);
    let applied = apply_original_lifecycle(
        &fixture.host,
        &fixture.owner,
        &manager,
        &AtomicBool::new(false),
        Some(cache_root.path()),
        validated_profile(&fixture),
        command.clone(),
        cache::DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
        || false,
    )
    .unwrap();
    assert_eq!(
        applied.cache_cleanup.status,
        CacheCleanupStatus::RecoveryRequired
    );
    assert_eq!(
        fs::read(&path).unwrap(),
        b"edited after the system opened this file"
    );
    let before = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap()
        .local;
    assert_eq!(before.bytes_state, OriginalBytesState::Released);

    let retried = retry_original_cache_cleanup(
        &fixture.host,
        &fixture.owner,
        &manager,
        &AtomicBool::new(false),
        Some(cache_root.path()),
        validated_profile(&fixture),
        fixture.original.original_id,
        cache::DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
        || false,
    )
    .unwrap();
    let after = fixture
        .host
        .original_lifecycle_status(
            &fixture.owner,
            fixture.profile,
            fixture.original.original_id,
        )
        .unwrap()
        .local;

    assert_eq!(retried.status, CacheCleanupStatus::RecoveryRequired);
    assert_eq!(after.bytes_state, before.bytes_state);
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.latest_event_id, before.latest_event_id);
    let human = fixture.workspace.human_session(fixture.profile).unwrap();
    assert_eq!(
        fixture
            .host
            .receipt(&human, fixture.profile, command.command_id)
            .unwrap(),
        Some(applied.receipt)
    );
    assert_eq!(
        fs::read(path).unwrap(),
        b"edited after the system opened this file"
    );
}
#[test]
fn lifecycle_capability_descriptor_is_explicit_and_contains_no_user_data() {
    let descriptor = super::original_lifecycle::capabilities_descriptor();
    let value = serde_json::to_value(descriptor).unwrap();
    assert_eq!(value["schema_version"], 1);
    assert_eq!(value["core_schema"], exomind_core::CORE_SCHEMA_VERSION);
    assert_eq!(
        value["operations"],
        serde_json::json!(["reclaim", "restore", "release_local", "purge_reclaimed"])
    );
    assert_eq!(
        value["supports_reveal"],
        cfg!(any(
            windows,
            target_os = "macos",
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))
    );
    assert_eq!(value.as_object().unwrap().len(), 5);
}
