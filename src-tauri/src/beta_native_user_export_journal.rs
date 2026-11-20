//! Bounded, pathless receipts for Native UserRange exports.
use super::{UserRangeExportPhase, UserRangeExportResult, UserRangeExportStatus};
use exomind_core::ProfileId;
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt,
    fs::{self, DirBuilder, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MANIFEST_NAME: &str = "manifest.json";
const PRIVATE_STAGE_DIR: &str = "private";
const VERSION: u32 = 1;
const MAX_TERMINAL: usize = 32;
const MAX_ACTIVE: usize = 1;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_FAILURE_CODE_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum JournalError {
    Corrupt,
    Unavailable,
    CommitUnconfirmed,
    InvalidRequest,
    DuplicateRequest,
    Busy,
    HistoryFull,
    InvalidTransition,
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Corrupt => "user range export receipt journal is malformed or unsupported",
            Self::Unavailable => "user range export receipt storage is unavailable",
            Self::CommitUnconfirmed => "user range export receipt commit is unconfirmed",
            Self::InvalidRequest => "user range export receipt metadata is invalid",
            Self::DuplicateRequest => "user range export request ID is already retained",
            Self::Busy => "user range export already has an active request",
            Self::HistoryFull => "user range export receipt history has no confirmed entry to evict",
            Self::InvalidTransition => "user range export receipt phase transition is invalid",
        })
    }
}
impl Error for JournalError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    records: Vec<UserRangeExportStatus>,
}

impl Manifest {
    fn empty() -> Self {
        Self { version: VERSION, records: Vec::new() }
    }

    fn validate(&self) -> Result<(), JournalError> {
        if self.version != VERSION || self.records.len() > MAX_TERMINAL + MAX_ACTIVE {
            return Err(JournalError::Corrupt);
        }
        let mut ids = std::collections::HashSet::with_capacity(self.records.len());
        let mut active = 0usize;
        let mut terminal = 0usize;
        for status in &self.records {
            validate_status(status).map_err(|_| JournalError::Corrupt)?;
            if !ids.insert(status.request_id) {
                return Err(JournalError::Corrupt);
            }
            if is_terminal(status.phase) {
                terminal += 1;
            } else {
                active += 1;
            }
        }
        if active > MAX_ACTIVE || terminal > MAX_TERMINAL {
            return Err(JournalError::Corrupt);
        }
        Ok(())
    }
}

pub(super) struct UserRangeExportJournal {
    root: PathBuf,
    manifest: Manifest,
}

impl UserRangeExportJournal {
    pub(super) fn root_for_host(host_root: &Path) -> Result<PathBuf, JournalError> {
        if !host_root.is_absolute() {
            return Err(JournalError::InvalidRequest);
        }
        let host = fs::canonicalize(host_root).map_err(|_| JournalError::Unavailable)?;
        if !host.is_dir() {
            return Err(JournalError::InvalidRequest);
        }
        let stem = host.file_name().ok_or(JournalError::InvalidRequest)?;
        let name = if stem == std::ffi::OsStr::new("beta-host") {
            std::ffi::OsString::from("beta-native-user-range-export")
        } else {
            let mut value = stem.to_os_string();
            value.push("-user-range-export-receipts");
            value
        };
        let root = host.with_file_name(name);
        if root == host || root.starts_with(&host) || host.starts_with(&root) {
            return Err(JournalError::InvalidRequest);
        }
        Ok(root)
    }

    pub(super) fn open(host_root: &Path) -> Result<Self, JournalError> {
        let root = Self::root_for_host(host_root)?;
        let mut journal = Self {
            manifest: read_manifest(&root)?,
            root,
        };

        if let Some(index) = journal.manifest.records.iter().position(|row| !is_terminal(row.phase)) {
            let previous = journal.manifest.records[index].clone();
            let result = UserRangeExportResult::interrupted(
                previous.request_id,
                previous.profile_id,
                possible_partial_output(previous.phase),
            );
            journal.manifest.records[index] = UserRangeExportStatus {
                request_id: previous.request_id,
                profile_id: previous.profile_id,
                phase: UserRangeExportPhase::Interrupted,
                result: Some(result),
            };
            Self::trim_terminal_history_in(&mut journal.manifest, Some(previous.request_id))?;
            journal.write_manifest(&journal.manifest, previous.request_id)?;
        }
        Ok(journal)
    }

