//! 文件操作命令
//! 用于消息持久化存储

use tauri::{AppHandle, Runtime, Manager};
use std::path::PathBuf;
use std::fs;

/// 获取应用数据目录
fn get_data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let path = app.path().app_data_dir().unwrap_or_else(|_| {
        let mut path = PathBuf::new();
        path.push(".exomind");
        path
    });

    // 确保目录存在
    if !path.exists() {
        fs::create_dir_all(&path).unwrap_or_default();
    }

    path
}

/// 写入文件
#[tauri::command]
pub async fn write_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    content: String,
) -> Result<(), String> {
    let data_dir = get_data_dir(&app);

    // 处理路径：如果path是相对路径，则相对于数据目录
    let full_path = if PathBuf::from(&path).is_absolute() {
        PathBuf::from(path)
    } else {
        data_dir.join(path)
    };

    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 写入文件
    fs::write(&full_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// 读取文件
#[tauri::command]
pub async fn read_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let data_dir = get_data_dir(&app);

    // 处理路径
    let full_path = if PathBuf::from(&path).is_absolute() {
        PathBuf::from(path)
    } else {
        data_dir.join(path)
    };

    // 读取文件
    fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// 读取文件（字节流，用于二进制文件）
#[tauri::command]
pub async fn read_file_binary<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Vec<u8>, String> {
    let data_dir = get_data_dir(&app);

    let full_path = if PathBuf::from(&path).is_absolute() {
        PathBuf::from(path)
    } else {
        data_dir.join(path)
    };

    fs::read(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// 删除文件
#[tauri::command]
pub async fn delete_file<R: Runtime>(
    _app: AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let full_path = PathBuf::from(path);

    if full_path.exists() {
        fs::remove_file(&full_path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
    }

    Ok(())
}

/// 检查文件是否存在
#[tauri::command]
pub async fn file_exists<R: Runtime>(
    _app: AppHandle<R>,
    path: String,
) -> Result<bool, String> {
    let full_path = PathBuf::from(path);
    Ok(full_path.exists())
}

/// 列出目录中的文件
#[tauri::command]
pub async fn list_files<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
) -> Result<Vec<String>, String> {
    let data_dir = get_data_dir(&app);

    let full_path = if PathBuf::from(&dir).is_absolute() {
        PathBuf::from(dir)
    } else {
        data_dir.join(dir)
    };

    if !full_path.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&full_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        if entry.path().is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }

    Ok(files)
}
