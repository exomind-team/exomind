//! Native owner for bounded, private profile archive tasks.
use super::{trusted_window, Failure, NativeState};
use exomind_beta_host::{
    ArchiveBudget, ArchiveLimits, BetaHost, ProfileArchiveError, ProfileArchiveExportReceipt,
    ProfileArchivePreview, ProfileArchiveProgress,
};
use exomind_core::{ProfileId, MAX_ORIGINAL_CHUNK_BYTES};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

#[path = "beta_native_profile_archive_journal.rs"]
mod journal;
#[cfg(test)]
#[path = "beta_native_profile_archive_tests.rs"]
mod tests;

use journal::{
    ArchiveDirection, ArchiveProgress, ArchiveTaskPhase, ArchiveTaskRecord, JournalError,
    ProfileArchiveJournal, SpoolFileIdentity,
};

const GIB: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = GIB;
const MAX_SPOOL_BYTES: u64 = 2 * GIB;
const MIN_FREE_SPACE_BYTES: u64 = 2 * GIB;
const MAX_TASK_TIME: Duration = Duration::from_secs(60 * 60);
const CHECKPOINT_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy)]
pub(super) struct NativeArchiveLimits {
    pub(super) max_total_bytes: u64,
    pub(super) max_spool_bytes: u64,
    pub(super) min_free_space_bytes: u64,
}

fn native_profile_archive_limits() -> NativeArchiveLimits {
    NativeArchiveLimits {
        max_total_bytes: MAX_ARCHIVE_BYTES,
        max_spool_bytes: MAX_SPOOL_BYTES,
        min_free_space_bytes: MIN_FREE_SPACE_BYTES,
    }
}

fn native_host_limits() -> Result<ArchiveLimits, ProfileArchiveError> {
    let mut limits = ArchiveLimits::default();
    limits.max_total_bytes = MAX_ARCHIVE_BYTES;
    limits.max_single_original_bytes = MAX_ARCHIVE_BYTES;
    ArchiveBudget::with_limits(limits.clone())?;
    Ok(limits)
}

fn ensure_native_archive_disk_budget(available_bytes: u64, incoming_bytes: u64) -> io::Result<()> {
    if incoming_bytes > MAX_ARCHIVE_BYTES
        || available_bytes < incoming_bytes.saturating_add(MIN_FREE_SPACE_BYTES)
    {
        return Err(io::Error::new(io::ErrorKind::Other, "archive storage budget exceeded"));
    }
    Ok(())
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}

fn journal_failure(error: JournalError) -> Failure {
    match error {
        JournalError::Corrupt => failure("archive_journal_corrupt", "档案操作历史损坏，原有资料已保留"),
        JournalError::Unavailable => failure("archive_storage_unavailable", "档案操作记录暂不可用"),
        JournalError::CommitUnconfirmed => failure("archive_receipt_unconfirmed", "操作回执未确认；请刷新历史，不会自动重发"),
        JournalError::InvalidTask => failure("archive_task_invalid", "档案任务状态无效"),
        JournalError::DuplicateRequest => failure("archive_request_reused", "此操作身份已使用，请重新发起"),
        JournalError::StaleTask => failure("archive_task_stale", "任务结果已过期，未覆盖当前状态"),
        JournalError::InvalidTransition => failure("archive_task_transition_invalid", "任务状态变化无效"),
        JournalError::HistoryFull => failure("archive_history_full", "未决档案操作占满本机恢复历史，请先处理未决任务"),
    }
}

