//! User-selected filesystem inputs and local byte movement. No file bytes cross
//! the WebView for native selections; only IDs and measured progress do.
use super::{Failure, NativeState, trusted_window};
use exomind_beta_host::{
    HostError, LocalSourceBegin, LocalSourceInfo, LocalSourceState, MAX_LOCAL_SOURCE_BYTES,
};
use exomind_core::{
    BeginStageCommand, DeviceId, MAX_ORIGINAL_CHUNK_BYTES, OriginalId, ProfileId, StageState,
    StageStatus,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow, ipc::Channel};
use uuid::Uuid;

const MAX_ATTACHMENT_WORK: usize = 2;
const MAX_ATTACHMENT_REQUESTS: usize = 4096;
#[derive(Default)]
struct Cancellation {
    cancelled: AtomicBool,
    changed: tokio::sync::Notify,
}
impl Cancellation {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    async fn cancelled(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            changed.await;
        }
    }
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}
fn io_error() -> Failure {
    failure(
        "attachment_source_unavailable",
        "无法读取所选文件，请检查文件是否仍存在、读取权限和可用空间",
    )
}
#[derive(Default)]
struct Registry {
    active: HashMap<Uuid, (String, Arc<Cancellation>)>,
    seen: HashMap<Uuid, bool>,
}
#[derive(Default)]
pub(super) struct AttachmentJobs {
    entries: Mutex<Registry>,
    stopping: AtomicBool,
    idle: Condvar,
}
pub(super) struct Lease {
    jobs: Arc<AttachmentJobs>,
    id: Uuid,
    cancel: Arc<Cancellation>,
}
impl AttachmentJobs {
    pub(super) fn begin(self: &Arc<Self>, id: Uuid, key: &str) -> Result<Lease, Failure> {
        let mut entries = self.entries.lock().map_err(|_| io_error())?;
        if self.stopping.load(Ordering::Acquire) {
            return Err(HostError::Stopped.into());
        }
        if entries.seen.get(&id) == Some(&true) {
            return Err(failure(
                "attachment_cancelled",
                "附件请求已取消，未开始新处理",
            ));
        }
        if id.is_nil() || entries.seen.contains_key(&id) {
            return Err(failure("invalid_request", "附件请求身份无效"));
        }
        if entries.active.len() >= MAX_ATTACHMENT_WORK
            || entries.active.values().any(|(active, _)| active == key)
        {
            return Err(failure(
                "attachment_busy",
                "已有附件正在准备，请完成或取消后重试",
            ));
        }
        if entries.seen.len() >= MAX_ATTACHMENT_REQUESTS {
            return Err(failure(
                "attachment_request_limit",
                "本次运行的附件请求过多，请保留资料后重启应用",
            ));
        }
        let cancel = Arc::new(Cancellation::default());
        entries.seen.insert(id, false);
        entries.active.insert(id, (key.to_owned(), cancel.clone()));
        Ok(Lease {
            jobs: self.clone(),
            id,
            cancel,
        })
    }
    pub(super) fn cancel(&self, id: Uuid) -> Result<bool, Failure> {
        let mut entries = self.entries.lock().map_err(|_| io_error())?;
        if id.is_nil() {
            return Err(failure("invalid_request", "附件请求身份无效"));
        }
        if !entries.seen.contains_key(&id) && entries.seen.len() >= MAX_ATTACHMENT_REQUESTS {
            return Err(failure(
                "attachment_request_limit",
                "本次运行的附件请求过多，请保留资料后重启应用",
            ));
        }
        // Async IPC admission may run after its cancellation message. Retain
        // the exact UUID intent; a late start must never escape cancellation.
        entries.seen.insert(id, true);
        Ok(entries.active.get(&id).is_some_and(|(_, cancel)| {
            cancel.cancel();
            true
        }))
    }
    pub(super) fn request_stop(&self) {
        self.stopping.store(true, Ordering::Release);
        if let Ok(entries) = self.entries.lock() {
            for (_, cancel) in entries.active.values() {
                cancel.cancel();
            }
        }
    }
    pub(super) fn wait_empty(&self, timeout: Duration) -> Result<(), HostError> {
        let end = Instant::now() + timeout;
        let mut entries = self.entries.lock().map_err(|_| HostError::StatePoisoned)?;
        while !entries.active.is_empty() {
            let remaining = end.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HostError::Shutdown);
            }
            entries = self
                .idle
                .wait_timeout(entries, remaining)
                .map_err(|_| HostError::StatePoisoned)?
                .0;
        }
        Ok(())
    }
}
impl Lease {
    pub(super) fn check(&self, state: &NativeState) -> Result<(), Failure> {
        if self.cancel.is_cancelled() || state.closing.load(Ordering::Acquire) {
            Err(failure(
                "attachment_cancelled",
                "附件准备已取消；已提交的记录和原件保持不变",
            ))
        } else {
            Ok(())
        }
    }
    pub(super) async fn cancelled(&self) {
        self.cancel.cancelled().await;
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.jobs.entries.lock() {
            entries.active.remove(&self.id);
            self.jobs.idle.notify_all();
        }
    }
}
#[derive(Clone, Serialize)]
pub(super) struct Progress {
    phase: &'static str,
    completed: Option<u64>,
    total: u64,
}
fn progress(channel: &Channel<Progress>, phase: &'static str, completed: Option<u64>, total: u64) {
    let _ = channel.send(Progress {
        phase,
        completed,
        total,
    });
}

