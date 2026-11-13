use exomind_core::{AgentId, CaptureCommand, CommandId, Core, CoreError, EventId, ProfileId};
use rusqlite::Connection;
use std::sync::{Arc, Barrier};

const CRASH_ROOT_ENV: &str = "EXOMIND_CORE_TEST_CRASH_ROOT";

fn command(profile_id: ProfileId) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1_794_000_000_000,
        text: "先可靠记下".to_owned(),
        tags: vec!["work".to_owned()],
    }
}

#[test]
fn committed_receipt_and_identity_survive_reopen_and_retry() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("same name").unwrap();
    let other = core.create_profile("same name").unwrap();
    assert_ne!(profile, other);
    let context = core.local_human(profile).unwrap();
    let input = command(profile);
    let receipt = core.submit(&context, &input).unwrap();
    let device = core.device_id();
    let retry = core.submit(&context, &input).unwrap();
    assert!(retry.replayed);
    assert_eq!(receipt.event_id, retry.event_id);
    assert_eq!(receipt.local_seq, retry.local_seq);
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    assert_eq!(reopened.device_id(), device);
    let retry = reopened
        .submit(&reopened.local_human(profile).unwrap(), &input)
        .unwrap();
    assert!(retry.replayed);
    assert_eq!(retry.local_seq, receipt.local_seq);
    assert_eq!(
        reopened
            .events(&reopened.local_human(profile).unwrap(), profile)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn context_cannot_write_or_read_another_profile_or_runtime() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let context = core.local_human(p).unwrap();
    assert!(matches!(
        core.submit(&context, &command(q)),
        Err(CoreError::ScopeMismatch)
    ));
    assert!(matches!(
        core.events(&context, q),
        Err(CoreError::ScopeMismatch)
    ));
    assert!(
        core.events(&core.local_human(q).unwrap(), q)
            .unwrap()
            .is_empty()
    );
    let reopened = Core::open(root.path()).unwrap();
    assert!(matches!(
        reopened.submit(&context, &command(p)),
        Err(CoreError::ForeignContext)
    ));
}

#[test]
fn command_id_is_bound_to_content_event_and_authenticated_author() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let original = command(profile);
    core.submit(&context, &original).unwrap();
    let mut changed = original.clone();
    changed.text = "changed".to_owned();
    assert!(matches!(
        core.submit(&context, &changed),
        Err(CoreError::CommandConflict)
    ));
    changed = original.clone();
    changed.event_id = EventId::new();
    assert!(matches!(
        core.submit(&context, &changed),
        Err(CoreError::CommandConflict)
    ));
    let agent = core.local_agent(profile, AgentId::new()).unwrap();
    assert!(matches!(
        core.submit(&agent, &original),
        Err(CoreError::CommandConflict)
    ));
    let events = core.events(&context, profile).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].text, original.text);
}

#[test]
fn event_id_replay_never_overwrites_original() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let original = command(profile);
    let first = core.submit(&context, &original).unwrap();
    let mut repeated = original.clone();
    repeated.command_id = CommandId::new();
    let duplicate = core.submit(&context, &repeated).unwrap();
    assert_eq!(first.local_seq, duplicate.local_seq);
    repeated.command_id = CommandId::new();
    repeated.text = "do not replace".to_owned();
    assert!(matches!(
        core.submit(&context, &repeated),
        Err(CoreError::EventConflict)
    ));
    assert_eq!(
        core.events(&context, profile).unwrap()[0].text,
        original.text
    );
}

#[test]
fn receipt_write_failure_rolls_back_the_event_and_retry_can_succeed() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let input = command(profile);
    let fault = Connection::open(core.database_path()).unwrap();
    fault.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt fault'); END;").unwrap();
    assert!(core.submit(&context, &input).is_err());
    assert!(core.events(&context, profile).unwrap().is_empty());
    assert!(core.receipt(&context, input.command_id).unwrap().is_none());
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    let context = reopened.local_human(profile).unwrap();
    assert!(reopened.events(&context, profile).unwrap().is_empty());
    fault.execute_batch("DROP TRIGGER fail_receipt;").unwrap();
    assert!(!reopened.submit(&context, &input).unwrap().replayed);
}