fn archive_failure(error: ProfileArchiveError) -> Failure {
    match error {
        ProfileArchiveError::Host(error) => Failure::from(error),
        ProfileArchiveError::Core(error) => Failure::from(exomind_beta_host::HostError::Core(error)),
        ProfileArchiveError::Io(_) | ProfileArchiveError::Json(_) | ProfileArchiveError::Database(_) => {
            failure("archive_io", "档案文件读写失败，已有资料已保留")
        }
        ProfileArchiveError::InvalidFormat => failure("archive_invalid", "所选文件不是有效的外心档案包"),
        ProfileArchiveError::UnsupportedVersion => failure("archive_version_unsupported", "档案包版本暂不支持"),
        ProfileArchiveError::BudgetExceeded => failure("archive_budget_exceeded", "档案包超过本机大小或内容预算，未截断文件"),
        ProfileArchiveError::PreviewChanged => failure("archive_preview_changed", "档案内容、目标或预览已变化，请重新选择并预览"),
        ProfileArchiveError::Conflict => failure("archive_conflict", "档案包含冲突，现有内容未覆盖"),
        ProfileArchiveError::LocalIdentityCollision => failure("archive_identity_conflict", "档案来源与本机身份冲突"),
        ProfileArchiveError::Cancelled => failure("cancelled", "档案操作已停止，已保留可解释进度"),
        ProfileArchiveError::Busy => failure("archive_busy", "已有档案操作正在运行"),
        ProfileArchiveError::ProgressUnavailable => failure("archive_progress_unavailable", "档案进度暂不可读取"),
        ProfileArchiveError::OriginalIntegrityMismatch => failure("archive_hash_mismatch", "档案原件校验未通过"),
    }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ProfileArchiveCapabilitiesDto {
    schema: u8,
    supports_import: bool,
    supports_export: bool,
}
fn profile_archive_capabilities() -> ProfileArchiveCapabilitiesDto {
    ProfileArchiveCapabilitiesDto { schema: 1, supports_import: true, supports_export: true }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ProfileArchiveAcceptedDto {
    request_id: Uuid,
    accepted: bool,
}
impl ProfileArchiveAcceptedDto {
    fn accepted(request_id: Uuid) -> Self { Self { request_id, accepted: true } }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ProfileArchivePreviewDto {
    request_id: Uuid,
    profile_id: Uuid,
    source_display_name: Option<String>,
    archive_sha256: String,
    fact_count: u64,
    original_count: usize,
    conflict_count: usize,
    missing_original_count: usize,
    unverified_origin_count: usize,
    facts_complete: bool,
    proofs_complete: bool,
    bytes_complete: bool,
    target_bytes_complete: bool,
    can_import: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ProfileArchiveTaskDto {
    request_id: Uuid,
    profile_id: Option<Uuid>,
    direction: ArchiveDirection,
    phase: ArchiveTaskPhase,
    archive_sha256: Option<String>,
    archive_complete: Option<bool>,
    byte_length: Option<u64>,
    bytes_processed: u64,
    facts_processed: u64,
    original_bytes_processed: u64,
    failure_code: Option<String>,
    partial_output: bool,
    preview: Option<ProfileArchivePreviewDto>,
}
impl ProfileArchiveTaskDto {
    fn from_record(record: ArchiveTaskRecord, preview: Option<ProfileArchivePreviewDto>) -> Self {
        Self {
            request_id: record.request_id,
            profile_id: record.profile_id,
            direction: record.direction,
            phase: record.phase,
            archive_sha256: record.archive_sha256,
            archive_complete: record.archive_complete,
            byte_length: record.byte_length,
            bytes_processed: record.progress.bytes_processed,
            facts_processed: record.progress.facts_processed,
            original_bytes_processed: record.progress.original_bytes_processed,
            failure_code: record.failure_code,
            partial_output: record.partial_output,
            preview,
        }
    }
}

#[derive(Clone)]
pub(super) struct ArchiveSourceBinding {
    request_id: Uuid,
    profile_id: ProfileId,
    spool_id: Uuid,
    archive_sha256: String,
}
impl ArchiveSourceBinding {
    fn new(request_id: Uuid, profile_id: ProfileId, spool_id: Uuid, archive_sha256: String) -> Self {
        Self { request_id, profile_id, spool_id, archive_sha256 }
    }
    fn matches(&self, request_id: Uuid, profile_id: &ProfileId, spool_id: Uuid, sha256: &str) -> bool {
        self.request_id == request_id && self.profile_id == *profile_id
            && self.spool_id == spool_id && self.archive_sha256 == sha256
    }
}

fn validate_expected_profile_id(expected: Option<ProfileId>, actual: ProfileId) -> Result<(), Failure> {
    if expected.is_some_and(|profile| profile != actual) {
        return Err(failure("archive_expected_profile_mismatch", "备份中的档案身份与预期不一致"));
    }
    Ok(())
}

fn validate_export_for_save(
    result: Result<ProfileArchiveExportReceipt, ProfileArchiveError>,
    actual_sha256: &str,
) -> Result<ProfileArchiveExportReceipt, ProfileArchiveError> {
    let receipt = result?;
    verify_export_spool(&receipt, actual_sha256)?;
    Ok(receipt)
}
fn verify_export_spool(receipt: &ProfileArchiveExportReceipt, actual_sha256: &str) -> Result<(), ProfileArchiveError> {
    if receipt.archive_sha256 != actual_sha256 { return Err(ProfileArchiveError::OriginalIntegrityMismatch); }
    Ok(())
}

#[derive(Clone)]
struct ArchivePaths { root: PathBuf, spool: PathBuf }
#[derive(Clone)]
struct PreparedImport {
    preview_id: exomind_beta_host::ArchivePreviewId,
    binding: ArchiveSourceBinding,
    preview: ProfileArchivePreviewDto,
    can_import: bool,
}
#[derive(Default)]
struct RuntimeTasks {
    active: Option<Arc<ArchiveRun>>,
    prepared: Option<PreparedImport>,
}

pub(super) struct ProfileArchiveManager {
    root: PathBuf,
    host_root: PathBuf,
    paths: Mutex<Option<ArchivePaths>>,
    journal: ProfileArchiveJournal,
    runtime: Mutex<RuntimeTasks>,
    idle: Condvar,
    ready: AtomicBool,
    stopping: AtomicBool,
}
impl ProfileArchiveManager {
    pub(super) fn new(root: PathBuf, host_root: PathBuf) -> Self {
        let generation = Uuid::new_v4();
        Self {
            journal: ProfileArchiveJournal::new(root.clone(), generation),
            root,
            host_root,
            paths: Mutex::new(None),
            runtime: Mutex::new(RuntimeTasks::default()),
            idle: Condvar::new(),
            ready: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
        }
    }

    pub(super) fn initialize(&self) -> Result<(), Failure> {
        let base = self.root.parent().ok_or_else(storage_unavailable)?;
        fs::create_dir_all(base).map_err(|_| storage_unavailable())?;
        let base = base.canonicalize().map_err(|_| storage_unavailable())?;
        let host = self.host_root.canonicalize().map_err(|_| storage_unavailable())?;
        let root = base.join(self.root.file_name().ok_or_else(storage_unavailable)?);
        if root.starts_with(&host) || host.starts_with(&root) {
            return Err(storage_unavailable());
        }
        if let Ok(metadata) = fs::symlink_metadata(&root) {
            if !metadata.file_type().is_dir() { return Err(storage_unavailable()); }
        }
        fs::create_dir_all(&root).map_err(|_| storage_unavailable())?;
        let root = root.canonicalize().map_err(|_| storage_unavailable())?;
        if root.starts_with(&host) || host.starts_with(&root) { return Err(storage_unavailable()); }
        let spool = root.join("spool");
        if let Ok(metadata) = fs::symlink_metadata(&spool) {
            if !metadata.file_type().is_dir() { return Err(storage_unavailable()); }
        }
        fs::create_dir_all(&spool).map_err(|_| storage_unavailable())?;
        let spool = spool.canonicalize().map_err(|_| storage_unavailable())?;
        *self.paths.lock().map_err(|_| storage_unavailable())? = Some(ArchivePaths { root, spool });
        self.journal.initialize().map_err(journal_failure)?;
        self.ready.store(true, Ordering::Release);
        Ok(())
    }

    pub(super) fn is_ready(&self) -> bool { self.ready.load(Ordering::Acquire) }

    fn paths(&self) -> Result<ArchivePaths, Failure> {
        self.paths.lock().map_err(|_| storage_unavailable())?.clone().ok_or_else(storage_unavailable)
    }

    fn start_task(&self, mut record: ArchiveTaskRecord) -> Result<Arc<ArchiveRun>, Failure> {
        if !self.is_ready() || self.stopping.load(Ordering::Acquire) { return Err(storage_unavailable()); }
        let budget = ArchiveBudget::with_limits(native_host_limits().map_err(archive_failure)?).map_err(archive_failure)?;
        let mut runtime = self.runtime.lock().map_err(|_| storage_unavailable())?;
        if runtime.active.is_some() { return Err(failure("archive_busy", "已有档案操作正在运行")); }
        self.journal.begin(record.clone(), None).map_err(journal_failure)?;
        record.progress = ArchiveProgress::default();
        let run = Arc::new(ArchiveRun {
            journal: self.journal.clone(),
            record: Mutex::new(record),
            budget,
            expected_profile_id: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
            started: Instant::now(),
        });
        runtime.active = Some(run.clone());
        Ok(run)
    }

    fn begin_import(&self, request_id: Uuid, expected_profile_id: Option<ProfileId>) -> Result<Arc<ArchiveRun>, Failure> {
        let run = self.start_task(ArchiveTaskRecord {
            request_id,
            profile_id: None,
            direction: ArchiveDirection::Import,
            phase: ArchiveTaskPhase::Preparing,
            archive_sha256: None,
            archive_complete: None,
            byte_length: None,
            progress: ArchiveProgress::default(),
            failure_code: None,
            partial_output: false,
        })?;
        *run.expected_profile_id.lock().map_err(|_| storage_unavailable())? = expected_profile_id;
        run.transition(ArchiveTaskPhase::AwaitingSource, None, false).map_err(journal_failure)?;
        Ok(run)
    }

    fn begin_export(&self, request_id: Uuid, profile_id: Uuid) -> Result<Arc<ArchiveRun>, Failure> {
        self.reserve_spool(MAX_ARCHIVE_BYTES)?;
        let run = self.start_task(ArchiveTaskRecord {
            request_id,
            profile_id: Some(profile_id),
            direction: ArchiveDirection::Export,
            phase: ArchiveTaskPhase::Preparing,
            archive_sha256: None,
            archive_complete: None,
            byte_length: None,
            progress: ArchiveProgress::default(),
            failure_code: None,
            partial_output: false,
        })?;
        run.transition(ArchiveTaskPhase::Exporting, None, false).map_err(journal_failure)?;
        Ok(run)
    }

    fn reserve_spool(&self, incoming: u64) -> Result<(), Failure> {
        let paths = self.paths()?;
        let mut used = 0u64;
        let mut count = 0usize;
        for item in fs::read_dir(&paths.spool).map_err(|_| storage_unavailable())? {
            count += 1;
            if count > 128 { return Err(failure("archive_spool_full", "本机未决档案文件过多，未删除任何内容")); }
            let entry = item.map_err(|_| storage_unavailable())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|_| storage_unavailable())?;
            if !metadata.file_type().is_file() { return Err(storage_unavailable()); }
            used = used.checked_add(metadata.len()).ok_or_else(|| failure("archive_spool_full", "本机档案缓存预算溢出"))?;
        }
        if used.checked_add(incoming).map_or(true, |sum| sum > MAX_SPOOL_BYTES) {
            return Err(failure("archive_spool_full", "未决档案占满本机私有缓存，请先处理未决操作"));
        }
        let available = available_space(&paths.root).map_err(|_| storage_unavailable())?;
        ensure_native_archive_disk_budget(available, incoming).map_err(|_| failure("archive_free_space", "可用空间不足；至少保留 2 GiB 空间后重试"))
    }

    fn spool_path(&self, request_id: Uuid) -> Result<PathBuf, Failure> {
        Ok(PrivateProfileArchiveSpool::final_path(&self.paths()?.spool, request_id))
    }

    fn remove_owned_spool(
        &self,
        spool_root: &Path,
        record: &ArchiveTaskRecord,
    ) -> Result<(), Failure> {
        let identity = self.journal.owned_spool_identity(record.request_id).map_err(journal_failure)?;
        remove_resolved_spool(spool_root, record, identity)
    }

    fn store_preview(&self, run: &Arc<ArchiveRun>, host_preview: &ProfileArchivePreview, spool_id: Uuid, spool_sha: String, spool_len: u64) -> Result<(), Failure> {
        let profile_id = host_preview.profile_id;
        let profile_uuid = uuid_from_profile(profile_id)?;
        let request_id = run.record()?.request_id;
        let dto = preview_dto(request_id, host_preview, profile_uuid);
        run.update_record(|record| {
            record.profile_id = Some(profile_uuid);
            record.archive_sha256 = Some(spool_sha.clone());
            record.archive_complete = Some(host_preview.facts_complete && host_preview.proofs_complete && host_preview.bytes_complete && host_preview.target_bytes_complete);
            record.byte_length = Some(spool_len);
            record.progress.bytes_processed = spool_len;
            record.progress.facts_processed = host_preview.fact_count;
        }).map_err(journal_failure)?;
        validate_expected_profile_id(*run.expected_profile_id.lock().map_err(|_| storage_unavailable())?, profile_id)?;
        run.transition(ArchiveTaskPhase::PreviewReady, None, false).map_err(journal_failure)?;
        let prepared = PreparedImport {
            preview_id: host_preview.preview_id,
            binding: ArchiveSourceBinding::new(request_id, profile_id, spool_id, spool_sha),
            preview: dto,
            can_import: host_preview.can_import,
        };
        let mut runtime = self.runtime.lock().map_err(|_| storage_unavailable())?;
        if runtime.active.as_ref().map_or(true, |active| active.record().map(|r| r.request_id).ok() != Some(request_id)) {
            return Err(failure("archive_task_stale", "预览任务已过期"));
        }
        runtime.prepared = Some(prepared);
        Ok(())
    }

    fn confirm_import(&self, request_id: Uuid) -> Result<(Arc<ArchiveRun>, PreparedImport), Failure> {
        let mut runtime = self.runtime.lock().map_err(|_| storage_unavailable())?;
        let run = runtime.active.as_ref().filter(|run| run.record().is_ok_and(|row| row.request_id == request_id))
            .cloned().ok_or_else(|| failure("archive_preview_missing", "预览已过期，请重新选择并预览"))?;
        let prepared = runtime.prepared.as_ref().filter(|value| value.binding.request_id == request_id)
            .cloned().ok_or_else(|| failure("archive_preview_missing", "预览已过期，请重新选择并预览"))?;
        if !prepared.can_import { return Err(failure("archive_conflict", "预览包含冲突，不能导入")); }
        if let Err(error) = run.transition(ArchiveTaskPhase::Importing, None, false) {
            runtime.prepared = None;
            runtime.active = None;
            self.idle.notify_all();
            return Err(journal_failure(error));
        }
        runtime.prepared = None;
        Ok((run, prepared))
    }

    fn cancel(&self, request_id: Uuid) -> Result<bool, Failure> {
        let mut runtime = self.runtime.lock().map_err(|_| storage_unavailable())?;
        if let Some(run) = runtime.active.as_ref().filter(|run| run.record().is_ok_and(|row| row.request_id == request_id)).cloned() {
            if run.record()?.phase == ArchiveTaskPhase::PreviewReady {
                let paths = self.paths()?;
                self.remove_owned_spool(&paths.spool, &run.record()?)?;
                runtime.prepared = None;
                run.request_cancel();
                drop(runtime);
                self.finish(&run, ArchiveTaskPhase::Cancelled, Some("cancelled"), false, false)?;
                return Ok(true);
            }
            run.request_cancel();
            if run.record()?.phase != ArchiveTaskPhase::CancelRequested {
                run.transition(ArchiveTaskPhase::CancelRequested, None, run.record()?.partial_output).map_err(journal_failure)?;
            }
            return Ok(true);
        }
        drop(runtime);

        // The same explicit user action can abandon an old terminal operation.
        // It requires the request's persisted file identity and checks any journaled receipt.
        let Some(record) = self.journal.history(None, None).map_err(journal_failure)?
            .into_iter().find(|row| row.request_id == request_id) else { return Ok(false); };
        let paths = self.paths()?;
        if matches!(record.phase, ArchiveTaskPhase::Succeeded | ArchiveTaskPhase::Cancelled) {
            self.remove_owned_spool(&paths.spool, &record)?;
            return Ok(true);
        }
        if !matches!(record.phase, ArchiveTaskPhase::Failed | ArchiveTaskPhase::Interrupted) {
            return Ok(false);
        }
        self.remove_owned_spool(&paths.spool, &record)?;
        self.journal.abandon(request_id).map_err(journal_failure)?;
        Ok(true)
    }

    fn finish(&self, run: &Arc<ArchiveRun>, phase: ArchiveTaskPhase, code: Option<&'static str>, partial: bool, cleanup_spool: bool) -> Result<(), Failure> {
        let mut effective_code = code;
        if cleanup_spool {
            if let Ok(paths) = self.paths() {
                if self.remove_owned_spool(&paths.spool, &run.record()?).is_err() {
                    effective_code = Some("spool_cleanup_pending");
                }
            } else {
                effective_code = Some("spool_cleanup_pending");
            }
        }
        let result = run.transition(phase, effective_code, partial);
        let request_id = run.record()?.request_id;
        let mut runtime = self.runtime.lock().map_err(|_| storage_unavailable())?;
        if runtime.active.as_ref().is_some_and(|active| active.record().is_ok_and(|record| record.request_id == request_id)) {
            runtime.active = None;
            runtime.prepared = None;
            self.idle.notify_all();
        }
        result.map_err(journal_failure)
    }

    fn history(&self, profile_id: Option<Uuid>) -> Result<Vec<ProfileArchiveTaskDto>, Failure> {
        let active_request = self.active_request()?;
        let records = self.journal.history(profile_id, active_request).map_err(journal_failure)?;
        let prepared = self.runtime.lock().map_err(|_| storage_unavailable())?.prepared.as_ref().map(|value| (value.binding.request_id, value.preview.clone()));
        Ok(records.into_iter().map(|record| {
            let preview = prepared.as_ref().filter(|(id, _)| *id == record.request_id).map(|(_, preview)| preview.clone());
            ProfileArchiveTaskDto::from_record(record, preview)
        }).collect())
    }

    fn active_request(&self) -> Result<Option<Uuid>, Failure> {
        self.runtime.lock().map_err(|_| storage_unavailable())?.active.as_ref().map(|run| run.record().map(|record| record.request_id)).transpose()
    }

    pub(super) fn request_stop(&self) {
        self.stopping.store(true, Ordering::Release);
        let active = self.runtime.lock().ok().and_then(|runtime| runtime.active.clone());
        if let Some(run) = active {
            if let Ok(record) = run.record() {
                if record.phase == ArchiveTaskPhase::PreviewReady {
                    let _ = self.cancel(record.request_id);
                    return;
                }
            }
            run.request_cancel();
        }
    }

    pub(super) fn wait_empty(&self, timeout: Duration) -> Result<(), exomind_beta_host::HostError> {
        let end = Instant::now() + timeout;
        let mut runtime = self.runtime.lock().map_err(|_| exomind_beta_host::HostError::StatePoisoned)?;
        while runtime.active.is_some() {
            let remaining = end.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err(exomind_beta_host::HostError::Shutdown); }
            runtime = self.idle.wait_timeout(runtime, remaining).map_err(|_| exomind_beta_host::HostError::StatePoisoned)?.0;
        }
        Ok(())
    }

    #[cfg(test)]
    fn begin(&self, request_id: Uuid, profile_id: ProfileId, direction: ArchiveDirection) -> Result<ProfileArchiveLease, Failure> {
        let run = self.start_task(ArchiveTaskRecord {
            request_id,
            profile_id: Some(uuid_from_profile(profile_id)?),
            direction,
            phase: ArchiveTaskPhase::Preparing,
            archive_sha256: None,
            archive_complete: None,
            byte_length: None,
            progress: ArchiveProgress::default(),
            failure_code: None,
            partial_output: false,
        })?;
        Ok(ProfileArchiveLease { run })
    }

    #[cfg(test)]
    fn snapshot(&self, request_id: Uuid) -> Result<ProfileArchiveTaskDto, Failure> {
        let run = self.runtime.lock().map_err(|_| storage_unavailable())?.active.as_ref()
            .filter(|run| run.record().is_ok_and(|record| record.request_id == request_id))
            .cloned().ok_or_else(storage_unavailable)?;
        Ok(ProfileArchiveTaskDto::from_record(run.record()?, None))
    }
}

#[cfg(test)]
impl Default for ProfileArchiveManager {
    fn default() -> Self {
        let id = Uuid::new_v4();
        let base = std::env::temp_dir();
        let root = base.join(format!("beta-profile-archive-test-{id}"));
        let host = base.join(format!("beta-profile-archive-host-test-{id}"));
        fs::create_dir_all(&host).expect("create isolated host test root");
        let manager = Self::new(root, host);
        manager.initialize().expect("initialize isolated archive manager");
        manager
    }
}

#[cfg(test)]
pub(super) struct ProfileArchiveLease { run: Arc<ArchiveRun> }
#[cfg(test)]
impl ProfileArchiveLease { pub(super) fn check(&self) -> Result<(), Failure> { self.run.check() } }

struct ArchiveRun {
    journal: ProfileArchiveJournal,
    record: Mutex<ArchiveTaskRecord>,
    expected_profile_id: Mutex<Option<ProfileId>>,
    budget: ArchiveBudget,
    cancelled: AtomicBool,
    wake: tokio::sync::Notify,
    started: Instant,
}
impl ArchiveRun {
    fn record(&self) -> Result<ArchiveTaskRecord, Failure> {
        self.record.lock().map(|record| record.clone()).map_err(|_| storage_unavailable())
    }
    fn check(&self) -> Result<(), Failure> {
        if self.cancelled.load(Ordering::Acquire) { return Err(failure("cancelled", "档案任务正在停止")); }
        if self.started.elapsed() > MAX_TASK_TIME { return Err(failure("archive_timeout", "档案操作超过本机时间预算")); }
        Ok(())
    }
    fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.budget.cancel_handle().cancel();
        self.wake.notify_waiters();
    }
    async fn cancelled(&self) {
        loop {
            if self.cancelled.load(Ordering::Acquire) { return; }
            self.wake.notified().await;
        }
    }
    fn update_record(&self, update: impl FnOnce(&mut ArchiveTaskRecord)) -> Result<(), JournalError> {
        let mut record = self.record.lock().map_err(|_| JournalError::Unavailable)?;
        update(&mut record);
        self.journal.checkpoint(record.clone())?;
        Ok(())
    }
    fn checkpoint_host(&self, progress: ProfileArchiveProgress, force: bool) -> Result<(), JournalError> {
        let next = host_progress(progress);
        {
            let current = self.record.lock().map_err(|_| JournalError::Unavailable)?;
            let old = &current.progress;
            let changed = next.bytes_processed < old.bytes_processed
                || next.original_bytes_processed < old.original_bytes_processed
                || next.facts_processed < old.facts_processed
                || next.bytes_processed.saturating_sub(old.bytes_processed) >= CHECKPOINT_BYTES
                || next.original_bytes_processed.saturating_sub(old.original_bytes_processed) >= CHECKPOINT_BYTES
                || next.facts_processed.saturating_sub(old.facts_processed) >= 128;
            if !force && !changed { return Ok(()); }
        }
        self.update_record(|record| {
            record.progress = next;
        })
    }
    fn transition(&self, phase: ArchiveTaskPhase, failure_code: Option<&str>, partial_output: bool) -> Result<(), JournalError> {
        let mut record = self.record.lock().map_err(|_| JournalError::Unavailable)?;
        let expected = record.phase;
        let mut next = record.clone();
        next.phase = phase;
        next.failure_code = failure_code.map(str::to_owned);
        next.partial_output = partial_output;
        let result = self.journal.transition(next.request_id, expected, next.clone());
        *record = next;
        result
    }
}

fn storage_unavailable() -> Failure {
    failure("archive_storage_unavailable", "本机档案操作存储暂不可用；现有资料已保留")
}

fn uuid_from_profile(profile: ProfileId) -> Result<Uuid, Failure> {
    Uuid::parse_str(&profile.to_string()).map_err(|_| failure("invalid_profile", "档案身份无效"))
}

fn preview_dto(request_id: Uuid, preview: &ProfileArchivePreview, profile_uuid: Uuid) -> ProfileArchivePreviewDto {
    let source_display_name = preview.source_display_name.as_ref().filter(|name| {
        !name.is_empty() && name.len() <= 4096 && !name.chars().any(char::is_control)
    }).cloned();
    ProfileArchivePreviewDto {
        request_id,
        profile_id: profile_uuid,
        source_display_name,
        archive_sha256: preview.package_sha256.clone(),
        fact_count: preview.fact_count,
        original_count: preview.original_count,
        conflict_count: preview.conflicts.len(),
        missing_original_count: preview.missing_originals.len(),
        unverified_origin_count: preview.unverified_origins.len(),
        facts_complete: preview.facts_complete,
        proofs_complete: preview.proofs_complete,
        bytes_complete: preview.bytes_complete,
        target_bytes_complete: preview.target_bytes_complete,
        can_import: preview.can_import,
    }
}

#[cfg(unix)]
fn available_space(path: &Path) -> io::Result<u64> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid filesystem path"))?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
    let result = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 { return Err(io::Error::last_os_error()); }
    let stats = unsafe { stats.assume_init() };
    let available = (stats.f_bavail as u128) * (stats.f_frsize as u128);
    Ok(available.min(u64::MAX as u128) as u64)
}

