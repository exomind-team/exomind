//! Durable, metadata-only lifecycle records for Native original exports.
//!
//! This module owns no Tauri state, Host data, destination URI, or original
//! bytes. The application boundary chooses the private root and process
//! generation; this module only validates and atomically stores the journal.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;

pub(super) const MANIFEST_FILE_NAME: &str = "manifest.json";

const MANIFEST_VERSION: u32 = 1;
const MAX_TERMINAL_RECORDS: usize = 32;
const MAX_ACTIVE_RECORDS: usize = 1;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_FILE_NAME_BYTES: usize = 4096;
const MAX_FAILURE_CODE_BYTES: usize = 128;

static JOURNAL_LOCK: Mutex<()> = Mutex::new(());
static PROCESS_GENERATION: OnceLock<Uuid> = OnceLock::new();
static UNCONFIRMED_REQUESTS: OnceLock<Mutex<HashSet<(PathBuf, Uuid)>>> = OnceLock::new();

/// One process generation prevents a new Native process from claiming an old
/// picker callback as its own. The value is deliberately not exposed to UI.
pub(super) fn current_process_generation() -> Uuid {
    *PROCESS_GENERATION.get_or_init(Uuid::new_v4)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExportTaskPhase {
    Preparing,
    AwaitingDestination,
    Writing,
    Verifying,
    Succeeded,
    Cancelled,
    Failed,
    Interrupted,
}

impl ExportTaskPhase {
    pub(super) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Cancelled | Self::Failed | Self::Interrupted
        )
    }

    fn can_advance_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Preparing, Self::AwaitingDestination)
                | (Self::AwaitingDestination, Self::Writing)
                | (Self::Writing, Self::Verifying)
                | (Self::Verifying, Self::Succeeded)
        ) || (!self.is_terminal()
            && matches!(next, Self::Cancelled | Self::Failed | Self::Interrupted))
    }
}

/// Public history data intentionally contains metadata only. In particular,
/// neither the selected SAF URI nor a filesystem path is retained here.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExportTaskRecord {
    pub(super) request_id: Uuid,
    pub(super) profile_id: Uuid,
    pub(super) original_id: Uuid,
    pub(super) file_name: String,
    pub(super) byte_length: u64,
    pub(super) sha256: String,
    pub(super) phase: ExportTaskPhase,
    pub(super) failure_code: Option<String>,
    pub(super) partial_output: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum JournalError {
    Corrupt,
    Unavailable,
    CommitUnconfirmed,
    InvalidTask,
    DuplicateRequest,
    StaleTask,
    InvalidTransition,
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Corrupt => "export journal is malformed or has an unsupported layout",
            Self::Unavailable => "export journal storage is unavailable",
            Self::CommitUnconfirmed => {
                "export journal rename completed but directory sync was not confirmed"
            }
            Self::InvalidTask => "export task metadata is invalid",
            Self::DuplicateRequest => "export request ID is already recorded",
            Self::StaleTask => "export task result does not match the current record",
            Self::InvalidTransition => "export task phase transition is invalid",
        };
        formatter.write_str(message)
    }
}

impl Error for JournalError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    records: Vec<PersistedTask>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedTask {
    record: ExportTaskRecord,
    process_generation: Uuid,
}

impl Manifest {
    fn empty() -> Self {
        Self {
            version: MANIFEST_VERSION,
            records: Vec::new(),
        }
    }

    fn validate(&self) -> Result<(), JournalError> {
        if self.version != MANIFEST_VERSION
            || self.records.len() > MAX_TERMINAL_RECORDS + MAX_ACTIVE_RECORDS
        {
            return Err(JournalError::Corrupt);
        }

        let mut requests = HashSet::with_capacity(self.records.len());
        let mut terminal_count = 0;
        let mut active_count = 0;
        for task in &self.records {
            validate_record(&task.record).map_err(|_| JournalError::Corrupt)?;
            if task.process_generation.is_nil() || !requests.insert(task.record.request_id) {
                return Err(JournalError::Corrupt);
            }
            if task.record.phase.is_terminal() {
                terminal_count += 1;
            } else {
                active_count += 1;
            }
        }
        if terminal_count > MAX_TERMINAL_RECORDS || active_count > MAX_ACTIVE_RECORDS {
            return Err(JournalError::Corrupt);
        }
        Ok(())
    }

