use crate::CoreError;
use rusqlite::{
    Connection, OpenFlags, TransactionBehavior,
    backup::{Backup, StepResult},
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub(crate) const SCHEMA_VERSION: i64 = 3;
pub(crate) const APPLICATION_ID: i64 = 0x45584f36;

const ORIGINAL_SCHEMA: &str = "
CREATE TABLE core_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),original_block_bytes INTEGER NOT NULL,layout_revision INTEGER NOT NULL);
INSERT INTO core_layout VALUES(1,$MAX_CHUNK_BYTES,1);
CREATE TABLE original_stages(
 stage_id TEXT PRIMARY KEY, original_id TEXT NOT NULL UNIQUE,
 profile_id TEXT NOT NULL REFERENCES profiles(id), author_id TEXT NOT NULL,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('human','agent_note')),
 expected_sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>=0),
 file_name TEXT NOT NULL, media_type TEXT NOT NULL,
 next_offset INTEGER NOT NULL CHECK(next_offset>=0 AND next_offset<=byte_length),
 generation INTEGER NOT NULL CHECK(generation>0),
 state TEXT NOT NULL CHECK(state IN ('uploading','frozen','verified','hash_mismatch')));
CREATE TABLE original_chunks(
 stage_id TEXT NOT NULL REFERENCES original_stages(stage_id),
 offset INTEGER NOT NULL CHECK(offset>=0 AND offset % $MAX_CHUNK_BYTES=0),
 bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)>0 AND length(bytes)<=$MAX_CHUNK_BYTES),
 chunk_sha256 TEXT NOT NULL CHECK(length(chunk_sha256)=64),
 PRIMARY KEY(stage_id,offset));
CREATE TABLE event_originals(
 event_id TEXT NOT NULL REFERENCES events(event_id), ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 original_id TEXT NOT NULL REFERENCES original_stages(original_id),
 PRIMARY KEY(event_id,ordinal));
CREATE INDEX original_fact_references ON event_originals(original_id);
CREATE TRIGGER original_chunks_insert_guard BEFORE INSERT ON original_chunks
 WHEN NOT EXISTS(SELECT 1 FROM original_stages WHERE stage_id=NEW.stage_id AND state='uploading'
 AND next_offset=NEW.offset AND NEW.offset+length(NEW.bytes)<=byte_length)
 BEGIN SELECT RAISE(ABORT,'original chunk is not a contiguous mutable stage'); END;
CREATE TRIGGER original_chunks_no_update BEFORE UPDATE ON original_chunks
 WHEN NOT (NEW.stage_id=OLD.stage_id AND NEW.offset=OLD.offset
 AND length(OLD.bytes)>0 AND length(OLD.bytes)<$MAX_CHUNK_BYTES
 AND typeof(NEW.bytes)='blob' AND length(NEW.bytes)>length(OLD.bytes) AND length(NEW.bytes)<=$MAX_CHUNK_BYTES
 AND substr(NEW.bytes,1,length(OLD.bytes))=OLD.bytes
 AND EXISTS(SELECT 1 FROM original_stages WHERE stage_id=OLD.stage_id AND state='uploading'
 AND next_offset=OLD.offset+length(OLD.bytes) AND OLD.offset+length(NEW.bytes)<=byte_length))
 BEGIN SELECT RAISE(ABORT,'original chunks are immutable'); END;
CREATE TRIGGER original_chunks_no_delete BEFORE DELETE ON original_chunks
 BEGIN SELECT RAISE(ABORT,'original release requires a later explicit lifecycle'); END;
CREATE TRIGGER original_identity_no_update BEFORE UPDATE OF stage_id,original_id,profile_id,author_id,author_kind,expected_sha256,byte_length,file_name,media_type ON original_stages
 BEGIN SELECT RAISE(ABORT,'original identity is immutable'); END;
";

