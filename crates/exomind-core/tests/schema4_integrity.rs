use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, Core, CoreError, EventId, OriginalId, StageId,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

fn contents(db: &Connection) -> Vec<Vec<rusqlite::types::Value>> {
    // Preserve business content independently of the shape deliberately damaged
    // below. No generated SQL or assertion reproduces Core's schema validator.
    let mut values = vec![];
    for table in [
        "identity",
        "profiles",
        "events",
        "command_receipts",
        "original_manifests",
        "original_stages",
        "origin_heads",
        "origin_entries",
        "local_origin_epochs",
    ] {
        let mut statement = db
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let count = statement.column_count();
        let mut rows = statement.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            values.push((0..count).map(|column| row.get(column).unwrap()).collect());
        }
    }
    values
}

fn refuses_damaged_schema_without_reinitializing(damage: &str) {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core
        .create_profile("schema integrity retained content")
        .unwrap();
    let human = core.local_human(profile).unwrap();
    core.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1794000000000,
            text: "do not reset a damaged schema".into(),
            tags: vec!["retained".into()],
            originals: vec![],
        },
    )
    .unwrap();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: StageId::new(),
            original_id: OriginalId::new(),
            profile_id: profile,
            expected_sha256: format!("{:x}", Sha256::digest(b"retained private draft")),
            byte_length: 22,
            file_name: "retained.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    )
    .unwrap();
    let path = core.database_path().to_path_buf();
    drop(core);
    let db = Connection::open(&path).unwrap();
    db.execute_batch(damage).unwrap();
    let before = contents(&db);
    drop(db);
    assert!(
        matches!(
            Core::open(directory.path()),
            Err(CoreError::RecoveryRequired)
        ),
        "same-version weakened schema must require explicit recovery"
    );
    let db = Connection::open(&path).unwrap();
    assert_eq!(contents(&db), before, "refusal preserves original data");
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        4
    );
}

#[test]
fn missing_manifest_immutable_trigger_requires_recovery_without_repair() {
    refuses_damaged_schema_without_reinitializing("DROP TRIGGER original_manifest_no_update;");
}

#[test]
fn same_columns_without_origin_event_uniqueness_require_recovery() {
    refuses_damaged_schema_without_reinitializing("
        PRAGMA foreign_keys=OFF;
        ALTER TABLE origin_entries RENAME TO weakened_origin_entries;
        CREATE TABLE origin_entries(profile_id TEXT NOT NULL,origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,origin_seq INTEGER NOT NULL CHECK(origin_seq>0),event_id TEXT NOT NULL REFERENCES events(event_id),fact_type TEXT NOT NULL CHECK(fact_type IN ('capture/1','capture/2','timeblock/1')),digest TEXT NOT NULL,chain_hash TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device,restoration_epoch,origin_seq),FOREIGN KEY(profile_id,origin_device,restoration_epoch) REFERENCES origin_heads(profile_id,origin_device,restoration_epoch));
        INSERT INTO origin_entries SELECT * FROM weakened_origin_entries;
        DROP TABLE weakened_origin_entries;
    ");
}

#[test]
fn plausible_first_layout_row_does_not_hide_duplicate_layout_records() {
    refuses_damaged_schema_without_reinitializing(
        "
        DROP TABLE replication_layout;
        CREATE TABLE replication_layout(singleton INTEGER,layout_revision INTEGER NOT NULL);
        INSERT INTO replication_layout VALUES(1,1),(1,1);
    ",
    );
}

#[test]
fn intact_layout_definition_with_an_extra_corrupt_row_requires_recovery() {
    // A diagnostic/import tool can bypass CHECKs while leaving exact DDL intact.
    refuses_damaged_schema_without_reinitializing(
        "
        PRAGMA ignore_check_constraints=ON;
        INSERT INTO replication_layout VALUES(2,1);
        PRAGMA ignore_check_constraints=OFF;
    ",
    );
}
