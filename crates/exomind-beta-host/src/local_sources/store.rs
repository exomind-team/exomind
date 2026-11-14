use super::*;
use crate::storage;
use rusqlite::limits::Limit;
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
const APPLICATION: i64 = 0x45585343;
const LAYOUT: &str = "exomind-native-sources/1";
const DATABASE: &str = "sources.sqlite3";
// A valid row fits one 256 KiB block plus its small identity fields. Limit
// SQLite values too: a damaged TEXT must not allocate an unbounded Rust String
// before a length check, or an oversized SQLite value before SQL CASE rejects it.
const MAX_SQL_VALUE_BYTES: i32 = (2 * MAX_LOCAL_SOURCE_CHUNK_BYTES) as i32;
pub(crate) struct Store {
    connection: Connection,
    path: PathBuf,
}
pub(super) struct Ticket {
    path: PathBuf,
    info: LocalSourceInfo,
}
fn unavailable<T>(_: T) -> HostError {
    HostError::LocalSourceUnavailable
}
fn corrupt<T>(_: T) -> HostError {
    HostError::LocalSourceCorrupt
}
fn read_error(error: rusqlite::Error) -> HostError {
    // An unavailable verification reader does not prove that its durable
    // bytes are corrupt. In particular CANTOPEN/IOERR/BUSY must never authorize
    // a caller to replace a healthy copy during explicit reselection.
    match error {
        rusqlite::Error::SqliteFailure(error, _) => match error.extended_code & 0xff {
            rusqlite::ffi::SQLITE_CORRUPT
            | rusqlite::ffi::SQLITE_NOTADB
            | rusqlite::ffi::SQLITE_TOOBIG
            | rusqlite::ffi::SQLITE_MISMATCH => HostError::LocalSourceCorrupt,
            _ => HostError::LocalSourceUnavailable,
        },
        rusqlite::Error::InvalidColumnType(..)
        | rusqlite::Error::FromSqlConversionFailure(..)
        | rusqlite::Error::IntegralValueOutOfRange(..)
        | rusqlite::Error::Utf8Error(_)
        | rusqlite::Error::QueryReturnedNoRows => HostError::LocalSourceCorrupt,
        _ => HostError::LocalSourceUnavailable,
    }
}
fn bound_sql_values(connection: &Connection) {
    connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_SQL_VALUE_BYTES);
}
fn check_identity(connection: &Connection, device: &str) -> Result<(), HostError> {
    let app: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(read_error)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(read_error)?;
    if app != APPLICATION || version != 1 {
        return Err(HostError::LocalSourceCorrupt);
    }
    let (stored_device, layout): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT CASE WHEN typeof(device_id)='text' AND length(device_id)=36 THEN device_id END, CASE WHEN typeof(layout)='text' AND length(layout)=?1 THEN layout END FROM identity WHERE singleton=1",
            [LAYOUT.len() as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(read_error)?;
    if stored_device.as_deref() != Some(device) || layout.as_deref() != Some(LAYOUT) {
        return Err(HostError::LocalSourceCorrupt);
    }
    Ok(())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn exists(path: &Path) -> Result<bool, HostError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(unavailable(error)),
    }
}
fn file(path: &Path) -> Result<(), HostError> {
    storage::check_private_tree(path).map_err(corrupt)?;
    if !fs::metadata(path).map_err(unavailable)?.is_file() {
        return Err(HostError::LocalSourceCorrupt);
    }
    Ok(())
}
fn status(connection: &Connection, key: &str) -> Result<Option<LocalSourceInfo>, HostError> {
    let row:Option<(u64,Option<String>,u64,u64,Option<String>)>=connection.query_row("SELECT byte_length,CASE WHEN length(sha256)=64 THEN sha256 END,next_offset,generation,CASE WHEN length(state)<=16 THEN state END FROM sources WHERE key=?1",[key],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional().map_err(read_error)?;
    row.map(|(byte_length, sha256, next_offset, generation, state)| {
        let sha256 = sha256.ok_or(HostError::LocalSourceCorrupt)?;
        let state = LocalSourceState::parse(&state.ok_or(HostError::LocalSourceCorrupt)?)?;
        let consistent = match state {
            LocalSourceState::Frozen | LocalSourceState::Ready | LocalSourceState::HashMismatch => {
                next_offset == byte_length
            }
            LocalSourceState::Released => next_offset == 0,
            LocalSourceState::Copying => {
                next_offset == byte_length || next_offset % MAX_LOCAL_SOURCE_CHUNK_BYTES as u64 == 0
            }
        };
        if byte_length > MAX_LOCAL_SOURCE_BYTES
            || next_offset > byte_length
            || generation == 0
            || sha256.len() != 64
            || !sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !consistent
        {
            return Err(HostError::LocalSourceCorrupt);
        }
        Ok(LocalSourceInfo {
            key: key.into(),
            byte_length,
            sha256,
            next_offset,
            generation,
            state,
        })
    })
    .transpose()
}
fn read_blocks(
    connection: &Connection,
    info: &LocalSourceInfo,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, HostError> {
    let end = offset
        .checked_add(length as u64)
        .ok_or(HostError::InvalidRequest)?;
    if end > info.byte_length {
        return Err(HostError::InvalidRequest);
    }
    let mut result = Vec::with_capacity(length);
    let mut position = offset;
    while position < end {
        let block =
            position / MAX_LOCAL_SOURCE_CHUNK_BYTES as u64 * MAX_LOCAL_SOURCE_CHUNK_BYTES as u64;
        let (bytes,sha):(Option<Vec<u8>>,Option<String>)=connection.query_row("SELECT CASE WHEN length(bytes)<=262144 THEN bytes END,CASE WHEN length(sha256)=64 THEN sha256 END FROM chunks WHERE key=?1 AND offset=?2",params![info.key,block],|row|Ok((row.get(0)?,row.get(1)?))).map_err(read_error)?;
        let bytes = bytes.ok_or(HostError::LocalSourceCorrupt)?;
        let sha = sha.ok_or(HostError::LocalSourceCorrupt)?;
        let expected = (info.byte_length - block).min(MAX_LOCAL_SOURCE_CHUNK_BYTES as u64) as usize;
        if bytes.len() != expected || digest(&bytes) != sha {
            return Err(HostError::LocalSourceCorrupt);
        }
        let start = (position - block) as usize;
        let take = (bytes.len() - start).min((end - position) as usize);
        result.extend_from_slice(&bytes[start..start + take]);
        position += take as u64;
    }
    Ok(result)
}
impl Store {
    pub(crate) fn open(root: &Path, device: DeviceId) -> Result<Self, HostError> {
        let directory = root.join(DIRECTORY);
        let anchor = root.join(INITIALIZED);
        let expected = format!("{LAYOUT}\n{device}\n");
        let anchored = exists(&anchor)?;
        if anchored {
            file(&anchor)?;
            if fs::metadata(&anchor).map_err(unavailable)?.len() != expected.len() as u64
                || fs::read(&anchor).map_err(unavailable)? != expected.as_bytes()
            {
                return Err(HostError::LocalSourceCorrupt);
            }
        }
        let previous = exists(&directory)?;
        if previous {
            storage::check_private_tree(&directory).map_err(corrupt)?;
            if !fs::metadata(&directory).map_err(unavailable)?.is_dir() {
                return Err(HostError::LocalSourceCorrupt);
            }
            for entry in fs::read_dir(&directory).map_err(unavailable)? {
                let entry = entry.map_err(unavailable)?;
                if !matches!(
                    entry.file_name().to_str(),
                    Some(
                        "sources.sqlite3"
                            | "sources.sqlite3-journal"
                            | "sources.sqlite3-wal"
                            | "sources.sqlite3-shm"
                    )
                ) {
                    return Err(HostError::LocalSourceCorrupt);
                }
                file(&entry.path())?;
            }
        } else if anchored {
            return Err(HostError::LocalSourceCorrupt);
        }
        let path = directory.join(DATABASE);
        let initialized = exists(&path)?;
        if initialized {
            file(&path)?;
            if fs::metadata(&path).map_err(unavailable)?.len() == 0 {
                return Err(HostError::LocalSourceCorrupt);
            }
        } else if previous || anchored {
            return Err(HostError::LocalSourceCorrupt);
        } else {
            fs::create_dir(&directory).map_err(unavailable)?;
            storage::private_path(&directory, true).map_err(unavailable)?;
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            drop(options.open(&path).map_err(unavailable)?);
        }
        let mut connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(read_error)?;
        bound_sql_values(&connection);
        connection
            .busy_timeout(Duration::from_millis(250))
            .map_err(unavailable)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(unavailable)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(unavailable)?;
        connection
            .pragma_update(None, "trusted_schema", false)
            .map_err(unavailable)?;
        if !initialized {
            connection
                .pragma_update(None, "journal_mode", "WAL")
                .map_err(unavailable)?;
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(unavailable)?;
            tx.execute_batch("CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,layout TEXT NOT NULL);CREATE TABLE sources(key TEXT PRIMARY KEY,byte_length INTEGER NOT NULL,sha256 TEXT NOT NULL,next_offset INTEGER NOT NULL,generation INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE chunks(key TEXT NOT NULL REFERENCES sources(key),offset INTEGER NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)>0 AND length(bytes)<=262144),sha256 TEXT NOT NULL,PRIMARY KEY(key,offset));CREATE TRIGGER immutable_source_chunk BEFORE UPDATE ON chunks BEGIN SELECT RAISE(ABORT,'immutable source chunk');END;").map_err(unavailable)?;
            tx.execute(
                "INSERT INTO identity VALUES(1,?1,?2)",
                params![device.to_string(), LAYOUT],
            )
            .map_err(unavailable)?;
            tx.pragma_update(None, "application_id", APPLICATION)
                .map_err(unavailable)?;
            tx.pragma_update(None, "user_version", 1)
                .map_err(unavailable)?;
            tx.commit().map_err(unavailable)?;
        }
        check_identity(&connection, &device.to_string())?;
        connection
            .prepare("SELECT key,offset,bytes,sha256 FROM chunks LIMIT 0")
            .map_err(read_error)?;
        storage::secure_private_tree(&directory).map_err(unavailable)?;
        if !anchored {
            let mut opts = OpenOptions::new();
            opts.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut handle = opts.open(&anchor).map_err(unavailable)?;
            storage::private_path(&anchor, false).map_err(unavailable)?;
            handle.write_all(expected.as_bytes()).map_err(unavailable)?;
            handle.sync_all().map_err(unavailable)?;
        }
        #[cfg(unix)]
        {
            fs::File::open(&directory)
                .and_then(|file| file.sync_all())
                .map_err(unavailable)?;
            fs::File::open(root)
                .and_then(|file| file.sync_all())
                .map_err(unavailable)?;
        }
        Ok(Self { connection, path })
    }
    pub(crate) fn status(&self, key: &str) -> Result<Option<LocalSourceInfo>, HostError> {
        status(&self.connection, key)
    }
    pub(crate) fn begin(&mut self, input: &LocalSourceBegin) -> Result<LocalSourceInfo, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let previous = status(&tx, &input.key)?;
        if let Some(old) = &previous {
            if old.byte_length != input.byte_length || old.sha256 != input.sha256 {
                return Err(HostError::LocalSourceConflict);
            }
            if old.state != LocalSourceState::Released {
                tx.commit().map_err(unavailable)?;
                return Ok(old.clone());
            }
        }
        let total: u64 = tx
            .query_row(
                "SELECT coalesce(sum(byte_length),0) FROM sources WHERE state!='released'",
                [],
                |row| row.get(0),
            )
            .map_err(read_error)?;
        if total
            .checked_add(input.byte_length)
            .is_none_or(|sum| sum > MAX_TOTAL_BYTES)
        {
            return Err(HostError::PayloadTooLarge);
        }
        if previous.is_some() {
            let remains: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM chunks WHERE key=?1)",
                    [&input.key],
                    |row| row.get(0),
                )
                .map_err(read_error)?;
            if remains {
                return Err(HostError::LocalSourceBusy);
            }
            tx.execute("UPDATE sources SET state='copying',next_offset=0,generation=generation+1 WHERE key=?1",[&input.key]).map_err(unavailable)?;
        } else {
            tx.execute(
                "INSERT INTO sources VALUES(?1,?2,?3,0,1,'copying')",
                params![input.key, input.byte_length, input.sha256],
            )
            .map_err(unavailable)?;
        }
        let info = status(&tx, &input.key)?.ok_or(HostError::LocalSourceCorrupt)?;
        tx.commit().map_err(unavailable)?;
        Ok(info)
    }
    pub(crate) fn write(
        &mut self,
        key: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<LocalSourceInfo, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let old = status(&tx, key)?.ok_or(HostError::LocalSourceIncomplete)?;
        if old.state != LocalSourceState::Copying {
            return Err(HostError::LocalSourceConflict);
        }
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or(HostError::InvalidRequest)?;
        if offset % MAX_LOCAL_SOURCE_CHUNK_BYTES as u64 != 0
            || offset > old.next_offset
            || end > old.byte_length
            || bytes.len()
                != (old.byte_length - offset).min(MAX_LOCAL_SOURCE_CHUNK_BYTES as u64) as usize
        {
            return Err(HostError::InvalidRequest);
        }
        if offset < old.next_offset {
            if end > old.next_offset || read_blocks(&tx, &old, offset, bytes.len())? != bytes {
                return Err(HostError::LocalSourceConflict);
            }
            return Ok(old);
        }
        tx.execute(
            "INSERT INTO chunks VALUES(?1,?2,?3,?4)",
            params![key, offset, bytes, digest(bytes)],
        )
        .map_err(unavailable)?;
        tx.execute(
            "UPDATE sources SET next_offset=?2,generation=generation+1 WHERE key=?1",
            params![key, end],
        )
        .map_err(unavailable)?;
        let info = status(&tx, key)?.ok_or(HostError::LocalSourceCorrupt)?;
        tx.commit().map_err(unavailable)?;
        Ok(info)
    }
    pub(super) fn freeze(&mut self, key: &str) -> Result<Ticket, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let old = status(&tx, key)?.ok_or(HostError::LocalSourceIncomplete)?;
        if old.state == LocalSourceState::HashMismatch {
            return Err(HostError::LocalSourceHashMismatch);
        }
        if old.state == LocalSourceState::Released || old.next_offset != old.byte_length {
            return Err(HostError::LocalSourceIncomplete);
        }
        if old.state == LocalSourceState::Copying {
            tx.execute(
                "UPDATE sources SET state='frozen',generation=generation+1 WHERE key=?1",
                [key],
            )
            .map_err(unavailable)?;
        }
        let info = status(&tx, key)?.ok_or(HostError::LocalSourceCorrupt)?;
        tx.commit().map_err(unavailable)?;
        Ok(Ticket {
            path: self.path.clone(),
            info,
        })
    }
    pub(super) fn seal(
        &mut self,
        ticket: &Ticket,
        actual: &str,
    ) -> Result<LocalSourceInfo, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let current = status(&tx, &ticket.info.key)?.ok_or(HostError::LocalSourceConflict)?;
        if current.generation != ticket.info.generation
            || current.sha256 != ticket.info.sha256
            || current.byte_length != ticket.info.byte_length
            || !matches!(
                current.state,
                LocalSourceState::Frozen | LocalSourceState::Ready
            )
        {
            return Err(HostError::LocalSourceConflict);
        }
        let matched = actual == current.sha256;
        if current.state == LocalSourceState::Ready && matched {
            tx.commit().map_err(unavailable)?;
            return Ok(current);
        }
        tx.execute(
            "UPDATE sources SET state=?2 WHERE key=?1",
            params![current.key, if matched { "ready" } else { "hash_mismatch" }],
        )
        .map_err(unavailable)?;
        let info = status(&tx, &current.key)?.ok_or(HostError::LocalSourceCorrupt)?;
        tx.commit().map_err(unavailable)?;
        if matched {
            Ok(info)
        } else {
            Err(HostError::LocalSourceHashMismatch)
        }
    }
    pub(crate) fn read(&self, key: &str, offset: u64, length: usize) -> Result<Vec<u8>, HostError> {
        let info = self.status(key)?.ok_or(HostError::LocalSourceIncomplete)?;
        if info.state != LocalSourceState::Ready {
            return Err(HostError::LocalSourceIncomplete);
        }
        read_blocks(&self.connection, &info, offset, length)
    }
    pub(crate) fn release(&mut self, key: &str, generation: u64) -> Result<u64, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let info = status(&tx, key)?.ok_or(HostError::LocalSourceConflict)?;
        if info.generation != generation {
            return Err(HostError::LocalSourceConflict);
        }
        tx.execute("UPDATE sources SET state='released',next_offset=0,generation=generation+1 WHERE key=?1",[key]).map_err(unavailable)?;
        let next = info.generation + 1;
        tx.commit().map_err(unavailable)?;
        Ok(next)
    }
    pub(crate) fn prune_released(&mut self, key: &str, generation: u64) -> Result<bool, HostError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let info = status(&tx, key)?.ok_or(HostError::LocalSourceConflict)?;
        if info.generation != generation || info.state != LocalSourceState::Released {
            return Err(HostError::LocalSourceConflict);
        }
        let offset: Option<u64> = tx
            .query_row(
                "SELECT offset FROM chunks WHERE key=?1 ORDER BY offset LIMIT 1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(read_error)?;
        if let Some(offset) = offset {
            tx.execute(
                "DELETE FROM chunks WHERE key=?1 AND offset=?2",
                params![key, offset],
            )
            .map_err(unavailable)?;
        }
        tx.commit().map_err(unavailable)?;
        Ok(offset.is_some())
    }
}
impl Ticket {
    pub(super) fn verify(&self, cancelled: impl Fn() -> bool) -> Result<String, HostError> {
        if cancelled() {
            return Err(HostError::Stopped);
        }
        let mut reader = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(read_error)?;
        bound_sql_values(&reader);
        reader
            .busy_timeout(Duration::from_millis(250))
            .map_err(unavailable)?;
        let parts: [String; 3] = serde_json::from_str(&self.info.key).map_err(corrupt)?;
        check_identity(&reader, &parts[0])?;
        let mut offset = 0u64;
        let mut hash = Sha256::new();
        while offset < self.info.byte_length {
            if cancelled() {
                return Err(HostError::Stopped);
            }
            let tx = reader.transaction().map_err(unavailable)?;
            let current = status(&tx, &self.info.key)?.ok_or(HostError::LocalSourceConflict)?;
            if current.generation != self.info.generation
                || current.byte_length != self.info.byte_length
                || current.sha256 != self.info.sha256
                || !matches!(
                    current.state,
                    LocalSourceState::Frozen | LocalSourceState::Ready
                )
            {
                return Err(HostError::LocalSourceConflict);
            }
            let count =
                (self.info.byte_length - offset).min(MAX_LOCAL_SOURCE_CHUNK_BYTES as u64) as usize;
            let bytes = read_blocks(&tx, &current, offset, count)?;
            tx.commit().map_err(unavailable)?;
            hash.update(&bytes);
            offset += count as u64;
        }
        if cancelled() {
            return Err(HostError::Stopped);
        }
        Ok(format!("{:x}", hash.finalize()))
    }
}

