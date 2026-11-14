//! Private native UI recovery state. This is neither a Core fact store nor an
//! HTTP resource. The Host gate owns its connection and all qualification.
use crate::{BetaHost, HostError, Session, storage};
use exomind_core::{Core, DeviceId, ProfileId};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::de::IgnoredAny;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::Duration,
};

pub(crate) const DIRECTORY: &str = "private-ui";
pub(crate) const INITIALIZED: &str = "private-ui.initialized";
const DATABASE: &str = "intent.sqlite3";
const APPLICATION: i64 = 0x4558494e;
const SCHEMA: i64 = 1;
const LAYOUT: &str = "exomind-native-local-intent/1";
const CAPTURE_PREFIX: &str = "exomind:beta:drafts:";
const TIMEBLOCK_PREFIX: &str = "exomind:beta:timeblocks:";
const MAX_RAW_BYTES: usize = 8 * 1024 * 1024;
const MAX_KEY_BYTES: usize = 256;
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);

pub(crate) struct Store {
    connection: Connection,
}

fn corrupt<T>(_: T) -> HostError {
    HostError::IntentCacheCorrupt
}
fn unavailable<T>(_: T) -> HostError {
    HostError::IntentCacheUnavailable
}
fn sql_error(error: rusqlite::Error) -> HostError {
    match error {
        rusqlite::Error::SqliteFailure(code, _)
            if matches!(
                code.code,
                rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
            ) =>
        {
            HostError::IntentCacheCorrupt
        }
        _ => HostError::IntentCacheUnavailable,
    }
}
fn raw_is_valid(raw: &str) -> bool {
    raw.len() <= MAX_RAW_BYTES && serde_json::from_str::<IgnoredAny>(raw).is_ok()
}
fn hash(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

fn validate_key(key: &str, device: DeviceId, core: &Core) -> Result<(), HostError> {
    if key.len() > MAX_KEY_BYTES {
        return Err(HostError::InvalidRequest);
    }
    if key == format!("{CAPTURE_PREFIX}{device}") {
        return Ok(());
    }
    let encoded = key
        .strip_prefix(TIMEBLOCK_PREFIX)
        .ok_or(HostError::InvalidRequest)?;
    let pair: [String; 2] = serde_json::from_str(encoded).map_err(|_| HostError::InvalidRequest)?;
    if serde_json::to_string(&pair).map_err(|_| HostError::InvalidRequest)? != encoded {
        return Err(HostError::InvalidRequest);
    }
    if pair[0] != device.to_string() {
        return Err(HostError::Forbidden);
    }
    let profile: ProfileId = pair[1].parse().map_err(|_| HostError::InvalidRequest)?;
    if pair[1] != profile.to_string()
        || !core
            .profiles()?
            .iter()
            .any(|item| item.profile_id == profile)
    {
        return Err(HostError::Forbidden);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc};

    #[test]
    fn a_local_intent_waiting_for_the_host_gate_loses_admission_after_request_stop() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("host");
        let host = Arc::new(BetaHost::open(&root).unwrap());
        let owner = host.owner_session().unwrap();
        let key = format!("{CAPTURE_PREFIX}{}", host.status().unwrap().device_id);
        host.write_local_intent(&owner, &key, "{\"draft\":\"before stop\"}")
            .unwrap();
        let gate = host.gate.lock().unwrap();
        let queued_host = host.clone();
        let queued_key = key.clone();
        let (started, waiting) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            queued_host.write_local_intent(&owner, &queued_key, "{\"late\":true}")
        });
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        host.request_stop();
        drop(gate);
        assert!(matches!(worker.join().unwrap(), Err(HostError::Stopped)));
        host.stop().unwrap();
        let reopened = BetaHost::open(&root).unwrap();
        assert_eq!(
            reopened
                .read_local_intent(&reopened.owner_session().unwrap(), &key)
                .unwrap()
                .as_deref(),
            Some("{\"draft\":\"before stop\"}")
        );
    }
}

