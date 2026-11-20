//! Private, bounded metadata journal for Native profile archive operations.
//! It never persists system paths/URIs, credentials, preview IDs, or archive bytes.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub(super) const MANIFEST_FILE_NAME: &str = "manifest.json";
const MANIFEST_VERSION: u32 = 1;
const MAX_TERMINAL_RECORDS: usize = 32;
const MAX_ACTIVE_RECORDS: usize = 1;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_FAILURE_CODE_BYTES: usize = 64;
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum SpoolIdentityPlatform { Unix, Windows }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct SpoolFileIdentity {
    platform: SpoolIdentityPlatform,
    volume: u64,
    file: u64,
}
impl SpoolFileIdentity {
    pub(super) fn unix(volume: u64, file: u64) -> Self {
        Self { platform: SpoolIdentityPlatform::Unix, volume, file }
    }
    pub(super) fn windows(volume: u32, file: u64) -> Self {
        Self { platform: SpoolIdentityPlatform::Windows, volume: u64::from(volume), file }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ArchiveDirection { Import, Export }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ArchiveTaskPhase {
    Preparing,
    AwaitingSource,
    Spooling,
    PreviewReady,
    Importing,
    Exporting,
    AwaitingDestination,
    Writing,
    Verifying,
    CancelRequested,
    Succeeded,
    Cancelled,
    Failed,
    Interrupted,
}
impl ArchiveTaskPhase {
    pub(super) fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Cancelled | Self::Failed | Self::Interrupted)
    }
    fn can_advance_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Preparing, Self::AwaitingSource | Self::Exporting)
                | (Self::AwaitingSource, Self::Spooling)
                | (Self::Spooling, Self::PreviewReady)
                | (Self::PreviewReady, Self::Importing)
                | (Self::Exporting, Self::AwaitingDestination)
                | (Self::AwaitingDestination, Self::Writing)
                | (Self::Writing, Self::Verifying)
                | (Self::Verifying, Self::Succeeded)
                | (Self::Importing, Self::Succeeded)
                | (Self::CancelRequested, Self::Cancelled | Self::Succeeded)
        ) || (!self.is_terminal()
            && matches!(next, Self::CancelRequested | Self::Cancelled | Self::Failed | Self::Interrupted))
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct ArchiveProgress {
    pub(super) bytes_processed: u64,
    pub(super) facts_processed: u64,
    pub(super) original_bytes_processed: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct ArchiveTaskRecord {
    pub(super) request_id: Uuid,
    pub(super) profile_id: Option<Uuid>,
    pub(super) direction: ArchiveDirection,
    pub(super) phase: ArchiveTaskPhase,
    pub(super) archive_sha256: Option<String>,
    pub(super) archive_complete: Option<bool>,
    pub(super) byte_length: Option<u64>,
    pub(super) progress: ArchiveProgress,
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
    HistoryFull,
}
impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Corrupt => "profile archive journal is malformed or unsupported",
            Self::Unavailable => "profile archive journal storage is unavailable",
            Self::CommitUnconfirmed => "profile archive journal commit is not confirmed",
            Self::InvalidTask => "profile archive task metadata is invalid",
            Self::DuplicateRequest => "profile archive request ID is already recorded",
            Self::StaleTask => "profile archive task result is stale",
            Self::InvalidTransition => "profile archive task transition is invalid",
            Self::HistoryFull => "profile archive recovery history is full of unresolved tasks",
        })
    }
}
impl Error for JournalError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest { version: u32, records: Vec<PersistedTask> }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedTask {
    record: ArchiveTaskRecord,
    process_generation: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    spool_identity: Option<SpoolFileIdentity>,
}
impl Manifest {
    fn empty() -> Self { Self { version: MANIFEST_VERSION, records: Vec::new() } }
    fn validate(&self) -> Result<(), JournalError> {
        if self.version != MANIFEST_VERSION || self.records.len() > MAX_TERMINAL_RECORDS + MAX_ACTIVE_RECORDS {
            return Err(JournalError::Corrupt);
        }
        let mut ids = HashSet::with_capacity(self.records.len());
        let mut active = 0usize;
        for task in &self.records {
            validate_record(&task.record).map_err(|_| JournalError::Corrupt)?;
            if task.process_generation.is_nil() || !ids.insert(task.record.request_id) {
                return Err(JournalError::Corrupt);
            }
            if !task.record.phase.is_terminal() { active += 1; }
        }
        if active > MAX_ACTIVE_RECORDS { return Err(JournalError::Corrupt); }
        Ok(())
    }
    fn interrupt_old_generations(&mut self, generation: Uuid) -> bool {
        let mut changed = false;
        for task in &mut self.records {
            if !task.record.phase.is_terminal() && task.process_generation != generation {
                interrupt(&mut task.record, "process_restarted");
                changed = true;
            }
        }
        changed
    }
    fn interrupt_inactive(&mut self, generation: Uuid, active: Option<Uuid>) -> bool {
        let mut changed = false;
        for task in &mut self.records {
            if task.record.phase.is_terminal() { continue; }
            let current = task.process_generation == generation && active == Some(task.record.request_id);
            if !current {
                interrupt(&mut task.record, if task.process_generation == generation { "task_no_longer_active" } else { "process_restarted" });
                changed = true;
            }
        }
        changed
    }
}