#[cfg(windows)]
fn available_space(path: &Path) -> io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::GetDiskFreeSpaceExW,
    };
    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    wide.push(0);
    let mut available = 0u64;
    unsafe {
        GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available as *mut u64), None, None)
    }.map_err(|_| io::Error::last_os_error())?;
    Ok(available)
}

#[cfg(not(any(unix, windows)))]
fn available_space(_path: &Path) -> io::Result<u64> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "filesystem free space is unavailable"))
}

fn spool_usage(spool_root: &Path) -> io::Result<u64> {
    let mut total = 0u64;
    let mut entries = 0usize;
    match fs::read_dir(spool_root) {
        Ok(items) => for item in items {
            entries += 1;
            if entries > 128 { return Err(io::Error::new(io::ErrorKind::Other, "too many native spool entries")); }
            let entry = item?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if !metadata.file_type().is_file() { return Err(io::Error::new(io::ErrorKind::InvalidData, "unknown native spool entry")); }
            total = total.checked_add(metadata.len()).ok_or_else(|| io::Error::new(io::ErrorKind::Other, "spool size overflow"))?;
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    }
    Ok(total)
}

fn check_spool_budget(paths: &ArchivePaths, incoming: u64) -> Result<(), Failure> {
    let used = spool_usage(&paths.spool).map_err(|_| storage_unavailable())?;
    if incoming > MAX_ARCHIVE_BYTES || used.checked_add(incoming).map_or(true, |sum| sum > MAX_SPOOL_BYTES) {
        return Err(failure("archive_spool_full", "未决档案占满本机私有缓存；未删除历史或用户文件"));
    }
    let available = available_space(&paths.root).map_err(|_| storage_unavailable())?;
    ensure_native_archive_disk_budget(available, incoming)
        .map_err(|_| failure("archive_free_space", "可用空间不足；操作停止并保留至少 2 GiB 空间"))
}

pub(super) struct PrivateProfileArchiveSpool {
    path: PathBuf,
    sha256: String,
    byte_length: u64,
}
impl PrivateProfileArchiveSpool {
    pub(super) fn final_path(root: &Path, request_id: Uuid) -> PathBuf {
        root.join(format!("{request_id}.spool"))
    }
    pub(super) fn copy_from(
        root: &Path,
        request_id: Uuid,
        source: &mut impl Read,
        max_bytes: u64,
        journal: &ProfileArchiveJournal,
    ) -> io::Result<Self> {
        let mut writer = SpoolWriter::create_owned(root, request_id, max_bytes, None, journal)?;
        let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES.min(256 * 1024)];
        loop {
            let count = source.read(&mut buffer)?;
            if count == 0 { break; }
            writer.write_all(&buffer[..count])?;
        }
        writer.finish()
    }
}

