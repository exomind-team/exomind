use crate::{HostError, PROTOCOL};
use rand::{RngCore, rngs::OsRng};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

const LOCK_APPLICATION: i64 = 0x4558424c;
const AUTH_APPLICATION: i64 = 0x45584248;
const CONNECTION: &str = "connection.beta.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Descriptor {
    pub protocol: String,
    pub owner_token: String,
    pub url: Option<String>,
}

pub(crate) struct Persistence {
    pub root: PathBuf,
    pub auth: Connection,
    pub _lock: Connection,
    pub descriptor: Descriptor,
    pub owner_existed: bool,
}

pub(crate) fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn token_hash(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

fn valid_token(raw: &str) -> bool {
    raw.len() == 64 && raw.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn children_are_owned(root: &Path) -> Result<(), HostError> {
    if !root.exists() {
        return Ok(());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() {
            return Err(HostError::InvalidRoot);
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !matches!(
            name.as_str(),
            "core"
                | "host-auth.sqlite3"
                | "host-auth.sqlite3-journal"
                | "host-lock.sqlite3"
                | "host-lock.sqlite3-journal"
                | crate::local_intents::DIRECTORY
                | crate::local_intents::INITIALIZED
                | crate::local_sources::DIRECTORY
                | crate::local_sources::INITIALIZED
                | CONNECTION
        ) && !(name.starts_with("connection.beta.") && name.ends_with(".tmp"))
        {
            return Err(HostError::ForeignRoot);
        }
        names.push(name);
    }
    if names.is_empty() {
        return Ok(());
    }
    let lock_path = root.join("host-lock.sqlite3");
    if !lock_path.exists() {
        return Err(HostError::ForeignRoot);
    }
    let probe = Connection::open_with_flags(lock_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    probe.busy_timeout(Duration::ZERO)?;
    let application: i64 = probe
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(ref code, _)
                if code.code == rusqlite::ErrorCode::DatabaseBusy
                    || code.code == rusqlite::ErrorCode::DatabaseLocked =>
            {
                HostError::RootInUse
            }
            other => HostError::Database(other),
        })?;
    if application == LOCK_APPLICATION {
        return Ok(());
    }
    // A first-start crash may leave only the still-empty lock database. No
    // credentials or business data exist yet, so initialization can resume.
    let tables: i64 = probe.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if application == 0
        && tables == 0
        && names
            .iter()
            .all(|name| name.starts_with("host-lock.sqlite3"))
    {
        return Ok(());
    }
    Err(HostError::ForeignRoot)
}

pub(crate) fn private_path(path: &Path, directory: bool) -> Result<(), HostError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            path,
            fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
        )?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The host owns this validated path. Apply an actual protected DACL;
        // chmod is not evidence of Windows access isolation.
        let script = r#"$ErrorActionPreference='Stop'; $p=$env:EXOMIND_BETA_PRIVATE_PATH; $directory=$env:EXOMIND_BETA_DIRECTORY -eq '1'; $acl=if($directory){[System.IO.Directory]::GetAccessControl($p)}else{[System.IO.File]::GetAccessControl($p)}; $acl.SetAccessRuleProtection($true,$false); foreach($r in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($r) }; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $inherit=if($env:EXOMIND_BETA_DIRECTORY -eq '1') {[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'} else {[System.Security.AccessControl.InheritanceFlags]::None}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); [void]$acl.AddAccessRule($rule); if($directory){[System.IO.Directory]::SetAccessControl($p,$acl)}else{[System.IO.File]::SetAccessControl($p,$acl)}"#;
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("EXOMIND_BETA_PRIVATE_PATH", path)
            .env("EXOMIND_BETA_DIRECTORY", if directory { "1" } else { "0" })
            .creation_flags(0x08000000)
            .output()?;
        if !result.status.success() {
            return Err(HostError::PrivatePermissions);
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, directory);
        return Err(HostError::PrivatePermissions);
    }
    Ok(())
}

fn private_tree(path: &Path, secure: bool) -> Result<(), HostError> {
    let metadata = fs::symlink_metadata(path)?;
    let kind = metadata.file_type();
    if kind.is_symlink() || (!kind.is_file() && !kind.is_dir()) {
        return Err(HostError::InvalidRoot);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions and other reparse points must not redirect a recursive ACL
        // operation into an unrelated application's directory.
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(HostError::InvalidRoot);
        }
    }
    if secure {
        private_path(path, kind.is_dir())?;
    }
    if kind.is_dir() {
        for entry in fs::read_dir(path)? {
            private_tree(&entry?.path(), secure)?;
        }
    }
    Ok(())
}

