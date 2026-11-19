use super::{ExportJournal, ExportTaskPhase, ExportTaskRecord, JournalError, MANIFEST_FILE_NAME};
use std::{fs, path::PathBuf};
use uuid::Uuid;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("beta-export-journal-{}", Uuid::new_v4()));
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

fn task(request: u128, profile_id: Uuid, original_id: Uuid) -> ExportTaskRecord {
    ExportTaskRecord {
        request_id: uuid(request),
        profile_id,
        original_id,
        file_name: "source.bin".into(),
        byte_length: 8_192,
        sha256: "a".repeat(64),
        phase: ExportTaskPhase::Preparing,
        failure_code: None,
        partial_output: false,
    }
}

fn journal(root: &std::path::Path, process: u128) -> ExportJournal {
    ExportJournal::new(root.to_path_buf(), uuid(process))
}

fn advance_to_success(journal: &ExportJournal, request_id: Uuid) {
    journal
        .transition(
            request_id,
            ExportTaskPhase::Preparing,
            ExportTaskPhase::AwaitingDestination,
            None,
            false,
        )
        .unwrap();
    journal
        .transition(
            request_id,
            ExportTaskPhase::AwaitingDestination,
            ExportTaskPhase::Writing,
            None,
            true,
        )
        .unwrap();
    journal
        .transition(
            request_id,
            ExportTaskPhase::Writing,
            ExportTaskPhase::Verifying,
            None,
            true,
        )
        .unwrap();
    journal
        .transition(
            request_id,
            ExportTaskPhase::Verifying,
            ExportTaskPhase::Succeeded,
            None,
            false,
        )
        .unwrap();
}

#[test]
fn restart_projects_unconfirmed_task_as_interrupted_and_preserves_metadata() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let old_process = journal(&root, 1);
    let profile_id = uuid(10);
    let original_id = uuid(11);
    let request_id = uuid(12);
    let original_task = task(12, profile_id.clone(), original_id.clone());

    old_process
        .begin(original_task.clone(), Some(request_id))
        .unwrap();
    old_process
        .transition(
            request_id,
            ExportTaskPhase::Preparing,
            ExportTaskPhase::AwaitingDestination,
            None,
            false,
        )
        .unwrap();

    let manifest_path = root.join(MANIFEST_FILE_NAME);
    let before_read = fs::read(&manifest_path).unwrap();
    let restarted = journal(&root, 2);
    let rows = restarted.history(profile_id.clone(), None).unwrap();
    let after_read = fs::read(&manifest_path).unwrap();

    assert_eq!(
        before_read, after_read,
        "history must not write recovery state"
    );
    assert_eq!(rows.len(), 1);
    let recovered = &rows[0];
    assert_eq!(recovered.request_id, request_id);
    assert_eq!(recovered.profile_id, profile_id);
    assert_eq!(recovered.original_id, original_id);
    assert_eq!(recovered.file_name, original_task.file_name);
    assert_eq!(recovered.byte_length, original_task.byte_length);
    assert_eq!(recovered.sha256, original_task.sha256);
    assert_eq!(recovered.phase, ExportTaskPhase::Interrupted);
    assert_eq!(recovered.failure_code.as_deref(), Some("process_restarted"));
    assert!(recovered.partial_output);

    let json: serde_json::Value = serde_json::from_slice(&after_read).unwrap();
    let stored_record = json["records"][0]["record"].as_object().unwrap();
    let mut stored_fields = stored_record.keys().cloned().collect::<Vec<_>>();
    stored_fields.sort();
    let expected_fields = [
        "byte_length",
        "failure_code",
        "file_name",
        "original_id",
        "partial_output",
        "phase",
        "profile_id",
        "request_id",
        "sha256",
    ]
    .into_iter()
    .map(String::from)
    .collect::<Vec<_>>();
    assert_eq!(stored_fields, expected_fields);
    assert!(!stored_record.contains_key("destination_uri"));
    assert!(!stored_record.contains_key("path"));
    assert!(!stored_record.contains_key("bytes"));

    restarted.initialize().unwrap();
    let persisted = restarted.history(profile_id, None).unwrap();
    assert_eq!(persisted[0].phase, ExportTaskPhase::Interrupted);
}

#[test]
fn interruption_before_destination_selection_does_not_claim_possible_output() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let old_process = journal(&root, 8);
    let profile_id = uuid(80);
    let request_id = uuid(81);
    old_process
        .begin(task(81, profile_id, uuid(82)), Some(request_id))
        .unwrap();

    let restarted = journal(&root, 9);
    let rows = restarted.history(profile_id, None).unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].phase, ExportTaskPhase::Interrupted);
    assert_eq!(rows[0].failure_code.as_deref(), Some("process_restarted"));
    assert!(!rows[0].partial_output);
}

#[test]
fn failed_startup_initialization_does_not_latch_a_later_read_history() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    let old_process = journal(&root, 10);
    let profile_id = uuid(100);
    let request_id = uuid(101);
    old_process
        .begin(task(101, profile_id, uuid(102)), Some(request_id))
        .unwrap();
    old_process
        .transition(
            request_id,
            ExportTaskPhase::Preparing,
            ExportTaskPhase::AwaitingDestination,
            None,
            false,
        )
        .unwrap();

    let manifest_path = root.join(MANIFEST_FILE_NAME);
    let manifest = fs::read(&manifest_path).unwrap();
    fs::remove_dir_all(&root).unwrap();
    fs::write(&root, b"temporary storage barrier").unwrap();
    let restarted = journal(&root, 11);
    assert_eq!(restarted.initialize(), Err(JournalError::Corrupt));

    fs::remove_file(&root).unwrap();
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join(MANIFEST_FILE_NAME), manifest).unwrap();
    let rows = restarted.history(profile_id, None).unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].phase, ExportTaskPhase::Interrupted);
    assert_eq!(rows[0].failure_code.as_deref(), Some("process_restarted"));
    assert!(rows[0].partial_output);
}

