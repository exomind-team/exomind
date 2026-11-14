//! Isolated Beta embedding. No legacy runtime/config/store is opened here.

#[path = "beta_overlay.rs"]
mod overlay;
#[path = "beta_native_sources.rs"]
mod local_sources;

use exomind_beta_host::{
    BetaHost, DeadlineEnvelope, HostError, HostStatus, RunningServer, Session,
};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, CoreError, EventPage, EventQuery, IntervalPage,
    IntervalQuery, OriginalChunk, OriginalId, ProfileId, ProfileInfo, Receipt, StageId,
    StageStatus, TimeblockCommand, TimeblockNodePage, TimeblockSnapshot, TimelinePage,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Debug, Clone, Serialize)]
struct Failure {
    code: &'static str,
    message: &'static str,
}

impl From<HostError> for Failure {
    fn from(error: HostError) -> Self {
        let (code, message) = match error {
            HostError::Unauthorized | HostError::Forbidden => {
                ("forbidden", "当前会话无权执行此操作")
            }
            HostError::Stopped => ("stopped", "本机服务已停止"),
            HostError::IntentCacheCorrupt => (
                "intent_cache_corrupt",
                "本机草稿存储需要恢复，原数据已保留；未改用旧缓存",
            ),
            HostError::IntentCacheUnavailable => (
                "intent_cache_unavailable",
                "本机草稿暂存未确认，请保留窗口并重试",
            ),
            HostError::LocalSourceCorrupt => (
                "local_source_corrupt",
                "本机文件暂存校验失败，现有数据已保留，请重新选择原文件",
            ),
            HostError::LocalSourceUnavailable => (
                "local_source_unavailable",
                "本机文件暂存未确认，请保留原文件并重试",
            ),
            HostError::LocalSourceConflict => (
                "local_source_conflict",
                "文件暂存身份或代次已变化，请查证后重试",
            ),
            HostError::LocalSourceIncomplete => (
                "local_source_incomplete",
                "本机文件副本尚未完整保存，请保留原文件",
            ),
            HostError::LocalSourceHashMismatch => (
                "local_source_hash_mismatch",
                "本机文件副本与原文件校验不一致，暂存字节已保留",
            ),
            HostError::LocalSourceBusy => (
                "local_source_busy",
                "本机文件校验正在处理中，请稍后重试",
            ),
            HostError::InvalidRequest
            | HostError::Core(
                CoreError::InvalidCapture(_)
                | CoreError::InvalidQuery(_)
                | CoreError::InvalidTimeblock(_)
                | CoreError::InvalidOriginal(_)
                | CoreError::InvalidOriginalOffset,
            ) => ("invalid_request", "请求内容无效"),
            HostError::NotFound
            | HostError::Core(
                CoreError::UnknownProfile | CoreError::UnknownStage | CoreError::UnknownOriginal,
            ) => ("not_found", "档案或记录不存在"),
            HostError::Core(
                CoreError::CommandConflict
                | CoreError::EventConflict
                | CoreError::ProfileConflict
                | CoreError::StageConflict
                | CoreError::OriginalConflict
                | CoreError::ChunkConflict,
            ) => ("conflict", "此标识已用于其他内容，请保留待确认稿件"),
            HostError::Core(CoreError::TimeblockConflict) => {
                ("timeblock_conflict", "时间块状态已变化，请查证后再操作")
            }
            HostError::Core(
                CoreError::ScopeMismatch
                | CoreError::ForeignContext
                | CoreError::TimeblockControlDenied
                | CoreError::OriginalAccessDenied,
            ) => ("forbidden", "会话所属档案不匹配"),
            HostError::RootInUse => ("root_in_use", "此数据目录已由另一个实例使用"),
            HostError::PayloadTooLarge => ("payload_too_large", "数据分块超过允许大小"),
            HostError::VerificationBusy => ("verification_busy", "文件校验正在处理中，请稍后重试"),
            HostError::Core(CoreError::OriginalHashMismatch) => {
                ("original_hash_mismatch", "文件校验不一致，暂存字节已保留")
            }
            HostError::Core(CoreError::VerificationCancelled) => {
                ("cancelled", "文件校验已停止，暂存字节已保留")
            }
            HostError::Core(CoreError::StageIncomplete | CoreError::OriginalNotReady) => {
                ("original_not_ready", "整组文件尚未完成保存与校验")
            }
            HostError::Core(CoreError::StageNotUploading | CoreError::StaleVerification) => {
                ("stage_conflict", "文件暂存状态已变化，请查证后重试")
            }
            HostError::Core(CoreError::OriginalIntegrityMismatch) => (
                "original_integrity_mismatch",
                "已保存的文件字节校验失败，现有数据已保留",
            ),
            HostError::Core(CoreError::RecoveryRequired) => (
                "recovery_required",
                "现有资料需要恢复，已保留目录并停止创建空档案",
            ),
            HostError::Core(CoreError::InvalidTimeblockHistory) => (
                "timeblock_history_incomplete",
                "时间块历史暂不能完整解释，现有记录已保留",
            ),
            _ => ("storage_error", "本机存储操作失败，请保留稿件后重试"),
        };
        Self { code, message }
    }
}

