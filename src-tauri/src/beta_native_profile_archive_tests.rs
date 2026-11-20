use super::*;
use exomind_beta_host::{ArchiveBudget, BetaHost, ProfileArchiveError, ProfileArchiveExportReceipt};
use exomind_core::{CaptureCommand, CommandId, EventId, ProfileId};
use std::{
    env,
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

const EXIT_CHILD_MODE_ENV: &str = "EXOMIND_TEST_PROFILE_ARCHIVE_SPOOL_EXIT_MODE";
const EXIT_CHILD_ROOT_ENV: &str = "EXOMIND_TEST_PROFILE_ARCHIVE_SPOOL_EXIT_ROOT";
const EXIT_CHILD_REQUEST_ENV: &str = "EXOMIND_TEST_PROFILE_ARCHIVE_SPOOL_EXIT_REQUEST";

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("beta-profile-archive-native-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create isolated archive test directory");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn uuid(value: u128) -> Uuid {
    let mut bytes = value.to_be_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn manager_at(root: &Path) -> ProfileArchiveManager {
    let archive_root = root.join("archive");
    let host_root = root.join("host");
    fs::create_dir_all(&host_root).expect("create isolated Host root");
    let manager = ProfileArchiveManager::new(archive_root, host_root);
    manager.initialize().expect("initialize isolated archive manager");
    manager
}

fn exit_process_child_if_requested() {
    let Ok(mode) = env::var(EXIT_CHILD_MODE_ENV) else {
        return;
    };
    let root = PathBuf::from(
        env::var_os(EXIT_CHILD_ROOT_ENV).expect("exit child receives its isolated root"),
    );
    let request_id = Uuid::parse_str(
        &env::var(EXIT_CHILD_REQUEST_ENV).expect("exit child receives its request ID"),
    )
    .expect("valid crash-child request ID");
    let manager = manager_at(&root);
    let lease = manager
        .begin(request_id, ProfileId::new(), ArchiveDirection::Import)
        .expect("begin the task whose process will exit");
    lease
        .run
        .transition(ArchiveTaskPhase::AwaitingSource, None, false)
        .expect("persist source phase");
    lease
        .run
        .transition(ArchiveTaskPhase::Spooling, None, false)
        .expect("persist spool phase");
    let paths = manager.paths().expect("read the private spool root");
    let mut writer =
        SpoolWriter::create_owned(
            &paths.spool,
            request_id,
            MAX_ARCHIVE_BYTES,
            None,
            &manager.journal,
        )
            .expect("create the task-owned spool");
    writer
        .write_all(b"process-owned archive bytes")
        .expect("write the child spool");

    match mode.as_str() {
        "part" => writer.flush().expect("flush the incomplete spool"),
        "sealed" => {
            writer.finish().expect("seal the spool before recording its receipt");
        }
        _ => panic!("unknown crash-child mode: {mode}"),
    }

    fs::write(root.join("child-reached-process-exit"), mode.as_bytes())
        .expect("leave evidence that the child test ran");
    // Models process termination without Drop; it does not model device power loss.
    std::process::exit(0);
}

fn spawn_process_exit_child(test_name: &str, mode: &str, root: &Path, request_id: Uuid) {
    let status = Command::new(env::current_exe().expect("locate this test binary"))
        // The unique test function name is a stable libtest substring filter;
        // the sentinel below rejects a successful zero-test child invocation.
        .arg(test_name)
        .arg("--nocapture")
        .env(EXIT_CHILD_MODE_ENV, mode)
        .env(EXIT_CHILD_ROOT_ENV, root)
        .env(EXIT_CHILD_REQUEST_ENV, request_id.to_string())
        .status()
        .expect("spawn the isolated crash child");
    assert!(status.success(), "crash child exited with {status}");
    assert!(
        root.join("child-reached-process-exit").is_file(),
        "the requested child test must run before its zero exit is accepted"
    );
    fs::remove_file(root.join("child-reached-process-exit"))
        .expect("remove child-run evidence");
}

fn assert_restarted_spool_can_be_abandoned(mode: &str, test_name: &str) {
    let directory = TestDirectory::new();
    let request_id = Uuid::new_v4();
    spawn_process_exit_child(test_name, mode, directory.path(), request_id);

    let manager = manager_at(directory.path());
    let history = manager.history(None).expect("read restarted task history");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].request_id, request_id);
    assert_eq!(history[0].phase, ArchiveTaskPhase::Interrupted);
    assert_eq!(history[0].failure_code.as_deref(), Some("process_restarted"));

    let paths = manager.paths().unwrap();
    let artifact = if mode == "part" {
        paths.spool.join(format!("{request_id}.part"))
    } else {
        PrivateProfileArchiveSpool::final_path(&paths.spool, request_id)
    };
    assert!(artifact.is_file(), "the abrupt process exit must leave the spool artifact");
    assert!(
        manager.cancel(request_id).expect("explicit abandon must be accepted"),
        "the interrupted task belongs to the Native journal"
    );
    assert!(!artifact.exists(), "abandon must release its exact owned artifact");
    let abandoned = manager.history(None).unwrap();
    assert_eq!(abandoned[0].phase, ArchiveTaskPhase::Cancelled);
    assert_eq!(abandoned[0].failure_code.as_deref(), Some("abandoned_by_user"));
    assert!(
        manager
            .begin(Uuid::new_v4(), ProfileId::new(), ArchiveDirection::Import)
            .is_ok(),
        "a cleaned interrupted task must leave admission available"
    );
}