#[derive(Serialize)]
pub(super) struct SelectedFile {
    path: String,
    name: String,
    size: u64,
    #[serde(rename = "type")]
    media_type: String,
}
fn describe(path: PathBuf) -> Result<SelectedFile, Failure> {
    if !path.is_absolute() {
        return Err(io_error());
    }
    let metadata = path.metadata().map_err(|_| io_error())?;
    if !metadata.is_file() {
        return Err(failure(
            "attachment_not_file",
            "暂不支持拖入文件夹，请选择其中的文件",
        ));
    }
    if metadata.len() > MAX_LOCAL_SOURCE_BYTES {
        return Err(failure("payload_too_large", "单个附件上限为 4 GiB"));
    }
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .filter(|v| !v.is_empty())
        .ok_or_else(io_error)?
        .to_owned();
    let media_type = match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "pdf" => "application/pdf",
        "apk" => "application/vnd.android.package-archive",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_owned();
    Ok(SelectedFile {
        path: path.to_string_lossy().into_owned(),
        name,
        size: metadata.len(),
        media_type,
    })
}
#[tauri::command]
pub(super) async fn beta_describe_attachment_paths(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    paths: Vec<PathBuf>,
) -> Result<Vec<SelectedFile>, Failure> {
    trusted_window(&window, state.inner())?;
    if paths.len() > 128 {
        return Err(io_error());
    }
    tauri::async_runtime::spawn_blocking(move || paths.into_iter().map(describe).collect())
        .await
        .map_err(|_| io_error())?
}
#[tauri::command]
pub(super) async fn beta_pick_attachment_files(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    multiple: bool,
) -> Result<Vec<SelectedFile>, Failure> {
    trusted_window(&window, state.inner())?;
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::{DialogExt, FilePath};
        let (tx, rx) = tokio::sync::oneshot::channel();
        let picker = app.dialog().file().set_parent(&window);
        if multiple {
            picker.pick_files(move |files| {
                let _ = tx.send(files);
            });
        } else {
            picker.pick_file(move |file| {
                let _ = tx.send(file.map(|file| vec![file]));
            });
        }
        let paths = rx.await.map_err(|_| io_error())?.unwrap_or_default();
        tauri::async_runtime::spawn_blocking(move || {
            paths
                .into_iter()
                .map(|file| match file {
                    FilePath::Path(path) => describe(path),
                    _ => Err(io_error()),
                })
                .collect()
        })
        .await
        .map_err(|_| io_error())?
    }
    #[cfg(target_os = "android")]
    {
        let _ = (app, multiple);
        Err(failure("unsupported_file_source", "请使用系统附件选择器"))
    }
}
#[tauri::command]
pub(super) async fn beta_clipboard_files(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Vec<SelectedFile>, Failure> {
    trusted_window(&window, state.inner())?;
    #[cfg(target_os = "android")]
    {
        exomind_android_clipboard::read_files(&app)
            .await
            .map_err(|_| io_error())?
            .into_iter()
            .map(|file| {
                let mut selected = describe(PathBuf::from(file.path))?;
                selected.name = file.file_name;
                selected.media_type = file.media_type;
                Ok(selected)
            })
            .collect()
    }
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| {
            if !clipboard_win::is_format_avail(15) {
                return Ok(vec![]);
            }
            let files: Vec<String> = clipboard_win::get_clipboard(clipboard_win::formats::FileList)
                .map_err(|_| io_error())?;
            if files.len() > 128 {
                return Err(io_error());
            }
            files
                .into_iter()
                .map(|path| describe(PathBuf::from(path)))
                .collect()
        })
        .await
        .map_err(|_| io_error())?
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = app;
        Ok(vec![])
    }
}
fn key_scope(state: &NativeState, key: &str) -> Result<(ProfileId, OriginalId), Failure> {
    let (device, profile, original): (DeviceId, ProfileId, OriginalId) =
        serde_json::from_str(key).map_err(|_| io_error())?;
    if device != state.host.status()?.device_id {
        return Err(failure(
            "identity_changed",
            "附件设备身份已变化，原选择保留",
        ));
    }
    Ok((profile, original))
}
#[tauri::command]
pub(super) async fn beta_import_attachment_path(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    path: PathBuf,
    expected_size: u64,
    request_id: Uuid,
    on_progress: Channel<Progress>,
) -> Result<LocalSourceInfo, Failure> {
    trusted_window(&window, state.inner())?;
    key_scope(state.inner(), &key)?;
    let lease = state.attachment_jobs.begin(request_id, &key)?;
    let clipboard_cache = app
        .path()
        .app_cache_dir()
        .ok()
        .and_then(|path| path.join("beta-clipboard").canonicalize().ok());
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        lease.check(&state)?;
        if !path.is_absolute() {
            return Err(io_error());
        }
        let mut file = File::open(&path).map_err(|_| io_error())?;
        let metadata = file.metadata().map_err(|_| io_error())?;
        if !metadata.is_file()
            || metadata.len() != expected_size
            || expected_size > MAX_LOCAL_SOURCE_BYTES
        {
            return Err(io_error());
        }
        let mut hash = Sha256::new();
        let mut buffer = vec![0; MAX_ORIGINAL_CHUNK_BYTES];
        let mut offset = 0u64;
        progress(&on_progress, "hashing", Some(0), expected_size);
        loop {
            lease.check(&state)?;
            let length = file.read(&mut buffer).map_err(|_| io_error())?;
            if length == 0 {
                break;
            }
            offset += length as u64;
            if offset > expected_size {
                return Err(io_error());
            }
            hash.update(&buffer[..length]);
            progress(&on_progress, "hashing", Some(offset), expected_size);
        }
        if offset != expected_size {
            return Err(io_error());
        }
        let command = LocalSourceBegin {
            key: key.clone(),
            byte_length: expected_size,
            sha256: format!("{:x}", hash.finalize()),
        };
        let mut current = state.host.begin_local_source(&state.owner, &command)?;
        if current.state == LocalSourceState::HashMismatch {
            state
                .host
                .remove_local_source(&state.owner, &key, current.generation)?;
            current = state.host.begin_local_source(&state.owner, &command)?;
        }
        file.seek(SeekFrom::Start(current.next_offset))
            .map_err(|_| io_error())?;
        progress(
            &on_progress,
            "copying",
            Some(current.next_offset),
            expected_size,
        );
        while current.next_offset < expected_size {
            lease.check(&state)?;
            let remaining = (expected_size - current.next_offset).min(buffer.len() as u64) as usize;
            file.read_exact(&mut buffer[..remaining])
                .map_err(|_| io_error())?;
            current = state.host.write_local_source_chunk(
                &state.owner,
                &key,
                current.next_offset,
                &buffer[..remaining],
            )?;
            progress(
                &on_progress,
                "copying",
                Some(current.next_offset),
                expected_size,
            );
        }
        lease.check(&state)?;
        progress(&on_progress, "verifying_source", None, expected_size);
        let result = state.host.finish_local_source(&state.owner, &key)?;
        lease.check(&state)?;
        drop(file);
        if let Some(root) = clipboard_cache {
            if let Ok(owned) = path.canonicalize() {
                if let Some(directory) = owned.parent() {
                    if directory.parent() == Some(root.as_path())
                        && directory
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| Uuid::parse_str(name).is_ok())
                    {
                        if std::fs::remove_file(&owned).is_ok() {
                            let _ = std::fs::remove_dir(directory);
                        } else {
                            log::warn!("Beta clipboard snapshot cleanup deferred");
                        }
                    }
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| io_error())?
}
#[derive(Serialize)]
pub(super) struct StageResult {
    stage: StageStatus,
    cleanup_confirmed: bool,
}
#[tauri::command]
pub(super) async fn beta_stage_local_attachment(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    command: BeginStageCommand,
    request_id: Uuid,
    on_progress: Channel<Progress>,
) -> Result<StageResult, Failure> {
    trusted_window(&window, state.inner())?;
    let (profile, original) = key_scope(state.inner(), &key)?;
    if command.profile_id != profile || command.original_id != original {
        return Err(io_error());
    }
    let lease = state.attachment_jobs.begin(request_id, &key)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        lease.check(&state)?;
        let session = state.human(profile)?;
        let mut stage = state.host.begin_stage(&session, &command)?;
        let source = state.host.local_source_status(&state.owner, &key)?;
        if stage.next_offset < command.byte_length {
            let source = source
                .as_ref()
                .ok_or_else(|| failure("source_missing", "本机附件副本缺失，请重新选择"))?;
            if source.state != LocalSourceState::Ready
                || source.byte_length != command.byte_length
                || source.sha256 != command.expected_sha256
            {
                return Err(io_error());
            }
            progress(
                &on_progress,
                "staging",
                Some(stage.next_offset),
                command.byte_length,
            );
            while stage.next_offset < command.byte_length {
                lease.check(&state)?;
                let offset = stage.next_offset;
                let bytes = state.host.read_local_source_range(
                    &state.owner,
                    &key,
                    offset,
                    (command.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize,
                )?;
                if bytes.is_empty() {
                    return Err(io_error());
                }
                lease.check(&state)?;
                stage = state.host.write_stage_chunk(
                    &session,
                    profile,
                    command.stage_id,
                    offset,
                    &bytes,
                )?;
                progress(
                    &on_progress,
                    "staging",
                    Some(stage.next_offset),
                    command.byte_length,
                );
            }
        }
        lease.check(&state)?;
        if stage.state != StageState::Verified {
            progress(&on_progress, "verifying_stage", None, command.byte_length);
            stage = state
                .host
                .verify_stage(&session, profile, command.stage_id)?;
        }
        lease.check(&state)?;
        if stage.state != StageState::Verified {
            return Err(io_error());
        }
        let cleanup_confirmed = match source {
            None => true,
            Some(source) if source.state == LocalSourceState::Released => true,
            Some(source)
                if source.state == LocalSourceState::Ready
                    && source.sha256 == command.expected_sha256
                    && source.byte_length == command.byte_length =>
            {
                state
                    .host
                    .remove_local_source(&state.owner, &key, source.generation)
                    .is_ok()
            }
            Some(_) => false,
        };
        Ok(StageResult {
            stage,
            cleanup_confirmed,
        })
    })
    .await
    .map_err(|_| io_error())?
}
#[tauri::command]
pub(super) fn beta_cancel_attachment_work(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request_id: Uuid,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    state.attachment_jobs.cancel(request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_arriving_before_async_admission_prevents_the_request_starting() {
        let jobs = Arc::new(AttachmentJobs::default());
        let request = Uuid::new_v4();
        assert!(!jobs.cancel(request).unwrap());
        assert!(
            jobs.begin(request, "synthetic pre-admission cancellation")
                .is_err()
        );
        assert!(
            jobs.begin(Uuid::new_v4(), "unrelated request remains available")
                .is_ok()
        );
    }
    #[test]
    fn preparation_cancel_and_stop_are_bound_to_owned_tasks() {
        let jobs = Arc::new(AttachmentJobs::default());
        let first_id = Uuid::new_v4();
        let first = jobs.begin(first_id, "synthetic-source-A").unwrap();
        assert!(!jobs.cancel(Uuid::new_v4()).unwrap());
        assert!(!first.cancel.is_cancelled());
        let second = jobs.begin(Uuid::new_v4(), "synthetic-source-B").unwrap();
        assert!(jobs.cancel(first_id).unwrap());
        assert!(first.cancel.is_cancelled());
        assert!(!second.cancel.is_cancelled());
        jobs.request_stop();
        assert!(second.cancel.is_cancelled());
        assert!(jobs.begin(Uuid::new_v4(), "synthetic-source-C").is_err());
        assert!(jobs.wait_empty(Duration::from_millis(1)).is_err());
        drop(first);
        drop(second);
        jobs.wait_empty(Duration::from_millis(1)).unwrap();
    }
    #[test]
    fn filesystem_selection_keeps_names_and_rejects_directories() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("synthetic.custom");
        std::fs::write(&path, [0, 255, 1, 2]).unwrap();
        let selected = describe(path.clone()).unwrap();
        assert_eq!(selected.name, "synthetic.custom");
        assert_eq!(selected.size, 4);
        assert_eq!(selected.media_type, "application/octet-stream");
        assert!(describe(root.path().to_path_buf()).is_err());
        assert!(describe(PathBuf::from("relative.txt")).is_err());
        assert_eq!(std::fs::read(path).unwrap(), [0, 255, 1, 2]);
    }
}