#[cfg(test)]
mod error_tests {
    use super::*;

    fn sqlite_error(code: i32) -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None)
    }

    #[test]
    fn operational_reader_failures_never_authorize_corrupt_source_recovery() {
        for code in [
            rusqlite::ffi::SQLITE_BUSY,
            rusqlite::ffi::SQLITE_LOCKED,
            rusqlite::ffi::SQLITE_CANTOPEN,
            rusqlite::ffi::SQLITE_IOERR,
            rusqlite::ffi::SQLITE_PERM,
            rusqlite::ffi::SQLITE_FULL,
            rusqlite::ffi::SQLITE_NOMEM,
            rusqlite::ffi::SQLITE_INTERRUPT,
            rusqlite::ffi::SQLITE_ABORT,
        ] {
            assert!(matches!(
                read_error(sqlite_error(code)),
                HostError::LocalSourceUnavailable
            ));
        }
        // Extended operational codes retain their primary classification.
        assert!(matches!(
            read_error(sqlite_error(rusqlite::ffi::SQLITE_IOERR_READ)),
            HostError::LocalSourceUnavailable
        ));
        for code in [
            rusqlite::ffi::SQLITE_CORRUPT,
            rusqlite::ffi::SQLITE_NOTADB,
            rusqlite::ffi::SQLITE_TOOBIG,
        ] {
            assert!(matches!(
                read_error(sqlite_error(code)),
                HostError::LocalSourceCorrupt
            ));
        }
    }
}