pub(crate) fn check_private_tree(path: &Path) -> Result<(), HostError> {
    private_tree(path, false)
}

pub(crate) fn secure_private_tree(path: &Path) -> Result<(), HostError> {
    private_tree(path, true)
}

fn checked_database(
    connection: &mut Connection,
    application: i64,
    schema: &str,
) -> Result<(), HostError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let found: i64 = transaction.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if found == application && version == 1 {
        transaction.commit()?;
        return Ok(());
    }
    let tables: i64 = transaction.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if found != 0 || version != 0 || tables != 0 {
        return Err(HostError::ForeignRoot);
    }
    transaction.execute_batch(schema)?;
    transaction.pragma_update(None, "application_id", application)?;
    transaction.pragma_update(None, "user_version", 1)?;
    transaction.commit()?;
    Ok(())
}

impl Persistence {
    pub fn open(root: &Path) -> Result<Self, HostError> {
        if !root.is_absolute() {
            return Err(HostError::InvalidRoot);
        }
        for ancestor in root.ancestors() {
            if ancestor.exists() && fs::symlink_metadata(ancestor)?.file_type().is_symlink() {
                return Err(HostError::InvalidRoot);
            }
        }
        children_are_owned(root)?;
        fs::create_dir_all(root)?;
        private_path(root, true)?;
        let root = root.canonicalize()?;
        let mut lock = Connection::open(root.join("host-lock.sqlite3"))?;
        lock.busy_timeout(Duration::ZERO)?;
        checked_database(&mut lock, LOCK_APPLICATION, "CREATE TABLE lock_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1));")
            .map_err(|error| if matches!(error, HostError::Database(rusqlite::Error::SqliteFailure(ref code, _)) if code.code == rusqlite::ErrorCode::DatabaseBusy || code.code == rusqlite::ErrorCode::DatabaseLocked) {HostError::RootInUse} else {error})?;
        lock.execute_batch("BEGIN EXCLUSIVE")
            .map_err(|_| HostError::RootInUse)?;
        let auth_path = root.join("host-auth.sqlite3");
        let initialized_evidence = root.join(CONNECTION).exists() || root.join("core").exists();
        if initialized_evidence && (!auth_path.exists() || fs::metadata(&auth_path)?.len() == 0) {
            return Err(HostError::Core(exomind_core::CoreError::RecoveryRequired));
        }
        let mut auth = Connection::open(&auth_path)?;
        auth.busy_timeout(Duration::from_secs(5))?;
        auth.pragma_update(None, "synchronous", "FULL")?;
        if initialized_evidence {
            let application: i64 =
                auth.pragma_query_value(None, "application_id", |row| row.get(0))?;
            let version: i64 = auth.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if application != AUTH_APPLICATION || version != 1 {
                return Err(HostError::Core(exomind_core::CoreError::RecoveryRequired));
            }
        }
        checked_database(
            &mut auth,
            AUTH_APPLICATION,
            "CREATE TABLE owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1), token_hash TEXT NOT NULL); CREATE TABLE grants(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,kind TEXT NOT NULL,agent_id TEXT,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);",
        )?;
        let owner: Option<String> = auth
            .query_row(
                "SELECT token_hash FROM owner WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let has_binding: bool = auth.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='core_binding')",
            [],
            |row| row.get(0),
        )?;
        if owner.is_none() && (has_binding || root.join("core").exists()) {
            return Err(HostError::Core(exomind_core::CoreError::RecoveryRequired));
        }
        let owner_existed = owner.is_some();
        let descriptor_path = root.join(CONNECTION);
        let descriptor = if descriptor_path.exists() {
            private_path(&descriptor_path, false)?;
            let stored = serde_json::from_slice::<Descriptor>(&fs::read(&descriptor_path)?);
            match stored {
                Ok(value) if value.protocol == PROTOCOL && valid_token(&value.owner_token) => value,
                _ if owner.is_none() => Descriptor {
                    protocol: PROTOCOL.into(),
                    owner_token: token(),
                    url: None,
                },
                _ => return Err(HostError::CredentialsUnavailable),
            }
        } else if owner.is_none() {
            Descriptor {
                protocol: PROTOCOL.into(),
                owner_token: token(),
                url: None,
            }
        } else {
            return Err(HostError::CredentialsUnavailable);
        };
        let mut persistence = Self {
            root,
            auth,
            _lock: lock,
            descriptor,
            owner_existed,
        };
        if let Some(owner) = owner {
            if owner != token_hash(&persistence.descriptor.owner_token) {
                return Err(HostError::CredentialsUnavailable);
            }
        } else {
            // Persist raw credentials completely before committing their hash.
            // A failed database write can reuse this same descriptor on restart.
            persistence.write_descriptor()?;
            persistence.auth.execute(
                "INSERT INTO owner(singleton,token_hash) VALUES(1,?1)",
                [token_hash(&persistence.descriptor.owner_token)],
            )?;
        }
        Ok(persistence)
    }

