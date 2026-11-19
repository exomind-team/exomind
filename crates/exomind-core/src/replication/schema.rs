use crate::{CoreError, DeviceId, EventRecord, ProfileId, TimeblockNodeRecord};
use rusqlite::{Connection, OptionalExtension, Transaction, params, types::Value};

// These exact definitions are shared by migration and validation. A damaged
// same-version layout is never silently repaired or treated as a fresh store.
const OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "replication_layout",
        "CREATE TABLE replication_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout_revision INTEGER NOT NULL CHECK(layout_revision=1))",
    ),
    (
        "table",
        "original_manifests",
        "CREATE TABLE original_manifests(original_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length>=0),file_name TEXT NOT NULL,media_type TEXT NOT NULL)",
    ),
    (
        "trigger",
        "original_manifest_no_update",
        "CREATE TRIGGER original_manifest_no_update BEFORE UPDATE ON original_manifests BEGIN SELECT RAISE(ABORT,'original manifest is immutable'); END",
    ),
    (
        "trigger",
        "original_manifest_no_delete",
        "CREATE TRIGGER original_manifest_no_delete BEFORE DELETE ON original_manifests BEGIN SELECT RAISE(ABORT,'manifest release requires a later explicit lifecycle'); END",
    ),
    (
        "table",
        "event_originals",
        "CREATE TABLE event_originals(event_id TEXT NOT NULL REFERENCES events(event_id),ordinal INTEGER NOT NULL CHECK(ordinal>=0),original_id TEXT NOT NULL REFERENCES original_manifests(original_id),PRIMARY KEY(event_id,ordinal))",
    ),
    (
        "index",
        "original_fact_references",
        "CREATE INDEX original_fact_references ON event_originals(original_id)",
    ),
    (
        "table",
        "local_origin_epochs",
        "CREATE TABLE local_origin_epochs(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),restoration_epoch TEXT NOT NULL UNIQUE)",
    ),
    (
        "table",
        "origin_heads",
        "CREATE TABLE origin_heads(profile_id TEXT NOT NULL REFERENCES profiles(id),origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,head_seq INTEGER NOT NULL CHECK(head_seq>=0),head_hash TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device,restoration_epoch))",
    ),
    (
        "table",
        "origin_entries",
        "CREATE TABLE origin_entries(profile_id TEXT NOT NULL,origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,origin_seq INTEGER NOT NULL CHECK(origin_seq>0),event_id TEXT NOT NULL REFERENCES events(event_id),fact_type TEXT NOT NULL CHECK(fact_type IN ('capture/1','capture/2','timeblock/1')),digest TEXT NOT NULL,chain_hash TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device,restoration_epoch,origin_seq),UNIQUE(profile_id,origin_device,restoration_epoch,event_id),FOREIGN KEY(profile_id,origin_device,restoration_epoch) REFERENCES origin_heads(profile_id,origin_device,restoration_epoch))",
    ),
    (
        "table",
        "receive_cursors",
        "CREATE TABLE receive_cursors(profile_id TEXT NOT NULL REFERENCES profiles(id),origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,cursor_seq INTEGER NOT NULL CHECK(cursor_seq>=0),cursor_hash TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device,restoration_epoch))",
    ),
    (
        "table",
        "accepted_origin_epochs",
        "CREATE TABLE accepted_origin_epochs(profile_id TEXT NOT NULL REFERENCES profiles(id),origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device))",
    ),
    (
        "table",
        "replication_projection_status",
        "CREATE TABLE replication_projection_status(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),status TEXT NOT NULL CHECK(status IN ('complete','incomplete')),missing_parents INTEGER NOT NULL CHECK(missing_parents>=0))",
    ),
    (
        "table",
        "import_conflicts",
        "CREATE TABLE import_conflicts(conflict_id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id),origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,origin_seq INTEGER NOT NULL,event_id TEXT NOT NULL,expected_digest TEXT,received_digest TEXT NOT NULL,reason TEXT NOT NULL)",
    ),
];

