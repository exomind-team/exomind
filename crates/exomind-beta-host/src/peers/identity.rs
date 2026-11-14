use crate::{HostError, storage};
use exomind_core::DeviceId;
use ring::{rand::SystemRandom, signature::Ed25519KeyPair};
use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    sign::CertifiedKey,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::Arc,
    time::Duration,
};
pub(crate) const DIRECTORY: &str = "private-peer-identity";
pub(crate) const INITIALIZED: &str = "peer-identity.initialized";
const DATABASE: &str = "identity.sqlite3";
const LAYOUT: &str = "exomind-device-key/1";
const APPLICATION: i64 = 0x45585049;
const MAX_KEY_BYTES: usize = 256;
const MAX_SQL_VALUE_BYTES: i32 = 4096;
const IDENTITY_SCHEMA: &str = "CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,layout TEXT NOT NULL,key_pkcs8 BLOB NOT NULL,spki BLOB NOT NULL,pin TEXT NOT NULL,initialized INTEGER NOT NULL CHECK(initialized IN (0,1)))";
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeviceIdentityInfo {
    pub device_id: DeviceId,
    pub spki_der: Vec<u8>,
    pub fingerprint_sha256: String,
}
// No Debug/Serialize for secret-bearing state. This database is Host-private,
// outside Core and its ordinary data backups/exports.
pub(crate) struct Identity {
    pub(super) info: DeviceIdentityInfo,
    pub(super) certified: Arc<CertifiedKey>,
}
fn unavailable<T>(_: T) -> HostError {
    HostError::PeerIdentityUnavailable
}
fn recovery<T>(_: T) -> HostError {
    HostError::PeerIdentityRecoveryRequired
}
fn database(error: rusqlite::Error) -> HostError {
    match error {
        rusqlite::Error::SqliteFailure(ref code, _)
            if matches!(
                code.code,
                rusqlite::ErrorCode::DatabaseBusy
                    | rusqlite::ErrorCode::DatabaseLocked
                    | rusqlite::ErrorCode::SystemIoFailure
                    | rusqlite::ErrorCode::ReadOnly
                    | rusqlite::ErrorCode::PermissionDenied
                    | rusqlite::ErrorCode::CannotOpen
                    | rusqlite::ErrorCode::DiskFull
            ) =>
        {
            HostError::PeerIdentityUnavailable
        }
        _ => HostError::PeerIdentityRecoveryRequired,
    }
}
fn private_tree(path: &Path) -> Result<(), HostError> {
    storage::check_private_tree(path).map_err(|error| match error {
        HostError::Filesystem(_) | HostError::PrivatePermissions => {
            HostError::PeerIdentityUnavailable
        }
        _ => HostError::PeerIdentityRecoveryRequired,
    })
}
pub(super) fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn valid_spki(bytes: &[u8]) -> bool {
    bytes.len() == 44 && bytes[..12] == [0x30, 0x2a, 0x30, 5, 6, 3, 0x2b, 0x65, 0x70, 3, 0x21, 0]
}
fn exists(path: &Path) -> Result<bool, HostError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(unavailable(error)),
    }
}
fn check_file(path: &Path) -> Result<(), HostError> {
    private_tree(path)?;
    if !fs::metadata(path).map_err(unavailable)?.is_file() {
        return Err(HostError::PeerIdentityRecoveryRequired);
    }
    Ok(())
}
fn certified(raw: &[u8]) -> Result<Arc<CertifiedKey>, HostError> {
    if raw.len() > MAX_KEY_BYTES {
        return Err(HostError::PeerIdentityRecoveryRequired);
    }
    Ed25519KeyPair::from_pkcs8(raw).map_err(recovery)?;
    let key = rustls::crypto::ring::sign::any_supported_type(&PrivateKeyDer::Pkcs8(
        PrivatePkcs8KeyDer::from(raw.to_vec()),
    ))
    .map_err(recovery)?;
    let spki = key
        .public_key()
        .ok_or(HostError::PeerIdentityRecoveryRequired)?
        .as_ref()
        .to_vec();
    if !valid_spki(&spki) {
        return Err(HostError::PeerIdentityRecoveryRequired);
    }
    Ok(Arc::new(CertifiedKey::new(
        vec![CertificateDer::from(spki)],
        key,
    )))
}
fn anchor(info: &DeviceIdentityInfo) -> String {
    format!(
        "{LAYOUT}\n{}\n{}\n",
        info.device_id, info.fingerprint_sha256
    )
}
fn sync_directory(path: &Path) -> Result<(), HostError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|handle| handle.sync_all())
            .map_err(unavailable)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
