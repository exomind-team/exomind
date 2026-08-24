// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod appbar;
mod commands;
mod dev_instance_paths;
mod windows_appbar;

use commands::asr_commands::{
    volcano_asr_check_config, volcano_asr_recognize, volcano_asr_stream_cancel,
    volcano_asr_stream_finish, volcano_asr_stream_push, volcano_asr_stream_session_exists,
    volcano_asr_stream_start, VolcanoAsrStreamState,
};
use commands::dev_commands::dev_instance_runtime_info;
use commands::device_commands::get_device_id;
use commands::eventlog_commands::{
    eventlog_append, eventlog_append_raw, eventlog_clear, eventlog_get, eventlog_list,
    eventlog_mirror_status, eventlog_rebuild_markdown,
};
use commands::file_commands::{
    append_file, append_to_markdown, delete_file, export_messages_to_markdown, file_exists,
    list_files, pick_audio_files, pick_json_file, read_file, read_file_binary, save_binary_file,
    save_json_file, write_file,
};
use commands::keep_awake_commands::focus_keep_awake_set;
use commands::now_workbench_overlay_commands::{
    now_workbench_overlay_ensure, now_workbench_overlay_focus_main, now_workbench_overlay_hide,
    now_workbench_overlay_profile_get, now_workbench_overlay_profile_set,
    now_workbench_overlay_restore, now_workbench_overlay_set_position, now_workbench_overlay_show,
};
use commands::runtime_commands::{
    ensure_runtime_started, load_persisted_runtime_network_mode,
    load_persisted_runtime_target_mode, runtime_external_address_get, runtime_external_address_set,
    runtime_lan_no_auth_get, runtime_lan_no_auth_set, runtime_network_mode_get,
    runtime_network_mode_set, runtime_service_peer_dial_address, runtime_service_reachable_address,
    runtime_service_start, runtime_service_status, runtime_service_stop, runtime_target_mode_get,
    runtime_target_mode_set, signal_publish_fast, sync_android_runtime_keepalive,
    RuntimeProcessState, RuntimeTargetMode,
};
use commands::shortcut_commands::{
    ensure_voice_overlay_window, foreground_window_get, main_window_shortcut_get,
    main_window_shortcut_set, main_window_shortcut_take_pending_activation,
    register_main_window_shortcut, register_voice_shortcut, simulate_enter, simulate_paste,
    voice_overlay_hide, voice_overlay_set_bottom_offset, voice_overlay_show,
    voice_recording_set_active, voice_shortcut_get, voice_shortcut_set, MainWindowShortcutState,
    VoiceShortcutState,
};
use commands::timeblock_end_alert_commands::{
    timeblock_end_alert_cancel, timeblock_end_alert_notification_permission_request,
    timeblock_end_alert_notification_permission_state, timeblock_end_alert_schedule,
    timeblock_end_alert_take_pending_handoff,
};
use commands::workspace_commands::{
    get_agent_workspace_actions, get_agent_workspace_knowledge, get_agent_workspace_knowledge_list,
    get_agent_workspace_soul, get_agent_workspace_status,
};
use commands::ws_commands::{ws_connect, ws_disconnect, ws_get_state, ws_send, WsClientState};
use dev_instance_paths::{
    resolve_instance_app_data_dir, resolve_instance_runtime_dir_from_app_data_dir,
    resolve_legacy_shared_app_data_dir, resolve_legacy_shared_runtime_dir,
    resolve_legacy_shared_webview_main_data_dir, resolve_main_webview_data_dir,
    resolve_mcp_bridge_base_port, seed_instance_app_data_dir_if_needed,
    seed_instance_runtime_dir_if_needed, seed_instance_webview_main_data_dir_if_needed,
};
use exomind_runtime::config::types::DEVICE_CONFIG_SCOPE;
use exomind_runtime::config::{ConfigStore, PutConfigEntryInput};
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use windows_appbar::{
    ensure_action_dock_window, windows_appbar_attach_right, windows_appbar_detach,
    windows_appbar_resize,
};

