// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;

use commands::asr_commands::{
    volcano_asr_check_config, volcano_asr_recognize, volcano_asr_stream_cancel,
    volcano_asr_stream_finish, volcano_asr_stream_push, volcano_asr_stream_session_exists,
    volcano_asr_stream_start, VolcanoAsrStreamState,
};
use commands::dev_commands::dev_instance_runtime_info;
use commands::device_commands::get_device_id;
use commands::eventlog_commands::{
    eventlog_append, eventlog_clear, eventlog_get, eventlog_list, eventlog_mirror_status,
    eventlog_rebuild_markdown,
};
use commands::file_commands::{
    append_file, append_to_markdown, delete_file, export_messages_to_markdown, file_exists,
    list_files, pick_audio_files, pick_json_file, read_file, read_file_binary, save_binary_file,
    save_json_file, write_file,
};
use commands::now_workbench_overlay_commands::{
    ensure_now_workbench_overlay_window, now_workbench_overlay_ensure,
    now_workbench_overlay_focus_main, now_workbench_overlay_hide, now_workbench_overlay_restore,
    now_workbench_overlay_set_position, now_workbench_overlay_show,
};
use commands::runtime_commands::{
    ensure_runtime_started, load_persisted_runtime_network_mode,
    load_persisted_runtime_target_mode, runtime_network_mode_set,
    runtime_service_reachable_address, runtime_service_start, runtime_service_status,
    runtime_service_stop, runtime_target_mode_set, signal_publish_fast,
    sync_android_runtime_keepalive, RuntimeProcessState, RuntimeTargetMode,
};
use commands::shortcut_commands::{
    ensure_voice_overlay_window, foreground_window_get, main_window_shortcut_get,
    main_window_shortcut_set, main_window_shortcut_take_pending_activation,
    register_main_window_shortcut, register_voice_shortcut, simulate_enter, simulate_paste,
    voice_overlay_hide, voice_overlay_set_bottom_offset, voice_overlay_show,
    voice_recording_set_active, voice_shortcut_get, voice_shortcut_set, MainWindowShortcutState,
    VoiceShortcutState,
};
use commands::workspace_commands::{
    get_agent_workspace_actions, get_agent_workspace_knowledge, get_agent_workspace_knowledge_list,
    get_agent_workspace_soul, get_agent_workspace_status,
};
use commands::ws_commands::{ws_connect, ws_disconnect, ws_get_state, ws_send, WsClientState};
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

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
}

fn resolve_embedded_runtime_port() -> u16 {
    std::env::var("EXOMIND_RT_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
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
        .plugin(exomind_android_keepalive::init())
        .manage(ws_client_state.clone())
        .manage(runtime_process_state.clone())
        .manage(voice_shortcut_state)
        .manage(main_window_shortcut_state)
        .manage(volcano_asr_stream_state)
        .setup(move |app| {
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
            if let Err(error) = ensure_now_workbench_overlay_window(app.handle()) {
                log::warn!("failed to prewarm now overlay window: {error}");
            }

            if std::env::var_os("EXOMIND_RT_SIGNAL_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_EVENTLOG_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_TASK_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_SESSION_SQLITE_PATH").is_none()
                || std::env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH").is_none()
            {
                match app.path().app_data_dir() {
                    Ok(app_data_dir) => {
                        let runtime_dir = app_data_dir.join("runtime");
                        if let Err(error) = std::fs::create_dir_all(&runtime_dir) {
                            log::error!(
                                "failed to create runtime data dir for signal sqlite: {error}"
                            );
                        } else {
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
                            "failed to resolve app data dir for runtime sqlite files: {error}"
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
                    // Keep embedded runtime port aligned with EXOMIND_RT_PORT（与前端端口配置保持一致）.
                    match ensure_runtime_started(
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
            dev_instance_runtime_info,
            get_device_id,
            eventlog_list,
            eventlog_append,
            eventlog_get,
            eventlog_clear,
            eventlog_mirror_status,
            eventlog_rebuild_markdown,
            // Runtime 服务命令
            runtime_service_start,
            runtime_service_stop,
            runtime_service_status,
            runtime_network_mode_set,
            runtime_target_mode_set,
            runtime_service_reachable_address,
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
            voice_shortcut_set,
            voice_shortcut_get,
            main_window_shortcut_set,
            main_window_shortcut_get,
            main_window_shortcut_take_pending_activation,
            voice_recording_set_active,
            foreground_window_get,
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
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .on_window_event(|window, event| {
            // When the main window is closed (or destroyed), exit the entire application
            // so that overlay windows (now-workbench-overlay, voice-overlay) don't linger.
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    std::process::exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::seed_runtime_sqlite_env_paths;

    fn clear_runtime_sqlite_envs() {
        for key in [
            "EXOMIND_RT_SIGNAL_SQLITE_PATH",
            "EXOMIND_RT_EVENTLOG_SQLITE_PATH",
            "EXOMIND_RT_TASK_SQLITE_PATH",
            "EXOMIND_RT_TIMEBLOCK_SQLITE_PATH",
            "EXOMIND_RT_SESSION_SQLITE_PATH",
            "EXOMIND_RT_CONFIG_SQLITE_PATH",
        ] {
            // SAFETY: tests mutate process env in a controlled single-threaded scope.
            unsafe {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn seed_runtime_sqlite_env_paths_sets_all_runtime_databases() {
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

        clear_runtime_sqlite_envs();
    }
}