struct SpoolWriter {
    root: PathBuf,
    temp_path: PathBuf,
    final_path: PathBuf,
    file: Option<File>,
    hasher: Sha256,
    byte_length: u64,
    max_bytes: u64,
    probe_root: Option<PathBuf>,
    next_space_check: u64,
    identity: SpoolFileIdentity,
}
impl SpoolWriter {
    fn create_owned(
        root: &Path,
        request_id: Uuid,
        max_bytes: u64,
        probe_root: Option<PathBuf>,
        journal: &ProfileArchiveJournal,
    ) -> io::Result<Self> {
        fs::create_dir_all(root)?;
        if !fs::symlink_metadata(root)?.file_type().is_dir() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "private spool root is not a directory"));
        }
        let final_path = PrivateProfileArchiveSpool::final_path(root, request_id);
        if fs::symlink_metadata(&final_path).is_ok() {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, "spool request already exists"));
        }
        let temp_path = root.join(format!("{request_id}.part"));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(windows)]
        windows_spool_ownership::configure_writer(&mut options);
        let file = options.open(&temp_path)?;
        let identity = spool_file_identity(&file)?;
        let writer = Self {
            root: root.to_path_buf(),
            temp_path,
            final_path,
            file: Some(file),
            hasher: Sha256::new(),
            byte_length: 0,
            max_bytes,
            probe_root,
            next_space_check: 0,
            identity,
        };
        sync_directory(root)?;
        journal.bind_spool_identity(request_id, identity)
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "spool ownership proof could not be persisted"))?;
        Ok(writer)
    }

    fn finish(mut self) -> io::Result<PrivateProfileArchiveSpool> {
        let mut file = self.file.take().ok_or_else(|| io::Error::new(io::ErrorKind::Other, "spool writer is closed"))?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::hard_link(&self.temp_path, &self.final_path)?;
        fs::remove_file(&self.temp_path)?;
        sync_directory(&self.root)?;
        Ok(PrivateProfileArchiveSpool {
            path: self.final_path.clone(),
            sha256: format!("{:x}", self.hasher.clone().finalize()),
            byte_length: self.byte_length,
        })
    }
}
impl Write for SpoolWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.is_empty() { return Ok(0); }
        let next = self.byte_length.checked_add(bytes.len() as u64)
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "archive length overflow"))?;
        if next > self.max_bytes || next > MAX_ARCHIVE_BYTES {
            return Err(io::Error::new(io::ErrorKind::Other, "archive_budget_exceeded"));
        }
        if let Some(root) = &self.probe_root {
            if self.byte_length >= self.next_space_check || bytes.len() as u64 >= CHECKPOINT_BYTES {
                let available = available_space(root)?;
                if available < MIN_FREE_SPACE_BYTES.saturating_add(bytes.len() as u64) {
                    return Err(io::Error::new(io::ErrorKind::Other, "archive_free_space"));
                }
                self.next_space_check = self.byte_length.saturating_add(CHECKPOINT_BYTES);
            }
        }
        let written = self.file.as_mut().ok_or_else(|| io::Error::new(io::ErrorKind::Other, "spool writer closed"))?.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.byte_length += written as u64;
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.as_mut().ok_or_else(|| io::Error::new(io::ErrorKind::Other, "spool writer closed"))?.flush()
    }
}
impl Drop for SpoolWriter {
    fn drop(&mut self) {
        self.file.take();
        if self.temp_path.parent() == Some(self.root.as_path()) {
            if let Ok(file) = open_spool_for_cleanup(&self.temp_path) {
                if spool_file_identity(&file).is_ok_and(|identity| identity == self.identity)
                    && delete_spool_path(&self.temp_path, &file, self.identity).is_ok()
                {
                    let _ = sync_directory(&self.root);
                }
            }
        }
    }
}

fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(unix)]
fn spool_file_identity(file: &File) -> io::Result<SpoolFileIdentity> {
    let metadata = file.metadata()?;
    spool_identity_from_metadata(&metadata)
}

#[cfg(unix)]
fn spool_identity_from_metadata(metadata: &fs::Metadata) -> io::Result<SpoolFileIdentity> {
    use std::os::unix::fs::MetadataExt;
    if !metadata.file_type().is_file() || metadata.nlink() != 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "spool is not a single-link regular file"));
    }
    Ok(SpoolFileIdentity::unix(metadata.dev(), metadata.ino()))
}

#[cfg(unix)]
fn open_spool_for_cleanup(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path)
}

#[cfg(windows)]
fn spool_file_identity(file: &File) -> io::Result<SpoolFileIdentity> {
    windows_spool_ownership::identity(file)
}

#[cfg(windows)]
fn open_spool_for_cleanup(path: &Path) -> io::Result<File> {
    windows_spool_ownership::open_for_cleanup(path)
}

#[cfg(not(any(unix, windows)))]
fn spool_file_identity(_file: &File) -> io::Result<SpoolFileIdentity> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "spool file identity is unsupported"))
}

#[cfg(not(any(unix, windows)))]
fn open_spool_for_cleanup(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "spool cleanup is unsupported"))
}

fn delete_spool_path(path: &Path, file: &File, expected: SpoolFileIdentity) -> io::Result<()> {
    if spool_file_identity(file)? != expected {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "spool file identity changed"));
    }
    #[cfg(unix)]
    {
        let metadata = fs::symlink_metadata(path)?;
        if spool_identity_from_metadata(&metadata)? != expected {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "spool path identity changed"));
        }
        fs::remove_file(path)
    }
    #[cfg(windows)]
    {
        windows_spool_ownership::delete(file)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Err(io::Error::new(io::ErrorKind::Unsupported, "spool cleanup is unsupported"))
    }
}

#[cfg(windows)]
mod windows_spool_ownership {
    use super::{io, File, OpenOptions, Path, SpoolFileIdentity};
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};

    const DELETE_ACCESS: u32 = 0x0001_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_DISPOSITION_INFO_CLASS: u32 = 4;

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileDispositionInformation {
        delete_file: i32,
    }

    #[link(name = "Kernel32")]
    extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            file: *mut std::ffi::c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;
        #[link_name = "SetFileInformationByHandle"]
        fn set_file_information_by_handle(
            file: *mut std::ffi::c_void,
            information_class: u32,
            information: *const std::ffi::c_void,
            information_size: u32,
        ) -> i32;
    }

    pub(super) fn configure_writer(options: &mut OpenOptions) {
        options
            .access_mode(GENERIC_WRITE | DELETE_ACCESS)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    pub(super) fn open_for_cleanup(path: &Path) -> io::Result<File> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .access_mode(GENERIC_READ | DELETE_ACCESS)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        options.open(path)
    }

    pub(super) fn identity(file: &File) -> io::Result<SpoolFileIdentity> {
        let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
        // SAFETY: The handle is live and the buffer matches BY_HANDLE_FILE_INFORMATION.
        let result = unsafe { get_file_information_by_handle(file.as_raw_handle(), information.as_mut_ptr()) };
        if result == 0 { return Err(io::Error::last_os_error()); }
        // SAFETY: Win32 initialized the full structure after returning nonzero.
        let information = unsafe { information.assume_init() };
        if information.number_of_links != 1
            || information.file_attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "spool is not a single-link regular file"));
        }
        let file_index = (u64::from(information.file_index_high) << 32)
            | u64::from(information.file_index_low);
        Ok(SpoolFileIdentity::windows(information.volume_serial_number, file_index))
    }

    pub(super) fn delete(file: &File) -> io::Result<()> {
        let disposition = FileDispositionInformation { delete_file: 1 };
        // SAFETY: The live handle has DELETE access and the record matches FILE_DISPOSITION_INFO.
        let result = unsafe {
            set_file_information_by_handle(
                file.as_raw_handle(),
                FILE_DISPOSITION_INFO_CLASS,
                &disposition as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<FileDispositionInformation>() as u32,
            )
        };
        if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }
}

fn spool_hash(path: &Path, run: &ArchiveRun) -> Result<(u64, String), Failure> {
    let metadata = fs::symlink_metadata(path).map_err(|_| storage_unavailable())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(failure("archive_spool_invalid", "私有档案副本无效或超过本机预算"));
    }
    let mut file = File::open(path).map_err(|_| storage_unavailable())?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES.min(256 * 1024)];
    loop {
        run.check()?;
        let count = file.read(&mut buffer).map_err(|_| storage_unavailable())?;
        if count == 0 { break; }
        total = total.checked_add(count as u64).ok_or_else(|| failure("archive_budget_exceeded", "档案长度溢出"))?;
        if total > MAX_ARCHIVE_BYTES { return Err(failure("archive_budget_exceeded", "档案超过 1 GiB 上限")); }
        hash.update(&buffer[..count]);
    }
    Ok((total, format!("{:x}", hash.finalize())))
}
fn translate_profile_archive_error(error: ProfileArchiveError) -> Failure { archive_failure(error) }

fn host_progress(value: ProfileArchiveProgress) -> ArchiveProgress {
    ArchiveProgress {
        bytes_processed: value.bytes_processed.min(MAX_ARCHIVE_BYTES),
        facts_processed: value.facts_processed,
        original_bytes_processed: value.original_bytes_processed.min(MAX_ARCHIVE_BYTES),
    }
}

async fn persist_host_progress(run: Arc<ArchiveRun>, force: bool) -> Result<(), Failure> {
    let progress = run.budget.progress().map_err(archive_failure)?;
    tauri::async_runtime::spawn_blocking(move || run.checkpoint_host(progress, force))
        .await
        .map_err(|_| failure("archive_progress_unavailable", "档案进度持久化任务中断"))?
        .map_err(journal_failure)
}

async fn await_host<T: Send + 'static>(
    run: Arc<ArchiveRun>,
    mut worker: tauri::async_runtime::JoinHandle<Result<T, ProfileArchiveError>>,
) -> Result<T, Failure> {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    let mut checkpoint_error = None;
    loop {
        tokio::select! {
            result = &mut worker => {
                if let Err(error) = persist_host_progress(run.clone(), true).await {
                    checkpoint_error.get_or_insert(error);
                }
                if let Some(error) = checkpoint_error { return Err(error); }
                return result
                    .map_err(|_| failure("archive_worker_interrupted", "档案任务中断，进度已保留"))?
                    .map_err(translate_profile_archive_error);
            }
            _ = interval.tick() => {
                if run.started.elapsed() >= MAX_TASK_TIME {
                    run.request_cancel();
                    checkpoint_error.get_or_insert(failure("archive_timeout", "档案操作超过本机时间预算"));
                }
                if let Err(error) = persist_host_progress(run.clone(), false).await {
                    run.request_cancel();
                    checkpoint_error.get_or_insert(error);
                }
            }
        }
    }
}

async fn choose_source(
    app: &AppHandle,
    window: &WebviewWindow,
    run: &ArchiveRun,
) -> Result<Option<FilePath>, Failure> {
    run.check()?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let dialog = app.dialog().file().add_filter("ExoMind Profile", &["exomind-profile"]);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let dialog = dialog.set_parent(window);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = window;
    dialog.pick_file(move |path| { let _ = send.send(path); });
    tokio::select! {
        result = receive => result.map_err(|_| failure("archive_picker_unavailable", "系统文件选择器未返回结果")),
        _ = run.cancelled() => Ok(None),
        _ = tokio::time::sleep(MAX_TASK_TIME.saturating_sub(run.started.elapsed())) => {
            Err(failure("archive_timeout", "等待系统文件选择器超过本机时间预算"))
        }
    }
}

async fn choose_destination(
    app: &AppHandle,
    window: &WebviewWindow,
    run: &ArchiveRun,
    suggested_name: String,
) -> Result<Option<FilePath>, Failure> {
    run.check()?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let dialog = app.dialog().file().set_file_name(suggested_name)
        .add_filter("ExoMind Profile", &["exomind-profile"]);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let dialog = dialog.set_parent(window);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = window;
    dialog.save_file(move |path| { let _ = send.send(path); });
    tokio::select! {
        result = receive => result.map_err(|_| failure("archive_picker_unavailable", "系统保存选择器未返回结果")),
        _ = run.cancelled() => Ok(None),
        _ = tokio::time::sleep(MAX_TASK_TIME.saturating_sub(run.started.elapsed())) => {
            Err(failure("archive_timeout", "等待系统保存选择器超过本机时间预算"))
        }
    }
}