    fn trim_terminal_history(&mut self) {
        while self
            .records
            .iter()
            .filter(|task| task.record.phase.is_terminal())
            .count()
            > MAX_TERMINAL_RECORDS
        {
            if let Some(index) = self
                .records
                .iter()
                .position(|task| task.record.phase.is_terminal())
            {
                self.records.remove(index);
            } else {
                break;
            }
        }
    }

    fn interrupt_old_generations(&mut self, process_generation: Uuid) -> bool {
        let mut changed = false;
        for task in &mut self.records {
            if !task.record.phase.is_terminal() && task.process_generation != process_generation {
                set_interrupted(&mut task.record, "process_restarted");
                changed = true;
            }
        }
        if changed {
            self.trim_terminal_history();
        }
        changed
    }

    fn interrupt_inactive_tasks(
        &mut self,
        process_generation: Uuid,
        active_request: Option<Uuid>,
    ) -> bool {
        let mut changed = false;
        for task in &mut self.records {
            if task.record.phase.is_terminal() {
                continue;
            }
            let current = task.process_generation == process_generation
                && active_request == Some(task.record.request_id);
            if !current {
                let reason = if task.process_generation == process_generation {
                    "task_no_longer_active"
                } else {
                    "process_restarted"
                };
                set_interrupted(&mut task.record, reason);
                changed = true;
            }
        }
        if changed {
            self.trim_terminal_history();
        }
        changed
    }
}

fn set_interrupted(record: &mut ExportTaskRecord, failure_code: &str) {
    if matches!(
        record.phase,
        ExportTaskPhase::AwaitingDestination
            | ExportTaskPhase::Writing
            | ExportTaskPhase::Verifying
    ) {
        record.partial_output = true;
    }
    record.phase = ExportTaskPhase::Interrupted;
    record.failure_code = Some(failure_code.to_owned());
}

fn remember_unconfirmed(root: &Path, request_id: Uuid) {
    let requests = UNCONFIRMED_REQUESTS.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut requests) = requests.lock() {
        requests.insert((root.to_path_buf(), request_id));
    }
}

fn request_is_unconfirmed(root: &Path, request_id: Uuid) -> Result<bool, JournalError> {
    let requests = UNCONFIRMED_REQUESTS.get_or_init(|| Mutex::new(HashSet::new()));
    let requests = requests.lock().map_err(|_| JournalError::Unavailable)?;
    Ok(requests.contains(&(root.to_path_buf(), request_id)))
}

fn clear_unconfirmed_root(root: &Path) {
    let Some(requests) = UNCONFIRMED_REQUESTS.get() else {
        return;
    };
    if let Ok(mut requests) = requests.lock() {
        requests.retain(|(candidate, _)| candidate != root);
    }
}

fn valid_failure_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_FAILURE_CODE_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn validate_record(record: &ExportTaskRecord) -> Result<(), JournalError> {
    let valid_sha256 = record.sha256.len() == 64
        && record
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase());
    let valid_file_name = !record.file_name.is_empty()
        && record.file_name.len() <= MAX_FILE_NAME_BYTES
        && !record.file_name.contains('\0');
    let valid_failure_code = record
        .failure_code
        .as_deref()
        .map_or(true, valid_failure_code);
    let valid_phase_fields = match record.phase {
        ExportTaskPhase::Preparing
        | ExportTaskPhase::AwaitingDestination
        | ExportTaskPhase::Writing
        | ExportTaskPhase::Verifying => record.failure_code.is_none(),
        ExportTaskPhase::Succeeded => record.failure_code.is_none() && !record.partial_output,
        ExportTaskPhase::Cancelled | ExportTaskPhase::Failed | ExportTaskPhase::Interrupted => {
            record.failure_code.is_some()
        }
    };
    let valid_partial_output = match record.phase {
        ExportTaskPhase::Preparing | ExportTaskPhase::AwaitingDestination => !record.partial_output,
        ExportTaskPhase::Writing | ExportTaskPhase::Verifying => record.partial_output,
        ExportTaskPhase::Succeeded => !record.partial_output,
        ExportTaskPhase::Cancelled | ExportTaskPhase::Failed | ExportTaskPhase::Interrupted => true,
    };

    if record.request_id.is_nil()
        || record.profile_id.is_nil()
        || record.original_id.is_nil()
        || !valid_file_name
        || !valid_sha256
        || !valid_failure_code
        || !valid_phase_fields
        || !valid_partial_output
    {
        return Err(JournalError::InvalidTask);
    }
    Ok(())
}

