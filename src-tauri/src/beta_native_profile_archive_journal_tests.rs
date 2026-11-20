use super::{
    ArchiveDirection, ArchiveProgress, ArchiveTaskPhase, ArchiveTaskRecord, JournalError,
    ProfileArchiveJournal, MANIFEST_FILE_NAME,
};
use std::{fs, path::PathBuf};
use uuid::Uuid;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("beta-profile-archive-journal-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create isolated journal test directory");
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

fn task(request_id: u128, profile_id: u128, direction: ArchiveDirection) -> ArchiveTaskRecord {
    ArchiveTaskRecord {
        request_id: uuid(request_id),
        profile_id: Some(uuid(profile_id)),
        direction,
        phase: ArchiveTaskPhase::Preparing,
        archive_sha256: Some("a".repeat(64)),
        archive_complete: Some(false),
        byte_length: Some(512 * 1024 + 17),
        progress: ArchiveProgress::default(),
        failure_code: None,
        partial_output: false,
    }
}

fn journal(root: &std::path::Path, process_generation: u128) -> ProfileArchiveJournal {
    ProfileArchiveJournal::new(root.to_path_buf(), uuid(process_generation))
}

fn advance(
    journal: &ProfileArchiveJournal,
    record: &mut ArchiveTaskRecord,
    next: ArchiveTaskPhase,
) {
    let expected = record.phase;
    record.phase = next;
    journal
        .transition(record.request_id, expected, record.clone())
        .expect("valid archive task transition");
}

#[test]
fn restart_marks_import_interrupted_and_retains_progress_without_a_locator() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let old_process = journal(&root, 1);
    let request_id = uuid(12);
    let profile_id = uuid(10);
    let mut record = task(12, 10, ArchiveDirection::Import);

    old_process.begin(record.clone(), Some(request_id)).unwrap();
    advance(&old_process, &mut record, ArchiveTaskPhase::AwaitingSource);
    advance(&old_process, &mut record, ArchiveTaskPhase::Spooling);
    advance(&old_process, &mut record, ArchiveTaskPhase::PreviewReady);
    advance(&old_process, &mut record, ArchiveTaskPhase::Importing);
    record.progress = ArchiveProgress {
        bytes_processed: 512 * 1024 + 17,
        facts_processed: 105,
        original_bytes_processed: 512 * 1024 + 17,
    };
    record.partial_output = true;
    old_process.checkpoint(record.clone()).unwrap();

    let restarted = journal(&root, 2);
    restarted.initialize().unwrap();
    let manifest_path = root.join(MANIFEST_FILE_NAME);
    let before_history = fs::read(&manifest_path).unwrap();
    let rows = restarted.history(Some(profile_id), None).unwrap();
    let after_history = fs::read(&manifest_path).unwrap();

    assert_eq!(before_history, after_history, "history is read-only");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].request_id, request_id);
    assert_eq!(rows[0].phase, ArchiveTaskPhase::Interrupted);
    assert_eq!(rows[0].failure_code.as_deref(), Some("process_restarted"));
    let expected_sha = "a".repeat(64);
    assert_eq!(rows[0].archive_sha256.as_deref(), Some(expected_sha.as_str()));
    assert_eq!(rows[0].progress.bytes_processed, 512 * 1024 + 17);
    assert_eq!(rows[0].progress.facts_processed, 105);
    assert_eq!(rows[0].progress.original_bytes_processed, 512 * 1024 + 17);
    assert!(rows[0].partial_output);

    let json: serde_json::Value = serde_json::from_slice(&after_history).unwrap();
    let stored_record = json["records"][0]["record"].as_object().unwrap();
    for forbidden in [
        "path",
        "source_path",
        "destination_path",
        "uri",
        "source_uri",
        "destination_uri",
        "preview_token",
        "preview_id",
        "human_token",
        "grant_token",
        "archive_bytes",
    ] {
        assert!(!stored_record.contains_key(forbidden), "journal stored {forbidden}");
    }
}