#[test]
fn late_result_for_old_request_cannot_change_a_new_task() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 3);
    let profile_id = uuid(20);
    let old_request = uuid(21);
    journal
        .begin(task(21, profile_id, uuid(22)), Some(old_request))
        .unwrap();
    journal
        .transition(
            old_request,
            ExportTaskPhase::Preparing,
            ExportTaskPhase::AwaitingDestination,
            None,
            false,
        )
        .unwrap();
    journal
        .transition(
            old_request,
            ExportTaskPhase::AwaitingDestination,
            ExportTaskPhase::Cancelled,
            Some("export_cancelled".into()),
            false,
        )
        .unwrap();

    let new_request = uuid(23);
    journal
        .begin(task(23, profile_id, uuid(24)), Some(new_request))
        .unwrap();
    let late = journal.transition(
        old_request,
        ExportTaskPhase::AwaitingDestination,
        ExportTaskPhase::Succeeded,
        None,
        false,
    );

    assert_eq!(late, Err(JournalError::StaleTask));
    let rows = journal.history(profile_id, Some(new_request)).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].request_id, old_request);
    assert_eq!(rows[0].phase, ExportTaskPhase::Cancelled);
    assert_eq!(rows[1].request_id, new_request);
    assert_eq!(rows[1].phase, ExportTaskPhase::Preparing);
}

#[test]
fn failed_start_record_write_returns_error_without_resetting_an_existing_path() {
    let directory = TestDirectory::new();
    let blocker = directory.path().join("not-a-directory");
    fs::write(&blocker, b"keep this file").unwrap();
    let journal = journal(&blocker.join("journal"), 4);
    let profile_id = uuid(30);
    let result = journal.begin(task(31, profile_id, uuid(32)), Some(uuid(31)));

    assert_eq!(result, Err(JournalError::Unavailable));
    assert_eq!(fs::read(blocker).unwrap(), b"keep this file");
}

#[test]
fn journal_keeps_at_most_thirty_two_terminal_tasks_and_one_active_task() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 5);
    let profile_id = uuid(40);

    for index in 0..34u128 {
        let request_id = uuid(100 + index);
        journal
            .begin(
                task(100 + index, profile_id, uuid(200 + index)),
                Some(request_id),
            )
            .unwrap();
        journal
            .transition(
                request_id,
                ExportTaskPhase::Preparing,
                ExportTaskPhase::Failed,
                Some("synthetic_failure".into()),
                false,
            )
            .unwrap();
    }

    let active_request = uuid(500);
    journal
        .begin(task(500, profile_id, uuid(501)), Some(active_request))
        .unwrap();
    let rows = journal.history(profile_id, Some(active_request)).unwrap();

    assert_eq!(rows.len(), 33);
    assert_eq!(
        rows.iter().filter(|row| row.phase.is_terminal()).count(),
        32
    );
    assert!(!rows.iter().any(|row| row.request_id == uuid(100)));
    assert!(rows.iter().any(|row| row.request_id == uuid(133)));
    assert_eq!(rows.last().unwrap().request_id, active_request);
    assert_eq!(rows.last().unwrap().phase, ExportTaskPhase::Preparing);
}

#[test]
fn history_is_read_only_and_never_returns_another_profiles_tasks() {
    let directory = TestDirectory::new();
    let journal = journal(&directory.path().join("journal"), 6);
    let first_profile = uuid(60);
    let second_profile = uuid(61);
    let first_request = uuid(62);
    let second_request = uuid(63);
    journal
        .begin(task(62, first_profile, uuid(64)), Some(first_request))
        .unwrap();
    advance_to_success(&journal, first_request);
    journal
        .begin(task(63, second_profile, uuid(65)), Some(second_request))
        .unwrap();
    advance_to_success(&journal, second_request);

    let manifest_path = directory.path().join("journal").join(MANIFEST_FILE_NAME);
    let before = fs::read(&manifest_path).unwrap();
    let rows = journal.history(first_profile.clone(), None).unwrap();
    let after = fs::read(&manifest_path).unwrap();

    assert_eq!(
        before, after,
        "terminal history reads must not mutate the manifest"
    );
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].request_id, first_request);
    assert_eq!(rows[0].profile_id, first_profile);
}

#[test]
fn malformed_manifest_is_an_explicit_error_and_is_never_cleared() {
    let directory = TestDirectory::new();
    let root = directory.path().join("journal");
    fs::create_dir_all(&root).unwrap();
    let manifest_path = root.join(MANIFEST_FILE_NAME);
    fs::write(&manifest_path, b"{not valid json").unwrap();
    let before = fs::read(&manifest_path).unwrap();
    let journal = journal(&root, 7);

    let result = journal.history(uuid(70), None);

    assert_eq!(result, Err(JournalError::Corrupt));
    assert_eq!(fs::read(manifest_path).unwrap(), before);
}
