//! Main-window, one-original export. The save picker owns destination choice;
//! frontend arguments contain only source IDs and a cancellation request ID.
use super::{Failure, NativeState, trusted_window};
use exomind_beta_host::HostError;
use exomind_core::{MAX_ORIGINAL_CHUNK_BYTES, OriginalId, OriginalRef, ProfileId};
#[path = "beta_export_journal.rs"]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
mod journal;
#[cfg(target_os = "android")]
use journal::{ExportJournal, ExportTaskPhase};
use journal::{ExportTaskRecord, JournalError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, atomic::Ordering},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

#[path = "beta_native_export_manager.rs"]
mod manager;
pub(super) use manager::ExportManager;
use manager::ExportLease;
#[path = "beta_native_original_source.rs"]
mod source;
use source::Source;

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}
fn cancelled() -> Failure {
    failure("export_cancelled", "导出已取消，原件保持不变")
}
fn incomplete() -> Failure {
    failure(
        "export_incomplete",
        "导出未完成，保存位置可能保留未完成的新文档；原件保持不变",
    )
}
fn interrupted() -> Failure {
    failure(
        "export_interrupted",
        "导出已中断；原件保持不变，所选位置可能为空或未完成，请检查后重新选择位置",
    )
}
#[cfg(target_os = "android")]
fn receipt_unconfirmed() -> Failure {
    failure(
        "export_receipt_unconfirmed",
        "所选位置可能已写入完整文件，但完成回执未确认；原件保持不变，请先检查位置，不会自动重试",
    )
}

fn journal_failure(error: JournalError) -> Failure {
    match error {
        JournalError::Corrupt => failure(
            "export_journal_corrupt",
            "原件导出历史损坏，原文件已保留；请保留本机资料并检查日志",
        ),
        JournalError::Unavailable => failure(
            "export_journal_unavailable",
            "本机导出任务记录无法确认；原件已保留，可能存在的目标文件不会被修改或清理",
        ),
        JournalError::CommitUnconfirmed => failure(
            "export_journal_commit_unconfirmed",
            "本机导出回执已尝试替换但目录持久化未确认；任务结果不视为完成，请保留原件并检查历史",
        ),
        JournalError::InvalidTask => failure(
            "export_journal_invalid",
            "原件导出任务元数据无效，未打开系统保存对话框",
        ),
        JournalError::DuplicateRequest => {
            failure("export_request_reused", "此导出请求已使用，请重新发起导出")
        }
        JournalError::StaleTask => {
            failure("export_task_stale", "导出回执已过期，没有覆盖当前任务状态")
        }
        JournalError::InvalidTransition => failure(
            "export_task_transition_invalid",
            "导出任务状态变化无效，未确认本次结果",
        ),
    }
}

#[cfg(target_os = "android")]
fn start_journal_failure(error: JournalError) -> Failure {
    match error {
        JournalError::Unavailable => failure(
            "export_journal_unavailable",
            "导出任务未能持久保存，未打开系统保存对话框；原件保持不变",
        ),
        JournalError::CommitUnconfirmed => failure(
            "export_journal_commit_unconfirmed",
            "导出任务记录提交结果未确认，未打开系统保存对话框；原件保持不变，请先检查导出历史",
        ),
        other => journal_failure(other),
    }
}

#[cfg(target_os = "android")]
fn persist_failure(
    journal: &ExportJournal,
    request_id: Uuid,
    phase: ExportTaskPhase,
    error: &Failure,
    partial_output: bool,
) -> Failure {
    let next = if error.code == "export_interrupted" {
        ExportTaskPhase::Interrupted
    } else if error.code == "export_cancelled" {
        ExportTaskPhase::Cancelled
    } else {
        ExportTaskPhase::Failed
    };
    journal
        .transition(
            request_id,
            phase,
            next,
            Some(error.code.to_owned()),
            partial_output,
        )
        .map_or_else(
            |_| receipt_unconfirmed(),
            |_| Failure {
                code: error.code,
                message: error.message,
            },
        )
}

