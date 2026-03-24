use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DevInstanceRuntimeInfo {
    pid: u32,
}

#[tauri::command]
pub fn dev_instance_runtime_info() -> DevInstanceRuntimeInfo {
    DevInstanceRuntimeInfo {
        pid: std::process::id(),
    }
}
