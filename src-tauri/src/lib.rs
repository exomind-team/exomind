// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod sync;

use std::sync::Arc;
use commands::{WsClientState, ws_connect, ws_disconnect, ws_send, ws_get_state};
use commands::file_commands::{
    write_file, read_file, read_file_binary, delete_file, file_exists, list_files
};

// 导出 WsClientState 以便在 AppHandle 中使用
pub use commands::ws_commands::ConnectionState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_client_state = Arc::new(WsClientState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