    pub(crate) fn bound_device(&self) -> Result<Option<exomind_core::DeviceId>, HostError> {
        let exists: bool = self.auth.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='core_binding')",
            [],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(None);
        }
        let stored: Option<String> = self
            .auth
            .query_row(
                "SELECT device_id FROM core_binding WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let device = stored
            .and_then(|value| value.parse().ok())
            .ok_or(HostError::Core(exomind_core::CoreError::RecoveryRequired))?;
        Ok(Some(device))
    }

    pub(crate) fn bind_core(&mut self, device: exomind_core::DeviceId) -> Result<(), HostError> {
        if self
            .bound_device()?
            .is_some_and(|expected| expected != device)
        {
            return Err(HostError::Core(exomind_core::CoreError::RecoveryRequired));
        }
        let transaction = self
            .auth
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Host auth schema remains 1 for older owner/grant readers. This extra
        // table is a durable one-time binding, never an automatic rebind.
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS core_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL)")?;
        transaction.execute(
            "INSERT OR IGNORE INTO core_binding VALUES(1,?1)",
            [device.to_string()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn write_descriptor(&mut self) -> Result<(), HostError> {
        let temporary = self
            .root
            .join(format!("connection.beta.{}.tmp", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        let result = (|| {
            private_path(&temporary, false)?;
            file.write_all(&serde_json::to_vec_pretty(&self.descriptor)?)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, self.root.join(CONNECTION))?;
            #[cfg(unix)]
            {
                fs::File::open(&self.root)?.sync_all()?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_core_backups_keep_directory_permissions_and_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let backup_dir = directory.path().join("core/backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let backup = backup_dir.join("synthetic.sqlite3");
        fs::write(&backup, b"synthetic preserved backup").unwrap();
        check_private_tree(directory.path()).unwrap();
        secure_private_tree(directory.path()).unwrap();
        assert!(backup_dir.is_dir());
        assert_eq!(fs::read(&backup).unwrap(), b"synthetic preserved backup");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&backup_dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn recursive_core_permissions_reject_a_backup_symlink() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let backup_dir = directory.path().join("core/backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let outside_file = outside.path().join("untouched");
        fs::write(&outside_file, b"external sentinel").unwrap();
        symlink(&outside_file, backup_dir.join("synthetic.sqlite3")).unwrap();
        assert!(matches!(
            check_private_tree(directory.path()),
            Err(HostError::InvalidRoot)
        ));
        assert_eq!(fs::read(outside_file).unwrap(), b"external sentinel");
    }

    #[test]
    fn initialization_reuses_durable_credentials_after_owner_insert_failure() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("beta");
        let persistence = Persistence::open(&root).unwrap();
        let original = persistence.descriptor.owner_token.clone();
        // This reproduces the disk state of a failed first-start owner insert;
        // no Core has been opened and there is no business database to reset.
        persistence.auth.execute_batch("DELETE FROM owner; CREATE TRIGGER interrupt_owner BEFORE INSERT ON owner BEGIN SELECT RAISE(ABORT,'synthetic interrupted write'); END;").unwrap();
        drop(persistence);
        assert!(Persistence::open(&root).is_err());
        let descriptor: Descriptor =
            serde_json::from_slice(&fs::read(root.join(CONNECTION)).unwrap()).unwrap();
        assert_eq!(descriptor.owner_token, original);
        let database = Connection::open(root.join("host-auth.sqlite3")).unwrap();
        database
            .execute_batch("DROP TRIGGER interrupt_owner")
            .unwrap();
        drop(database);
        let recovered = Persistence::open(&root).unwrap();
        assert_eq!(recovered.descriptor.owner_token, original);
        let stored: String = recovered
            .auth
            .query_row("SELECT token_hash FROM owner", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, token_hash(&original));
    }
}