    pub(super) fn begin(&mut self, request_id: Uuid, profile_id: ProfileId) -> Result<(), JournalError> {
        if request_id.is_nil() {
            return Err(JournalError::InvalidRequest);
        }
        if self.manifest.records.iter().any(|row| row.request_id == request_id) {
            return Err(JournalError::DuplicateRequest);
        }
        if self.manifest.records.iter().any(|row| !is_terminal(row.phase)) {
            return Err(JournalError::Busy);
        }
        let mut next = self.manifest.clone();
        next.records.push(UserRangeExportStatus {
            request_id,
            profile_id,
            phase: UserRangeExportPhase::Preparing,
            result: None,
        });
        next.validate()?;
        self.commit(next, request_id)
    }

    pub(super) fn transition(
        &mut self,
        request_id: Uuid,
        next_phase: UserRangeExportPhase,
    ) -> Result<(), JournalError> {
        let mut next = self.manifest.clone();
        let status = next.records.iter_mut().find(|row| row.request_id == request_id)
            .ok_or(JournalError::InvalidRequest)?;
        if is_terminal(status.phase) || !can_advance(status.phase, next_phase) {
            return Err(JournalError::InvalidTransition);
        }
        status.phase = next_phase;
        next.validate()?;
        self.commit(next, request_id)
    }

    pub(super) fn finish(&mut self, result: UserRangeExportResult) -> Result<(), JournalError> {
        validate_result(&result)?;
        let mut next = self.manifest.clone();
        let status = next.records.iter_mut().find(|row| row.request_id == result.request_id)
            .ok_or(JournalError::InvalidRequest)?;
        if is_terminal(status.phase) {
            return Err(JournalError::InvalidTransition);
        }
        if result.phase == UserRangeExportPhase::Saved && status.phase != UserRangeExportPhase::Publishing {
            return Err(JournalError::InvalidTransition);
        }
        let request_id = result.request_id;
        *status = UserRangeExportStatus {
            request_id,
            profile_id: result.profile_id,
            phase: result.phase,
            result: Some(result),
        };
        Self::trim_terminal_history_in(&mut next, Some(request_id))?;
        next.validate()?;
        self.commit(next, request_id)
    }

    pub(super) fn status(&self, request_id: Uuid) -> Result<Option<UserRangeExportStatus>, JournalError> {
        Ok(self.manifest.records.iter().find(|row| row.request_id == request_id).cloned())
    }

    #[cfg(test)]
    pub(super) fn history(&self, profile_id: ProfileId) -> Result<Vec<UserRangeExportStatus>, JournalError> {
        Ok(self.manifest.records.iter().filter(|row| row.profile_id == profile_id).cloned().collect())
    }

    pub(super) fn all(&self) -> Vec<UserRangeExportStatus> {
        self.manifest.records.clone()
    }

    pub(super) fn private_stage_root(&self) -> Result<PathBuf, JournalError> {
        ensure_private_directory(&self.root)?;
        let path = self.root.join(PRIVATE_STAGE_DIR);
        ensure_private_directory(&path)?;
        Ok(path)
    }

    fn commit(&mut self, next: Manifest, request_id: Uuid) -> Result<(), JournalError> {
        next.validate()?;
        self.write_manifest(&next, request_id)?;
        self.manifest = next;
        Ok(())
    }

    fn trim_terminal_history_in(
        manifest: &mut Manifest,
        protected: Option<Uuid>,
    ) -> Result<(), JournalError> {
        while manifest.records.iter().filter(|row| is_terminal(row.phase)).count() > MAX_TERMINAL {
            let Some(index) = manifest.records.iter().position(|row| {
                is_terminal(row.phase) && Some(row.request_id) != protected
            }) else {
                return Err(JournalError::HistoryFull);
            };
            manifest.records.remove(index);
        }
        Ok(())
    }

