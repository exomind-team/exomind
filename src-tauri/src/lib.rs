// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;

use commands::device_commands::get_device_id;
use commands::eventlog_commands::{
    eventlog_append, eventlog_clear, eventlog_get, eventlog_list, eventlog_mirror_status,
    eventlog_rebuild_markdown,
};
use commands::file_commands::{
    append_file, append_to_markdown, delete_file, export_messages_to_markdown, file_exists,
    list_files, pick_json_file, read_file, read_file_binary, save_json_file, write_file,
};
use commands::shortcut_commands::{
    ensure_voice_overlay_window, register_voice_shortcut, simulate_paste, voice_overlay_hide, voice_overlay_show,
    voice_shortcut_get, voice_shortcut_set, VoiceShortcutState,
};
use commands::runtime_commands::{
    ensure_runtime_started, runtime_service_reachable_address, runtime_service_start,
    runtime_service_status, runtime_service_stop, signal_publish_fast, RuntimeProcessState,
};
use commands::ws_commands::{ws_connect, ws_disconnect, ws_get_state, ws_send, WsClientState};
use commands::asr_commands::{volcano_asr_recognize, volcano_asr_check_config};
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(ws_client_state.clone())
        .manage(runtime_process_state.clone())
        .manage(voice_shortcut_state)
        .setup(move |app| {
            // Register global voice shortcut (toggle, 按一次开始再按一次结束) and prewarm overlay window（预热悬浮窗）.
            let voice_shortcut_state = app.state::<VoiceShortcutState>();
            register_voice_shortcut(app.handle(), &voice_shortcut_state);
            if let Err(error) = ensure_voice_overlay_window(app.handle()) {
                eprintln!("[tauri/setup] failed to prewarm voice overlay window: {error}");
            }

            let runtime_state = runtime_process_state_for_setup.clone();
            let runtime_port = resolve_embedded_runtime_port();
            tauri::async_runtime::spawn(async move {
                // Keep embedded runtime port aligned with EXOMIND_RT_PORT（与前端端口配置保持一致）.
                if let Err(error) = ensure_runtime_started(runtime_state, None, Some(runtime_port)).await {
                    eprintln!(
                        "[tauri/setup] failed to auto-start embedded runtime on {}: {error}",
                        runtime_port
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
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
            save_json_file,
            pick_json_file,
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
            runtime_service_reachable_address,
            signal_publish_fast,
            // 语音快捷键 + 悬浮窗命令
            simulate_paste,
            voice_overlay_show,
            voice_overlay_hide,
            voice_shortcut_set,
            voice_shortcut_get,
            // ASR 语音识别命令
            volcano_asr_recognize,
            volcano_asr_check_config,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