fn exists(path: &Path) -> Result<bool, HostError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(unavailable(error)),
    }
}
fn check_file(path: &Path) -> Result<(), HostError> {
    storage::check_private_tree(path).map_err(corrupt)?;
    if !fs::symlink_metadata(path).map_err(unavailable)?.is_file() {
        return Err(HostError::IntentCacheCorrupt);
    }
    Ok(())
}
fn check_directory(path: &Path) -> Result<(), HostError> {
    storage::check_private_tree(path).map_err(corrupt)?;
    if !fs::symlink_metadata(path).map_err(unavailable)?.is_dir() {
        return Err(HostError::IntentCacheCorrupt);
    }
    for entry in fs::read_dir(path).map_err(unavailable)? {
        let entry = entry.map_err(unavailable)?;
        if !matches!(
            entry.file_name().to_str(),
            Some(
                "intent.sqlite3"
                    | "intent.sqlite3-journal"
                    | "intent.sqlite3-wal"
                    | "intent.sqlite3-shm"
            )
        ) {
            return Err(HostError::IntentCacheCorrupt);
        }
        check_file(&entry.path())?;
    }
    Ok(())
}
fn anchor_bytes(device: DeviceId) -> String {
    format!("{LAYOUT}\n{device}\n")
}
fn validate_anchor(path: &Path, device: DeviceId) -> Result<(), HostError> {
    check_file(path)?;
    let expected = anchor_bytes(device);
    if fs::metadata(path).map_err(unavailable)?.len() != expected.len() as u64
        || fs::read(path).map_err(unavailable)? != expected.as_bytes()
    {
        return Err(HostError::IntentCacheCorrupt);
    }
    Ok(())
}
fn write_anchor(path: &Path, device: DeviceId) -> Result<(), HostError> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(unavailable)?;
    storage::private_path(path, false).map_err(unavailable)?;
    file.write_all(anchor_bytes(device).as_bytes())
        .map_err(unavailable)?;
    file.sync_all().map_err(unavailable)
}

fn sync_directory(path: &Path) -> Result<(), HostError> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(unavailable)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