#[cfg(target_os = "android")]
fn export_journal_root(app: &AppHandle, host_root: &Path) -> Result<PathBuf, JournalError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| JournalError::Unavailable)?
        .canonicalize()
        .map_err(|_| JournalError::Unavailable)?;
    let host_root = host_root
        .canonicalize()
        .map_err(|_| JournalError::Unavailable)?;
    let root = base.join("beta-native-export-recovery");

    // Native recovery is a sibling of beta-host. Refuse a custom Host root
    // that would make this file part of Host's strict ownership inventory.
    if root.starts_with(&host_root) {
        return Err(JournalError::Unavailable);
    }
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) => {
            if !metadata.file_type().is_dir() {
                return Err(JournalError::Unavailable);
            }
            if root
                .canonicalize()
                .map_err(|_| JournalError::Unavailable)?
                .starts_with(&host_root)
            {
                return Err(JournalError::Unavailable);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(JournalError::Unavailable),
    }
    Ok(root)
}

/// Called from Native setup after the Host root is known. Setup reports any
/// error without failing Beta startup; history re-reads the manifest read-only
/// so a later recovered storage location can still project interrupted work.
pub(super) fn initialize_journal(app: &AppHandle, host_root: &Path) -> Result<(), Failure> {
    #[cfg(target_os = "android")]
    {
        export_journal_root(app, host_root)
            .and_then(|root| {
                ExportJournal::new(root, journal::current_process_generation()).initialize()
            })
            .map_err(journal_failure)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, host_root);
        Ok(())
    }
}
fn io_failure() -> Failure {
    failure(
        "export_io",
        "无法写入所选位置，原文件未被覆盖，请检查空间与权限",
    )
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum ExportResult {
    Cancelled {
        cancelled: bool,
        partial_output: bool,
    },
    Saved {
        cancelled: bool,
        byte_length: u64,
        sha256: String,
    },
}
impl ExportResult {
    fn cancelled(partial_output: bool) -> Self {
        Self::Cancelled {
            cancelled: true,
            partial_output,
        }
    }
    fn saved(original: &OriginalRef) -> Self {
        Self::Saved {
            cancelled: false,
            byte_length: original.byte_length,
            sha256: original.sha256.clone(),
        }
    }
}
fn stream_source(
    source: &Source,
    output: &mut impl Write,
    lease: &ExportLease,
) -> Result<(), Failure> {
    stream_original(
        &source.original,
        |offset, length| source.read(offset, length),
        output,
        lease,
    )
}
fn stream_original(
    original: &OriginalRef,
    mut read: impl FnMut(u64, usize) -> Result<Vec<u8>, Failure>,
    output: &mut impl Write,
    lease: &ExportLease,
) -> Result<(), Failure> {
    lease.check()?;
    let mut hash = Sha256::new();
    let mut offset = 0;
    if original.byte_length == 0 && !read(0, 1)?.is_empty() {
        return Err(failure("original_integrity", "空原件返回了不匹配字节"));
    }
    while offset < original.byte_length {
        lease.check()?;
        let length = (original.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
        let bytes = read(offset, length)?;
        if bytes.len() != length {
            return Err(failure("original_incomplete", "原件读取未完整，未完成导出"));
        }
        output.write_all(&bytes).map_err(|_| io_failure())?;
        hash.update(&bytes);
        offset += bytes.len() as u64;
    }
    lease.check()?;
    if offset != original.byte_length || format!("{:x}", hash.finalize()) != original.sha256 {
        return Err(failure(
            "original_integrity",
            "原件完整性校验失败，未发布导出文件",
        ));
    }
    output.flush().map_err(|_| io_failure())?;
    Ok(())
}
fn verify_reader(
    reader: &mut impl Read,
    original: &OriginalRef,
    lease: &ExportLease,
) -> Result<(), Failure> {
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
    loop {
        lease.check()?;
        let length = reader.read(&mut buffer).map_err(|_| incomplete())?;
        if length == 0 {
            break;
        }
        count = count.checked_add(length as u64).ok_or_else(incomplete)?;
        if count > original.byte_length {
            return Err(incomplete());
        }
        hash.update(&buffer[..length]);
    }
    if count != original.byte_length || format!("{:x}", hash.finalize()) != original.sha256 {
        return Err(incomplete());
    }
    Ok(())
}

struct Temporary {
    path: PathBuf,
    parent: PathBuf,
    file: Option<File>,
}
impl Temporary {
    fn create(parent: &Path) -> Result<Self, Failure> {
        let parent = parent.canonicalize().map_err(|_| io_failure())?;
        if !parent.is_dir() {
            return Err(io_failure());
        }
        let path = parent.join(format!(".exomind-export-{}.partial", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path).map_err(|_| io_failure())?;
        Ok(Self {
            path,
            parent,
            file: Some(file),
        })
    }
    fn file(&mut self) -> Result<&mut File, Failure> {
        self.file.as_mut().ok_or_else(io_failure)
    }
    fn sync(&self) -> Result<(), Failure> {
        self.file
            .as_ref()
            .ok_or_else(io_failure)?
            .sync_all()
            .map_err(|_| io_failure())
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        self.file.take();
        // Only this exact create_new path is owned. Never scan/delete a parent
        // or try to remove a destination selected by the user.
        if self.path.parent() == Some(self.parent.as_path())
            && std::fs::symlink_metadata(&self.path)
                .is_ok_and(|metadata| metadata.file_type().is_file())
        {
            if std::fs::remove_file(&self.path).is_err() {
                log::warn!("Beta export temporary cleanup remains incomplete");
            }
        }
    }
}
pub(super) fn suggested_name(name: &str) -> String {
    let mut clean = String::new();
    let mut units = 0;
    for character in name.chars() {
        let character = if character.is_control() || "<>:\"/\\|?*".contains(character) {
            '_'
        } else {
            character
        };
        let size = character.len_utf16();
        if units + size > 240 {
            break;
        }
        clean.push(character);
        units += size;
    }
    let clean = clean.trim_end_matches(|character| character == '.' || character == ' ');
    let stem = clean.split('.').next().unwrap_or("").to_ascii_uppercase();
    if clean.is_empty()
        || matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    {
        "原件".into()
    } else {
        clean.into()
    }
}
enum PickerOutcome {
    Selected(FilePath),
    Cancelled { partial_output: bool },
    Interrupted,
}

async fn choose_destination(
    app: &AppHandle,
    window: &WebviewWindow,
    original: &OriginalRef,
    lease: &ExportLease,
) -> Result<PickerOutcome, Failure> {
    lease.check()?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let dialog = app
        .dialog()
        .file()
        .set_file_name(suggested_name(&original.file_name));
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let dialog = dialog.set_parent(window);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = window;
    dialog.save_file(move |path| {
        let _ = send.send(path);
    });
    tokio::select! {
        biased;
        _ = lease.cancellation() => {
            if lease.explicitly_cancelled() {
                // A save may have been confirmed by DocumentsUI just before
                // the exact-request cancellation reached this Native task.
                Ok(PickerOutcome::Cancelled { partial_output: true })
            } else {
                Ok(PickerOutcome::Interrupted)
            }
        }
        path = receive => match path.map_err(|_| io_failure())? {
            Some(path) => Ok(PickerOutcome::Selected(path)),
            None => Ok(PickerOutcome::Cancelled { partial_output: false }),
        }
    }
}

#[cfg(not(target_os = "android"))]
fn export_path(
    source: &Source,
    destination: FilePath,
    lease: &ExportLease,
) -> Result<ExportResult, Failure> {
    let FilePath::Path(destination) = destination else {
        return Err(io_failure());
    };
    if !destination.is_absolute() {
        return Err(io_failure());
    }
    let name = destination.file_name().ok_or_else(io_failure)?;
    let parent = destination
        .parent()
        .ok_or_else(io_failure)?
        .canonicalize()
        .map_err(|_| io_failure())?;
    let target = parent.join(name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(failure(
            "export_exists",
            "目标文件已存在且未被覆盖，请选择新的文件名",
        ));
    }
    let mut temporary = Temporary::create(&parent)?;
    stream_source(source, temporary.file()?, lease)?;
    temporary.sync()?;
    temporary
        .file()?
        .seek(SeekFrom::Start(0))
        .map_err(|_| io_failure())?;
    verify_reader(temporary.file()?, &source.original, lease)?;
    source.finish()?;
    lease.admit_publish()?;
    // Same-directory no-clobber publication. A file appearing after the picker
    // also wins over this export; the caller never overwrites it on retry.
    std::fs::hard_link(&temporary.path, &target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            failure(
                "export_exists",
                "目标文件已存在且未被覆盖，请选择新的文件名",
            )
        } else {
            io_failure()
        }
    })?;
    Ok(ExportResult::saved(&source.original))
}

#[cfg(target_os = "android")]
fn prepare_android(
    source: &Source,
    cache: &Path,
    lease: &ExportLease,
) -> Result<Temporary, Failure> {
    std::fs::create_dir_all(cache).map_err(|_| io_failure())?;
    let mut temporary = Temporary::create(cache)?;
    stream_source(source, temporary.file()?, lease)?;
    temporary.sync()?;
    Ok(temporary)
}
#[cfg(target_os = "android")]
struct AndroidExportAttempt {
    result: Result<ExportResult, Failure>,
    phase: ExportTaskPhase,
    partial_output: bool,
}

#[cfg(target_os = "android")]
fn export_document(
    app: &AppHandle,
    source: &Source,
    prepared: &mut Temporary,
    destination: FilePath,
    journal: &ExportJournal,
    request_id: Uuid,
    lease: &ExportLease,
) -> AndroidExportAttempt {
    use tauri_plugin_fs::FsExt;
    let FilePath::Url(uri) = destination else {
        return AndroidExportAttempt {
            result: Err(incomplete()),
            phase: ExportTaskPhase::Writing,
            partial_output: true,
        };
    };
    if uri.scheme() != "content" {
        return AndroidExportAttempt {
            result: Err(incomplete()),
            phase: ExportTaskPhase::Writing,
            partial_output: true,
        };
    }
    let destination = FilePath::Url(uri);
    let mut phase = ExportTaskPhase::Writing;
    let write_result = (|| -> Result<(), Failure> {
        lease.check()?;
        source.finish()?;
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true).write(true);
        let mut output = app
            .fs()
            .open(destination.clone(), options)
            .map_err(|_| incomplete())?;
        let mut existing = [0u8; 1];
        if output.metadata().map_err(|_| incomplete())?.len() != 0
            || output.read(&mut existing).map_err(|_| incomplete())? != 0
        {
            return Err(failure(
                "export_exists",
                "所选文档已有内容且未被覆盖，请创建新的文档",
            ));
        }
        prepared
            .file()?
            .seek(SeekFrom::Start(0))
            .map_err(|_| incomplete())?;
        let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
        loop {
            lease.check()?;
            let length = prepared
                .file()?
                .read(&mut buffer)
                .map_err(|_| incomplete())?;
            if length == 0 {
                break;
            }
            output
                .write_all(&buffer[..length])
                .map_err(|_| incomplete())?;
        }
        output.flush().map_err(|_| incomplete())?;
        output.sync_all().map_err(|_| incomplete())?;
        drop(output);
        journal
            .transition(
                request_id,
                ExportTaskPhase::Writing,
                ExportTaskPhase::Verifying,
                None,
                true,
            )
            .map_err(|_| receipt_unconfirmed())?;
        phase = ExportTaskPhase::Verifying;
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true);
        let mut check = app
            .fs()
            .open(destination, options)
            .map_err(|_| incomplete())?;
        verify_reader(&mut check, &source.original, lease)?;
        source.finish()?;
        lease.admit_publish()?;
        Ok(())
    })();
    let (result, partial_output) = match write_result {
        Ok(()) => (Ok(ExportResult::saved(&source.original)), false),
        Err(error) if error.code == "export_exists" => (Err(error), false),
        Err(error) if error.code == "export_receipt_unconfirmed" => (Err(error), true),
        Err(_) if lease.explicitly_cancelled() => (Ok(ExportResult::cancelled(true)), true),
        Err(_) if lease.stopped_without_explicit_cancel() => (Err(interrupted()), true),
        Err(error) => (Err(error), true),
    };
    AndroidExportAttempt {
        result,
        phase,
        partial_output,
    }
}