fn copy_reader_to_spool(
    paths: &ArchivePaths,
    request_id: Uuid,
    expected_len: u64,
    mut input: impl Read,
    run: &ArchiveRun,
) -> Result<PrivateProfileArchiveSpool, Failure> {
    check_spool_budget(paths, expected_len).map_err(|error| error)?;
    if expected_len > MAX_ARCHIVE_BYTES { return Err(failure("archive_budget_exceeded", "档案超过 1 GiB 上限")); }
    let mut writer = SpoolWriter::create_owned(
        &paths.spool,
        request_id,
        MAX_ARCHIVE_BYTES,
        Some(paths.root.clone()),
        &run.journal,
    )
        .map_err(|_| storage_unavailable())?;
    let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES.min(256 * 1024)];
    let mut checkpoint_at = CHECKPOINT_BYTES;
    loop {
        run.check()?;
        let count = input.read(&mut buffer).map_err(|_| failure("archive_source_read", "系统所选档案读取失败"))?;
        if count == 0 { break; }
        writer.write_all(&buffer[..count]).map_err(|error| {
            if error.to_string() == "archive_budget_exceeded" { failure("archive_budget_exceeded", "档案超过 1 GiB 上限，未生成截断档案") }
            else if error.to_string() == "archive_free_space" { failure("archive_free_space", "可用空间不足；操作停止并保留 2 GiB 空间") }
            else { failure("archive_spool_write", "本机私有档案副本写入失败") }
        })?;
        let progress = writer.byte_length;
        if progress >= checkpoint_at {
            run.update_record(|record| {
                record.byte_length = Some(expected_len);
                record.progress.bytes_processed = progress;
            }).map_err(journal_failure)?;
            checkpoint_at = progress.saturating_add(CHECKPOINT_BYTES);
        }
    }
    if writer.byte_length != expected_len {
        return Err(failure("archive_source_changed", "所选档案长度在读取期间发生变化"));
    }
    run.check()?;
    let spool = writer.finish().map_err(|_| failure("archive_spool_commit_unconfirmed", "私有档案副本封口未确认"))?;
    run.update_record(|record| {
        record.archive_sha256 = Some(spool.sha256.clone());
        record.byte_length = Some(spool.byte_length);
        record.progress.bytes_processed = spool.byte_length;
    }).map_err(journal_failure)?;
    Ok(spool)
}

fn copy_selected_to_spool(
    app: &AppHandle,
    selected: FilePath,
    paths: &ArchivePaths,
    request_id: Uuid,
    run: &ArchiveRun,
) -> Result<PrivateProfileArchiveSpool, Failure> {
    match selected {
        FilePath::Path(path) => {
            if !path.is_absolute() || !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("exomind-profile")) {
                return Err(failure("archive_source_invalid", "请选择 .exomind-profile 档案文件"));
            }
            let metadata = fs::symlink_metadata(&path).map_err(|_| failure("archive_source_read", "系统所选档案不可读取"))?;
            if !metadata.file_type().is_file() { return Err(failure("archive_source_invalid", "系统所选档案不是普通文件")); }
            let file = File::open(path).map_err(|_| failure("archive_source_read", "系统所选档案不可读取"))?;
            copy_reader_to_spool(paths, request_id, metadata.len(), file, run)
        }
        FilePath::Url(uri) => {
            #[cfg(target_os = "android")]
            {
                use tauri_plugin_fs::FsExt;
                if uri.scheme() != "content" { return Err(failure("archive_source_invalid", "Android 选择器返回了不支持的文件地址")); }
                let mut options = tauri_plugin_fs::OpenOptions::new();
                options.read(true);
                let mut file = app.fs().open(FilePath::Url(uri), options)
                    .map_err(|_| failure("archive_source_read", "无法读取系统所选档案"))?;
                let length = file.metadata().map_err(|_| failure("archive_source_read", "无法读取档案长度"))?.len();
                copy_reader_to_spool(paths, request_id, length, &mut file, run)
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, uri);
                Err(failure("archive_source_invalid", "当前桌面选择器未返回本机文件路径"))
            }
        }
    }
}

async fn run_import_preview(
    app: AppHandle,
    window: WebviewWindow,
    state: Arc<NativeState>,
    run: Arc<ArchiveRun>,
) -> Result<(), Failure> {
    let selected = choose_source(&app, &window, &run).await?;
    let Some(selected) = selected else {
        state.profile_archives.finish(&run, ArchiveTaskPhase::Cancelled, Some("cancelled"), false, true)?;
        return Ok(());
    };
    if run.cancelled.load(Ordering::Acquire) {
        state.profile_archives.finish(&run, ArchiveTaskPhase::Cancelled, Some("cancelled"), false, true)?;
        return Ok(());
    }
    run.transition(ArchiveTaskPhase::Spooling, None, false).map_err(journal_failure)?;
    let paths = state.profile_archives.paths()?;
    let worker_run = run.clone();
    let worker_app = app.clone();
    let request_id = run.record()?.request_id;
    let spool = tauri::async_runtime::spawn_blocking(move || {
        copy_selected_to_spool(&worker_app, selected, &paths, request_id, &worker_run)
    }).await.map_err(|_| failure("archive_worker_interrupted", "档案读取任务中断"))??;
    run.check()?;
    let host = state.host.clone();
    let owner = state.owner.clone();
    let archive_path = spool.path.clone();
    let budget = run.budget.clone();
    let host_task = tauri::async_runtime::spawn_blocking(move || {
        let mut file = File::open(archive_path).map_err(ProfileArchiveError::Io)?;
        host.preview_profile_archive_import(&owner, &mut file, budget)
    });
    let preview = await_host(run.clone(), host_task).await?;
    run.check()?;
    state.profile_archives.store_preview(&run, &preview, request_id, spool.sha256, spool.byte_length)?;
    Ok(())
}

async fn run_import_preview_owned(
    app: AppHandle,
    window: WebviewWindow,
    state: Arc<NativeState>,
    run: Arc<ArchiveRun>,
) {
    if let Err(error) = run_import_preview(app, window, state.clone(), run.clone()).await {
        let current = run.record().ok();
        let canceled = run.cancelled.load(Ordering::Acquire) || error.code == "cancelled";
        let phase = if canceled { ArchiveTaskPhase::Cancelled } else { ArchiveTaskPhase::Failed };
        let partial = current.as_ref().is_some_and(|record| record.progress.bytes_processed > 0);
        let _ = state.profile_archives.finish(&run, phase, Some(error.code), partial, false);
    }
}

async fn run_import_confirm_owned(
    state: Arc<NativeState>,
    run: Arc<ArchiveRun>,
    prepared: PreparedImport,
) {
    let result = async {
        let paths = state.profile_archives.paths()?;
        let request_id = run.record()?.request_id;
        let spool_path = PrivateProfileArchiveSpool::final_path(&paths.spool, request_id);
        let (length, sha256) = spool_hash(&spool_path, &run)?;
        let record = run.record()?;
        let bound_profile_id = uuid_from_profile(prepared.binding.profile_id)?;
        if record.profile_id != Some(bound_profile_id)
            || !prepared.binding.matches(request_id, &prepared.binding.profile_id, request_id, &sha256)
            || prepared.binding.archive_sha256 != sha256
        {
            return Err(failure("archive_preview_changed", "私有档案副本或预览发生变化，请重新选择"));
        }
        if length != run.record()?.byte_length.unwrap_or(0) {
            return Err(failure("archive_preview_changed", "私有档案副本长度与预览不一致"));
        }
        let host = state.host.clone();
        let owner = state.owner.clone();
        let budget = run.budget.clone();
        let worker_path = spool_path.clone();
        let preview_id = prepared.preview_id;
        let host_task = tauri::async_runtime::spawn_blocking(move || {
            let mut input = File::open(worker_path).map_err(ProfileArchiveError::Io)?;
            host.import_profile_archive(&owner, preview_id, &mut input, budget)
        });
        let receipt = await_host(run.clone(), host_task).await?;
        run.checkpoint_host(run.budget.progress().map_err(archive_failure)?, true).map_err(journal_failure)?;
        let receipt_profile = uuid_from_profile(receipt.profile_id)?;
        if run.record()?.profile_id != Some(receipt_profile) {
            return Err(failure("archive_profile_changed", "导入回执的档案身份与预览不一致"));
        }
        run.update_record(|record| {
            record.archive_complete = Some(receipt.complete);
            record.profile_id = Some(receipt_profile);
        }).map_err(journal_failure)?;
        state.profile_archives.finish(&run, ArchiveTaskPhase::Succeeded, None, false, true)?;
        Ok::<(), Failure>(())
    }.await;
    if let Err(error) = result {
        let record = run.record().ok();
        let cancelled = run.cancelled.load(Ordering::Acquire) || error.code == "cancelled";
        let partial = record.as_ref().is_some_and(|value| value.progress.facts_processed > 0 || value.progress.original_bytes_processed > 0);
        let phase = if cancelled { ArchiveTaskPhase::Cancelled } else if error.code == "archive_receipt_unconfirmed" { ArchiveTaskPhase::Interrupted } else { ArchiveTaskPhase::Failed };
        let _ = state.profile_archives.finish(&run, phase, Some(error.code), partial, false);
    }
}

