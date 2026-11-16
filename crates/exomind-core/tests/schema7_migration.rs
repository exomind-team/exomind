//! Requires an immutable, genuinely retained Core6 directory. Copy first;
//! never open/modify the retained input and never downgrade a new Core7 DB.
use exomind_core::*;
use rusqlite::{Connection, OpenFlags, types::Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::Read, path::Path};

fn readonly(path: &Path) -> Connection {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .unwrap()
}
fn rows(connection: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut query = connection
        .prepare(&format!(
            "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))
        .unwrap();
    let count = query.column_count();
    query
        .query_map([], |row| {
            (0..count)
                .map(|index| row.get(index))
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
fn snapshot(connection: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let names = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let values = rows(connection, &name);
            (name, values)
        })
        .collect()
}
fn hashes(root: &Path) -> BTreeMap<String, String> {
    fs::read_dir(root)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            assert!(
                entry.file_type().unwrap().is_file() && !entry.file_type().unwrap().is_symlink()
            );
            let mut file = fs::File::open(entry.path()).unwrap();
            let mut hash = Sha256::new();
            let mut bytes = [0u8; 65536];
            loop {
                let count = file.read(&mut bytes).unwrap();
                if count == 0 {
                    break;
                }
                hash.update(&bytes[..count]);
            }
            (
                entry.file_name().to_str().unwrap().to_string(),
                format!("{:x}", hash.finalize()),
            )
        })
        .collect()
}

#[test]
#[ignore = "requires immutable real Core6 via EXOMIND_CORE_SCHEMA6_FIXTURE; run separately for retained model and original-byte fixtures"]
fn actual_schema6_upgrade_preserves_all_history_and_allows_independent_external_fact() {
    let source = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE_SCHEMA6_FIXTURE")
            .expect("explicit immutable real Core6 path"),
    );
    assert!(source.is_absolute());
    let before_hashes = hashes(&source);
    let target = tempfile::tempdir().unwrap();
    for entry in fs::read_dir(&source).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        assert!(
            [
                "beta-core.sqlite3",
                "beta-core.sqlite3-wal",
                "beta-core.sqlite3-shm",
                "beta-core.sqlite3-journal"
            ]
            .iter()
            .any(|allowed| name == *allowed)
        );
        fs::copy(entry.path(), target.path().join(name)).unwrap();
    }
    // Inspect only the copy: a read-only SQLite WAL open must never create a
    // sidecar in the retained source directory.
    let input = readonly(&target.path().join("beta-core.sqlite3"));
    assert_eq!(
        input
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        6
    );
    let expected = snapshot(&input);
    assert!(!expected["events"].is_empty());
    assert!(!expected["command_receipts"].is_empty());
    assert!(!expected["origin_entries"].is_empty());
    assert!(
        !expected["summary_nodes"].is_empty() || !expected["original_chunks"].is_empty(),
        "use real summary or original-byte history, not an empty schema"
    );
    let old_sequence = rows(&input, "sqlite_sequence");
    drop(input);
    let core = Core::open(target.path()).unwrap();
    let database = readonly(core.database_path());
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        7
    );
    for (name, values) in &expected {
        assert_eq!(
            &rows(&database, name),
            values,
            "all old rowids/values/body/BLOB/hash/receipt data must survive in {name}"
        );
    }
    assert_eq!(rows(&database, "sqlite_sequence"), old_sequence);
    assert!(
        database
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    let backups = fs::read_dir(target.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    assert!(
        backups[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("schema-6-")
    );
    let backup = readonly(&backups[0]);
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        6
    );
    assert_eq!(snapshot(&backup), expected);
    drop(backup);
    for profile in core.profiles().unwrap() {
        let human = core.local_human(profile.profile_id).unwrap();
        let mut query = OriginPageQuery {
            max_bytes: MAX_ORIGIN_PAGE_BYTES,
            ..Default::default()
        };
        loop {
            let page = core
                .export_origin_page(&human, profile.profile_id, &query)
                .unwrap();
            for entry in &page.entries {
                assert_eq!(
                    format!(
                        "{:x}",
                        Sha256::digest(entry.fact.canonical_fact_bytes().unwrap())
                    ),
                    entry.fact.digest()
                );
            }
            if !page.has_more {
                break;
            }
            query.after = Some(page.to);
            query.through = Some(page.through);
        }
    }
    let (profile,event,digest): (String,String,String)=database.query_row("SELECT profile_id,event_id,digest FROM events WHERE kind='capture' ORDER BY local_seq LIMIT 1",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
    let profile: ProfileId = profile.parse().unwrap();
    let event: EventId = event.parse().unwrap();
    let human = core.local_human(profile).unwrap();
    let observed = core
        .events_page(&human, profile, &EventQuery::default())
        .unwrap()
        .highwater;
    let producer = core
        .local_external_summary_producer(profile, AgentId::new())
        .unwrap();
    let command = ExternalSummaryAppendCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 2000,
        observed_through: observed,
        sources: vec![SummarySourceRef {
            event_id: event,
            kind: "capture".into(),
            digest,
        }],
        narrative: "Synthetic post-migration external attestation".into(),
        evidence: vec![event],
    };
    let receipt = core.append_external_summary(&producer, &command).unwrap();
    assert!(
        matches!(core.read_timeline_event(&human,profile,receipt.event_id).unwrap(),Some(TimelineItem::AgentSummary(record))if record.digest==receipt.event_digest)
    );
    drop(database);
    drop(core);
    assert_eq!(
        hashes(&source),
        before_hashes,
        "retained actual Core6 input untouched"
    );
    let reopened = Core::open(target.path()).unwrap();
    assert_eq!(
        fs::read_dir(target.path().join("backups")).unwrap().count(),
        1,
        "same version must not add backup or migrate again"
    );
    let producer = reopened
        .local_external_summary_producer(
            profile,
            producer_agent(&reopened, profile, command.event_id),
        )
        .unwrap();
    assert!(
        reopened
            .append_external_summary(&producer, &command)
            .unwrap()
            .replayed
    );
    drop(reopened);
}

fn producer_agent(core: &Core, p: ProfileId, event: EventId) -> AgentId {
    match core
        .read_timeline_event(&core.local_human(p).unwrap(), p, event)
        .unwrap()
        .unwrap()
    {
        TimelineItem::AgentSummary(record) => record.producer_agent_id,
        _ => panic!("external fact must remain typed"),
    }
}