struct NativeState {
    host: Arc<BetaHost>,
    owner: Session,
    dev_origin: Option<url::Origin>,
    sessions: Mutex<HashMap<ProfileId, Session>>,
    server: tokio::sync::Mutex<Option<RunningServer>>,
    closing: AtomicBool,
    exit_ready: AtomicBool,
    overlay: Mutex<overlay::Broker>,
}

impl NativeState {
    fn open(root: &std::path::Path, dev_origin: Option<url::Origin>) -> Result<Self, HostError> {
        let host = Arc::new(BetaHost::open(root)?);
        let owner = host.owner_session()?;
        host.start_services()?;
        Ok(Self {
            host,
            owner,
            dev_origin,
            sessions: Mutex::new(HashMap::new()),
            server: tokio::sync::Mutex::new(None),
            closing: AtomicBool::new(false),
            exit_ready: AtomicBool::new(false),
            overlay: Mutex::new(overlay::Broker::default()),
        })
    }

    fn human(&self, profile: ProfileId) -> Result<Session, HostError> {
        let mut sessions = self.sessions.lock().map_err(|_| HostError::StatePoisoned)?;
        if let Some(session) = sessions.get(&profile) {
            return Ok(session.clone());
        }
        let session = self.host.native_human_session(&self.owner, profile)?;
        sessions.insert(profile, session.clone());
        Ok(session)
    }

    async fn start_listener(&self, port: u16) -> Result<(), HostError> {
        let server = exomind_beta_host::serve(
            self.host.clone(),
            SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        )
        .await?;
        let mut owned = self.server.lock().await;
        if self.closing.load(Ordering::Acquire) {
            drop(owned);
            return server.stop().await;
        }
        *owned = Some(server);
        Ok(())
    }

    async fn stop(&self) -> Result<(), HostError> {
        // Host's transaction gate synchronously fences queued work before we
        // await the owned HTTP task; native capture never depends on that task.
        let host = self.host.clone();
        tauri::async_runtime::spawn_blocking(move || host.stop())
            .await
            .map_err(|_| HostError::StatePoisoned)??;
        let server = self.server.lock().await.take();
        if let Some(server) = server {
            server.stop().await?;
        }
        Ok(())
    }
}

fn trusted_window(window: &WebviewWindow, state: &NativeState) -> Result<(), Failure> {
    let url = window.url().map_err(|_| Failure {
        code: "forbidden",
        message: "窗口来源不可用",
    })?;
    if window.label() == "main" && trusted_url(&url, state.dev_origin.as_ref()) {
        return Ok(());
    }
    Err(Failure {
        code: "forbidden",
        message: "此窗口无权调用本机记录接口",
    })
}