impl Identity {
    pub(crate) fn has_evidence(root: &Path) -> Result<bool, HostError> {
        Ok(exists(&root.join(DIRECTORY))? || exists(&root.join(INITIALIZED))?)
    }
    pub(crate) fn open(root: &Path, device: DeviceId) -> Result<Self, HostError> {
        let directory = root.join(DIRECTORY);
        let marker = root.join(INITIALIZED);
        let previous = exists(&directory)?;
        let marked = exists(&marker)?;
        if previous {
            private_tree(&directory)?;
            if !fs::metadata(&directory).map_err(unavailable)?.is_dir() {
                return Err(HostError::PeerIdentityRecoveryRequired);
            }
            for entry in fs::read_dir(&directory).map_err(unavailable)? {
                let entry = entry.map_err(unavailable)?;
                if !matches!(
                    entry.file_name().to_str(),
                    Some("identity.sqlite3" | "identity.sqlite3-journal")
                ) {
                    return Err(HostError::PeerIdentityRecoveryRequired);
                }
                check_file(&entry.path())?;
            }
        } else if marked {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        let path = directory.join(DATABASE);
        let initialized = exists(&path)?;
        if initialized {
            check_file(&path)?;
            if fs::metadata(&path).map_err(unavailable)?.len() == 0 {
                return Err(HostError::PeerIdentityRecoveryRequired);
            }
        } else if previous || marked {
            return Err(HostError::PeerIdentityRecoveryRequired);
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
        let mut db = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(database)?;
        // SQL CASE bounds Rust copies; SQLite's own row decoding must also be
        // bounded before reading a damaged private database/schema.
        db.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
            MAX_SQL_VALUE_BYTES,
        );
        db.busy_timeout(Duration::from_millis(250))
            .map_err(database)?;
        db.pragma_update(None, "synchronous", "FULL")
            .map_err(database)?;
        db.pragma_update(None, "trusted_schema", false)
            .map_err(database)?;
        if !initialized {
            db.pragma_update(None, "journal_mode", "DELETE")
                .map_err(unavailable)?;
            let document =
                Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(unavailable)?;
            let signing = certified(document.as_ref())?;
            let spki = signing.cert[0].as_ref();
            let pin = fingerprint(spki);
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(unavailable)?;
            tx.execute_batch(IDENTITY_SCHEMA).map_err(unavailable)?;
            tx.execute(
                "INSERT INTO identity VALUES(1,?1,?2,?3,?4,?5,0)",
                params![device.to_string(), LAYOUT, document.as_ref(), spki, pin],
            )
            .map_err(unavailable)?;
            tx.pragma_update(None, "application_id", APPLICATION)
                .map_err(unavailable)?;
            tx.pragma_update(None, "user_version", 1)
                .map_err(unavailable)?;
            tx.commit().map_err(unavailable)?;
        }
        let app: i64 = db
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .map_err(database)?;
        let version: i64 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(database)?;
        if app != APPLICATION || version != 1 {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        let journal: String = db
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(database)?;
        let (objects, schema): (i64, Option<String>) = db.query_row(
            "SELECT count(*), CASE WHEN count(*)=1 AND length(sql)<=1024 THEN sql END FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(database)?;
        if journal != "delete" || objects != 1 || schema.as_deref() != Some(IDENTITY_SCHEMA) {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        let rows: i64 = db
            .query_row(
                "SELECT count(*) FROM (SELECT 1 FROM identity LIMIT 2)",
                [],
                |row| row.get(0),
            )
            .map_err(database)?;
        if rows != 1 {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        // Bound all variable data before allocating into Rust, including a
        // corrupted private database. Initialized=0 is a durable bootstrap
        // ledger, not a claim that the external marker is atomic with SQLite.
        let (raw, spki, pin, complete): (Option<Vec<u8>>, Option<Vec<u8>>, Option<String>, i64) =
            db.query_row(
                "SELECT CASE WHEN length(key_pkcs8)<=?3 THEN key_pkcs8 END,
                    CASE WHEN length(spki)=44 THEN spki END,
                    CASE WHEN length(pin)=64 THEN pin END,initialized
             FROM identity WHERE singleton=1 AND device_id=?1 AND layout=?2",
                params![device.to_string(), LAYOUT, MAX_KEY_BYTES],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(database)?;
        if !matches!(complete, 0 | 1) {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        let mut raw = raw.ok_or(HostError::PeerIdentityRecoveryRequired)?;
        let signing = certified(&raw);
        raw.fill(0);
        let signing = signing?;
        let spki = spki.ok_or(HostError::PeerIdentityRecoveryRequired)?;
        let pin = pin.ok_or(HostError::PeerIdentityRecoveryRequired)?;
        if !valid_spki(&spki)
            || signing.cert[0].as_ref() != spki.as_slice()
            || fingerprint(&spki) != pin
        {
            return Err(HostError::PeerIdentityRecoveryRequired);
        }
        let info = DeviceIdentityInfo {
            device_id: device,
            spki_der: spki,
            fingerprint_sha256: pin,
        };
        let expected = anchor(&info);
        if marked {
            check_file(&marker)?;
            if fs::metadata(&marker).map_err(unavailable)?.len() != expected.len() as u64 {
                return Err(HostError::PeerIdentityRecoveryRequired);
            }
            let mut bytes = Vec::new();
            fs::File::open(&marker)
                .map_err(unavailable)?
                .take(256)
                .read_to_end(&mut bytes)
                .map_err(unavailable)?;
            if bytes != expected.as_bytes() {
                return Err(HostError::PeerIdentityRecoveryRequired);
            }
        } else {
            if complete == 1 {
                return Err(HostError::PeerIdentityRecoveryRequired);
            }
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&marker).map_err(unavailable)?;
            storage::private_path(&marker, false).map_err(unavailable)?;
            file.write_all(expected.as_bytes()).map_err(unavailable)?;
            file.sync_all().map_err(unavailable)?;
            sync_directory(&directory)?;
            sync_directory(root)?;
        }
        if complete == 0 {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(unavailable)?;
            tx.execute("UPDATE identity SET initialized=1 WHERE singleton=1", [])
                .map_err(unavailable)?;
            tx.commit().map_err(unavailable)?;
        }
        storage::secure_private_tree(&directory).map_err(unavailable)?;
        storage::private_path(&marker, false).map_err(unavailable)?;
        sync_directory(&directory)?;
        sync_directory(root)?;
        Ok(Self {
            info,
            certified: signing,
        })
    }
}
