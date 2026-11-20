use super::{journal::UserRangeExportJournal, UserRangeExportPhase, UserRangeExportResult};
use exomind_core::ProfileId;
use std::{fs, path::PathBuf};
use uuid::Uuid;

fn host_root() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("create isolated fixture");
    let host_root = directory.path().join("beta-host");
    fs::create_dir(&host_root).expect("create Host scope");
    (directory, host_root)
}

#[test]
fn restart_projects_pending_export_to_interrupted_without_saved_receipt() {
    let (_directory, host_root) = host_root();
    let request_id = Uuid::new_v4();
    let profile_id = ProfileId::new();

    let mut journal = UserRangeExportJournal::open(&host_root).expect("open receipt journal");
    journal.begin(request_id, profile_id).expect("persist before picker");
    journal
        .transition(request_id, UserRangeExportPhase::AwaitingDestination)
        .expect("persist picker phase");
    drop(journal);

    let restarted = UserRangeExportJournal::open(&host_root).expect("recover previous process");
    let status = restarted
        .status(request_id)
        .expect("read recovered status")
        .expect("retain request history");
    assert_eq!(status.phase, UserRangeExportPhase::Interrupted);
    let result = status.result.expect("interrupted projection has a result");
    assert_eq!(result.phase, UserRangeExportPhase::Interrupted);
    assert!(result.partial_output, "picker phase may have created a document");
    assert_eq!(result.archive_byte_length, None);
    assert_eq!(result.archive_sha256, None);
    assert_ne!(result.phase, UserRangeExportPhase::Saved);
}

#[test]
fn history_and_status_reads_leave_the_persisted_manifest_unchanged() {
    let (_directory, host_root) = host_root();
    let request_id = Uuid::new_v4();
    let profile_id = ProfileId::new();
    let mut journal = UserRangeExportJournal::open(&host_root).expect("open receipt journal");
    journal.begin(request_id, profile_id).expect("persist active request");

    let manifest = UserRangeExportJournal::root_for_host(&host_root)
        .expect("derive scoped journal root")
        .join("manifest.json");
    let before = fs::read(&manifest).expect("read persisted manifest");
    let status = journal.status(request_id).expect("read status");
    let history = journal.history(profile_id).expect("read profile history");
    let after = fs::read(&manifest).expect("read manifest after observations");

    assert_eq!(status.expect("known request").phase, UserRangeExportPhase::Preparing);
    assert_eq!(history.len(), 1);
    assert_eq!(before, after, "history/status must not rewrite journal state");
}

#[test]
fn saved_receipt_roundtrips_and_corrupt_json_is_retained_without_sensitive_dto_fields() {
    let (_directory, host_root) = host_root();
    let request_id = Uuid::new_v4();
    let profile_id = ProfileId::new();
    let mut journal = UserRangeExportJournal::open(&host_root).expect("open receipt journal");
    journal.begin(request_id, profile_id).expect("persist active request");
    journal
        .transition(request_id, UserRangeExportPhase::Writing)
        .expect("persist private stage phase");
    journal
        .transition(request_id, UserRangeExportPhase::AwaitingDestination)
        .expect("persist picker phase");
    journal
        .transition(request_id, UserRangeExportPhase::Writing)
        .expect("persist destination write phase");
    journal
        .transition(request_id, UserRangeExportPhase::Verifying)
        .expect("persist destination verification phase");
    journal
        .transition(request_id, UserRangeExportPhase::Publishing)
        .expect("persist verified target publication phase");
    journal
        .finish(UserRangeExportResult::saved(
            request_id,
            profile_id,
            true,
            4096,
            "a".repeat(64),
            2,
            0,
        ))
        .expect("persist terminal receipt");
    drop(journal);

    let reopened = UserRangeExportJournal::open(&host_root).expect("reload saved history");
    let status = reopened
        .status(request_id)
        .expect("read saved status")
        .expect("saved request remains queryable");
    assert_eq!(status.phase, UserRangeExportPhase::Saved);
    let result = status.result.as_ref().expect("saved result is present");
    assert_eq!(result.archive_byte_length, Some(4096));
    assert_eq!(result.archive_sha256.as_deref(), Some("a".repeat(64).as_str()));

    let dto = serde_json::to_value(&status).expect("serialize Native status DTO");
    let forbidden = ["destination", "destination_path", "destination_uri", "path", "uri", "token", "content"];
    fn check_keys(value: &serde_json::Value, forbidden: &[&str]) {
        match value {
            serde_json::Value::Object(fields) => {
                for (key, value) in fields {
                    assert!(!forbidden.contains(&key.as_str()), "unexpected sensitive DTO field: {key}");
                    check_keys(value, forbidden);
                }
            }
            serde_json::Value::Array(values) => values.iter().for_each(|value| check_keys(value, forbidden)),
            _ => {}
        }
    }
    check_keys(&dto, &forbidden);
    assert!(dto.get("request_id").is_some());
    assert!(dto.get("profile_id").is_some());
    assert!(dto.get("archive_sha256").is_none());
    assert!(dto["result"].get("archive_sha256").is_some());

    let corrupt_host = host_root.with_file_name("corrupt-host");
    fs::create_dir(&corrupt_host).expect("create corrupt fixture Host root");
    let corrupt_root = UserRangeExportJournal::root_for_host(&corrupt_host)
        .expect("derive corrupt fixture journal root");
    fs::create_dir(&corrupt_root).expect("create corrupt journal root");
    let corrupt_manifest = corrupt_root.join("manifest.json");
    let malformed = b"{not-json";
    fs::write(&corrupt_manifest, malformed).expect("write malformed manifest fixture");
    assert!(UserRangeExportJournal::open(&corrupt_host).is_err());
    assert_eq!(fs::read(&corrupt_manifest).expect("retain malformed evidence"), malformed);
}

#[test]
fn restart_preserves_a_private_stage_not_bound_to_a_creation_record() {
    let (_directory, host_root) = host_root();
    let request_id = Uuid::new_v4();
    let mut journal = UserRangeExportJournal::open(&host_root).unwrap();
    journal.begin(request_id, ProfileId::new()).unwrap();
    let stage = journal.private_stage_root().unwrap()
        .join(super::journal::private_stage_file_name(request_id));
    fs::write(&stage, b"unregistered replacement file").unwrap();
    drop(journal);

    let restarted = UserRangeExportJournal::open(&host_root);
    assert_eq!(fs::read(&stage).expect("unknown stage must survive startup"), b"unregistered replacement file");
    drop(restarted);
}

#[test]
fn restart_preserves_a_uuid_named_manifest_temporary_without_creation_proof() {
    let (_directory, host_root) = host_root();
    let request_id = Uuid::new_v4();
    let mut journal = UserRangeExportJournal::open(&host_root).unwrap();
    journal.begin(request_id, ProfileId::new()).unwrap();
    let root = UserRangeExportJournal::root_for_host(&host_root).unwrap();
    let temporary = root.join(format!(".manifest-{request_id}.{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, b"unregistered manifest lookalike").unwrap();
    drop(journal);

    let restarted = UserRangeExportJournal::open(&host_root);
    assert_eq!(fs::read(&temporary).expect("unknown temporary must survive startup"), b"unregistered manifest lookalike");
    drop(restarted);
}
