//! Schema6 -> schema7 widens only the visible fact-kind CHECK. Historical
//! JSON, digests, rowids, child FK targets and sequence watermark stay intact.
use crate::CoreError;
use rusqlite::{OptionalExtension, Transaction, params};

const EVENTS6: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1')))";
const EVENTS7: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1','agent_summary/1')))";
const INDEX: &str = "CREATE INDEX events_profile_sequence ON events(profile_id,local_seq)";
pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        tx,
        &[
            ("table", "events", EVENTS6),
            ("index", "events_profile_sequence", INDEX),
        ],
    )?;
    if tx.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0))? {
        return Err(CoreError::RecoveryRequired);
    }
    let sequence: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    tx.execute_batch("ALTER TABLE events RENAME TO events_schema6;")?;
    tx.execute_batch(EVENTS7)?;
    tx.execute_batch("INSERT INTO events(local_seq,event_id,profile_id,digest,body,kind) SELECT local_seq,event_id,profile_id,digest,body,kind FROM events_schema6 ORDER BY local_seq; DROP TABLE events_schema6;")?;
    tx.execute_batch(INDEX)?;
    tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
    if let Some((rowid, seq)) = sequence {
        tx.execute(
            "INSERT INTO sqlite_sequence(rowid,name,seq) VALUES(?1,'events',?2)",
            params![rowid, seq],
        )?;
    }
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    validate(tx)
}
pub(crate) fn validate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        tx,
        &[
            ("table", "events", EVENTS7),
            ("index", "events_profile_sequence", INDEX),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema7_event_check_preserves_history_sequence_and_child_target() {
        for populated in [false, true] {
            let mut connection = rusqlite::Connection::open_in_memory().unwrap();
            connection
                .execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY);")
                .unwrap();
            connection.execute_batch(EVENTS6).unwrap();
            connection.execute_batch(INDEX).unwrap();
            connection.execute_batch("CREATE TABLE child(event_id TEXT REFERENCES events(event_id)); INSERT INTO profiles VALUES('synthetic-P');").unwrap();
            if populated {
                connection.execute_batch("INSERT INTO events VALUES(7,'old','synthetic-P','digest','{  \"unchanged\": true }','summary/1'); INSERT INTO child VALUES('old'); INSERT INTO events VALUES(31,'removed','synthetic-P','d','{}','capture'); DELETE FROM events WHERE local_seq=31;").unwrap();
            }
            let before: Option<(i64, i64)> = connection
                .query_row(
                    "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .unwrap();
            let child: String = connection
                .query_row(
                    "SELECT sql FROM sqlite_schema WHERE name='child'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            connection
                .pragma_update(None, "foreign_keys", false)
                .unwrap();
            let tx = connection.transaction().unwrap();
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
            let after: Option<(i64, i64)> = connection
                .query_row(
                    "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .unwrap();
            assert_eq!(before, after);
            assert_eq!(
                child,
                connection
                    .query_row::<String, _, _>(
                        "SELECT sql FROM sqlite_schema WHERE name='child'",
                        [],
                        |row| row.get(0)
                    )
                    .unwrap()
            );
            if populated {
                assert_eq!(
                    connection
                        .query_row::<String, _, _>(
                            "SELECT body FROM events WHERE event_id='old'",
                            [],
                            |row| row.get(0)
                        )
                        .unwrap(),
                    "{  \"unchanged\": true }"
                );
            }
            connection
                .pragma_update(None, "foreign_keys", true)
                .unwrap();
            assert!(
                connection
                    .execute("INSERT INTO child VALUES('absent')", [])
                    .is_err()
            );
            connection.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES('external','synthetic-P','d','{}','agent_summary/1')",[]).unwrap();
            assert!(connection.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES('unknown','synthetic-P','d','{}','unknown/1')",[]).is_err());
        }
    }
    #[test]
    fn schema7_migration_refuses_a_modified_schema6_check_without_repair() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY);")
            .unwrap();
        connection
            .execute_batch(&EVENTS6.replace("'summary/1'", "'summary/1','unexpected/1'"))
            .unwrap();
        connection.execute_batch(INDEX).unwrap();
        connection.execute_batch("INSERT INTO profiles VALUES('synthetic-P'); INSERT INTO events VALUES(7,'retained','synthetic-P','d','{ \"keep\": true }','capture');").unwrap();
        connection
            .pragma_update(None, "foreign_keys", false)
            .unwrap();
        let tx = connection.transaction().unwrap();
        assert!(matches!(migrate(&tx), Err(CoreError::RecoveryRequired)));
        tx.rollback().unwrap();
        assert_eq!(
            connection
                .query_row::<String, _, _>(
                    "SELECT body FROM events WHERE event_id='retained'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            "{ \"keep\": true }"
        );
        assert!(
            !connection
                .query_row::<bool, _, _>(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='events_schema6')",
                    [],
                    |row| row.get(0)
                )
                .unwrap()
        );
    }
}