pub(crate) fn migrate(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    transaction.execute_batch("DROP INDEX original_fact_references; ALTER TABLE event_originals RENAME TO event_originals_schema3;")?;
    for (_, _, definition) in OBJECTS {
        transaction.execute_batch(definition)?;
    }
    transaction.execute_batch("INSERT INTO replication_layout VALUES(1,1); INSERT INTO original_manifests SELECT original_id,profile_id,expected_sha256,byte_length,file_name,media_type FROM original_stages; INSERT INTO event_originals SELECT event_id,ordinal,original_id FROM event_originals_schema3; DROP TABLE event_originals_schema3;")?;
    let device: DeviceId = transaction
        .query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get::<_, String>(0),
        )?
        .parse()?;
    let profiles = transaction
        .prepare("SELECT id FROM profiles ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for profile in profiles {
        let profile: ProfileId = profile.parse()?;
        super::origin::provision_local_origin(transaction, profile, device)?;
        let mut statement=transaction.prepare("SELECT event_id,kind,digest,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?2 THEN body END FROM events WHERE profile_id=?1 ORDER BY local_seq")?;
        let rows =
            statement.query_map(params![profile.to_string(), crate::MAX_FACT_BYTES], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
        for row in rows {
            let (event, kind, digest, body) = row?;
            let body = body.ok_or(CoreError::RecoveryRequired)?;
            let fact_type = match kind.as_str() {
                "capture" => {
                    let record: EventRecord = serde_json::from_str(&body)?;
                    if record.device_id != device
                        || record.profile_id != profile
                        || record.event_id.to_string() != event
                        || record.digest != digest
                        || record.computed_digest()? != digest
                    {
                        return Err(CoreError::RecoveryRequired);
                    }
                    if record.originals.is_empty() {
                        "capture/1"
                    } else {
                        "capture/2"
                    }
                }
                "timeblock/1" => {
                    let node: TimeblockNodeRecord = serde_json::from_str(&body)?;
                    if node.device_id != device
                        || node.profile_id != profile
                        || node.event_id.to_string() != event
                        || node.digest != digest
                        || node.computed_digest()? != digest
                    {
                        return Err(CoreError::RecoveryRequired);
                    }
                    "timeblock/1"
                }
                _ => return Err(CoreError::RecoveryRequired),
            };
            super::origin::record_local_fact(
                transaction,
                profile,
                device,
                event.parse()?,
                fact_type,
                &digest,
            )?;
        }
        transaction.execute(
            "INSERT INTO replication_projection_status VALUES(?1,'complete',0)",
            params![profile.to_string()],
        )?;
    }
    validate_schema(transaction)
}
pub(crate) fn validate_schema(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    validate_objects(transaction, OBJECTS)?;
    let layout: (i64, i64) = transaction.query_row(
        "SELECT count(*),COALESCE(sum(CASE WHEN typeof(singleton)='integer' AND singleton=1 AND typeof(layout_revision)='integer' AND layout_revision=1 THEN 1 ELSE 0 END),0) FROM replication_layout",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if layout != (1, 1) {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}

fn summary_objects() -> Vec<(&'static str, &'static str, String)> {
    OBJECTS
        .iter()
        .map(|(kind, name, sql)| {
            (
                *kind,
                *name,
                if *name == "origin_entries" {
                    sql.replace(
                        "'capture/1','capture/2','timeblock/1'",
                        "'capture/1','capture/2','timeblock/1','summary_job/1','summary/1'",
                    )
                } else {
                    sql.to_string()
                },
            )
        })
        .collect()
}
/// Only widens the accepted fact-kind domain. Existing rowids, canonical
/// bodies, origin sequence numbers and hashes are copied byte-for-byte.
pub(crate) fn migrate_summary_facts(tx: &Transaction<'_>) -> Result<(), CoreError> {
    tx.execute_batch("ALTER TABLE origin_entries RENAME TO origin_entries_schema5;")?;
    let objects = summary_objects();
    tx.execute_batch(
        &objects
            .iter()
            .find(|(_, name, _)| *name == "origin_entries")
            .ok_or(CoreError::RecoveryRequired)?
            .2,
    )?;
    tx.execute_batch("INSERT INTO origin_entries(rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash) SELECT rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash FROM origin_entries_schema5; DROP TABLE origin_entries_schema5;")?;
    validate_summary_schema(tx)
}
pub(crate) fn validate_summary_schema(tx: &Transaction<'_>) -> Result<(), CoreError> {
    let objects = summary_objects();
    let refs = objects
        .iter()
        .map(|(kind, name, sql)| (*kind, *name, sql.as_str()))
        .collect::<Vec<_>>();
    validate_objects(tx, &refs)?;
    let valid:bool=tx.query_row("SELECT count(*)=1 AND COALESCE(sum(singleton=1 AND layout_revision=1),0)=1 FROM replication_layout",[],|r|r.get(0))?;
    if !valid {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
fn agent_summary_objects() -> Vec<(&'static str, &'static str, String)> {
    summary_objects()
        .into_iter()
        .map(|(kind, name, sql)| {
            let sql = if name == "origin_entries" {
                sql.replace(
                    "'summary_job/1','summary/1'",
                    "'summary_job/1','summary/1','agent_summary/1'",
                )
            } else {
                sql
            };
            (kind, name, sql)
        })
        .collect()
}
fn correction_objects() -> Vec<(&'static str, &'static str, String)> {
    agent_summary_objects()
        .into_iter()
        .map(|(kind, name, sql)| {
            let sql = if name == "origin_entries" {
                sql.replace(
                    "'summary/1','agent_summary/1'",
                    "'summary/1','agent_summary/1','correction/1'",
                )
            } else {
                sql
            };
            (kind, name, sql)
        })
        .collect()
}
fn original_lifecycle_objects() -> Vec<(&'static str, &'static str, String)> {
    correction_objects()
        .into_iter()
        .map(|(kind, name, sql)| {
            let sql = if name == "origin_entries" {
                sql.replace(
                    "'agent_summary/1','correction/1'",
                    "'agent_summary/1','correction/1','orig_lifecycle/1'",
                )
            } else {
                sql
            };
            (kind, name, sql)
        })
        .collect()
}
pub(crate) fn migrate_agent_summary_facts(tx: &Transaction<'_>) -> Result<(), CoreError> {
    validate_summary_schema(tx)?;
    tx.execute_batch("ALTER TABLE origin_entries RENAME TO origin_entries_schema6;")?;
    let objects = agent_summary_objects();
    tx.execute_batch(
        &objects
            .iter()
            .find(|(_, name, _)| *name == "origin_entries")
            .ok_or(CoreError::RecoveryRequired)?
            .2,
    )?;
    tx.execute_batch("INSERT INTO origin_entries(rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash) SELECT rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash FROM origin_entries_schema6; DROP TABLE origin_entries_schema6;")?;
    validate_agent_summary_schema(tx)
}
pub(crate) fn validate_agent_summary_schema(tx: &Transaction<'_>) -> Result<(), CoreError> {
    let objects = agent_summary_objects();
    let refs = objects
        .iter()
        .map(|(kind, name, sql)| (*kind, *name, sql.as_str()))
        .collect::<Vec<_>>();
    validate_objects(tx, &refs)?;
    let valid:bool=tx.query_row("SELECT count(*)=1 AND COALESCE(sum(singleton=1 AND layout_revision=1),0)=1 FROM replication_layout",[],|row|row.get(0))?;
    if !valid {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
/// Core9 adds one fact kind to the immutable origin stream. Only the accepted
/// kind domain changes; existing positions, hashes, epochs and proof rows stay
/// byte-for-byte intact.
pub(crate) fn migrate_correction_fact_type(tx: &Transaction<'_>) -> Result<(), CoreError> {
    let previous = agent_summary_objects();
    let old_origin_entries = previous
        .iter()
        .find(|(_, name, _)| *name == "origin_entries")
        .ok_or(CoreError::RecoveryRequired)?;
    validate_objects(
        tx,
        &[(
            old_origin_entries.0,
            old_origin_entries.1,
            &old_origin_entries.2,
        )],
    )?;
    if tx.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0))? {
        return Err(CoreError::RecoveryRequired);
    }
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    tx.execute_batch("ALTER TABLE origin_entries RENAME TO origin_entries_schema8;")?;
    let current = correction_objects();
    tx.execute_batch(
        &current
            .iter()
            .find(|(_, name, _)| *name == "origin_entries")
            .ok_or(CoreError::RecoveryRequired)?
            .2,
    )?;
    tx.execute_batch("INSERT INTO origin_entries(rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash) SELECT rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash FROM origin_entries_schema8; DROP TABLE origin_entries_schema8;")?;
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    let current_origin_entries = current
        .iter()
        .find(|(_, name, _)| *name == "origin_entries")
        .ok_or(CoreError::RecoveryRequired)?;
    validate_objects(
        tx,
        &[(
            current_origin_entries.0,
            current_origin_entries.1,
            &current_origin_entries.2,
        )],
    )
}

pub(crate) fn validate_correction_fact_schema(tx: &Transaction<'_>) -> Result<(), CoreError> {
    let objects = correction_objects();
    let refs = objects
        .iter()
        .map(|(kind, name, sql)| (*kind, *name, sql.as_str()))
        .collect::<Vec<_>>();
    validate_objects(tx, &refs)?;
    let valid: bool = tx.query_row(
        "SELECT count(*)=1 AND COALESCE(sum(singleton=1 AND layout_revision=1),0)=1 FROM replication_layout",
        [],
        |row| row.get(0),
    )?;
    if !valid {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}

/// Core10 widens the origin kind domain after preserving the complete Core9
/// correction schema. Existing source positions and chain hashes are copied
/// byte-for-byte; old Core9 peers are rejected by the schema handshake.
pub(crate) fn migrate_original_lifecycle_fact_type(
    tx: &Transaction<'_>,
) -> Result<(), CoreError> {
    let previous = correction_objects();
    let old = previous
        .iter()
        .find(|(_, name, _)| *name == "origin_entries")
        .ok_or(CoreError::RecoveryRequired)?;
    validate_objects(tx, &[(old.0, old.1, old.2.as_str())])?;
    if tx.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0))? {
        return Err(CoreError::RecoveryRequired);
    }
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    tx.execute_batch("ALTER TABLE origin_entries RENAME TO origin_entries_schema9;")?;
    let current = original_lifecycle_objects();
    let definition = current
        .iter()
        .find(|(_, name, _)| *name == "origin_entries")
        .ok_or(CoreError::RecoveryRequired)?;
    tx.execute_batch(&definition.2)?;
    tx.execute_batch("INSERT INTO origin_entries(rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash) SELECT rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash FROM origin_entries_schema9; DROP TABLE origin_entries_schema9;")?;
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    validate_original_lifecycle_fact_schema(tx)
}

pub(crate) fn validate_original_lifecycle_fact_schema(
    tx: &Transaction<'_>,
) -> Result<(), CoreError> {
    let objects = original_lifecycle_objects();
    let refs = objects
        .iter()
        .map(|(kind, name, sql)| (*kind, *name, sql.as_str()))
        .collect::<Vec<_>>();
    validate_objects(tx, &refs)?;
    let valid: bool = tx.query_row(
        "SELECT count(*)=1 AND COALESCE(sum(singleton=1 AND layout_revision=1),0)=1 FROM replication_layout",
        [],
        |row| row.get(0),
    )?;
    if !valid {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
pub(crate) fn validate_objects(
    connection: &Connection,
    objects: &[(&str, &str, &str)],
) -> Result<(), CoreError> {
    // A constant-sized, disposable reference gives SQLite itself authority over
    // PK order, UNIQUE indexes, nullability and composite FK interpretation. It
    // contains no business rows, does not touch disk, and cannot repair storage.
    let reference = Connection::open_in_memory()?;
    for (kind, name, definition) in objects {
        let actual: Option<Option<String>> = connection.query_row(
            "SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql END FROM sqlite_schema WHERE type=?1 AND name=?2",
            params![kind, name], |row| row.get(0),
        ).optional()?;
        if actual.flatten().as_deref() != Some(*definition) {
            return Err(CoreError::RecoveryRequired);
        }
        reference.execute_batch(definition)?;
    }
    for (kind, name, _) in objects {
        if *kind == "table" {
            for query in [
                "SELECT * FROM pragma_table_info(?1)",
                "SELECT * FROM pragma_foreign_key_list(?1)",
            ] {
                if structure_rows(connection, query, name)?
                    != structure_rows(&reference, query, name)?
                {
                    return Err(CoreError::RecoveryRequired);
                }
            }
            if unique_indexes(connection, name)? != unique_indexes(&reference, name)? {
                return Err(CoreError::RecoveryRequired);
            }
        }
    }
    Ok(())
}

fn structure_rows(
    connection: &Connection,
    query: &str,
    name: &str,
) -> Result<Vec<Vec<Value>>, CoreError> {
    let mut statement = connection.prepare(query)?;
    let columns = statement.column_count();
    let mut rows = statement.query([name])?;
    let mut result = vec![];
    while let Some(row) = rows.next()? {
        if result.len() >= 128 {
            return Err(CoreError::RecoveryRequired);
        }
        result.push(
            (0..columns)
                .map(|column| row.get(column))
                .collect::<Result<Vec<Value>, _>>()?,
        );
    }
    Ok(result)
}

type UniqueIndex = (String, i64, Vec<(i64, i64, Option<String>)>);
fn unique_indexes(connection: &Connection, table: &str) -> Result<Vec<UniqueIndex>, CoreError> {
    let mut statement=connection.prepare("SELECT CASE WHEN typeof(name)='text' AND length(CAST(name AS BLOB))<=256 THEN name END,origin,partial FROM pragma_index_list(?1) WHERE \"unique\"=1")?;
    let mut rows = statement.query([table])?;
    let mut indexes = vec![];
    while let Some(row) = rows.next()? {
        if indexes.len() >= 32 {
            return Err(CoreError::RecoveryRequired);
        }
        let name: Option<String> = row.get(0)?;
        let name = name.ok_or(CoreError::RecoveryRequired)?;
        let mut info =
            connection.prepare("SELECT seqno,cid,name FROM pragma_index_info(?1) LIMIT 129")?;
        let columns = info
            .query_map([name], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        if columns.len() > 128 {
            return Err(CoreError::RecoveryRequired);
        }
        indexes.push((row.get(1)?, row.get(2)?, columns));
    }
    indexes.sort();
    Ok(indexes)
}
