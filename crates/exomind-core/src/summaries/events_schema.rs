//! SQLite's generalized table replacement, only within the opening migration
//! transaction. The opening connection temporarily disables FK enforcement;
//! no usable Core escapes before FK validation and restoration.
use crate::CoreError;
use rusqlite::{OptionalExtension, Transaction, params};

const LEGACY_EVENTS: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1')))";
const EVENTS: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1')))";
const INDEX: &str = "CREATE INDEX events_profile_sequence ON events(profile_id,local_seq)";

pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    // Validate the OLD domain before replacing it. A damaged schema5 is not
    // repaired by accepting summary kinds or skipping its old constraints.
    crate::replication::validate_objects(
        tx,
        &[
            ("table", "events", LEGACY_EVENTS),
            ("index", "events_profile_sequence", INDEX),
        ],
    )?;
    let enforced: bool = tx.pragma_query_value(None, "foreign_keys", |r| r.get(0))?;
    if enforced {
        return Err(CoreError::RecoveryRequired);
    }
    let sequence: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |r| r.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    // FK OFF + legacy rename leaves all child REFERENCES events clauses
    // pointing at the final public table, never events_schema5.
    tx.execute_batch("ALTER TABLE events RENAME TO events_schema5;")?;
    tx.execute_batch(EVENTS)?;
    tx.execute_batch("INSERT INTO events(local_seq,event_id,profile_id,digest,body,kind) SELECT local_seq,event_id,profile_id,digest,body,kind FROM events_schema5 ORDER BY local_seq; DROP TABLE events_schema5;")?;
    tx.execute_batch(INDEX)?;
    match sequence {
        Some((rowid, seq)) => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
            tx.execute(
                "INSERT INTO sqlite_sequence(rowid,name,seq) VALUES(?1,'events',?2)",
                params![rowid, seq],
            )?;
        }
        None => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
        }
    }
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    validate(tx)
}
pub(crate) fn validate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        tx,
        &[
            ("table", "events", EVENTS),
            ("index", "events_profile_sequence", INDEX),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expanded_check_preserves_child_binding_and_sequence_watermark() {
        for populated in [false, true] {
            let mut c = rusqlite::Connection::open_in_memory().unwrap();
            c.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY);")
                .unwrap();
            c.execute_batch(LEGACY_EVENTS).unwrap();
            c.execute_batch(INDEX).unwrap();
            c.execute_batch("CREATE TABLE child(event_id TEXT NOT NULL REFERENCES events(event_id)); INSERT INTO profiles VALUES('synthetic-P');").unwrap();
            if populated {
                c.execute_batch("INSERT INTO events VALUES(7,'event-A','synthetic-P','digest','{}','capture'); INSERT INTO events VALUES(23,'deleted-fixture-row','synthetic-P','digest','{}','capture'); DELETE FROM events WHERE local_seq=23; INSERT INTO child VALUES('event-A');").unwrap();
            }
            let before: Option<(i64, i64)> = c
                .query_row(
                    "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .unwrap();
            let child_sql: String = c
                .query_row(
                    "SELECT sql FROM sqlite_schema WHERE name='child'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            // Bundled SQLite defaults FK enforcement ON. The real opening
            // wrapper explicitly disables it BEFORE BEGIN; this direct helper
            // fixture must establish that same precondition.
            c.pragma_update(None, "foreign_keys", false).unwrap();
            assert!(
                !c.pragma_query_value::<bool, _>(None, "foreign_keys", |r| r.get(0))
                    .unwrap()
            );
            let tx = c.transaction().unwrap();
            migrate(&tx).unwrap();
            assert!(
                tx.prepare("PRAGMA foreign_key_check")
                    .unwrap()
                    .query([])
                    .unwrap()
                    .next()
                    .unwrap()
                    .is_none()
            );
            tx.commit().unwrap();
            assert_eq!(
                before,
                c.query_row(
                    "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?))
                )
                .optional()
                .unwrap()
            );
            assert_eq!(
                child_sql,
                c.query_row::<String, _, _>(
                    "SELECT sql FROM sqlite_schema WHERE name='child'",
                    [],
                    |r| r.get(0)
                )
                .unwrap()
            );
            if populated {
                assert_eq!(
                    c.query_row::<i64, _, _>(
                        "SELECT local_seq FROM events WHERE event_id='event-A'",
                        [],
                        |r| r.get(0)
                    )
                    .unwrap(),
                    7
                );
            }
            c.pragma_update(None, "foreign_keys", true).unwrap();
            assert!(
                c.execute("INSERT INTO child VALUES('missing')", [])
                    .is_err()
            );
            c.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES('summary-job','synthetic-P','digest','{}','summary_job/1')",[]).unwrap();
            c.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES('summary-result','synthetic-P','digest','{}','summary/1')",[]).unwrap();
            assert!(c.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES('unknown','synthetic-P','digest','{}','unknown/1')",[]).is_err());
        }
    }
    #[test]
    fn opening_restores_foreign_keys_after_success_and_recovery_failure() {
        let root = tempfile::tempdir().unwrap();
        let core = crate::Core::open(root.path()).unwrap();
        let path = core.database_path().to_path_buf();
        drop(core);
        let mut connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        crate::migrations::initialize(&mut connection, &path, false, None).unwrap();
        assert!(
            connection
                .pragma_query_value::<bool, _>(None, "foreign_keys", |r| r.get(0))
                .unwrap()
        );
        connection
            .execute("DROP INDEX summary_capture_range", [])
            .unwrap();
        assert!(matches!(
            crate::migrations::initialize(&mut connection, &path, false, None),
            Err(CoreError::RecoveryRequired)
        ));
        assert!(
            connection
                .pragma_query_value::<bool, _>(None, "foreign_keys", |r| r.get(0))
                .unwrap()
        );
        assert!(
            !connection
                .query_row::<bool, _, _>(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='events_schema5')",
                    [],
                    |r| r.get(0)
                )
                .unwrap()
        );
    }
}