fn trusted_url(url: &url::Url, dev_origin: Option<&url::Origin>) -> bool {
    if url.path() != "/beta.html"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    if url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
    {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        dev_origin.is_some_and(|origin| *origin == url.origin())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = dev_origin;
        false
    }
}

async fn work<T: Send + 'static>(
    state: &Arc<NativeState>,
    action: impl FnOnce(&NativeState) -> Result<T, HostError> + Send + 'static,
) -> Result<T, Failure> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if state.closing.load(Ordering::Acquire) {
            return Err(HostError::Stopped);
        }
        action(&state)
    })
    .await
    .map_err(|_| Failure {
        code: "host_error",
        message: "本机操作意外中断，请保留稿件",
    })?
    .map_err(Failure::from)
}

#[tauri::command]
async fn beta_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<HostStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), |state| state.host.status()).await
}

#[tauri::command]
async fn beta_profiles(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Vec<ProfileInfo>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), |state| state.host.profiles(&state.owner)).await
}

// Private local UI storage: deliberately absent from the HTTP router and the
// replicated event stream. Only this trusted Beta window's owner is supplied.
#[tauri::command]
async fn beta_read_local_intent(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
) -> Result<Option<String>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.read_local_intent(&state.owner, &key)
    })
    .await
}

#[tauri::command]
async fn beta_write_local_intent(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    raw: String,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.write_local_intent(&state.owner, &key, &raw)
    })
    .await
}

#[tauri::command]
async fn beta_provision_profile(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    name: String,
) -> Result<ProfileInfo, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .provision_profile(&state.owner, profile_id, &name)
    })
    .await
}

#[tauri::command]
async fn beta_capture(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: CaptureCommand,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .capture(&state.human(command.profile_id)?, &command)
    })
    .await
}

#[tauri::command]
async fn beta_events_page(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: EventQuery,
) -> Result<EventPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .events_page(&state.human(profile_id)?, profile_id, &query)
    })
    .await
}

#[tauri::command]
async fn beta_timeblock_command(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: TimeblockCommand,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .apply_timeblock(&state.human(command.profile_id)?, &command)
    })
    .await
}

#[tauri::command]
async fn beta_timeblock_snapshot(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
) -> Result<TimeblockSnapshot, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .timeblock_snapshot(&state.human(profile_id)?, profile_id)
    })
    .await
}

#[tauri::command]
async fn beta_timeblock_nodes(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: EventQuery,
) -> Result<TimeblockNodePage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .timeblock_nodes(&state.human(profile_id)?, profile_id, &query)
    })
    .await
}

#[tauri::command]
async fn beta_timeblock_intervals(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: IntervalQuery,
) -> Result<IntervalPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .timeblock_intervals(&state.human(profile_id)?, profile_id, &query)
    })
    .await
}

#[tauri::command]
async fn beta_timeline_page(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: EventQuery,
) -> Result<TimelinePage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .timeline_page(&state.human(profile_id)?, profile_id, &query)
    })
    .await
}

#[tauri::command]
async fn beta_deadline_envelope(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
) -> Result<DeadlineEnvelope, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .deadline_envelope(&state.human(profile_id)?, profile_id)
    })
    .await
}

#[tauri::command]
async fn beta_receipt(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    command_id: CommandId,
) -> Result<Option<Receipt>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .receipt(&state.human(profile_id)?, profile_id, command_id)
    })
    .await
}

#[tauri::command]
async fn beta_begin_stage(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: BeginStageCommand,
) -> Result<StageStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .begin_stage(&state.human(command.profile_id)?, &command)
    })
    .await
}

#[tauri::command]
async fn beta_stage_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    stage_id: StageId,
) -> Result<StageStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .stage_status(&state.human(profile_id)?, profile_id, stage_id)
    })
    .await
}

#[tauri::command]
async fn beta_write_stage_chunk(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    stage_id: StageId,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<StageStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.write_stage_chunk(
            &state.human(profile_id)?,
            profile_id,
            stage_id,
            offset,
            &bytes,
        )
    })
    .await
}