    fn write_manifest(&self, manifest: &Manifest, request_id: Uuid) -> Result<(), JournalError> {
        manifest.validate()?;
        let bytes = serde_json::to_vec(manifest).map_err(|_| JournalError::Unavailable)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(JournalError::HistoryFull);
        }
        ensure_private_directory(&self.root)?;
        let path = self.root.join(MANIFEST_NAME);
        if fs::symlink_metadata(&path).is_ok_and(|metadata| !metadata.file_type().is_file()) {
            return Err(JournalError::Corrupt);
        }
        let nonce = Uuid::new_v4();
        let temporary = self.root.join(format!(".manifest-{request_id}.{nonce}.tmp"));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| JournalError::Unavailable)?;
        let mut renamed = false;
        let result = (|| {
            use std::io::Write;
            file.write_all(&bytes).map_err(|_| JournalError::Unavailable)?;
            file.sync_all().map_err(|_| JournalError::Unavailable)?;
            drop(file);
            fs::rename(&temporary, &path).map_err(|_| JournalError::Unavailable)?;
            renamed = true;
            #[cfg(unix)] File::open(&self.root).and_then(|directory| directory.sync_all()).map_err(|_| JournalError::CommitUnconfirmed)?;
            Ok(())
        })();
        if result.is_err() && !renamed {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

pub(super) fn private_stage_file_name(request_id: Uuid) -> String {
    format!(".exomind-user-range-{request_id}.tar.tmp")
}

fn read_manifest(root: &Path) -> Result<Manifest, JournalError> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err(JournalError::Corrupt),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Manifest::empty()),
        Err(_) => return Err(JournalError::Unavailable),
    }
    let path = root.join(MANIFEST_NAME);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Manifest::empty()),
        Err(_) => return Err(JournalError::Unavailable),
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err(JournalError::Corrupt);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path).map_err(|_| JournalError::Unavailable)?
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| JournalError::Unavailable)?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(JournalError::Corrupt);
    }
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
    manifest.validate()?;
    Ok(manifest)
}

fn validate_status(status: &UserRangeExportStatus) -> Result<(), JournalError> {
    if status.request_id.is_nil() {
        return Err(JournalError::InvalidRequest);
    }
    match (is_terminal(status.phase), status.result.as_ref()) {
        (false, None) => Ok(()),
        (false, Some(_)) | (true, None) => Err(JournalError::InvalidRequest),
        (true, Some(result)) => {
            validate_result(result)?;
            if result.request_id != status.request_id || result.profile_id != status.profile_id || result.phase != status.phase {
                return Err(JournalError::InvalidRequest);
            }
            Ok(())
        }
    }
}

fn validate_result(result: &UserRangeExportResult) -> Result<(), JournalError> {
    if result.request_id.is_nil() || !is_terminal(result.phase) {
        return Err(JournalError::InvalidRequest);
    }
    if result.failure_code.as_ref().is_some_and(|code| {
        code.is_empty() || code.len() > MAX_FAILURE_CODE_BYTES
            || !code.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    }) {
        return Err(JournalError::InvalidRequest);
    }
    if result.phase == UserRangeExportPhase::Saved {
        let (Some(length), Some(hash)) = (result.archive_byte_length, result.archive_sha256.as_deref()) else {
            return Err(JournalError::InvalidRequest);
        };
        if length == 0 || hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || result.failure_code.is_some() || result.partial_output
        {
            return Err(JournalError::InvalidRequest);
        }
    } else if result.archive_byte_length.is_some() || result.archive_sha256.is_some() || result.failure_code.is_none() {
        return Err(JournalError::InvalidRequest);
    }
    Ok(())
}

fn is_terminal(phase: UserRangeExportPhase) -> bool {
    matches!(phase, UserRangeExportPhase::Saved | UserRangeExportPhase::Cancelled | UserRangeExportPhase::Failed | UserRangeExportPhase::Interrupted)
}

fn possible_partial_output(phase: UserRangeExportPhase) -> bool {
    matches!(phase,
        UserRangeExportPhase::AwaitingDestination
            | UserRangeExportPhase::Writing
            | UserRangeExportPhase::Verifying
            | UserRangeExportPhase::Cancelling
            | UserRangeExportPhase::Publishing)
}

fn can_advance(from: UserRangeExportPhase, to: UserRangeExportPhase) -> bool {
    matches!((from, to),
        (UserRangeExportPhase::Preparing, UserRangeExportPhase::Writing | UserRangeExportPhase::AwaitingDestination)
            | (UserRangeExportPhase::Writing, UserRangeExportPhase::AwaitingDestination | UserRangeExportPhase::Verifying)
            | (UserRangeExportPhase::AwaitingDestination, UserRangeExportPhase::Writing)
            | (UserRangeExportPhase::Verifying, UserRangeExportPhase::Publishing))
}

fn ensure_private_directory(path: &Path) -> Result<(), JournalError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err(JournalError::Corrupt),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(unix)] {
                use std::os::unix::fs::DirBuilderExt;
                let mut builder = DirBuilder::new();
                builder.mode(0o700).create(path).map_err(|_| JournalError::Unavailable)?;
            }
            #[cfg(not(unix))]
            DirBuilder::new().create(path).map_err(|_| JournalError::Unavailable)?;
        }
        Err(_) => return Err(JournalError::Unavailable),
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| JournalError::Unavailable)?;
    }
    Ok(())
}