fn interrupt(record: &mut ArchiveTaskRecord, code: &str) {
    if matches!(record.phase, ArchiveTaskPhase::Importing | ArchiveTaskPhase::Exporting | ArchiveTaskPhase::AwaitingDestination | ArchiveTaskPhase::Writing | ArchiveTaskPhase::Verifying) {
        record.partial_output = true;
    }
    record.phase = ArchiveTaskPhase::Interrupted;
    record.failure_code = Some(code.to_owned());
}
fn validate_record(record: &ArchiveTaskRecord) -> Result<(), JournalError> {
    if record.request_id.is_nil()
        || record.profile_id.is_some_and(|id| id.is_nil())
        || record.archive_sha256.as_ref().is_some_and(|sha| sha.len() != 64 || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || record.byte_length.is_some_and(|length| length > MAX_ARCHIVE_BYTES)
        || record.progress.bytes_processed > MAX_ARCHIVE_BYTES
        || record.progress.original_bytes_processed > MAX_ARCHIVE_BYTES
        || record.failure_code.as_ref().is_some_and(|code| code.is_empty() || code.len() > MAX_FAILURE_CODE_BYTES || !code.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'))
    { return Err(JournalError::InvalidTask); }
    Ok(())
}

#[derive(Clone)]
pub(super) struct ProfileArchiveJournal {
    root: PathBuf,
    process_generation: Uuid,
    lock: Arc<Mutex<()>>,
    unconfirmed: Arc<Mutex<HashSet<Uuid>>>,
}
impl ProfileArchiveJournal {
    pub(super) fn new(root: PathBuf, process_generation: Uuid) -> Self {
        Self { root, process_generation, lock: Arc::new(Mutex::new(())), unconfirmed: Arc::new(Mutex::new(HashSet::new())) }
    }

    pub(super) fn initialize(&self) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        let Some(mut manifest) = self.read_manifest()? else { return Ok(()); };
        if manifest.interrupt_old_generations(self.process_generation) {
            // If all old evidence is unresolved, preserve it and disable new admission.
            let _ = self.trim_terminal_history(&mut manifest, None);
            self.write_manifest(&manifest)?;
        }
        Ok(())
    }

    pub(super) fn begin(&self, mut record: ArchiveTaskRecord, active_request: Option<Uuid>) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        validate_record(&record)?;
        if record.phase != ArchiveTaskPhase::Preparing || record.failure_code.is_some() || record.partial_output {
            return Err(JournalError::InvalidTask);
        }
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        if manifest.records.iter().any(|row| row.record.request_id == record.request_id) {
            return Err(JournalError::DuplicateRequest);
        }
        manifest.interrupt_inactive(self.process_generation, active_request);
        let terminal_count = manifest.records.iter().filter(|row| row.record.phase.is_terminal()).count();
        if terminal_count >= MAX_TERMINAL_RECORDS && !self.has_evictable(&manifest, None) {
            return Err(JournalError::HistoryFull);
        }
        if manifest.records.len() >= MAX_TERMINAL_RECORDS + MAX_ACTIVE_RECORDS {
            self.evict_oldest_confirmed(&mut manifest, None)?;
        }
        record.progress = ArchiveProgress::default();
        manifest.records.push(PersistedTask {
            record,
            process_generation: self.process_generation,
            spool_identity: None,
        });
        manifest.validate()?;
        let request_id = manifest.records.last().ok_or(JournalError::InvalidTask)?.record.request_id;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => { self.remember_unconfirmed(request_id)?; Err(JournalError::CommitUnconfirmed) }
            result => result,
        }
    }

    pub(super) fn bind_spool_identity(
        &self,
        request_id: Uuid,
        identity: SpoolFileIdentity,
    ) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        let mut manifest = self.read_manifest()?.ok_or(JournalError::StaleTask)?;
        let task = manifest.records.iter_mut().find(|row| row.record.request_id == request_id)
            .ok_or(JournalError::StaleTask)?;
        if task.process_generation != self.process_generation || task.record.phase.is_terminal() {
            return Err(JournalError::StaleTask);
        }
        if let Some(existing) = task.spool_identity {
            return if existing == identity { Ok(()) } else { Err(JournalError::InvalidTransition) };
        }
        task.spool_identity = Some(identity);
        manifest.validate()?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => {
                self.remember_unconfirmed(request_id)?;
                Err(JournalError::CommitUnconfirmed)
            }
            result => result,
        }
    }

    pub(super) fn owned_spool_identity(
        &self,
        request_id: Uuid,
    ) -> Result<Option<SpoolFileIdentity>, JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        let Some(manifest) = self.read_manifest()? else { return Ok(None); };
        Ok(manifest.records.iter().find(|row| row.record.request_id == request_id)
            .and_then(|task| task.spool_identity))
    }

    pub(super) fn transition(&self, request_id: Uuid, expected: ArchiveTaskPhase, next: ArchiveTaskRecord) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        if next.request_id != request_id { return Err(JournalError::InvalidTask); }
        validate_record(&next)?;
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        let terminal = next.phase.is_terminal();
        {
            let task = manifest.records.iter_mut().find(|row| row.record.request_id == request_id).ok_or(JournalError::StaleTask)?;
            if task.process_generation != self.process_generation || task.record.phase != expected { return Err(JournalError::StaleTask); }
            if !expected.can_advance_to(next.phase) { return Err(JournalError::InvalidTransition); }
            task.record = next;
        }
        if terminal { self.trim_terminal_history(&mut manifest, Some(request_id))?; }
        manifest.validate()?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => { self.remember_unconfirmed(request_id)?; Err(JournalError::CommitUnconfirmed) }
            result => result,
        }
    }

    pub(super) fn checkpoint(&self, record: ArchiveTaskRecord) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        validate_record(&record)?;
        let request_id = record.request_id;
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        let task = manifest.records.iter_mut().find(|row| row.record.request_id == request_id).ok_or(JournalError::StaleTask)?;
        if task.process_generation != self.process_generation || task.record.phase != record.phase || task.record.phase.is_terminal() {
            return Err(JournalError::StaleTask);
        }
        task.record = record;
        manifest.validate()?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => { self.remember_unconfirmed(request_id)?; Err(JournalError::CommitUnconfirmed) }
            result => result,
        }
    }

    /// Explicit user abandonment changes only this local operation record. The
    /// caller must first verify/delete its exact request-derived private spool.
    pub(super) fn abandon(&self, request_id: Uuid) -> Result<(), JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        let mut manifest = self.read_manifest()?.unwrap_or_else(Manifest::empty);
        {
            let task = manifest.records.iter_mut().find(|row| row.record.request_id == request_id)
                .ok_or(JournalError::StaleTask)?;
            if matches!(task.record.phase, ArchiveTaskPhase::Succeeded | ArchiveTaskPhase::Cancelled) {
                return Err(JournalError::InvalidTransition);
            }
            task.record.phase = ArchiveTaskPhase::Cancelled;
            task.record.failure_code = Some("abandoned_by_user".into());
        }
        self.trim_terminal_history(&mut manifest, Some(request_id))?;
        manifest.validate()?;
        match self.write_manifest(&manifest) {
            Err(JournalError::CommitUnconfirmed) => {
                self.remember_unconfirmed(request_id)?;
                Err(JournalError::CommitUnconfirmed)
            }
            result => result,
        }
    }
    pub(super) fn history(&self, profile_id: Option<Uuid>, active_request: Option<Uuid>) -> Result<Vec<ArchiveTaskRecord>, JournalError> {
        let _guard = self.lock.lock().map_err(|_| JournalError::Unavailable)?;
        let Some(manifest) = self.read_manifest()? else { return Ok(Vec::new()); };
        let unconfirmed = self.unconfirmed.lock().map_err(|_| JournalError::Unavailable)?.clone();
        let mut rows = Vec::new();
        for task in manifest.records {
            if profile_id.is_some() && task.record.profile_id != profile_id { continue; }
            let mut record = task.record;
            if unconfirmed.contains(&record.request_id) { interrupt(&mut record, "receipt_unconfirmed"); }
            else if !record.phase.is_terminal() {
                let current = task.process_generation == self.process_generation && active_request == Some(record.request_id);
                if !current { interrupt(&mut record, if task.process_generation == self.process_generation { "task_no_longer_active" } else { "process_restarted" }); }
            }
            rows.push(record);
        }
        Ok(rows)
    }

    fn remember_unconfirmed(&self, request_id: Uuid) -> Result<(), JournalError> {
        self.unconfirmed.lock().map_err(|_| JournalError::Unavailable)?.insert(request_id);
        Ok(())
    }
    fn has_evictable(&self, manifest: &Manifest, protected: Option<Uuid>) -> bool {
        let spool = self.root.join("spool");
        manifest.records.iter().any(|row| Some(row.record.request_id) != protected
            && matches!(row.record.phase, ArchiveTaskPhase::Succeeded | ArchiveTaskPhase::Cancelled)
            && !row.has_spool(&spool))
    }
    fn trim_terminal_history(&self, manifest: &mut Manifest, protected: Option<Uuid>) -> Result<(), JournalError> {
        while manifest.records.iter().filter(|row| row.record.phase.is_terminal()).count() > MAX_TERMINAL_RECORDS {
            self.evict_oldest_confirmed(manifest, protected)?;
        }
        Ok(())
    }
    fn evict_oldest_confirmed(&self, manifest: &mut Manifest, protected: Option<Uuid>) -> Result<(), JournalError> {
        let spool = self.root.join("spool");
        let index = manifest.records.iter().position(|row| Some(row.record.request_id) != protected
            && matches!(row.record.phase, ArchiveTaskPhase::Succeeded | ArchiveTaskPhase::Cancelled)
            && !row.has_spool(&spool)).ok_or(JournalError::HistoryFull)?;
        manifest.records.remove(index);
        Ok(())
    }
    fn manifest_path(&self) -> PathBuf { self.root.join(MANIFEST_FILE_NAME) }
    fn read_manifest(&self) -> Result<Option<Manifest>, JournalError> {
        match fs::symlink_metadata(&self.root) {
            Ok(meta) if meta.file_type().is_dir() => {},
            Ok(_) => return Err(JournalError::Corrupt),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(JournalError::Unavailable),
        }
        let path = self.manifest_path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(JournalError::Unavailable),
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_MANIFEST_BYTES { return Err(JournalError::Corrupt); }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(path).map_err(|_| JournalError::Unavailable)?.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut bytes).map_err(|_| JournalError::Unavailable)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES { return Err(JournalError::Corrupt); }
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
        manifest.validate()?;
        Ok(Some(manifest))
    }
    fn write_manifest(&self, manifest: &Manifest) -> Result<(), JournalError> {
        manifest.validate()?;
        let bytes = serde_json::to_vec(manifest).map_err(|_| JournalError::Unavailable)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES { return Err(JournalError::HistoryFull); }
        fs::create_dir_all(&self.root).map_err(|_| JournalError::Unavailable)?;
        if !fs::symlink_metadata(&self.root).map_err(|_| JournalError::Unavailable)?.file_type().is_dir() { return Err(JournalError::Corrupt); }
        let path = self.manifest_path();
        if fs::symlink_metadata(&path).is_ok_and(|meta| !meta.file_type().is_file()) { return Err(JournalError::Corrupt); }
        let temporary = self.root.join(format!(".manifest-{}.tmp", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary).map_err(|_| JournalError::Unavailable)?;
        let mut renamed = false;
        let result = (|| {
            file.write_all(&bytes).map_err(|_| JournalError::Unavailable)?;
            file.sync_all().map_err(|_| JournalError::Unavailable)?;
            drop(file);
            fs::rename(&temporary, &path).map_err(|_| JournalError::Unavailable)?;
            renamed = true;
            #[cfg(unix)] File::open(&self.root).and_then(|dir| dir.sync_all()).map_err(|_| JournalError::CommitUnconfirmed)?;
            Ok(())
        })();
        if result.is_err() && !renamed { let _ = fs::remove_file(&temporary); }
        result
    }
}

impl PersistedTask {
    fn has_spool(&self, spool_dir: &Path) -> bool {
        let stem = self.record.request_id.to_string();
        [format!("{stem}.spool"), format!("{stem}.part")].iter().any(|name| fs::symlink_metadata(spool_dir.join(name)).is_ok())
    }
}
#[cfg(test)]
#[path = "beta_native_profile_archive_journal_tests.rs"]
mod tests;