const DEFAULT_SIGNAL_ROUTES_FILE_NAME: &str = "signal-routes.default.json";
const DEFAULT_SIGNAL_ROUTES_BUNDLED_JSON: &str =
    include_str!("../../config/signal-routes.default.json");
const DEFAULT_MESH_STATE_FILE_NAME: &str = "mesh-state.json";
const DEVICE_RUNTIME_HOST_ID_KEY: &str = "exomind:runtimeHostId";
const RUNTIME_IDENTITY_SOURCE: &str = "src-tauri:seed-runtime-identity";

fn seed_runtime_default_signal_routes_path(runtime_dir: &std::path::Path) {
    if std::env::var_os("EXOMIND_RT_SIGNAL_ROUTES_DEFAULT").is_some() {
        return;
    }

    let bundled_routes_dir = runtime_dir.join("config");
    if let Err(error) = std::fs::create_dir_all(&bundled_routes_dir) {
        log::error!("failed to create runtime config dir for signal routes: {error}");
        return;
    }

    let bundled_routes_path = bundled_routes_dir.join(DEFAULT_SIGNAL_ROUTES_FILE_NAME);
    let should_write = match std::fs::read_to_string(&bundled_routes_path) {
        Ok(existing) => existing != DEFAULT_SIGNAL_ROUTES_BUNDLED_JSON,
        Err(_) => true,
    };

    if should_write {
        if let Err(error) = std::fs::write(&bundled_routes_path, DEFAULT_SIGNAL_ROUTES_BUNDLED_JSON)
        {
            log::error!("failed to seed bundled signal routes file: {error}");
            return;
        }
    }

    // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
    unsafe {
        std::env::set_var("EXOMIND_RT_SIGNAL_ROUTES_DEFAULT", &bundled_routes_path);
    }
}

fn resolve_runtime_config_sqlite_path(runtime_dir: &std::path::Path) -> std::path::PathBuf {
    std::env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| runtime_dir.join("config.sqlite"))
}

fn resolve_or_create_runtime_host_id(
    config_store: &ConfigStore,
) -> Result<String, exomind_runtime::config::ConfigStoreError> {
    if let Some(entry) = config_store.get(DEVICE_CONFIG_SCOPE, DEVICE_RUNTIME_HOST_ID_KEY)? {
        let persisted = entry.value.trim();
        if !persisted.is_empty() {
            return Ok(persisted.to_string());
        }
    }

    let generated = format!("rt-{}", uuid::Uuid::new_v4());
    config_store.put(PutConfigEntryInput {
        scope: DEVICE_CONFIG_SCOPE.to_string(),
        key: DEVICE_RUNTIME_HOST_ID_KEY.to_string(),
        value: generated.clone(),
        sensitive: false,
        source: Some(RUNTIME_IDENTITY_SOURCE.to_string()),
        source_origin: None,
    })?;
    Ok(generated)
}

fn seed_runtime_identity_env_paths(runtime_dir: &std::path::Path) {
    if std::env::var_os("EXOMIND_RT_HOST_ID").is_none() {
        let config_sqlite_path = resolve_runtime_config_sqlite_path(runtime_dir);
        let host_id = match ConfigStore::with_sqlite_path(&config_sqlite_path)
            .and_then(|store| resolve_or_create_runtime_host_id(&store))
        {
            Ok(host_id) => host_id,
            Err(error) => {
                log::error!(
                    "failed to resolve persistent runtime host id from {:?}: {error}",
                    config_sqlite_path
                );
                format!("rt-{}", uuid::Uuid::new_v4())
            }
        };

        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_HOST_ID", host_id);
        }
    }

    if std::env::var_os("EXOMIND_RT_MESH_STATE_PATH").is_none() {
        let mesh_state_path = runtime_dir.join(DEFAULT_MESH_STATE_FILE_NAME);
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_MESH_STATE_PATH", mesh_state_path);
        }
    }
}