fn suggested_archive_name(profile_id: ProfileId) -> String {
    format!("profile-{}.exomind-profile", profile_id)
}

async fn run_export_owned(
    app: AppHandle,
    window: WebviewWindow,
    state: Arc<NativeState>,
    run: Arc<ArchiveRun>,
    profile_id: ProfileId,
    human: exomind_beta_host::Session,
) {
    let result = async {
        let paths = state.profile_archives.paths()?;
        let request_id = run.record()?.request_id;
        let writer_paths = paths.clone();
        let writer_run = run.clone();
        let host = state.host.clone();
        let profile = profile_id;
        let budget = run.budget.clone();
        let host_task = tauri::async_runtime::spawn_blocking(move || {
            let mut writer = SpoolWriter::create_owned(
                &writer_paths.spool,
                request_id,
                MAX_ARCHIVE_BYTES,
                Some(writer_paths.root.clone()),
                &writer_run.journal,
            )
                .map_err(ProfileArchiveError::Io)?;
            let receipt = host.export_profile_archive(&human, profile, &mut writer, budget)?;
            let spool = writer.finish().map_err(ProfileArchiveError::Io)?;
            validate_export_for_save(Ok(receipt), &spool.sha256).map(|receipt| (receipt, spool))
        });
        let (receipt, spool) = await_host(run.clone(), host_task).await?;
        let receipt_profile = uuid_from_profile(receipt.profile_id)?;
        if run.record()?.profile_id != Some(receipt_profile) {
            return Err(failure("archive_profile_changed", "导出回执的档案身份与所选档案不一致"));
        }
        run.update_record(|record| {
            record.archive_sha256 = Some(spool.sha256.clone());
            record.archive_complete = Some(receipt.complete);
            record.byte_length = Some(spool.byte_length);
            record.profile_id = Some(receipt_profile);
            record.progress.bytes_processed = spool.byte_length;
            record.progress.facts_processed = receipt.fact_count;
        }).map_err(journal_failure)?;
        run.transition(ArchiveTaskPhase::AwaitingDestination, None, false).map_err(journal_failure)?;
        let destination = choose_destination(&app, &window, &run, suggested_archive_name(profile_id)).await?;
        let Some(destination) = destination else {
            state.profile_archives.finish(&run, ArchiveTaskPhase::Cancelled, Some("cancelled"), false, true)?;
            return Ok::<(), Failure>(());
        };
        run.transition(ArchiveTaskPhase::Writing, None, false).map_err(journal_failure)?;
        let worker_app = app.clone();
        let worker_run = run.clone();
        let worker_spool = spool.path.clone();
        let worker_paths = paths.clone();
        let saved = tauri::async_runtime::spawn_blocking(move || {
            save_to_destination(&worker_app, destination, &worker_spool, &worker_paths, &worker_run)
        }).await.map_err(|_| failure("archive_worker_interrupted", "目的文件写入任务中断"))?;
        if let Err(saved) = saved {
            if saved.partial {
                if let Ok(mut record) = run.record.lock() { record.partial_output = true; }
            }
            return Err(saved.failure);
        }
        state.profile_archives.finish(&run, ArchiveTaskPhase::Succeeded, None, false, true)?;
        Ok::<(), Failure>(())
    }.await;
    if let Err(error) = result {
        let record = run.record().ok();
        let cancelled = run.cancelled.load(Ordering::Acquire) || error.code == "cancelled";
        let partial = error.code == "archive_destination_partial" || record.as_ref().is_some_and(|row|
            row.partial_output || row.phase == ArchiveTaskPhase::Verifying
                || (error.code == "archive_worker_interrupted" && row.phase == ArchiveTaskPhase::Writing));
        let phase = if cancelled { ArchiveTaskPhase::Cancelled } else if error.code == "archive_receipt_unconfirmed" { ArchiveTaskPhase::Interrupted } else { ArchiveTaskPhase::Failed };
        let _ = state.profile_archives.finish(&run, phase, Some(error.code), partial, false);
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn beta_profile_archive_capabilities(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<ProfileArchiveCapabilitiesDto, Failure> {
    trusted_window(&window, state.inner())?;
    let mut value = profile_archive_capabilities();
    value.supports_import = state.profile_archives.is_ready() && !state.closing.load(Ordering::Acquire);
    value.supports_export = value.supports_import;
    Ok(value)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) fn beta_profile_archive_history(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: Option<Uuid>,
) -> Result<Vec<ProfileArchiveTaskDto>, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) { return Err(failure("native_stopping", "应用正在关闭")); }
    state.profile_archives.history(profile_id)
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn beta_profile_archive_import_preview(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request_id: Uuid,
    expected_profile_id: Option<ProfileId>,
) -> Result<ProfileArchiveAcceptedDto, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) { return Err(failure("native_stopping", "应用正在关闭")); }
    if !state.profile_archives.is_ready() { return Err(storage_unavailable()); }
    let run = state.profile_archives.begin_import(request_id, expected_profile_id)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn(run_import_preview_owned(app, window, state, run));
    Ok(ProfileArchiveAcceptedDto::accepted(request_id))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn beta_profile_archive_import_confirm(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request_id: Uuid,
) -> Result<ProfileArchiveAcceptedDto, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) { return Err(failure("native_stopping", "应用正在关闭")); }
    let (run, prepared) = state.profile_archives.confirm_import(request_id)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn(run_import_confirm_owned(state, run, prepared));
    Ok(ProfileArchiveAcceptedDto::accepted(request_id))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn beta_profile_archive_export(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    request_id: Uuid,
) -> Result<ProfileArchiveAcceptedDto, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) { return Err(failure("native_stopping", "应用正在关闭")); }
    if !state.profile_archives.is_ready() { return Err(storage_unavailable()); }
    let human = state.inner().human(profile_id).map_err(Failure::from)?;
    let profile_uuid = uuid_from_profile(profile_id)?;
    let run = state.profile_archives.begin_export(request_id, profile_uuid)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn(run_export_owned(app, window, state, run, profile_id, human));
    Ok(ProfileArchiveAcceptedDto::accepted(request_id))
}

#[tauri::command(rename_all = "camelCase")]
pub(super) async fn beta_profile_archive_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request_id: Uuid,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) { return Err(failure("native_stopping", "应用正在关闭")); }
    let manager = state.profile_archives.clone();
    tauri::async_runtime::spawn_blocking(move || manager.cancel(request_id)).await
        .map_err(|_| failure("archive_worker_interrupted", "档案取消或暂存清理结果未确认"))?
}

fn hash_reader(mut reader: impl Read, run: Option<&ArchiveRun>) -> Result<(u64, String), Failure> {
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES.min(256 * 1024)];
    loop {
        if let Some(run) = run { run.check()?; }
        let count = reader.read(&mut buffer).map_err(|_| failure("archive_verify_failed", "文件读回校验失败"))?;
        if count == 0 { break; }
        total = total.checked_add(count as u64).ok_or_else(|| failure("archive_budget_exceeded", "档案长度溢出"))?;
        if total > MAX_ARCHIVE_BYTES { return Err(failure("archive_budget_exceeded", "档案超过 1 GiB 上限")); }
        hash.update(&buffer[..count]);
    }
    Ok((total, format!("{:x}", hash.finalize())))
}

fn hash_file(path: &Path) -> Result<(u64, String), Failure> {
    let metadata = fs::symlink_metadata(path).map_err(|_| storage_unavailable())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(failure("archive_spool_unverified", "私有档案文件类型或长度无法确认"));
    }
    hash_reader(File::open(path).map_err(|_| storage_unavailable())?, None)
}