#[test]
fn independent_connections_commit_one_fact_for_concurrent_retry() {
    let root = tempfile::tempdir().unwrap();
    let first = Core::open(root.path()).unwrap();
    let profile = first.create_profile("P").unwrap();
    let second = Core::open(root.path()).unwrap();
    let input = command(profile);
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = [first, second]
        .into_iter()
        .map(|core| {
            let input = input.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let context = core.local_human(profile).unwrap();
                barrier.wait();
                core.submit(&context, &input).unwrap()
            })
        })
        .collect();
    let receipts: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(receipts[0].local_seq, receipts[1].local_seq);
    assert_ne!(receipts[0].replayed, receipts[1].replayed);
    let core = Core::open(root.path()).unwrap();
    assert_eq!(
        core.events(&core.local_human(profile).unwrap(), profile)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn corrupted_unknown_and_foreign_roots_fail_without_fallback() {
    let root = tempfile::tempdir().unwrap();
    let broken = root.path().join("broken");
    std::fs::create_dir(&broken).unwrap();
    std::fs::write(broken.join("beta-core.sqlite3"), b"not sqlite").unwrap();
    assert!(Core::open(&broken).is_err());
    let unknown = root.path().join("unknown");
    let core = Core::open(&unknown).unwrap();
    let db = Connection::open(core.database_path()).unwrap();
    drop(core);
    db.pragma_update(None, "user_version", 999).unwrap();
    assert!(matches!(
        Core::open(&unknown),
        Err(CoreError::UnsupportedSchema(999))
    ));
    let legacy = root.path().join("legacy");
    std::fs::create_dir(&legacy).unwrap();
    std::fs::write(legacy.join("events.json"), b"do not touch").unwrap();
    assert!(matches!(Core::open(&legacy), Err(CoreError::ForeignRoot)));
    assert_eq!(
        std::fs::read(legacy.join("events.json")).unwrap(),
        b"do not touch"
    );
    assert!(!legacy.join("beta-core.sqlite3").exists());
    assert!(matches!(
        Core::open(std::path::Path::new("relative")),
        Err(CoreError::InvalidRoot)
    ));
}

#[test]
fn query_failure_is_not_an_empty_collection() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let fault = Connection::open(core.database_path()).unwrap();
    fault
        .execute_batch("ALTER TABLE events RENAME TO hidden_events;")
        .unwrap();
    assert!(core.events(&context, profile).is_err());
}

#[test]
fn serialization_rejects_author_fields_and_invalid_ids() {
    assert!(serde_json::from_str::<ProfileId>("\"anonymous\"").is_err());
    assert!(serde_json::from_str::<ProfileId>("\"00000000-0000-0000-0000-000000000000\"").is_err());
    let mut input = serde_json::to_value(command(ProfileId::new())).unwrap();
    input["author"] = serde_json::json!("human");
    assert!(serde_json::from_value::<CaptureCommand>(input).is_err());
    assert!(
        "00000000-0000-0000-0000-000000000000"
            .parse::<ProfileId>()
            .is_err()
    );
}

#[cfg(windows)]
#[test]
fn read_only_database_is_rejected_without_alternate_storage() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let database = core.database_path().to_owned();
    drop(core);
    let original = std::fs::metadata(&database).unwrap().permissions();
    let mut read_only = original.clone();
    read_only.set_readonly(true);
    std::fs::set_permissions(&database, read_only).unwrap();
    let result = Core::open(root.path());
    std::fs::set_permissions(&database, original).unwrap();
    assert!(result.is_err());
    assert!(!root.path().join("events.json").exists());
}