pub(crate) fn validate_backup_directory(path: &Path) -> Result<(), CoreError> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() || !path.is_dir() {
        return Err(CoreError::ForeignRoot);
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() || entry.file_type()?.is_symlink() {
            return Err(CoreError::ForeignRoot);
        }
        let name = entry.file_name();
        let name = name.to_str().ok_or(CoreError::ForeignRoot)?;
        let name = ["-journal", "-wal", "-shm"]
            .iter()
            .find_map(|suffix| name.strip_suffix(suffix))
            .unwrap_or(name);
        let id = name
            .strip_prefix("schema-1-")
            .or_else(|| name.strip_prefix("schema-2-"))
            .and_then(|name| name.strip_suffix(".sqlite3"))
            .ok_or(CoreError::ForeignRoot)?;
        if Uuid::parse_str(id)
            .map_err(|_| CoreError::ForeignRoot)?
            .is_nil()
        {
            return Err(CoreError::ForeignRoot);
        }
    }
    Ok(())
}

fn private(path: &Path, directory: bool) -> Result<(), CoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            path,
            fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
        )?;
    }
    #[cfg(not(unix))]
    let _ = (path, directory);
    Ok(())
}

fn snapshot_digest(connection: &Connection) -> Result<Vec<u8>, CoreError> {
    use rusqlite::types::ValueRef;
    let mut digest = Sha256::new();
    let mut definitions = connection
        .prepare("SELECT type,name,COALESCE(sql,'') FROM sqlite_master ORDER BY type,name")?;
    let definitions = definitions
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (kind, name, sql) in definitions {
        for value in [kind, name, sql] {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
    }
    // Verify all source tables, including staged bytes, reference rows and
    // SQLite's sequence state, not only the four original schema-1 tables.
    let mut schema=connection.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name")?;
    let tables = schema
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (name, sql) in tables {
        digest.update(sql.as_bytes());
        let query = format!(
            "SELECT * FROM \"{}\" ORDER BY rowid",
            name.replace('"', "\"\"")
        );
        digest.update(query.as_bytes());
        let mut statement = connection.prepare(&query)?;
        let columns = statement.column_count();
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            digest.update([0xff]);
            for column in 0..columns {
                match row.get_ref(column)? {
                    ValueRef::Null => digest.update([0]),
                    ValueRef::Integer(value) => {
                        digest.update([1]);
                        digest.update(value.to_le_bytes());
                    }
                    ValueRef::Real(value) => {
                        digest.update([2]);
                        digest.update(value.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(value) => {
                        digest.update([3]);
                        digest.update((value.len() as u64).to_le_bytes());
                        digest.update(value);
                    }
                    ValueRef::Blob(value) => {
                        digest.update([4]);
                        digest.update((value.len() as u64).to_le_bytes());
                        digest.update(value);
                    }
                }
            }
        }
    }
    Ok(digest.finalize().to_vec())
}

// The caller holds BEGIN IMMEDIATE on the main connection before this read-only
// source is opened. No writer can change the schema-1 snapshot between backup
// and migration; using another connection avoids backing up a write transaction.
fn backup_schema(database_path: &Path, expected_version: i64) -> Result<(), CoreError> {
    let directory = database_path
        .parent()
        .ok_or(CoreError::InvalidRoot)?
        .join("backups");
    if directory.exists() {
        validate_backup_directory(&directory)?;
    } else {
        fs::create_dir(&directory)?;
        private(&directory, true)?;
    }
    let path = directory.join(format!(
        "schema-{expected_version}-{}.sqlite3",
        Uuid::new_v4()
    ));
    // Reserve without replacing an existing backup. A failed partial backup is
    // retained for explicit inspection, never silently removed or restored.
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?
        .sync_all()?;
    private(&path, false)?;
    let source = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.busy_timeout(Duration::from_secs(5))?;
    let mut destination = Connection::open(&path)?;
    destination.pragma_update(None, "synchronous", "FULL")?;
    {
        let backup = Backup::new(&source, &mut destination)?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            match backup.step(128)? {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    if Instant::now() >= deadline {
                        return Err(CoreError::BackupVerification);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => return Err(CoreError::BackupVerification),
            }
        }
    }
    // Online backup can copy the source's WAL journal-mode header. A retained
    // backup must restore from this one file, including when opened read-only;
    // checkpoint its own sidecars and persist DELETE mode before validation.
    let checkpoint: (i64, i64, i64) =
        destination.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if checkpoint.0 != 0 {
        return Err(CoreError::BackupVerification);
    }
    destination.pragma_update(None, "journal_mode", "DELETE")?;
    let mode: String = destination.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if mode != "delete" {
        return Err(CoreError::BackupVerification);
    }
    let version: i64 = destination.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application: i64 =
        destination.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let integrity: String =
        destination.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if version != expected_version || application != APPLICATION_ID || integrity != "ok" {
        return Err(CoreError::BackupVerification);
    }
    if snapshot_digest(&source)? != snapshot_digest(&destination)? {
        return Err(CoreError::BackupVerification);
    }
    destination
        .close()
        .map_err(|(_, error)| CoreError::Storage(error))?;
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}

pub(crate) fn initialize(
    connection: &mut Connection,
    database_path: &Path,
    allow_initialization: bool,
    expected_device: Option<crate::DeviceId>,
) -> Result<(), CoreError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application: i64 =
        transaction.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if ![0, 1, 2, SCHEMA_VERSION].contains(&version) {
        return Err(CoreError::UnsupportedSchema(version));
    }
    if application != 0 && application != APPLICATION_ID {
        return Err(CoreError::ForeignDatabase);
    }
    if let Some(expected_device) = expected_device {
        let stored: Result<String, _> = transaction.query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get(0),
        );
        if !matches!(stored,Ok(value) if value==expected_device.to_string()) {
            return Err(CoreError::RecoveryRequired);
        }
    }
    if version == 0 {
        if application != 0 {
            return Err(CoreError::ForeignDatabase);
        }
        let tables: i64 = transaction.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        if tables != 0 {
            return Err(CoreError::ForeignDatabase);
        }
        if !allow_initialization {
            return Err(CoreError::RecoveryRequired);
        }
        transaction.execute_batch("CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,human_author TEXT NOT NULL); CREATE TABLE profiles(id TEXT PRIMARY KEY,display_name TEXT NOT NULL); CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE command_receipts(command_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),input_digest TEXT NOT NULL,receipt TEXT NOT NULL); CREATE INDEX events_profile_sequence ON events(profile_id,local_seq);")?;
        transaction.execute(
            "INSERT INTO identity VALUES(1,?1,?2)",
            rusqlite::params![
                crate::DeviceId::new().to_string(),
                Uuid::new_v4().to_string()
            ],
        )?;
        transaction.pragma_update(None, "application_id", APPLICATION_ID)?;
    } else if application != APPLICATION_ID {
        return Err(CoreError::ForeignDatabase);
    }
    if version >= 2 {
        // Schema 2 has not shipped. Its earlier synthetic fragmented layout
        // must not be silently interpreted as the bounded fixed-block format.
        // Keep the original bytes/facts untouched for explicit inspection.
        let layout: Result<(i64, i64), _> = transaction.query_row(
            "SELECT original_block_bytes,layout_revision FROM core_layout WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        if !matches!(layout,Ok((size,1)) if size==crate::MAX_ORIGINAL_CHUNK_BYTES as i64) {
            return Err(CoreError::RecoveryRequired);
        }
    }
    if version == 1 || version == 2 {
        backup_schema(database_path, version)?;
    }
    if version < 2 {
        transaction.execute_batch(&ORIGINAL_SCHEMA.replace(
            "$MAX_CHUNK_BYTES",
            &crate::MAX_ORIGINAL_CHUNK_BYTES.to_string(),
        ))?;
    }
    if version<3 {transaction.execute_batch(crate::timeblocks::SCHEMA)?;transaction.pragma_update(None,"user_version",SCHEMA_VERSION)?;}
    else if transaction.prepare("SELECT e.kind,s.revision,n.request_digest FROM events e LEFT JOIN timeblock_state s ON s.profile_id=e.profile_id LEFT JOIN timeblock_nodes n ON n.event_id=e.event_id LIMIT 0").is_err(){return Err(CoreError::RecoveryRequired);}
    transaction.commit()?;
    Ok(())
}