#[tauri::command]
pub(super) async fn beta_export_original(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    request_id: Uuid,
) -> Result<ExportResult, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(Failure::from(HostError::Stopped));
    }
    #[cfg(target_os = "android")]
    let record_profile_id = profile_id
        .to_string()
        .parse::<Uuid>()
        .map_err(|_| failure("invalid_profile", "档案身份无效，无法记录导出任务"))?;
    let lease = state.exports.begin(request_id, profile_id, original_id)?;
    let native = state.inner().clone();
    let (source, lease) = tauri::async_runtime::spawn_blocking(move || {
        lease.check()?;
        let session = native.human(profile_id)?;
        // Source metadata and all later ranges use one profile-scoped permit.
        let source = Source::begin(native.host.clone(), session, profile_id, original_id)?;
        Ok::<_, Failure>((source, lease))
    })
    .await
    .map_err(|_| io_failure())??;
    #[cfg(target_os = "android")]
    let journal = {
        let root =
            export_journal_root(&app, &state.data_directory).map_err(start_journal_failure)?;
        let original_id = source
            .original
            .original_id
            .to_string()
            .parse::<Uuid>()
            .map_err(|_| failure("invalid_original", "原件身份无效，无法记录导出任务"))?;
        let record = ExportTaskRecord {
            request_id,
            profile_id: record_profile_id,
            original_id,
            file_name: source.original.file_name.clone(),
            byte_length: source.original.byte_length,
            sha256: source.original.sha256.clone(),
            phase: ExportTaskPhase::Preparing,
            failure_code: None,
            partial_output: false,
        };
        let journal = ExportJournal::new(root, journal::current_process_generation());
        let (journal, start_result) = tauri::async_runtime::spawn_blocking(move || {
            let result = journal.begin(record, Some(request_id));
            (journal, result)
        })
        .await
        .map_err(|_| start_journal_failure(JournalError::Unavailable))?;
        start_result.map_err(start_journal_failure)?;
        journal
    };
    #[cfg(target_os = "android")]
    let (mut prepared, source, lease) = {
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|_| {
                let error = io_failure();
                persist_failure(
                    &journal,
                    request_id,
                    ExportTaskPhase::Preparing,
                    &error,
                    false,
                )
            })?
            .join("beta-exports");
        let preparation = tauri::async_runtime::spawn_blocking(move || {
            let prepared = prepare_android(&source, &cache, &lease);
            (prepared, source, lease)
        })
        .await
        .map_err(|_| interrupted())?;
        let (preparation, source, lease) = preparation;
        match preparation {
            Ok(prepared) => (prepared, source, lease),
            Err(raw_error) => {
                let error = if lease.explicitly_cancelled() {
                    cancelled()
                } else if lease.stopped_without_explicit_cancel() {
                    interrupted()
                } else {
                    raw_error
                };
                let final_error = persist_failure(
                    &journal,
                    request_id,
                    ExportTaskPhase::Preparing,
                    &error,
                    false,
                );
                if error.code == "export_cancelled"
                    && final_error.code != "export_receipt_unconfirmed"
                {
                    return Ok(ExportResult::cancelled(false));
                }
                return Err(final_error);
            }
        }
    };

    #[cfg(target_os = "android")]
    journal
        .transition(
            request_id,
            ExportTaskPhase::Preparing,
            ExportTaskPhase::AwaitingDestination,
            None,
            false,
        )
        .map_err(start_journal_failure)?;

    let picker_outcome = match choose_destination(&app, &window, &source.original, &lease).await {
        Ok(outcome) => outcome,
        Err(error) => {
            #[cfg(target_os = "android")]
            return Err(persist_failure(
                &journal,
                request_id,
                ExportTaskPhase::AwaitingDestination,
                &error,
                true,
            ));
            #[cfg(not(target_os = "android"))]
            return Err(error);
        }
    };
    let destination = match picker_outcome {
        PickerOutcome::Selected(destination) => destination,
        PickerOutcome::Cancelled { partial_output } => {
            #[cfg(target_os = "android")]
            {
                let error = cancelled();
                let final_error = persist_failure(
                    &journal,
                    request_id,
                    ExportTaskPhase::AwaitingDestination,
                    &error,
                    partial_output,
                );
                if final_error.code == "export_receipt_unconfirmed" {
                    return Err(final_error);
                }
            }
            return Ok(ExportResult::cancelled(partial_output));
        }
        PickerOutcome::Interrupted => {
            #[cfg(target_os = "android")]
            return Err(persist_failure(
                &journal,
                request_id,
                ExportTaskPhase::AwaitingDestination,
                &interrupted(),
                true,
            ));
            #[cfg(not(target_os = "android"))]
            return Err(interrupted());
        }
    };

    #[cfg(target_os = "android")]
    {
        journal
            .transition(
                request_id,
                ExportTaskPhase::AwaitingDestination,
                ExportTaskPhase::Writing,
                None,
                true,
            )
            .map_err(journal_failure)?;
        let worker_journal = journal.clone();
        let attempt = tauri::async_runtime::spawn_blocking(move || {
            export_document(
                &app,
                &source,
                &mut prepared,
                destination,
                &worker_journal,
                request_id,
                &lease,
            )
        })
        .await
        .map_err(|_| interrupted())?;
        return match attempt.result {
            Ok(saved @ ExportResult::Saved { .. }) => {
                journal
                    .transition(
                        request_id,
                        ExportTaskPhase::Verifying,
                        ExportTaskPhase::Succeeded,
                        None,
                        false,
                    )
                    .map_err(|_| receipt_unconfirmed())?;
                Ok(saved)
            }
            Ok(cancelled_result @ ExportResult::Cancelled { .. }) => {
                let error = cancelled();
                let final_error = persist_failure(
                    &journal,
                    request_id,
                    attempt.phase,
                    &error,
                    attempt.partial_output,
                );
                if final_error.code == "export_receipt_unconfirmed" {
                    Err(final_error)
                } else {
                    Ok(cancelled_result)
                }
            }
            Err(error) if error.code == "export_receipt_unconfirmed" => Err(error),
            Err(error) => Err(persist_failure(
                &journal,
                request_id,
                attempt.phase,
                &error,
                attempt.partial_output,
            )),
        };
    }

    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let result = export_path(&source, destination, &lease);
        match result {
            Err(_) if lease.explicitly_cancelled() => Ok(ExportResult::cancelled(false)),
            Err(_) if lease.stopped_without_explicit_cancel() => Err(interrupted()),
            other => other,
        }
    })
    .await
    .map_err(|_| io_failure())?
}
#[tauri::command]
pub(super) async fn beta_open_original(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    request_id: Uuid,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    let lease = state.exports.begin(request_id, profile_id, original_id)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| io_failure())?
        .join("beta-open")
        .join(profile_id.to_string())
        .join(original_id.to_string());
    let native = state.inner().clone();
    let (path, media_type, lease) = tauri::async_runtime::spawn_blocking(move || {
        lease.check()?;
        let session = native.human(profile_id)?;
        let source = Source::begin(native.host.clone(), session, profile_id, original_id)?;
        let path = prepare_open_copy(
            &cache,
            &source.original,
            |offset, length| source.read(offset, length),
            &lease,
        )?;
        // A cached copy never substitutes for current archive authorization.
        source.finish()?;
        Ok::<_, Failure>((path, source.original.media_type.clone(), lease))
    })
    .await
    .map_err(|_| io_failure())??;
    lease.admit_publish()?;
    #[cfg(target_os = "android")]
    exomind_android_clipboard::open_file(&app, path.to_string_lossy().into_owned(), media_type)
        .await
        .map_err(|_| {
            failure(
                "system_open_failed",
                "系统无法打开此格式，请安装相应应用或另存为后打开",
            )
        })?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = media_type;
        tauri::async_runtime::spawn_blocking(move || {
            tauri_plugin_opener::open_path(path, None::<&str>)
        })
        .await
        .map_err(|_| io_failure())?
        .map_err(|_| {
            failure(
                "system_open_failed",
                "系统无法打开此格式，请设置默认应用或另存为后打开",
            )
        })?;
    }
    Ok(())
}

