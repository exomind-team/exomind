//! Isolated Beta embedding. No legacy runtime/config/store is opened here.

use exomind_beta_host::{BetaHost, HostError, HostStatus, RunningServer, Session};
use exomind_core::{
    CaptureCommand, CommandId, CoreError, EventPage, EventQuery, ProfileId, ProfileInfo, Receipt,
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
            HostError::InvalidRequest
            | HostError::Core(CoreError::InvalidCapture(_) | CoreError::InvalidQuery(_)) => {
                ("invalid_request", "请求内容无效")
            }
            HostError::NotFound | HostError::Core(CoreError::UnknownProfile) => {
                ("not_found", "档案或记录不存在")
            }
            HostError::Core(
                CoreError::CommandConflict | CoreError::EventConflict | CoreError::ProfileConflict,
            ) => ("conflict", "此标识已用于其他内容，请保留待确认稿件"),
            HostError::Core(CoreError::ScopeMismatch | CoreError::ForeignContext) => {
                ("forbidden", "会话所属档案不匹配")
            }
            HostError::RootInUse => ("root_in_use", "此数据目录已由另一个实例使用"),
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
}

impl NativeState {
    fn open(root: &std::path::Path, dev_origin: Option<url::Origin>) -> Result<Self, HostError> {
        let host = Arc::new(BetaHost::open(root)?);
        let owner = host.owner_session()?;
        Ok(Self {
            host,
            owner,
            dev_origin,
            sessions: Mutex::new(HashMap::new()),
            server: tokio::sync::Mutex::new(None),
            closing: AtomicBool::new(false),
            exit_ready: AtomicBool::new(false),
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
    Ok(app.path().app_data_dir()?.join("beta-host"))
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
            beta_status,
            beta_profiles,
            beta_provision_profile,
            beta_capture,
            beta_events_page,
            beta_receipt,
            beta_request_exit,
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
    }

    #[tokio::test]
    async fn queued_native_command_cannot_commit_after_close_or_resurrect_listener() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("host");
        let state = Arc::new(NativeState::open(&root, None).unwrap());
        let profile = ProfileId::new();
        state
            .host
            .provision_profile(&state.owner, profile, "synthetic native")
            .unwrap();
        let command = CaptureCommand {
            command_id: CommandId::new(),
            event_id: exomind_core::EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1,
            text: "synthetic queued".into(),
            tags: vec![],
        };
        let before_close_session = state.human(profile).unwrap();
        state.closing.store(true, Ordering::Release);
        let queued = command.clone();
        let result = work(&state, move |state| {
            state.host.capture(&state.human(profile)?, &queued)
        })
        .await;
        assert_eq!(result.unwrap_err().code, "stopped");
        state.stop().await.unwrap();
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
        let human = reopened.native_human_session(&owner, profile).unwrap();
        assert!(reopened
            .events_page(&human, profile, &EventQuery::default())
            .unwrap()
            .items
            .is_empty());
    }
}
