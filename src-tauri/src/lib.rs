// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
// mod sync; // 预留：WebSocket 服务器端实现，用于电脑端接收移动端连接

use std::sync::Arc;
use commands::ws_commands::{
    WsClientState, ws_connect, ws_disconnect, ws_send, ws_get_state,
};
use commands::file_commands::{
    write_file, read_file, read_file_binary, delete_file, file_exists, list_files,
    append_file, append_to_markdown, export_messages_to_markdown
};
use commands::pairing_commands::{
    PairingState, generate_pairing_code, confirm_pairing,
    get_pairing_requests, get_paired_devices, remove_paired_device, clear_pairing_requests,
};
use commands::network_commands::{get_local_ip_with_current_port, get_local_ip_with_random_port, check_network_status};
use commands::p2p_commands::{
    P2PConnectionState, connect_to_peer, disconnect_from_peer, get_connection_status, disconnect_all,
};

// 导出 WsClientState 和 PairingState 以便在 AppHandle 中使用
pub use commands::ws_commands::ConnectionState;
pub use commands::pairing_commands::PairingState as PairingCommandState;
pub use commands::p2p_commands::P2PConnectionState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_client_state = Arc::new(WsClientState::default());
    let pairing_state = Arc::new(PairingState::default());
    let p2p_state = Arc::new(P2PConnectionState::default());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ws_client_state.clone())
        .manage(pairing_state.clone())
        .manage(p2p_state.clone())
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
            // 配对命令
            generate_pairing_code,
            confirm_pairing,
            get_pairing_requests,
            get_paired_devices,
            remove_paired_device,
            clear_pairing_requests,
            // 网络命令
            get_local_ip_with_current_port,
            get_local_ip_with_random_port,
            check_network_status,
            // P2P 连接命令
            connect_to_peer,
            disconnect_from_peer,
            get_connection_status,
            disconnect_all,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