#[test]
fn restart_preserves_partial_export_and_never_persists_the_save_destination() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let old_process = journal(&root, 8);
    let request_id = uuid(81);
    let profile_id = uuid(80);
    let mut record = task(81, 80, ArchiveDirection::Export);

    old_process.begin(record.clone(), Some(request_id)).unwrap();
    advance(&old_process, &mut record, ArchiveTaskPhase::Exporting);
    advance(&old_process, &mut record, ArchiveTaskPhase::AwaitingDestination);
    advance(&old_process, &mut record, ArchiveTaskPhase::Writing);
    record.progress.bytes_processed = 4096;
    record.partial_output = true;
    old_process.checkpoint(record).unwrap();

    let restarted = journal(&root, 9);
    restarted.initialize().unwrap();
    let rows = restarted.history(Some(profile_id), None).unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].phase, ArchiveTaskPhase::Interrupted);
    assert_eq!(rows[0].failure_code.as_deref(), Some("process_restarted"));
    assert!(rows[0].partial_output, "a possibly created document remains explainable");
    assert_eq!(rows[0].archive_complete, Some(false));
    assert_eq!(rows[0].progress.bytes_processed, 4096);

    let raw = fs::read(root.join(MANIFEST_FILE_NAME)).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    let stored = json["records"][0]["record"].as_object().unwrap();
    assert!(!stored.contains_key("destination_uri"));
    assert!(!stored.contains_key("destination_path"));
}

#[test]
fn unconfirmed_export_receipt_is_an_explicit_partial_interruption() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 10);
    let request_id = uuid(91);
    let profile_id = uuid(90);
    let mut record = task(91, 90, ArchiveDirection::Export);

    journal.begin(record.clone(), Some(request_id)).unwrap();
    advance(&journal, &mut record, ArchiveTaskPhase::Exporting);
    advance(&journal, &mut record, ArchiveTaskPhase::AwaitingDestination);
    advance(&journal, &mut record, ArchiveTaskPhase::Writing);
    advance(&journal, &mut record, ArchiveTaskPhase::Verifying);
    record.phase = ArchiveTaskPhase::Interrupted;
    record.failure_code = Some("receipt_unconfirmed".into());
    record.partial_output = true;
    journal
        .transition(request_id, ArchiveTaskPhase::Verifying, record)
        .unwrap();

    let before_history = fs::read(directory.path().join("journal").join(MANIFEST_FILE_NAME)).unwrap();
    let rows = journal.history(Some(profile_id), None).unwrap();
    let after_history = fs::read(directory.path().join("journal").join(MANIFEST_FILE_NAME)).unwrap();

    assert_eq!(before_history, after_history, "unknown receipt history is read-only");
    assert_eq!(rows[0].phase, ArchiveTaskPhase::Interrupted);
    assert_eq!(rows[0].failure_code.as_deref(), Some("receipt_unconfirmed"));
    assert!(rows[0].partial_output);
}
#[test]
fn cancellation_stays_requested_until_worker_ack_and_late_result_is_stale() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 3);
    let request_id = uuid(21);
    let profile_id = uuid(20);
    let mut record = task(21, 20, ArchiveDirection::Import);

    journal.begin(record.clone(), Some(request_id)).unwrap();
    advance(&journal, &mut record, ArchiveTaskPhase::AwaitingSource);
    advance(&journal, &mut record, ArchiveTaskPhase::Spooling);
    advance(&journal, &mut record, ArchiveTaskPhase::PreviewReady);
    advance(&journal, &mut record, ArchiveTaskPhase::Importing);
    advance(&journal, &mut record, ArchiveTaskPhase::CancelRequested);

    let pending = journal.history(Some(profile_id), Some(request_id)).unwrap();
    assert_eq!(pending[0].phase, ArchiveTaskPhase::CancelRequested);

    advance(&journal, &mut record, ArchiveTaskPhase::Cancelled);
    let mut late_success = record.clone();
    late_success.phase = ArchiveTaskPhase::Succeeded;
    assert_eq!(
        journal.transition(request_id, ArchiveTaskPhase::CancelRequested, late_success),
        Err(JournalError::StaleTask),
    );
}