fn assert_renderer_safe(value: serde_json::Value) {
    let serialized = value.to_string().to_ascii_lowercase();
    for forbidden in [
        "\"path\"",
        "\"source_path\"",
        "\"destination_path\"",
        "\"uri\"",
        "\"source_uri\"",
        "\"destination_uri\"",
        "\"preview_id\"",
        "\"preview_token\"",
        "\"human_token\"",
        "\"grant_token\"",
        "\"archive_bytes\"",
        "\"spool_identity\"",
        "\"spool_file_id\"",
        "\"creation_credential\"",
        "\"owner_credential\"",
        "content://",
        "c:\\users\\",
    ] {
        assert!(!serialized.contains(forbidden), "Renderer DTO leaked {forbidden}");
    }
}

#[test]
fn accepted_ack_has_exact_snake_case_shape() {
    let ack = ProfileArchiveAcceptedDto {
        request_id: uuid(5),
        accepted: true,
    };
    let value = serde_json::to_value(ack).unwrap();

    assert_eq!(value["request_id"], uuid(5).to_string());
    assert_eq!(value["accepted"], true);
    assert_eq!(value.as_object().unwrap().len(), 2);
}
#[test]
fn archive_capabilities_have_a_versioned_explicit_shape() {
    let capabilities = profile_archive_capabilities();

    assert_eq!(capabilities.schema, 1);
    assert!(capabilities.supports_import);
    assert!(capabilities.supports_export);
}
#[test]
fn empty_target_preview_cancel_does_not_provision_until_confirm_with_archive_p() {
    let source_directory = TestDirectory::new();
    let source = BetaHost::open(source_directory.path()).unwrap();
    let source_owner = source.owner_session().unwrap();
    let archive_profile = ProfileId::new();
    source
        .provision_profile(&source_owner, archive_profile, "source archive")
        .unwrap();
    source.device_identity(&source_owner).unwrap();
    let source_human = source
        .native_human_session(&source_owner, archive_profile)
        .unwrap();
    source
        .capture(
            &source_human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: archive_profile,
                occurred_at_ms: 1_000,
                text: "archive fact".into(),
                tags: Vec::new(),
                originals: Vec::new(),
            },
        )
        .unwrap();
    let mut archive = Vec::new();
    source
        .export_profile_archive(
            &source_human,
            archive_profile,
            &mut archive,
            ArchiveBudget::default(),
        )
        .unwrap();

    let target_directory = TestDirectory::new();
    let target = BetaHost::open(target_directory.path()).unwrap();
    let target_owner = target.owner_session().unwrap();
    assert!(target.profiles(&target_owner).unwrap().is_empty());

    let cancelled_preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert_eq!(cancelled_preview.profile_id, archive_profile);
    assert!(cancelled_preview.can_import);
    assert!(validate_expected_profile_id(None, cancelled_preview.profile_id).is_ok());
    assert!(validate_expected_profile_id(Some(archive_profile), cancelled_preview.profile_id).is_ok());
    assert!(validate_expected_profile_id(Some(ProfileId::new()), cancelled_preview.profile_id).is_err());
    drop(cancelled_preview); // A dismissed preview is not a confirmation.
    assert!(target.profiles(&target_owner).unwrap().is_empty());

    let confirmed_preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    let receipt = target
        .import_profile_archive(
            &target_owner,
            confirmed_preview.preview_id,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();

    assert_eq!(receipt.profile_id, archive_profile);
    let profiles = target.profiles(&target_owner).unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].profile_id, archive_profile);
    source.stop().unwrap();
    target.stop().unwrap();
}
#[test]
fn preview_binding_requires_the_same_request_target_spool_and_hash() {
    let request_id = uuid(1);
    let other_request_id = uuid(2);
    let profile_id = ProfileId::new();
    let other_profile_id = ProfileId::new();
    let spool_id = uuid(3);
    let other_spool_id = uuid(4);
    let archive_sha256 = "a".repeat(64);
    let changed_sha256 = "b".repeat(64);
    let binding = ArchiveSourceBinding::new(
        request_id,
        profile_id.clone(),
        spool_id,
        archive_sha256.clone(),
    );

    assert!(binding.matches(
        request_id,
        &profile_id,
        spool_id,
        &archive_sha256,
    ));
    assert!(!binding.matches(
        other_request_id,
        &profile_id,
        spool_id,
        &archive_sha256,
    ));
    assert!(!binding.matches(
        request_id,
        &other_profile_id,
        spool_id,
        &archive_sha256,
    ));
    assert!(!binding.matches(
        request_id,
        &profile_id,
        other_spool_id,
        &archive_sha256,
    ));
    assert!(!binding.matches(
        request_id,
        &profile_id,
        spool_id,
        &changed_sha256,
    ));
}