/// File-backed journal for one Native private root. All updates are serialized
/// in process, then committed via a new same-directory file and rename.
#[derive(Clone)]
pub(super) struct ExportJournal {
    root: PathBuf,
    process_generation: Uuid,
}

impl ExportJournal {
    pub(super) fn new(root: PathBuf, process_generation: Uuid) -> Self {
        Self {
            root,
            process_generation,
        }
    }

    /// Startup action: persist old process generations as interrupted. A bad
    /// manifest is reported and preserved; this method never resets storage.
    pub(super) fn initialize(&self) -> Result<(), JournalError> {
        let _guard = JOURNAL_LOCK.lock().map_err(|_| JournalError::Unavailable)?;
        let Some(mut manifest) = self.read_manifest()? else {
            return Ok(());
        };
        if manifest.interrupt_old_generations(self.process_generation) {
            self.write_manifest(&manifest)?;
        }
        Ok(())
    }

    /// Begin is an explicit task action. It first records any prior inactive
    /// work as interrupted, then durably records this request before callers
    /// are allowed to open the system picker.
    pub(super) fn begin(
        &self,
        record: ExportTaskRecord,
        active_request: Option<Uuid>,
    ) -> Result<(), JournalError> {
        validate_record(&record)?;
        if record.phase != ExportTaskPhase::Preparing
            || record.failure_code.is_some()
            || record.partial_output
        {
            return Err(JournalError::InvalidTask);
        }

        let _guard = JOURNAL_LOCK.lock().map_err(|_| JournalError::Unavailable)?;
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        if manifest
            .records
            .iter()
            .any(|task| task.record.request_id == record.request_id)
        {
            return Err(JournalError::DuplicateRequest);
        }

        manifest.interrupt_inactive_tasks(self.process_generation, active_request);
        manifest.records.push(PersistedTask {
            record,
            process_generation: self.process_generation,
        });
        manifest.trim_terminal_history();
        manifest.validate()?;
        let request_id = manifest
            .records
            .last()
            .map(|task| task.record.request_id)
            .ok_or(JournalError::InvalidTask)?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => {
                remember_unconfirmed(&self.root, request_id);
                Err(JournalError::CommitUnconfirmed)
            }
            result => result,
        }
    }

    /// Commit one request-ID-scoped phase result. A stale response cannot
    /// mutate a replacement task, even when both refer to the same original.
    pub(super) fn transition(
        &self,
        request_id: Uuid,
        expected: ExportTaskPhase,
        next: ExportTaskPhase,
        failure_code: Option<String>,
        partial_output: bool,
    ) -> Result<(), JournalError> {
        let _guard = JOURNAL_LOCK.lock().map_err(|_| JournalError::Unavailable)?;
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        let task = manifest
            .records
            .iter_mut()
            .find(|task| task.record.request_id == request_id)
            .ok_or(JournalError::StaleTask)?;
        if task.process_generation != self.process_generation {
            return Err(JournalError::StaleTask);
        }
        if task.record.phase != expected {
            return Err(JournalError::StaleTask);
        }
        if !expected.can_advance_to(next) {
            return Err(JournalError::InvalidTransition);
        }

        task.record.phase = next;
        task.record.failure_code = failure_code;
        task.record.partial_output = partial_output;
        validate_record(&task.record)?;
        manifest.trim_terminal_history();
        manifest.validate()?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => {
                remember_unconfirmed(&self.root, request_id);
                Err(JournalError::CommitUnconfirmed)
            }
            result => result,
        }
    }

    /// Read-only history. Stale in-memory owners are projected as interrupted
    /// for the caller; only initialize/begin/transition write that fact.
    pub(super) fn history(
        &self,
        profile_id: Uuid,
        active_request: Option<Uuid>,
    ) -> Result<Vec<ExportTaskRecord>, JournalError> {
        let _guard = JOURNAL_LOCK.lock().map_err(|_| JournalError::Unavailable)?;
        let Some(manifest) = self.read_manifest()? else {
            return Ok(Vec::new());
        };
        let mut records = Vec::new();
        for task in manifest.records {
            if task.record.profile_id != profile_id {
                continue;
            }
            let mut record = task.record;
            if request_is_unconfirmed(&self.root, record.request_id)? {
                set_interrupted(&mut record, "receipt_commit_unconfirmed");
            } else if !record.phase.is_terminal() {
                let current = task.process_generation == self.process_generation
                    && active_request == Some(record.request_id);
                if !current {
                    let reason = if task.process_generation == self.process_generation {
                        "task_no_longer_active"
                    } else {
                        "process_restarted"
                    };
                    set_interrupted(&mut record, reason);
                }
            }
            records.push(record);
        }
        Ok(records)
    }

    fn manifest_path(&self) -> PathBuf {
        self.root.join(MANIFEST_FILE_NAME)
    }

    fn read_manifest(&self) -> Result<Option<Manifest>, JournalError> {
        let root_metadata = match fs::symlink_metadata(&self.root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(JournalError::Unavailable),
        };
        if !root_metadata.file_type().is_dir() {
            return Err(JournalError::Corrupt);
        }
        let path = self.manifest_path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(JournalError::Unavailable),
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_MANIFEST_BYTES {
            return Err(JournalError::Corrupt);
        }

        let mut file = File::open(path).map_err(|_| JournalError::Unavailable)?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| JournalError::Unavailable)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(JournalError::Corrupt);
        }
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
        manifest.validate()?;
        Ok(Some(manifest))
    }

    fn write_manifest(&self, manifest: &Manifest) -> Result<(), JournalError> {
        manifest.validate()?;
        let bytes = serde_json::to_vec(manifest).map_err(|_| JournalError::Unavailable)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(JournalError::Unavailable);
        }

        fs::create_dir_all(&self.root).map_err(|_| JournalError::Unavailable)?;
        let root_metadata =
            fs::symlink_metadata(&self.root).map_err(|_| JournalError::Unavailable)?;
        if !root_metadata.file_type().is_dir() {
            return Err(JournalError::Unavailable);
        }

        let path = self.manifest_path();
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                return Err(JournalError::Corrupt);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(JournalError::Unavailable),
        }

        let temporary = self.root.join(format!(".manifest-{}.tmp", Uuid::new_v4()));
        let mut owns_temporary = false;
        let mut renamed = false;
        let write_result = (|| -> Result<(), JournalError> {
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|_| JournalError::Unavailable)?;
            owns_temporary = true;
            file.write_all(&bytes)
                .map_err(|_| JournalError::Unavailable)?;
            file.sync_all().map_err(|_| JournalError::Unavailable)?;
            drop(file);
            fs::rename(&temporary, &path).map_err(|_| JournalError::Unavailable)?;
            renamed = true;
            #[cfg(unix)]
            File::open(&self.root)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| JournalError::CommitUnconfirmed)?;
            Ok(())
        })();
        if write_result.is_err() && owns_temporary && !renamed {
            let _ = fs::remove_file(&temporary);
        }
        if write_result.is_ok() {
            clear_unconfirmed_root(&self.root);
        }
        write_result
    }
}

#[cfg(test)]
#[path = "beta_export_journal_tests.rs"]
mod tests;