fn seed_runtime_sqlite_env_paths(runtime_dir: &std::path::Path) {
    if std::env::var_os("EXOMIND_RT_SIGNAL_SQLITE_PATH").is_none() {
        let signal_sqlite_path = runtime_dir.join("signal-pool.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_SIGNAL_SQLITE_PATH", signal_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_EVENTLOG_SQLITE_PATH").is_none() {
        let eventlog_sqlite_path = runtime_dir.join("eventlog.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_EVENTLOG_SQLITE_PATH", eventlog_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_TASK_SQLITE_PATH").is_none() {
        let task_sqlite_path = runtime_dir.join("tasks.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_TASK_SQLITE_PATH", task_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH").is_none() {
        let timeblock_sqlite_path = runtime_dir.join("timeblocks.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH", timeblock_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_SESSION_SQLITE_PATH").is_none() {
        let session_sqlite_path = runtime_dir.join("sessions.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_SESSION_SQLITE_PATH", session_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH").is_none() {
        let config_sqlite_path = runtime_dir.join("config.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_CONFIG_SQLITE_PATH", config_sqlite_path);
        }
    }
    if std::env::var_os("EXOMIND_RT_REMINDER_SQLITE_PATH").is_none() {
        let reminder_sqlite_path = runtime_dir.join("reminders.sqlite");
        // SAFETY: setup runs before the embedded runtime starts and before worker threads read this env var.
        unsafe {
            std::env::set_var("EXOMIND_RT_REMINDER_SQLITE_PATH", reminder_sqlite_path);
        }
    }

    seed_runtime_default_signal_routes_path(runtime_dir);
    seed_runtime_identity_env_paths(runtime_dir);
}

fn resolve_embedded_runtime_port() -> u16 {
    std::env::var("EXOMIND_RT_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(9124)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_client_state = std::sync::Arc::new(WsClientState::default());
    let runtime_process_state = std::sync::Arc::new(RuntimeProcessState::new());
    let runtime_process_state_for_setup = runtime_process_state.clone();
    let voice_shortcut_state = VoiceShortcutState::new();
    let main_window_shortcut_state = MainWindowShortcutState::new();
    let volcano_asr_stream_state = std::sync::Arc::new(VolcanoAsrStreamState::default());
    let mut context = tauri::generate_context!();

    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    let main_window_override = resolve_main_webview_data_dir().and_then(|main_data_dir| {
        // Tauri config only honors relative dataDirectory values, so debug-only
        // instance isolation must recreate the main window from Rust with an
        // absolute per-instance WebView2 data dir.
        let main_window_config = context
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .cloned()?;

        if let Some(window_config) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
        {
            window_config.create = false;
        }

        Some((main_window_config, main_data_dir))
    });

    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Webview),
                    Target::new(TargetKind::LogDir { file_name: Some("exomind.log".into()) }),
                ])
                .level(log::LevelFilter::Info)
                .level_for("tungstenite", log::LevelFilter::Warn)
                .level_for("tokio_tungstenite", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .max_file_size(5_000_000) // 5MB per file
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(exomind_android_keep_awake::init())
        .plugin(exomind_android_keepalive::init())
        .plugin(exomind_android_timeblock_end_alert::init())
        .manage(ws_client_state.clone())
        .manage(runtime_process_state.clone())
        .manage(voice_shortcut_state)
        .manage(main_window_shortcut_state)
        .manage(volcano_asr_stream_state)
        .setup(move |app| {
            #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
            if let Some((main_window_config, main_data_dir)) = main_window_override.as_ref() {
                if let Some(legacy_webview_dir) = resolve_legacy_shared_webview_main_data_dir() {
                    if let Err(error) = seed_instance_webview_main_data_dir_if_needed(
                        main_data_dir,
                        &legacy_webview_dir,
                    ) {
                        log::warn!(
                            "instance webview main data seed incomplete, will retry on next launch: {error}"
                        );
                    }
                }
                if app.get_webview_window("main").is_none() {
                    tauri::WebviewWindowBuilder::from_config(app.handle(), main_window_config)?
                        .data_directory(main_data_dir.clone())
                        .build()?;
                }
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Some(main_window) = app.get_webview_window("main") {
                let title = if cfg!(debug_assertions) {
                    "ExoMind (dev)".to_string()
                } else {
                    format!("ExoMind v{}", env!("CARGO_PKG_VERSION"))
                };
                if let Err(error) = main_window.set_title(&title) {
                    log::warn!("failed to set main window title: {error}");
                }
            }

            // Register global voice shortcut (toggle, 按一次开始再按一次结束) and prewarm overlay window（预热悬浮窗）.
            let voice_shortcut_state = app.state::<VoiceShortcutState>();
            let main_window_shortcut_state = app.state::<MainWindowShortcutState>();
            register_voice_shortcut(app.handle(), &voice_shortcut_state);
            register_main_window_shortcut(
                app.handle(),
                &main_window_shortcut_state,
                &voice_shortcut_state,
            );
            if let Err(error) = ensure_voice_overlay_window(app.handle()) {
                log::warn!("failed to prewarm voice overlay window: {error}");
            }
            if let Err(error) = ensure_action_dock_window(app.handle()) {
                log::warn!("failed to prewarm action-dock window: {error}");
            }

            if std::env::var_os("EXOMIND_RT_SIGNAL_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_EVENTLOG_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_TASK_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_SESSION_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH").is_none()
            {
                match resolve_instance_app_data_dir(&app.handle()) {
                    Ok(app_data_dir) => {
                        if let Some(legacy_app_data_dir) = resolve_legacy_shared_app_data_dir() {
                            if let Err(error) = seed_instance_app_data_dir_if_needed(
                                &app_data_dir,
                                &legacy_app_data_dir,
                            ) {
                                log::warn!(
                                    "instance app data seed incomplete, will retry on next launch: {error}"
                                );
                            }
                        }

                        let runtime_dir = resolve_instance_runtime_dir_from_app_data_dir(&app_data_dir);
                        if let Err(error) = std::fs::create_dir_all(&runtime_dir) {
                            log::error!(
                                "failed to create instance runtime data dir for runtime sqlite files: {error}"
                            );
                        } else {
                            if let Some(legacy_runtime_dir) = resolve_legacy_shared_runtime_dir() {
                                if let Err(error) =
                                    seed_instance_runtime_dir_if_needed(&runtime_dir, &legacy_runtime_dir)
                                {
                                    log::warn!(
                                        "instance runtime seed incomplete, will retry on next launch: {error}"
                                    );
                                }
                            }

                            // Set EXOMIND_RT_DATA_DIR so the EventLog JSON-files backend
                            // and other file-based stores write inside the app sandbox
                            // instead of the read-only CWD (critical on Android).
                            if std::env::var_os("EXOMIND_RT_DATA_DIR").is_none() {
                                unsafe {
                                    std::env::set_var("EXOMIND_RT_DATA_DIR", &runtime_dir);
                                }
                            }
                            seed_runtime_sqlite_env_paths(&runtime_dir);
                        }
                    }
                    Err(error) => {
                        log::error!(
                            "failed to resolve instance app data dir for runtime sqlite files: {error}"
                        );
                    }
                }
            }

            let runtime_target_mode = match load_persisted_runtime_target_mode(&app.handle()) {
                Ok(mode) => mode,
                Err(error) => {
                    log::warn!(
                        "failed to load persisted runtime target mode, fallback to embedded: {error}"
                    );
                    RuntimeTargetMode::Embedded
                }
            };
            let runtime_bind_host = match load_persisted_runtime_network_mode(&app.handle()) {
                Ok(mode) => mode.bind_host().to_string(),
                Err(error) => {
                    log::warn!(
                        "failed to load persisted runtime network mode, fallback to localhost: {error}"
                    );
                    "127.0.0.1".to_string()
                }
            };
            if runtime_target_mode == RuntimeTargetMode::Embedded {
                let runtime_state = runtime_process_state_for_setup.clone();
                let runtime_port = resolve_embedded_runtime_port();
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Honor EXOMIND_RT_PORT for embedded runtime startup（包括 `0` 表示随机端口）.
                    match ensure_runtime_started(
                        &app_handle,
                        runtime_state,
                        Some(runtime_bind_host),
                        Some(runtime_port),
                    )
                    .await
                    {
                        Ok(status) => {
                            sync_android_runtime_keepalive(
                                &app_handle,
                                true,
                                &status.host,
                                status.port,
                            );
                        }
                        Err(error) => {
                            sync_android_runtime_keepalive(
                                &app_handle,
                                false,
                                "127.0.0.1",
                                runtime_port,
                            );
                            log::error!(
                                "failed to auto-start embedded runtime on {runtime_port}: {error}"
                            );
                        }
                    }
                });
            } else {
                sync_android_runtime_keepalive(&app.handle(), false, "127.0.0.1", 0);
                log::info!("runtime target mode is external, skip embedded runtime auto-start");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // WebSocket 客户端命令
            ws_connect,
            ws_disconnect,
            ws_send,
            ws_get_state,
            // 文件操作命令
            write_file,
            read_file,
            read_file_binary,
            delete_file,
            file_exists,
            list_files,
            append_file,
            append_to_markdown,
            export_messages_to_markdown,
            save_binary_file,
            save_json_file,
            pick_json_file,
            pick_audio_files,
            focus_keep_awake_set,
            dev_instance_runtime_info,
            get_device_id,
            eventlog_list,
            eventlog_append,
            eventlog_append_raw,
            eventlog_get,
            eventlog_clear,
            eventlog_mirror_status,
            eventlog_rebuild_markdown,
            // Runtime 服务命令
            runtime_service_start,
            runtime_service_stop,
            runtime_service_status,
            runtime_network_mode_set,
            runtime_network_mode_get,
            runtime_target_mode_set,
            runtime_target_mode_get,
            runtime_external_address_set,
            runtime_external_address_get,
            runtime_lan_no_auth_set,
            runtime_lan_no_auth_get,
            runtime_service_reachable_address,
            runtime_service_peer_dial_address,
            signal_publish_fast,
            // 语音快捷键 + 悬浮窗命令
            simulate_enter,
            simulate_paste,
            voice_overlay_show,
            voice_overlay_hide,
            voice_overlay_set_bottom_offset,
            now_workbench_overlay_ensure,
            now_workbench_overlay_show,
            now_workbench_overlay_restore,
            now_workbench_overlay_hide,
            now_workbench_overlay_focus_main,
            now_workbench_overlay_set_position,
            now_workbench_overlay_profile_get,
            now_workbench_overlay_profile_set,
            voice_shortcut_set,
            voice_shortcut_get,
            main_window_shortcut_set,
            main_window_shortcut_get,
            main_window_shortcut_take_pending_activation,
            voice_recording_set_active,
            foreground_window_get,
            // Windows 桌面停靠 / Windows AppBar
            windows_appbar_attach_right,
            windows_appbar_resize,
            windows_appbar_detach,
            timeblock_end_alert_schedule,
            timeblock_end_alert_cancel,
            timeblock_end_alert_take_pending_handoff,
            timeblock_end_alert_notification_permission_state,
            timeblock_end_alert_notification_permission_request,
            // ASR 语音识别命令
            volcano_asr_recognize,
            volcano_asr_check_config,
            volcano_asr_stream_start,
            volcano_asr_stream_push,
            volcano_asr_stream_finish,
            volcano_asr_stream_cancel,
            volcano_asr_stream_session_exists,
            // Workspace 认知生命体命令
            get_agent_workspace_soul,
            get_agent_workspace_knowledge_list,
            get_agent_workspace_knowledge,
            get_agent_workspace_actions,
            get_agent_workspace_status,
        ]);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    #[cfg(debug_assertions)]
    {
        let mut mcp_bridge_builder = tauri_plugin_mcp_bridge::Builder::new();
        if let Some(base_port) = resolve_mcp_bridge_base_port() {
            mcp_bridge_builder = mcp_bridge_builder.base_port(base_port);
        }
        builder = builder.plugin(mcp_bridge_builder.build());
    }

    builder
        .on_window_event(|window, event| {
            // When the main window is closed (or destroyed), exit the entire application
            // so that overlay windows (now-workbench-overlay, voice-overlay) don't linger.
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    windows_appbar::detach_on_shutdown(window.app_handle());
                    std::process::exit(0);
                }
            }
        })
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::seed_runtime_sqlite_env_paths;
    use exomind_runtime::config::store::ConfigStore;
    use exomind_runtime::config::types::DEVICE_CONFIG_SCOPE;
    use std::sync::{Mutex, OnceLock};
    use uuid::Uuid;

    fn runtime_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn clear_runtime_sqlite_envs() {
        for key in [
            "EXOMIND_RT_SIGNAL_SQLITE_PATH",
            "EXOMIND_RT_EVENTLOG_SQLITE_PATH",
            "EXOMIND_RT_TASK_SQLITE_PATH",
            "EXOMIND_RT_TIMEBLOCK_SQLITE_PATH",
            "EXOMIND_RT_SESSION_SQLITE_PATH",
            "EXOMIND_RT_CONFIG_SQLITE_PATH",
            "EXOMIND_RT_REMINDER_SQLITE_PATH",
            "EXOMIND_RT_HOST_ID",
            "EXOMIND_RT_MESH_STATE_PATH",
            "EXOMIND_RT_SIGNAL_ROUTES_DEFAULT",
        ] {
            // SAFETY: tests mutate process env in a controlled single-threaded scope.
            unsafe {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn seed_runtime_sqlite_env_paths_sets_all_runtime_databases() {
        let _guard = runtime_env_lock().lock().unwrap();
        let runtime_dir = std::env::temp_dir().join("exomind-tauri-runtime-env-test");
        clear_runtime_sqlite_envs();

        seed_runtime_sqlite_env_paths(&runtime_dir);

        assert_eq!(
            std::env::var_os("EXOMIND_RT_SIGNAL_SQLITE_PATH"),
            Some(runtime_dir.join("signal-pool.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_EVENTLOG_SQLITE_PATH"),
            Some(runtime_dir.join("eventlog.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_TASK_SQLITE_PATH"),
            Some(runtime_dir.join("tasks.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH"),
            Some(runtime_dir.join("timeblocks.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_SESSION_SQLITE_PATH"),
            Some(runtime_dir.join("sessions.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH"),
            Some(runtime_dir.join("config.sqlite").into_os_string())
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_REMINDER_SQLITE_PATH"),
            Some(runtime_dir.join("reminders.sqlite").into_os_string())
        );

        clear_runtime_sqlite_envs();
    }

    #[test]
    fn seed_runtime_sqlite_env_paths_persists_and_reuses_runtime_host_id() {
        let _guard = runtime_env_lock().lock().unwrap();
        let runtime_dir = std::env::temp_dir().join(format!(
            "exomind-tauri-runtime-host-id-test-{}",
            Uuid::new_v4()
        ));
        clear_runtime_sqlite_envs();

        seed_runtime_sqlite_env_paths(&runtime_dir);

        let first_host_id =
            std::env::var("EXOMIND_RT_HOST_ID").expect("runtime host id should be seeded");
        assert!(
            first_host_id.starts_with("rt-"),
            "seeded runtime host id should use rt-* format"
        );
        assert_eq!(
            std::env::var_os("EXOMIND_RT_MESH_STATE_PATH"),
            Some(runtime_dir.join("mesh-state.json").into_os_string())
        );

        let config_store = ConfigStore::with_sqlite_path(&runtime_dir.join("config.sqlite"))
            .expect("config sqlite should open");
        let persisted = config_store
            .get(DEVICE_CONFIG_SCOPE, "exomind:runtimeHostId")
            .expect("config read should succeed")
            .expect("runtime host id should persist");
        assert_eq!(persisted.value, first_host_id);

        clear_runtime_sqlite_envs();
        seed_runtime_sqlite_env_paths(&runtime_dir);

        let second_host_id = std::env::var("EXOMIND_RT_HOST_ID")
            .expect("runtime host id should be reseeded from persisted config");
        assert_eq!(
            second_host_id, first_host_id,
            "repeated seeding should reuse the persisted runtime host id"
        );

        std::fs::remove_dir_all(&runtime_dir).ok();
        clear_runtime_sqlite_envs();
    }

    #[test]
    fn seed_runtime_sqlite_env_paths_preserves_explicit_runtime_host_id_override() {
        let _guard = runtime_env_lock().lock().unwrap();
        let runtime_dir = std::env::temp_dir().join(format!(
            "exomind-tauri-runtime-host-id-override-test-{}",
            Uuid::new_v4()
        ));
        clear_runtime_sqlite_envs();
        // SAFETY: tests mutate process env in a controlled single-threaded scope.
        unsafe {
            std::env::set_var("EXOMIND_RT_HOST_ID", "rt-explicit-override");
        }

        seed_runtime_sqlite_env_paths(&runtime_dir);

        assert_eq!(
            std::env::var("EXOMIND_RT_HOST_ID"),
            Ok("rt-explicit-override".to_string())
        );

        let config_store = ConfigStore::with_sqlite_path(&runtime_dir.join("config.sqlite"))
            .expect("config sqlite should open");
        let persisted = config_store
            .get(DEVICE_CONFIG_SCOPE, "exomind:runtimeHostId")
            .expect("config read should succeed");
        assert!(
            persisted.is_none(),
            "explicit EXOMIND_RT_HOST_ID override should not be backfilled into device config"
        );

        std::fs::remove_dir_all(&runtime_dir).ok();
        clear_runtime_sqlite_envs();
    }

    #[test]
    fn seed_runtime_sqlite_env_paths_sets_default_signal_routes_path() {
        let _guard = runtime_env_lock().lock().unwrap();
        let runtime_dir = std::env::temp_dir().join(format!(
            "exomind-tauri-runtime-routes-test-{}",
            Uuid::new_v4()
        ));
        clear_runtime_sqlite_envs();

        seed_runtime_sqlite_env_paths(&runtime_dir);

        let routes_path = std::env::var_os("EXOMIND_RT_SIGNAL_ROUTES_DEFAULT")
            .expect("default signal routes path should be seeded");
        let routes_path = std::path::PathBuf::from(routes_path);
        assert!(
            routes_path.is_file(),
            "seeded default signal routes file must exist: {}",
            routes_path.display()
        );

        let routes_content = std::fs::read_to_string(&routes_path)
            .expect("seeded default signal routes should be readable");
        assert!(
            routes_content.contains("\"target_type\": \"frontend\""),
            "seeded routes should preserve bundled frontend route"
        );

        std::fs::remove_dir_all(&runtime_dir).ok();
        clear_runtime_sqlite_envs();
    }

    #[test]
    fn resolve_embedded_runtime_port_accepts_zero_for_random_port() {
        let _guard = runtime_env_lock().lock().unwrap();
        // SAFETY: tests mutate process env in a controlled single-threaded scope.
        unsafe {
            std::env::set_var("EXOMIND_RT_PORT", "0");
        }

        assert_eq!(super::resolve_embedded_runtime_port(), 0);

        // SAFETY: tests mutate process env in a controlled single-threaded scope.
        unsafe {
            std::env::remove_var("EXOMIND_RT_PORT");
        }
    }

    #[test]
    fn resolve_embedded_runtime_port_falls_back_when_value_is_invalid() {
        let _guard = runtime_env_lock().lock().unwrap();
        // SAFETY: tests mutate process env in a controlled single-threaded scope.
        unsafe {
            std::env::set_var("EXOMIND_RT_PORT", "not-a-port");
        }

        assert_eq!(super::resolve_embedded_runtime_port(), 9124);

        // SAFETY: tests mutate process env in a controlled single-threaded scope.
        unsafe {
            std::env::remove_var("EXOMIND_RT_PORT");
        }
    }
}