#[test]
fn preview_and_task_dtos_expose_no_path_uri_preview_token_or_archive_bytes() {
    let preview = ProfileArchivePreviewDto {
        request_id: uuid(10),
        profile_id: uuid(11),
        source_display_name: Some("archive profile".into()),
        archive_sha256: "a".repeat(64),
        fact_count: 105,
        original_count: 2,
        conflict_count: 0,
        missing_original_count: 1,
        unverified_origin_count: 1,
        facts_complete: true,
        proofs_complete: false,
        bytes_complete: false,
        target_bytes_complete: false,
        can_import: true,
    };
    let task = ProfileArchiveTaskDto {
        request_id: uuid(12),
        profile_id: Some(uuid(11)),
        direction: ArchiveDirection::Import,
        phase: ArchiveTaskPhase::Interrupted,
        archive_sha256: Some("a".repeat(64)),
        archive_complete: Some(false),
        byte_length: Some(512 * 1024 + 17),
        bytes_processed: 0,
        facts_processed: 0,
        original_bytes_processed: 0,
        preview: None,
        failure_code: Some("process_restarted".into()),
        partial_output: true,
    };

    assert_renderer_safe(serde_json::to_value(preview).unwrap());
    assert_renderer_safe(serde_json::to_value(task).unwrap());
}

#[test]
fn dropping_a_task_snapshot_does_not_cancel_the_native_owner() {
    let manager = ProfileArchiveManager::default();
    let request_id = uuid(20);
    let profile_id = ProfileId::new();
    let lease = manager
        .begin(request_id, profile_id, ArchiveDirection::Import)
        .unwrap();
    let snapshot = manager.snapshot(request_id).unwrap();

    drop(snapshot);

    assert_eq!(manager.active_request().unwrap(), Some(request_id));
    assert!(lease.check().is_ok());
}