fn remove_resolved_spool(
    spool_root: &Path,
    record: &ArchiveTaskRecord,
    expected_identity: Option<SpoolFileIdentity>,
) -> Result<(), Failure> {
    let request_id = record.request_id;
    let final_path = PrivateProfileArchiveSpool::final_path(spool_root, request_id);
    let partial_path = spool_root.join(format!("{request_id}.part"));
    let partial_exists = match fs::symlink_metadata(&partial_path) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => return Err(failure("archive_spool_unverified", "私有档案副本状态无法确认；保留任务记录")),
    };
    let final_exists = match fs::symlink_metadata(&final_path) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => return Err(failure("archive_spool_unverified", "私有档案副本状态无法确认；保留任务记录")),
    };
    let path = match (partial_exists, final_exists) {
        (false, false) => return Ok(()),
        (true, false) => &partial_path,
        (false, true) => &final_path,
        (true, true) => return Err(failure("archive_spool_unverified", "暂存文件名状态不明确；保留文件和任务记录")),
    };
    if path.parent() != Some(spool_root) {
        return Err(failure("archive_spool_unverified", "私有档案副本路径无效；保留任务记录"));
    }
    let expected_identity = expected_identity.ok_or_else(|| {
        failure("archive_spool_unverified", "任务没有文件创建证明；保留私有副本和任务记录")
    })?;
    let mut file = open_spool_for_cleanup(path)
        .map_err(|_| failure("archive_spool_unverified", "私有档案副本类型或链接状态无法确认；保留文件"))?;
    let actual_identity = spool_file_identity(&file)
        .map_err(|_| failure("archive_spool_unverified", "私有档案副本类型或链接状态无法确认；保留文件"))?;
    if actual_identity != expected_identity {
        return Err(failure("archive_spool_unverified", "私有档案副本已被替换；拒绝清理"));
    }
    if path == &final_path {
        match (record.byte_length, record.archive_sha256.as_deref()) {
            (Some(expected_length), Some(expected_sha)) => {
                let (actual_length, actual_sha) = hash_reader(&mut file, None)?;
                if actual_length != expected_length || actual_sha != expected_sha {
                    return Err(failure("archive_spool_unverified", "私有档案副本已变化；拒绝清理"));
                }
            }
            // A complete journaled receipt proves contents; otherwise ownership comes from file identity.
            _ => {}
        }
    }
    delete_spool_path(path, &file, expected_identity)
        .map_err(|_| failure("archive_spool_unverified", "私有档案副本删除前身份已变化；保留文件"))?;
    drop(file);
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Ok(_) => return Err(failure("archive_spool_cleanup_unconfirmed", "私有副本清理结果未确认；任务记录仍保留")),
        Err(_) => return Err(failure("archive_spool_cleanup_unconfirmed", "私有副本状态无法确认；任务记录仍保留")),
    }
    sync_directory(spool_root)
        .map_err(|_| failure("archive_spool_cleanup_unconfirmed", "私有副本清理结果未确认"))
}

struct SaveFailure { failure: Failure, partial: bool }
fn save_failure(code: &'static str, message: &'static str, partial: bool) -> SaveFailure {
    SaveFailure { failure: failure(code, message), partial }
}

fn save_to_destination(
    app: &AppHandle,
    destination: FilePath,
    spool_path: &Path,
    paths: &ArchivePaths,
    run: &ArchiveRun,
) -> Result<(), SaveFailure> {
    let record = run.record().map_err(|error| save_failure(error.code, error.message, false))?;
    let expected_length = record.byte_length.ok_or_else(|| save_failure("archive_spool_unverified", "档案长度未确认", false))?;
    let expected_sha = record.archive_sha256.as_deref().ok_or_else(|| save_failure("archive_spool_unverified", "档案 SHA-256 未确认", false))?;
    match destination {
        FilePath::Path(path) => save_to_path(path, spool_path, paths, run, expected_length, expected_sha),
        FilePath::Url(uri) => {
            #[cfg(target_os = "android")]
            { save_to_uri(app, uri, spool_path, run, expected_length, expected_sha) }
            #[cfg(not(target_os = "android"))]
            { let _ = (app, uri); Err(save_failure("archive_destination_invalid", "桌面保存选择器未返回本机路径", false)) }
        }
    }
}

#[cfg(not(target_os = "android"))]
fn save_to_path(
    destination: PathBuf,
    spool_path: &Path,
    _paths: &ArchivePaths,
    run: &ArchiveRun,
    expected_length: u64,
    expected_sha: &str,
) -> Result<(), SaveFailure> {
    if !destination.is_absolute() { return Err(save_failure("archive_destination_invalid", "保存位置无效", false)); }
    let name = destination.file_name().ok_or_else(|| save_failure("archive_destination_invalid", "保存文件名无效", false))?;
    let parent = destination.parent().ok_or_else(|| save_failure("archive_destination_invalid", "保存目录无效", false))?
        .canonicalize().map_err(|_| save_failure("archive_destination_unavailable", "保存目录不可用", false))?;
    let target = parent.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(save_failure("archive_destination_exists", "所选文件已存在且未被覆盖，请选择新文件名", false));
    }
    let available = available_space(&parent).map_err(|_| save_failure("archive_destination_space_unknown", "无法确认保存设备剩余空间", false))?;
    ensure_native_archive_disk_budget(available, expected_length)
        .map_err(|_| save_failure("archive_free_space", "保存设备空间不足；至少保留 2 GiB 空间", false))?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut output = options.open(&target).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            save_failure("archive_destination_exists", "所选文件已存在且未被覆盖，请选择新文件名", false)
        } else { save_failure("archive_destination_unavailable", "无法创建所选保存文件", false) }
    })?;
    copy_spool_to_writer(spool_path, &mut output, run, expected_length, expected_sha)
        .map_err(|error| save_failure(error.code, error.message, true))?;
    output.flush().map_err(|_| save_failure("archive_destination_partial", "保存文件可能只写入部分内容", true))?;
    output.sync_all().map_err(|_| save_failure("archive_destination_partial", "保存文件持久化未确认", true))?;
    drop(output);
    run.transition(ArchiveTaskPhase::Verifying, None, true)
        .map_err(|_| save_failure("archive_receipt_unconfirmed", "保存回执未确认；文件保留供核对", true))?;
    let (actual_length, actual_sha) = hash_file(&target).map_err(|error| save_failure(error.code, error.message, true))?;
    if actual_length != expected_length || actual_sha != expected_sha {
        return Err(save_failure("archive_destination_partial", "保存文件读回与档案 SHA 不一致；文件保留供核对", true));
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn save_to_uri(
    app: &AppHandle,
    uri: url::Url,
    spool_path: &Path,
    run: &ArchiveRun,
    expected_length: u64,
    expected_sha: &str,
) -> Result<(), SaveFailure> {
    use tauri_plugin_fs::FsExt;
    if uri.scheme() != "content" { return Err(save_failure("archive_destination_invalid", "Android 保存选择器返回了不支持的位置", false)); }
    let destination = FilePath::Url(uri);
    let mut options = tauri_plugin_fs::OpenOptions::new();
    options.read(true).write(true);
    let mut output = app.fs().open(destination.clone(), options)
        .map_err(|_| save_failure("archive_destination_unavailable", "无法打开系统保存文档", false))?;
    if output.metadata().map_err(|_| save_failure("archive_destination_unavailable", "无法读取系统保存文档状态", false))?.len() != 0 {
        return Err(save_failure("archive_destination_exists", "所选文档已有内容且未被覆盖，请创建新文档", false));
    }
    copy_spool_to_writer(spool_path, &mut output, run, expected_length, expected_sha)
        .map_err(|error| save_failure(error.code, error.message, true))?;
    output.flush().map_err(|_| save_failure("archive_destination_partial", "系统文档可能只写入部分内容", true))?;
    output.sync_all().map_err(|_| save_failure("archive_destination_partial", "系统文档持久化未确认", true))?;
    drop(output);
    run.transition(ArchiveTaskPhase::Verifying, None, true)
        .map_err(|_| save_failure("archive_receipt_unconfirmed", "保存回执未确认；系统文档保留供核对", true))?;
    let mut options = tauri_plugin_fs::OpenOptions::new();
    options.read(true);
    let mut input = app.fs().open(destination, options)
        .map_err(|_| save_failure("archive_destination_partial", "无法重新读取系统文档；文档保留供核对", true))?;
    let (actual_length, actual_sha) = hash_reader(&mut input, Some(run))
        .map_err(|error| save_failure(error.code, error.message, true))?;
    if actual_length != expected_length || actual_sha != expected_sha {
        return Err(save_failure("archive_destination_partial", "系统文档读回与档案 SHA 不一致；文档保留供核对", true));
    }
    Ok(())
}

fn copy_spool_to_writer(
    spool_path: &Path,
    output: &mut impl Write,
    run: &ArchiveRun,
    expected_length: u64,
    expected_sha: &str,
) -> Result<(), Failure> {
    let mut input = File::open(spool_path).map_err(|_| failure("archive_spool_unavailable", "私有档案副本不可读取"))?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut next_checkpoint = CHECKPOINT_BYTES;
    let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES.min(256 * 1024)];
    loop {
        run.check()?;
        let count = input.read(&mut buffer).map_err(|_| failure("archive_spool_read", "私有档案副本读取失败"))?;
        if count == 0 { break; }
        total = total.checked_add(count as u64).ok_or_else(|| failure("archive_budget_exceeded", "档案长度溢出"))?;
        if total > expected_length || total > MAX_ARCHIVE_BYTES { return Err(failure("archive_spool_changed", "私有档案副本长度发生变化")); }
        output.write_all(&buffer[..count]).map_err(|_| failure("archive_destination_partial", "目的文件写入失败"))?;
        hash.update(&buffer[..count]);
        if total >= next_checkpoint {
            run.update_record(|record| record.progress.bytes_processed = total).map_err(journal_failure)?;
            next_checkpoint = total.saturating_add(CHECKPOINT_BYTES);
        }
    }
    run.update_record(|record| record.progress.bytes_processed = total).map_err(journal_failure)?;
    if total != expected_length || format!("{:x}", hash.finalize()) != expected_sha {
        return Err(failure("archive_spool_changed", "私有档案副本校验未通过"));
    }
    Ok(())
}