impl Store {
    pub(crate) fn open(root: &Path, device: DeviceId) -> Result<Self, HostError> {
        let directory = root.join(DIRECTORY);
        let anchor = root.join(INITIALIZED);
        let anchored = exists(&anchor)?;
        if anchored {
            validate_anchor(&anchor, device)?;
        }
        let directory_existed = exists(&directory)?;
        if directory_existed {
            check_directory(&directory)?;
        } else if anchored {
            return Err(HostError::IntentCacheCorrupt);
        }
        let path = directory.join(DATABASE);
        let initialized = exists(&path)?;
        if initialized {
            check_file(&path)?;
            if fs::metadata(&path).map_err(unavailable)?.len() == 0 {
                return Err(HostError::IntentCacheCorrupt);
            }
        } else if anchored || directory_existed {
            // A directory/sidecar without a complete DB is initialization or
            // recovery evidence, never permission to create an empty cache.
            return Err(HostError::IntentCacheCorrupt);
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
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        let mut connection = Connection::open_with_flags(&path, flags).map_err(sql_error)?;
        connection.busy_timeout(BUSY_TIMEOUT).map_err(sql_error)?;
        connection
            .pragma_update(None, "trusted_schema", false)
            .map_err(sql_error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(sql_error)?;
        if !initialized {
            connection
                .pragma_update(None, "journal_mode", "DELETE")
                .map_err(sql_error)?;
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            transaction.execute_batch("CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,layout TEXT NOT NULL); CREATE TABLE intents(key TEXT PRIMARY KEY,raw TEXT NOT NULL,sha256 TEXT NOT NULL CHECK(length(sha256)=64));").map_err(sql_error)?;
            transaction
                .execute(
                    "INSERT INTO identity VALUES(1,?1,?2)",
                    params![device.to_string(), LAYOUT],
                )
                .map_err(sql_error)?;
            transaction
                .pragma_update(None, "application_id", APPLICATION)
                .map_err(sql_error)?;
            transaction
                .pragma_update(None, "user_version", SCHEMA)
                .map_err(sql_error)?;
            transaction.commit().map_err(sql_error)?;
        }
        Self::validate(&connection, device)?;
        storage::secure_private_tree(&directory).map_err(unavailable)?;
        // Persist the new SQLite directory entry before acknowledging the
        // external anchor. A file flush alone does not flush its parent entry.
        sync_directory(&directory)?;
        if !anchored {
            // SQLite initialization and the external loss-detection anchor are
            // not one atomic operation. A complete, bound DB without an anchor
            // may finish initialization; an anchor with no DB must fail closed.
            write_anchor(&anchor, device)?;
        } else {
            storage::private_path(&anchor, false).map_err(unavailable)?;
        }
        sync_directory(root)?;
        Ok(Self { connection })
    }

    fn validate(connection: &Connection, device: DeviceId) -> Result<(), HostError> {
        let application: i64 = connection
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .map_err(corrupt)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(corrupt)?;
        let journal: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(corrupt)?;
        if application != APPLICATION || version != SCHEMA || journal != "delete" {
            return Err(HostError::IntentCacheCorrupt);
        }
        let identity: (String, String) = connection
            .query_row(
                "SELECT device_id,layout FROM identity WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(corrupt)?;
        if identity != (device.to_string(), LAYOUT.to_string()) {
            return Err(HostError::IntentCacheCorrupt);
        }
        let integrity: String = connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
            .map_err(corrupt)?;
        if integrity != "ok" {
            return Err(HostError::IntentCacheCorrupt);
        }
        let tables: i64 = connection.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |row| row.get(0)).map_err(corrupt)?;
        if tables != 2 {
            return Err(HostError::IntentCacheCorrupt);
        }
        // Force column/schema validation even for an empty, recognized DB.
        connection
            .prepare("SELECT key,raw,sha256 FROM intents LIMIT 0")
            .map_err(corrupt)?;
        Ok(())
    }

    fn read(&self, key: &str) -> Result<Option<String>, HostError> {
        let row: Option<(i64, Option<String>, String)> = self.connection.query_row("SELECT length(CAST(raw AS BLOB)),CASE WHEN length(CAST(raw AS BLOB))<=?2 THEN raw ELSE NULL END,sha256 FROM intents WHERE key=?1", params![key, MAX_RAW_BYTES as i64], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional().map_err(sql_error)?;
        let Some((length, raw, stored_hash)) = row else {
            return Ok(None);
        };
        let raw = raw.ok_or(HostError::IntentCacheCorrupt)?;
        if length < 0
            || length as usize != raw.len()
            || !raw_is_valid(&raw)
            || stored_hash != hash(&raw)
        {
            return Err(HostError::IntentCacheCorrupt);
        }
        Ok(Some(raw))
    }

    fn write(&mut self, key: &str, raw: &str) -> Result<(), HostError> {
        // Never erase an unreadable fixed command by replacing its corrupt row.
        self.read(key)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        transaction.execute("INSERT INTO intents(key,raw,sha256) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET raw=excluded.raw,sha256=excluded.sha256", params![key, raw, hash(raw)]).map_err(sql_error)?;
        transaction.commit().map_err(sql_error)
    }
}

impl BetaHost {
    /// Read private UI intent for this device, from trusted owner embedding.
    /// No HTTP handler exposes this method. Missing data and recovery errors
    /// stay distinct; reads may lazily initialize a never-created cache.
    pub fn read_local_intent(
        &self,
        owner: &Session,
        key: &str,
    ) -> Result<Option<String>, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        if resources.local_intents.is_none() {
            resources.local_intents =
                Some(Store::open(&resources.persistence.root, self.device_id)?);
        }
        resources
            .local_intents
            .as_ref()
            .ok_or(HostError::IntentCacheUnavailable)?
            .read(key)
    }

    /// Acknowledge only after a FULL SQLite transaction commits the complete
    /// opaque JSON snapshot. No event, sequence, grant or remote write is made.
    pub fn write_local_intent(
        &self,
        owner: &Session,
        key: &str,
        raw: &str,
    ) -> Result<(), HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        if raw.len() > MAX_RAW_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        if !raw_is_valid(raw) {
            return Err(HostError::InvalidRequest);
        }
        if resources.local_intents.is_none() {
            resources.local_intents =
                Some(Store::open(&resources.persistence.root, self.device_id)?);
        }
        resources
            .local_intents
            .as_mut()
            .ok_or(HostError::IntentCacheUnavailable)?
            .write(key, raw)
    }
}