#[test]
fn private_spool_is_immutable_and_rejects_input_over_its_byte_budget() {
    let directory = TestDirectory::new();
    let manager = manager_at(directory.path());
    let request_id = uuid(30);
    let first_lease = manager.begin(request_id, ProfileId::new(), ArchiveDirection::Import).unwrap();
    let root = manager.paths().unwrap().spool;
    let first_bytes = b"immutable archive bytes";
    let mut first_source = Cursor::new(first_bytes.as_slice());
    let spool = PrivateProfileArchiveSpool::copy_from(
        &root,
        request_id,
        &mut first_source,
        64,
        &manager.journal,
    )
    .unwrap();
    let spool_path = spool.path.clone();

    let mut changed_source = Cursor::new(b"replacement bytes".as_slice());
    assert!(PrivateProfileArchiveSpool::copy_from(
        &root,
        request_id,
        &mut changed_source,
        64,
        &manager.journal,
    )
    .is_err());
    assert_eq!(fs::read(&spool_path).unwrap(), first_bytes);
    manager.finish(&first_lease.run, ArchiveTaskPhase::Failed, Some("archive_invalid"), false, false).unwrap();
    let oversized_request = uuid(31);
    let _oversized_lease = manager.begin(oversized_request, ProfileId::new(), ArchiveDirection::Import).unwrap();

    let mut oversized_source = Cursor::new(b"five!".as_slice());
    assert!(PrivateProfileArchiveSpool::copy_from(
        &root,
        oversized_request,
        &mut oversized_source,
        4,
        &manager.journal,
    )
    .is_err());
    assert!(!PrivateProfileArchiveSpool::final_path(&root, oversized_request).exists());
    assert_eq!(fs::metadata(&spool_path).unwrap().len(), first_bytes.len() as u64);
}

#[test]
fn native_archive_budget_preserves_two_gib_free_space_margin_and_rejects_oversize() {
    const GIB: u64 = 1024 * 1024 * 1024;
    let limits = native_profile_archive_limits();

    assert_eq!(limits.max_total_bytes, GIB);
    assert_eq!(limits.max_spool_bytes, 2 * GIB);
    assert_eq!(limits.min_free_space_bytes, 2 * GIB);
    assert!(ensure_native_archive_disk_budget(3 * GIB, GIB).is_ok());
    assert!(ensure_native_archive_disk_budget(3 * GIB - 1, GIB).is_err());
    assert!(ensure_native_archive_disk_budget(4 * GIB, GIB + 1).is_err());
}
#[test]
fn explicit_terminal_abandon_removes_verified_private_spool_only() {
    let manager = ProfileArchiveManager::default();
    let request_id = uuid(50);
    let lease = manager.begin(request_id, ProfileId::new(), ArchiveDirection::Import).unwrap();
    let paths = manager.paths().unwrap();
    let bytes = b"known native spool bytes";
    let mut input = Cursor::new(bytes.as_slice());
    let spool = PrivateProfileArchiveSpool::copy_from(&paths.spool, request_id, &mut input, 128, &lease.run.journal).unwrap();
    lease.run.update_record(|record| {
        record.archive_sha256 = Some(spool.sha256.clone());
        record.byte_length = Some(spool.byte_length);
    }).unwrap();
    manager.finish(&lease.run, ArchiveTaskPhase::Failed, Some("archive_invalid"), false, false).unwrap();

    let user_directory = TestDirectory::new();
    let user_destination = user_directory.path().join("user-selected-document");
    fs::write(&user_destination, b"user data must remain untouched").unwrap();

    assert!(manager.cancel(request_id).unwrap());
    assert!(!spool.path.exists());
    assert_eq!(fs::read(&user_destination).unwrap(), b"user data must remain untouched");
    let rows = manager.history(None).unwrap();
    assert_eq!(rows[0].phase, ArchiveTaskPhase::Cancelled);
    assert_eq!(rows[0].failure_code.as_deref(), Some("abandoned_by_user"));
}

