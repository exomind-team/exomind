//! 命令模块导出
//! 导出所有 Tauri 命令

pub mod ws_commands;
pub mod file_commands;
pub mod pairing_commands;

pub use ws_commands::{
    ws_connect,
    ws_disconnect,
    ws_send,
    ws_get_state,
    WsClientState,
};

pub use file_commands::{
    write_file,
    read_file,
    read_file_binary,
    delete_file,
    file_exists,
    list_files,
    append_to_markdown,
    export_messages_to_markdown,
};

pub use pairing_commands::{
    PairingRequest,
    PairingState,
    PairedDevice,
    generate_pairing_code,
    confirm_pairing,
    get_pairing_requests,
    get_paired_devices,
    remove_paired_device,
    clear_pairing_requests,
};
