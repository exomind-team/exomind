//! 设备标识命令
//! 提供稳定 device id（持久化到 app data）

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

fn resolve_device_id_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?;

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|err| format!("failed to create app data dir: {err}"))?;
    }

    Ok(data_dir.join("device_id.txt"))
}

#[tauri::command]
pub fn get_device_id(app: AppHandle) -> Result<String, String> {
    let path = resolve_device_id_path(&app)?;

    if path.exists() {
        let existing = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read device id file: {err}"))?;
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let generated = format!("device-{}", Uuid::new_v4());
    fs::write(&path, &generated).map_err(|err| format!("failed to persist device id: {err}"))?;
    Ok(generated)
}