#[test]
fn independent_roots_do_not_share_identity_or_data() {
    let parent = tempfile::tempdir().unwrap();
    let sentinel = parent.path().join("untouched.txt");
    std::fs::write(&sentinel, b"outside the data roots").unwrap();
    let a = Core::open(&parent.path().join("a")).unwrap();
    let b = Core::open(&parent.path().join("b")).unwrap();
    assert_ne!(a.device_id(), b.device_id());
    let profile = a.create_profile("same display").unwrap();
    a.submit(&a.local_human(profile).unwrap(), &command(profile))
        .unwrap();
    assert!(matches!(
        b.local_human(profile),
        Err(CoreError::UnknownProfile)
    ));
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"outside the data roots");
    assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 3);
}

#[test]
fn tag_order_and_duplicates_normalize_without_rewriting_text() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let mut input = command(profile);
    input.text = "  原文保持空白  ".to_owned();
    input.tags = vec!["b".to_owned(), "a".to_owned(), "a".to_owned()];
    core.submit(&context, &input).unwrap();
    input.tags = vec!["a".to_owned(), "b".to_owned()];
    assert!(core.submit(&context, &input).unwrap().replayed);
    let events = core.events(&context, profile).unwrap();
    assert_eq!(events[0].text, input.text);
    assert_eq!(events[0].tags, vec!["a", "b"]);
}

#[test]
#[ignore = "subprocess crash fixture; invoked only with an explicit synthetic root"]
fn crash_writer_process() {
    let root = std::env::var_os(CRASH_ROOT_ENV).expect("crash fixture root is required");
    let database = std::path::PathBuf::from(root).join("beta-core.sqlite3");
    let mut connection = Connection::open(database).unwrap();
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .unwrap();
    connection
        .pragma_update(None, "synchronous", "FULL")
        .unwrap();
    connection.pragma_update(None, "cache_size", 1).unwrap();
    connection.pragma_update(None, "cache_spill", true).unwrap();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let payload = "uncommitted process-crash fixture ".repeat(256);
    for _ in 0..64 {
        transaction
            .execute(
                "INSERT INTO profiles(id,display_name) VALUES(?1,?2)",
                rusqlite::params![ProfileId::new().to_string(), payload],
            )
            .unwrap();
    }
    // Exit only this owned test process, without Connection/Transaction Drop.
    // The tiny page cache forces dirty-page spill and a genuine hot journal.
    std::process::exit(73);
}

#[test]
fn opens_hot_rollback_journal_after_real_writer_process_crash() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("committed profile").unwrap();
    let input = command(profile);
    let original = core
        .submit(&core.local_human(profile).unwrap(), &input)
        .unwrap();
    let device = core.device_id();
    drop(core);

    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "crash_writer_process",
            "--nocapture",
        ])
        .env(CRASH_ROOT_ENV, root.path())
        .output()
        .unwrap();
    assert_eq!(
        child.status.code(),
        Some(73),
        "child stdout={} stderr={}",
        String::from_utf8_lossy(&child.stdout),
        String::from_utf8_lossy(&child.stderr)
    );
    let journal_path = root.path().join("beta-core.sqlite3-journal");
    let journal = std::fs::read(&journal_path).expect("crashed writer left a real journal");
    assert!(journal.len() > 512);
    assert_eq!(
        &journal[..8],
        &[0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]
    );

    let recovered = Core::open(root.path()).expect("SQLite must be allowed to recover its journal");
    assert_eq!(recovered.device_id(), device);
    let context = recovered.local_human(profile).unwrap();
    let events = recovered.events(&context, profile).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].text, input.text);
    let receipt = recovered.submit(&context, &input).unwrap();
    assert!(receipt.replayed);
    assert_eq!(receipt.local_seq, original.local_seq);
    let inspect = Connection::open(recovered.database_path()).unwrap();
    let profile_count: i64 = inspect
        .query_row("SELECT count(*) FROM profiles", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        profile_count, 1,
        "uncommitted profiles must not survive recovery"
    );
    assert!(!journal_path.exists());
}