#[tauri::command]
async fn beta_verify_stage(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    stage_id: StageId,
) -> Result<StageStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .verify_stage(&state.human(profile_id)?, profile_id, stage_id)
    })
    .await
}

#[tauri::command]
async fn beta_read_stage_range(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    stage_id: StageId,
    offset: u64,
    length: usize,
) -> Result<OriginalChunk, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.read_stage_range(
            &state.human(profile_id)?,
            profile_id,
            stage_id,
            offset,
            length,
        )
    })
    .await
}

#[tauri::command]
async fn beta_read_original_range(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    offset: u64,
    length: usize,
) -> Result<OriginalChunk, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.read_original_range(
            &state.human(profile_id)?,
            profile_id,
            original_id,
            offset,
            length,
        )
    })
    .await
}

fn request_exit(app: &AppHandle, code: i32) {
    let state = app.state::<Arc<NativeState>>().inner().clone();
    if state.closing.swap(true, Ordering::AcqRel) {
        return;
    }
    // Fence HTTP as well as IPC immediately, before scheduling resource close.
    state.host.request_stop();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match state.stop().await {
            Ok(()) => {
                state.exit_ready.store(true, Ordering::Release);
                app.exit(code);
            }
            Err(error) => {
                state.closing.store(false, Ordering::Release);
                log::error!("Beta owned shutdown failed: {error}");
                let _ = app.emit("app-shutdown-error", Failure::from(error));
            }
        }
    });
}

#[tauri::command]
fn beta_request_exit(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<NativeState>>,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    request_exit(&app, 0);
    Ok(())
}

fn data_root(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(root) = std::env::var_os("EXOMIND_BETA_DATA_DIR") {
        let root = PathBuf::from(root);
        if !root.is_absolute() {
            return Err("EXOMIND_BETA_DATA_DIR must be absolute".into());
        }
        return Ok(root);
    }
    // Resolve the platform-owned app directory before the independent host's
    // strict path checks. Android may expose this directory through OS aliases;
    // explicit user overrides above still retain their strict validation.
    let base = app.path().app_data_dir()?;
    std::fs::create_dir_all(&base)?;
    let base = base.canonicalize()?;
    let root = base.join("beta-host");
    #[cfg(debug_assertions)]
    log::info!(
        "Beta platform storage: absolute={}, root={}",
        root.is_absolute(),
        root.display()
    );
    Ok(root)
}