fn prepare_open_copy(
    cache: &Path,
    original: &OriginalRef,
    mut read: impl FnMut(u64, usize) -> Result<Vec<u8>, Failure>,
    lease: &ExportLease,
) -> Result<PathBuf, Failure> {
    std::fs::create_dir_all(cache).map_err(|_| io_failure())?;
    let cache = cache.canonicalize().map_err(|_| io_failure())?;
    let path = cache.join(suggested_name(&original.file_name));
    if path.exists() {
        if !std::fs::symlink_metadata(&path)
            .map_err(|_| io_failure())?
            .file_type()
            .is_file()
        {
            return Err(io_failure());
        }
        verify_reader(
            &mut File::open(&path).map_err(|_| io_failure())?,
            original,
            lease,
        )?;
        return Ok(path);
    }
    let mut temporary = Temporary::create(&cache)?;
    stream_original(original, &mut read, temporary.file()?, lease)?;
    temporary.sync()?;
    lease.check()?;
    // create_new semantics: another application's file is never overwritten.
    std::fs::hard_link(&temporary.path, &path).map_err(|_| io_failure())?;
    Ok(path)
}

#[tauri::command]
pub(super) fn beta_cancel_original_export(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request_id: Uuid,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    state.exports.cancel(request_id)
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn authorized_history_profile(
    profile_id: ProfileId,
    authorize: impl FnOnce(ProfileId) -> Result<(), Failure>,
) -> Result<Uuid, Failure> {
    authorize(profile_id.clone())?;
    profile_id
        .to_string()
        .parse::<Uuid>()
        .map_err(|_| failure("invalid_profile", "档案身份无效，无法读取导出历史"))
}

#[tauri::command]
pub(super) async fn beta_original_export_history(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
) -> Result<Vec<ExportTaskRecord>, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(Failure::from(HostError::Stopped));
    }
    let native = state.inner().clone();
    let history_profile_id = tauri::async_runtime::spawn_blocking(move || {
        authorized_history_profile(profile_id, |profile| {
            native.human(profile).map(|_| ()).map_err(Failure::from)
        })
    })
    .await
    .map_err(|_| {
        failure(
            "export_scope_unavailable",
            "档案授权暂不可用，无法读取导出历史",
        )
    })??;
    #[cfg(target_os = "android")]
    {
        let root = export_journal_root(&app, &state.data_directory).map_err(journal_failure)?;
        let process_generation = journal::current_process_generation();
        let active_request = state.exports.active_request()?;
        let store = ExportJournal::new(root, process_generation);
        tauri::async_runtime::spawn_blocking(move || {
            store
                .history(history_profile_id, active_request)
                .map_err(journal_failure)
        })
        .await
        .map_err(|_| journal_failure(JournalError::Unavailable))?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state, history_profile_id);
        // Desktop callers keep the same public API while recovery remains an
        // Android-only capability; no desktop profile or Host root is written.
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, time::Duration};

    fn test_lease(manager: &Arc<ExportManager>, request: Uuid) -> Result<ExportLease, Failure> {
        manager.begin(request, ProfileId::new(), OriginalId::new())
    }
    #[test]
    fn system_open_copy_requires_a_complete_digest_and_never_overwrites_a_changed_cache() {
        let cache = tempfile::tempdir().unwrap();
        let bytes = b"synthetic default application document";
        let mut descriptor = original(bytes.len() as u64, format!("{:x}", Sha256::digest(bytes)));
        descriptor.file_name = "../../synthetic-open.txt".into();
        let manager = Arc::new(ExportManager::default());
        let lease = test_lease(&manager, Uuid::new_v4()).unwrap();
        let path = prepare_open_copy(
            cache.path(),
            &descriptor,
            |offset, length| {
                Ok(bytes[offset as usize..((offset as usize) + length).min(bytes.len())].to_vec())
            },
            &lease,
        )
        .unwrap();
        assert_eq!(
            path.parent(),
            Some(cache.path().canonicalize().unwrap().as_path())
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::write(&path, b"changed by external application").unwrap();
        assert!(
            prepare_open_copy(
                cache.path(),
                &descriptor,
                |_, _| panic!("must validate the existing cache first"),
                &lease
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"changed by external application"
        );
        let bad = tempfile::tempdir().unwrap();
        assert!(
            prepare_open_copy(
                bad.path(),
                &descriptor,
                |_, length| Ok(vec![0; length]),
                &lease
            )
            .is_err()
        );
        assert_eq!(std::fs::read_dir(bad.path()).unwrap().count(), 0);
    }
    fn original(length: u64, sha256: String) -> OriginalRef {
        OriginalRef {
            original_id: Uuid::new_v4().to_string().parse().unwrap(),
            sha256,
            byte_length: length,
            file_name: "fixture.raw".into(),
            media_type: "application/octet-stream".into(),
        }
    }
    #[test]
    fn larger_than_web_ceiling_streams_with_bounded_reads_and_validates_full_digest() {
        let length = 65 * 1024 * 1024 + 17u64;
        let chunk = vec![0xa5; MAX_ORIGINAL_CHUNK_BYTES];
        let mut expected = Sha256::new();
        for _ in 0..length / MAX_ORIGINAL_CHUNK_BYTES as u64 {
            expected.update(&chunk);
        }
        expected.update(&chunk[..(length % MAX_ORIGINAL_CHUNK_BYTES as u64) as usize]);
        let metadata = original(length, format!("{:x}", expected.finalize()));
        let manager = Arc::new(ExportManager::default());
        let lease = test_lease(&manager, Uuid::new_v4()).unwrap();
        let mut offset = 0;
        let mut calls = 0;
        stream_original(
            &metadata,
            |at, size| {
                assert_eq!(at, offset);
                assert!(size <= MAX_ORIGINAL_CHUNK_BYTES);
                offset += size as u64;
                calls += 1;
                Ok(vec![0xa5; size])
            },
            &mut std::io::sink(),
            &lease,
        )
        .unwrap();
        assert_eq!(offset, length);
        assert_eq!(calls, 261);
        let bad = original(3, "0".repeat(64));
        assert_eq!(
            stream_original(
                &bad,
                |_, size| Ok(vec![0xa5; size]),
                &mut std::io::sink(),
                &lease
            )
            .unwrap_err()
            .code,
            "original_integrity"
        );
        assert_eq!(
            stream_original(&bad, |_, _| Ok(vec![0xa5; 2]), &mut std::io::sink(), &lease)
                .unwrap_err()
                .code,
            "original_incomplete"
        );
    }
    #[test]
    fn cancellation_prevents_next_read_and_publication_admission_rejects_late_cancel() {
        let manager = Arc::new(ExportManager::default());
        let id = Uuid::new_v4();
        let lease = test_lease(&manager, id).unwrap();
        assert!(manager.cancel(id).unwrap());
        let metadata = original(1, "0".repeat(64));
        assert_eq!(
            stream_original(
                &metadata,
                |_, _| panic!("cancelled source must not read"),
                &mut std::io::sink(),
                &lease
            )
            .unwrap_err()
            .code,
            "export_cancelled"
        );
        drop(lease);
        let id = Uuid::new_v4();
        let lease = test_lease(&manager, id).unwrap();
        lease.admit_publish().unwrap();
        assert!(!manager.cancel(id).unwrap());
        manager.request_stop();
        assert!(!lease.is_cancelled());
    }
    #[test]
    fn cancel_is_bound_to_one_runtime_request_and_never_poisons_the_next() {
        let manager = Arc::new(ExportManager::default());
        let first = Uuid::new_v4();
        let lease = test_lease(&manager, first).unwrap();
        assert!(!manager.cancel(Uuid::new_v4()).unwrap());
        assert!(!lease.is_cancelled());
        assert!(manager.cancel(first).unwrap());
        assert!(lease.is_cancelled());
        drop(lease);
        let next = test_lease(&manager, Uuid::new_v4()).unwrap();
        assert!(!manager.cancel(first).unwrap());
        assert!(!next.is_cancelled());
        manager.request_stop();
        assert!(next.is_cancelled());
        assert!(manager.wait_empty(Duration::ZERO).is_err());
        drop(next);
        manager.wait_empty(Duration::ZERO).unwrap();
    }
    #[test]
    fn selected_existing_file_is_not_overwritten_and_only_owned_partial_is_removed() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("existing.bin");
        std::fs::write(&target, b"user file").unwrap();
        {
            let mut temporary = Temporary::create(directory.path()).unwrap();
            temporary.file().unwrap().write_all(b"export").unwrap();
            assert!(std::fs::hard_link(&temporary.path, &target).is_err());
        }
        assert_eq!(std::fs::read(&target).unwrap(), b"user file");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[test]
    fn file_suggestion_is_only_a_name_and_reserved_or_long_names_are_safe() {
        assert_eq!(suggested_name(".."), "原件");
        assert_eq!(suggested_name("CON.txt"), "原件");
        assert!(!suggested_name("../bad\\file\n.exe").contains('/'));
        assert!(suggested_name(&"中文".repeat(500)).encode_utf16().count() <= 240);
    }

    #[test]
    fn export_history_profile_must_pass_native_human_authorization() {
        let profile: ProfileId = "00000000-0000-4000-8000-000000000090".parse().unwrap();
        let mut authorized = false;
        let result = authorized_history_profile(profile, |_| {
            authorized = true;
            Err(failure("profile_denied", "profile is not authorized"))
        });

        assert!(authorized);
        assert_eq!(result.unwrap_err().code, "profile_denied");

        let profile: ProfileId = "00000000-0000-4000-8000-000000000091".parse().unwrap();
        let id = authorized_history_profile(profile, |_| Ok(())).unwrap();
        assert_eq!(id.to_string(), "00000000-0000-4000-8000-000000000091");
    }
}
