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
use commands::ws_commands::{ws_connect, ws_disconnect, ws_get_state, ws_send, WsClientState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_client_state = std::sync::Arc::new(WsClientState::default());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ws_client_state.clone())
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
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