#[test]
fn explicit_terminal_abandon_refuses_a_replaced_private_spool() {
    let manager = ProfileArchiveManager::default();
    let request_id = uuid(60);
    let lease = manager.begin(request_id, ProfileId::new(), ArchiveDirection::Import).unwrap();
    let paths = manager.paths().unwrap();
    let bytes = b"known native spool bytes";
    let mut input = Cursor::new(bytes.as_slice());
    let spool = PrivateProfileArchiveSpool::copy_from(&paths.spool, request_id, &mut input, 128, &lease.run.journal).unwrap();
    lease.run.update_record(|record| {
        record.archive_sha256 = Some(spool.sha256.clone());
        record.byte_length = Some(spool.byte_length);
    }).unwrap();
    manager.finish(&lease.run, ArchiveTaskPhase::Interrupted, Some("process_restarted"), true, false).unwrap();
    fs::write(&spool.path, b"changed archive payload!").unwrap();

    let result = manager.cancel(request_id);

    assert!(result.is_err());
    assert_eq!(fs::read(&spool.path).unwrap(), b"changed archive payload!");
    assert_eq!(manager.history(None).unwrap()[0].phase, ArchiveTaskPhase::Interrupted);
}

#[test]
fn restart_abandons_a_process_exit_partial_spool_and_admits_a_new_task() {
    exit_process_child_if_requested();
    assert_restarted_spool_can_be_abandoned(
        "part",
        "restart_abandons_a_process_exit_partial_spool_and_admits_a_new_task",
    );
}

#[test]
fn restart_abandons_a_sealed_spool_whose_receipt_was_not_journaled() {
    exit_process_child_if_requested();
    assert_restarted_spool_can_be_abandoned(
        "sealed",
        "restart_abandons_a_sealed_spool_whose_receipt_was_not_journaled",
    );
}

#[test]
fn abandon_does_not_delete_uuid_named_spools_without_a_journal_owner() {
    let directory = TestDirectory::new();
    let manager = manager_at(directory.path());
    let paths = manager.paths().unwrap();
    let request_id = Uuid::new_v4();
    let partial = paths.spool.join(format!("{request_id}.part"));
    let sealed = PrivateProfileArchiveSpool::final_path(&paths.spool, request_id);
    fs::write(&partial, b"unowned partial file").unwrap();
    fs::write(&sealed, b"unowned sealed file").unwrap();

    assert!(!manager.cancel(request_id).unwrap());
    assert_eq!(fs::read(&partial).unwrap(), b"unowned partial file");
    assert_eq!(fs::read(&sealed).unwrap(), b"unowned sealed file");
}

#[test]
fn abandon_refuses_a_partial_spool_replaced_after_process_exit() {
    exit_process_child_if_requested();
    let directory = TestDirectory::new();
    let request_id = Uuid::new_v4();
    spawn_process_exit_child(
        "abandon_refuses_a_partial_spool_replaced_after_process_exit",
        "part",
        directory.path(),
        request_id,
    );

    let manager = manager_at(directory.path());
    let paths = manager.paths().unwrap();
    let partial = paths.spool.join(format!("{request_id}.part"));
    let replacement = paths.spool.join(format!("{request_id}.replacement"));
    fs::write(&replacement, b"replacement file created separately").unwrap();
    fs::remove_file(&partial).unwrap();
    fs::rename(&replacement, &partial).unwrap();

    assert!(manager.cancel(request_id).is_err());
    assert_eq!(
        fs::read(&partial).unwrap(),
        b"replacement file created separately"
    );
    assert_eq!(
        manager.history(None).unwrap()[0].phase,
        ArchiveTaskPhase::Interrupted
    );
}

#[test]
fn complete_archive_hash_can_be_saved_when_content_completeness_is_partial() {
    let receipt = ProfileArchiveExportReceipt {
        profile_id: ProfileId::new(),
        unverified_origins: Vec::new(),
        request_id: uuid(40),
        archive_sha256: "c".repeat(64),
        fact_count: 105,
        original_count: 2,
        facts_complete: true,
        proofs_complete: false,
        bytes_complete: false,
        missing_originals: Vec::new(),
        complete: false,
    };

    let expected_sha256 = receipt.archive_sha256.clone();
    let result = validate_export_for_save(Ok(receipt), &expected_sha256);
    assert!(result.is_ok());
    let saved = result.unwrap();
    assert!(!saved.complete, "the saved result must remain visibly partial");
    assert!(verify_export_spool(&saved, &"d".repeat(64)).is_err());

    let host_error: Result<ProfileArchiveExportReceipt, ProfileArchiveError> =
        Err(ProfileArchiveError::InvalidFormat);
    assert!(validate_export_for_save(host_error, &expected_sha256).is_err());
}