pub fn run(mut context: tauri::Context<tauri::Wry>) {
    let dev_origin = context
        .config()
        .build
        .dev_url
        .as_ref()
        .map(url::Url::origin);
    let log_target = match crate::dev_instance_paths::resolve_instance_log_dir_from_env() {
        Some(path) => tauri_plugin_log::TargetKind::Folder {
            path,
            file_name: Some("beta.log".into()),
        },
        None => tauri_plugin_log::TargetKind::LogDir {
            file_name: Some("beta.log".into()),
        },
    };
    // Explicit instance isolation also applies to the WebView's own storage.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let isolated_window =
        crate::dev_instance_paths::resolve_main_webview_data_dir().and_then(|directory| {
            let window = context
                .config_mut()
                .app
                .windows
                .iter_mut()
                .find(|window| window.label == "main")?;
            let config = window.clone();
            window.create = false;
            Some((config, directory))
        });
    let mut builder = tauri::Builder::default()
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = window.try_state::<Arc<NativeState>>() {
                    if let Ok(mut broker) = state.overlay.lock() {
                        broker.document_started(window.label());
                    };
                }
            }
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(log_target),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let port = match std::env::var("EXOMIND_BETA_PORT") {
                Ok(value) => value
                    .parse::<u16>()
                    .map_err(|_| "EXOMIND_BETA_PORT must be a port number")?,
                Err(std::env::VarError::NotPresent) => 0,
                Err(_) => return Err("EXOMIND_BETA_PORT must be valid Unicode".into()),
            };
            let state = Arc::new(NativeState::open(
                &data_root(app.handle())?,
                dev_origin.clone(),
            )?);
            app.manage(state.clone());
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Some((config, directory)) = isolated_window.as_ref() {
                tauri::WebviewWindowBuilder::from_config(app, config)?
                    .data_directory(directory.clone())
                    .build()?;
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = state.start_listener(port).await {
                    if state.closing.load(Ordering::Acquire) {
                        return;
                    }
                    // Local IPC remains available even when a requested port
                    // cannot bind. Report the distinct transport fault.
                    log::error!("Beta HTTP listener unavailable: {error}");
                    let _ = handle.emit(
                        "beta-http-error",
                        Failure {
                            code: "listener_error",
                            message: "本机记录可用，外部连接端口未能启动",
                        },
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay::beta_overlay_main,
            overlay::beta_overlay_attach,
            overlay::beta_overlay_read,
            overlay::beta_overlay_request,
            overlay::beta_overlay_window,
            beta_status,
            beta_profiles,
            beta_read_local_intent,
            beta_write_local_intent,
            local_sources::beta_begin_local_source,
            local_sources::beta_local_source_status,
            local_sources::beta_write_local_source_chunk,
            local_sources::beta_finish_local_source,
            local_sources::beta_read_local_source_range,
            local_sources::beta_remove_local_source,
            beta_provision_profile,
            beta_capture,
            beta_events_page,
            beta_timeblock_command,
            beta_timeblock_snapshot,
            beta_timeblock_nodes,
            beta_timeblock_intervals,
            beta_timeline_page,
            beta_deadline_envelope,
            beta_receipt,
            beta_request_exit,
            beta_begin_stage,
            beta_stage_status,
            beta_write_stage_chunk,
            beta_verify_stage,
            beta_read_stage_range,
            beta_read_original_range,
            crate::commands::mobile_display_commands::mobile_fullscreen_set
        ]);
    #[cfg(debug_assertions)]
    {
        let mut bridge = tauri_plugin_mcp_bridge::Builder::new().bind_address("127.0.0.1");
        if let Some(port) = crate::dev_instance_paths::resolve_mcp_bridge_base_port() {
            bridge = bridge.base_port(port);
        }
        builder = builder.plugin(bridge.build());
    }
    let app = builder
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<NativeState>>();
                if !state.exit_ready.load(Ordering::Acquire) {
                    api.prevent_close();
                    request_exit(window.app_handle(), 0);
                }
            }
        })
        .build(context)
        .expect("failed to build isolated Beta application");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            let state = app.state::<Arc<NativeState>>();
            if !state.exit_ready.load(Ordering::Acquire) {
                api.prevent_exit();
                request_exit(app, code.unwrap_or(0));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_window_authority_rejects_remote_and_legacy_pages() {
        for value in [
            "https://example.com/beta.html",
            "tauri://localhost/index.html",
            "tauri://localhost/beta.html?token=secret",
            "tauri://localhost/beta.html#foreign",
            "tauri://localhost:1420/beta.html",
            "http://tauri.localhost:1420/beta.html",
            "tauri://other@localhost/beta.html",
        ] {
            assert!(
                !trusted_url(&url::Url::parse(value).unwrap(), None),
                "{value}"
            );
        }
        assert!(trusted_url(
            &url::Url::parse("tauri://localhost/beta.html").unwrap(),
            None
        ));
        assert!(trusted_url(
            &url::Url::parse("http://tauri.localhost/beta.html").unwrap(),
            None
        ));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn native_development_authority_matches_the_actual_configured_origin() {
        let origin = url::Url::parse("http://localhost:1480").unwrap().origin();
        assert!(trusted_url(
            &url::Url::parse("http://localhost:1480/beta.html").unwrap(),
            Some(&origin)
        ));
        for value in [
            "http://localhost:1481/beta.html",
            "http://127.0.0.1:1480/beta.html",
            "http://localhost:1480/index.html",
            "http://localhost:1480/beta.html?foreign",
        ] {
            assert!(
                !trusted_url(&url::Url::parse(value).unwrap(), Some(&origin)),
                "{value}"
            );
        }
    }

    #[test]
    fn native_error_preserves_failure_category_without_source_data() {
        let storage = Failure::from(HostError::Filesystem(std::io::Error::other(
            "private/path/token",
        )));
        assert_eq!(storage.code, "storage_error");
        assert!(!serde_json::to_string(&storage).unwrap().contains("private"));
        assert_eq!(
            Failure::from(HostError::Core(CoreError::CommandConflict)).code,
            "conflict"
        );
        assert_eq!(Failure::from(HostError::Stopped).code, "stopped");
        assert_eq!(
            Failure::from(HostError::IntentCacheCorrupt).code,
            "intent_cache_corrupt"
        );
        assert_eq!(
            Failure::from(HostError::IntentCacheUnavailable).code,
            "intent_cache_unavailable"
        );
        for (error, code) in [
            (CoreError::TimeblockConflict, "timeblock_conflict"),
            (CoreError::TimeblockControlDenied, "forbidden"),
            (
                CoreError::InvalidTimeblock("private input"),
                "invalid_request",
            ),
            (
                CoreError::InvalidTimeblockHistory,
                "timeblock_history_incomplete",
            ),
        ] {
            let failure = Failure::from(HostError::Core(error));
            assert_eq!(failure.code, code);
            assert!(!serde_json::to_string(&failure).unwrap().contains("private"));
        }
    }

    #[tokio::test]
    async fn queued_native_command_cannot_commit_after_close_or_resurrect_listener() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("host");
        let state = Arc::new(NativeState::open(&root, None).unwrap());
        assert!(state.host.service_status().unwrap().unwrap().running);
        let profile = ProfileId::new();
        state
            .host
            .provision_profile(&state.owner, profile, "synthetic native")
            .unwrap();
        let intent_key = format!(
            "exomind:beta:drafts:{}",
            state.host.status().unwrap().device_id
        );
        state
            .host
            .write_local_intent(
                &state.owner,
                &intent_key,
                "{\"draft\":\"retained local text\"}",
            )
            .unwrap();
        let command = CaptureCommand {
            command_id: CommandId::new(),
            event_id: exomind_core::EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1,
            text: "synthetic queued".into(),
            tags: vec![],
            originals: vec![],
        };
        let before_close_session = state.human(profile).unwrap();
        state.closing.store(true, Ordering::Release);
        let queued = command.clone();
        let result = work(&state, move |state| {
            state.host.capture(&state.human(profile)?, &queued)
        })
        .await;
        assert_eq!(result.unwrap_err().code, "stopped");
        let late_key = intent_key.clone();
        let late = work(&state, move |state| {
            state.host.write_local_intent(
                &state.owner,
                &late_key,
                "{\"draft\":\"late replacement\"}",
            )
        })
        .await;
        assert_eq!(late.unwrap_err().code, "stopped");
        state.stop().await.unwrap();
        assert!(!state.host.service_status().unwrap().unwrap().running);
        assert!(matches!(
            state.host.capture(&before_close_session, &command),
            Err(HostError::Stopped)
        ));
        assert!(matches!(
            state.start_listener(0).await,
            Err(HostError::Stopped)
        ));
        assert!(state.server.lock().await.is_none());
        // The old Arc still exists. Stopping must release the root explicitly.
        let reopened = BetaHost::open(&root).unwrap();
        let owner = reopened.owner_session().unwrap();
        assert_eq!(
            reopened
                .read_local_intent(&owner, &intent_key)
                .unwrap()
                .as_deref(),
            Some("{\"draft\":\"retained local text\"}")
        );
        let human = reopened.native_human_session(&owner, profile).unwrap();
        assert!(reopened
            .events_page(&human, profile, &EventQuery::default())
            .unwrap()
            .items
            .is_empty());
    }
}