#[test]
fn thirty_third_confirmed_archive_evicts_only_the_oldest_spool_free_success() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 20);
    let first_request = uuid(1_000);

    for index in 0..32u128 {
        let request_id = 1_000 + index;
        let mut record = task(request_id, 2_000 + index, ArchiveDirection::Export);
        journal.begin(record.clone(), Some(uuid(request_id))).unwrap();
        advance(&journal, &mut record, ArchiveTaskPhase::Exporting);
        advance(&journal, &mut record, ArchiveTaskPhase::AwaitingDestination);
        advance(&journal, &mut record, ArchiveTaskPhase::Writing);
        advance(&journal, &mut record, ArchiveTaskPhase::Verifying);
        advance(&journal, &mut record, ArchiveTaskPhase::Succeeded);
    }

    let request_id = uuid(1_032);
    let mut next = task(1_032, 2_032, ArchiveDirection::Export);
    journal.begin(next.clone(), Some(request_id)).unwrap();
    advance(&journal, &mut next, ArchiveTaskPhase::Exporting);
    advance(&journal, &mut next, ArchiveTaskPhase::AwaitingDestination);
    advance(&journal, &mut next, ArchiveTaskPhase::Writing);
    advance(&journal, &mut next, ArchiveTaskPhase::Verifying);
    advance(&journal, &mut next, ArchiveTaskPhase::Succeeded);

    let rows = journal.history(None, None).unwrap();
    assert_eq!(rows.len(), 32);
    assert!(!rows.iter().any(|row| row.request_id == first_request));
    assert!(rows.iter().any(|row| row.request_id == request_id));
    assert!(rows.iter().any(|row| row.profile_id == Some(uuid(2_001))));
}

#[test]
fn retention_preserves_interrupted_and_spooled_success_when_no_confirmed_slot_is_evictable() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let journal = journal(&root, 21);
    let spool = root.join("spool");
    fs::create_dir_all(&spool).unwrap();

    let mut completed = task(3_000, 4_000, ArchiveDirection::Export);
    let completed_id = completed.request_id;
    journal.begin(completed.clone(), Some(completed_id)).unwrap();
    advance(&journal, &mut completed, ArchiveTaskPhase::Exporting);
    advance(&journal, &mut completed, ArchiveTaskPhase::AwaitingDestination);
    advance(&journal, &mut completed, ArchiveTaskPhase::Writing);
    advance(&journal, &mut completed, ArchiveTaskPhase::Verifying);
    advance(&journal, &mut completed, ArchiveTaskPhase::Succeeded);
    fs::write(spool.join(format!("{completed_id}.spool")), b"still-owned archive spool").unwrap();

    for index in 1..32u128 {
        let request_id = 3_000 + index;
        let mut record = task(request_id, 4_000 + index, ArchiveDirection::Import);
        journal.begin(record.clone(), Some(uuid(request_id))).unwrap();
        let expected = record.phase;
        record.phase = ArchiveTaskPhase::Interrupted;
        record.failure_code = Some("process_restarted".into());
        record.partial_output = true;
        journal.transition(record.request_id, expected, record).unwrap();
    }

    let before = journal.history(None, None).unwrap();
    assert_eq!(before.len(), 32);
    assert_eq!(
        journal.begin(task(9_999, 8_888, ArchiveDirection::Export), Some(uuid(9_999))),
        Err(JournalError::HistoryFull),
    );
    let after = journal.history(None, None).unwrap();
    assert_eq!(after.len(), 32);
    assert!(after.iter().any(|row| row.request_id == completed_id));
    assert_eq!(fs::read(spool.join(format!("{completed_id}.spool"))).unwrap(), b"still-owned archive spool");
}
#[test]
fn unfiltered_history_includes_unknown_profile_preview_tasks() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 11);
    let request_id = uuid(111);
    let mut record = task(111, 110, ArchiveDirection::Import);
    record.profile_id = None;

    journal.begin(record.clone(), Some(request_id)).unwrap();
    advance(&journal, &mut record, ArchiveTaskPhase::AwaitingSource);
    advance(&journal, &mut record, ArchiveTaskPhase::CancelRequested);
    advance(&journal, &mut record, ArchiveTaskPhase::Cancelled);

    let all = journal.history(None, None).unwrap();
    let filtered = journal.history(Some(uuid(110)), None).unwrap();

    assert_eq!(all.len(), 1);
    assert_eq!(all[0].request_id, request_id);
    assert_eq!(all[0].profile_id, None);
    assert_eq!(all[0].phase, ArchiveTaskPhase::Cancelled);
    assert!(filtered.is_empty(), "history filtering never provisions a profile");
}
#[test]
fn corrupt_manifest_is_reported_and_preserved() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    fs::create_dir_all(&root).unwrap();
    let manifest = root.join(MANIFEST_FILE_NAME);
    let original = b"{not a profile archive journal";
    fs::write(&manifest, original).unwrap();

    let result = journal(&root, 4).initialize();

    assert_eq!(result, Err(JournalError::Corrupt));
    assert_eq!(fs::read(manifest).unwrap(), original);
}
