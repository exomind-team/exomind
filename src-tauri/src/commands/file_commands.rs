//! 文件操作命令
//! 用于消息持久化存储 - 重构版（同步版本）

use tauri::{AppHandle, Manager, ipc::InvokeError};
use std::path::PathBuf;
use std::fs;
use thiserror::Error;

/// 文件操作错误类型
#[derive(Error, Debug)]
pub enum FileError {
    #[error("文件不存在: {path}")]
    NotFound { path: String },

    #[error("权限被拒绝: {path}")]
    PermissionDenied { path: String },

    #[error("IO 错误: {message}")]
    IoError { message: String, source: std::io::Error },

    #[error("路径无效: {path}")]
    InvalidPath { path: String },

    #[error("目录创建失败: {message}")]
    DirectoryCreationFailed { message: String },

    #[error("未知错误: {message}")]
    Unknown { message: String },
}

/// 文件操作结果
pub type FileResult<T> = Result<T, FileError>;

impl std::convert::From<FileError> for InvokeError {
    fn from(error: FileError) -> Self {
        InvokeError::from_error(error)
    }
}

/// 获取应用数据目录
fn get_data_dir(app: &AppHandle) -> Result<PathBuf, FileError> {
    let path = app.path().app_data_dir().map_err(|e| FileError::IoError {
        message: format!("获取应用数据目录失败: {}", e),
        source: std::io::Error::new(std::io::ErrorKind::Other, e.to_string()),
    })?;

    // 确保目录存在
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| FileError::DirectoryCreationFailed {
            message: format!("创建目录失败: {}", e),
        })?;
    }

    Ok(path)
}

/// 处理路径（相对路径转换为绝对路径）
fn resolve_path(app: &AppHandle, path: &str) -> Result<PathBuf, FileError> {
    let data_dir = get_data_dir(app)?;

    let full_path = if PathBuf::from(path).is_absolute() {
        PathBuf::from(path)
    } else {
        data_dir.join(path)
    };

    // 验证路径不包含父目录遍历
    if full_path.to_string_lossy().contains("..") {
        return Err(FileError::InvalidPath {
            path: path.to_string(),
        });
    }

    Ok(full_path)
}

/// 确保父目录存在
fn ensure_parent_dir(path: &PathBuf) -> Result<(), FileError> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| FileError::DirectoryCreationFailed {
                message: format!("创建父目录失败: {}", e),
            })?;
        }
    }
    Ok(())
}

/// 追加内容到文件（永覆盖）
/// 用于消息日志等需要追加的场景
#[tauri::command]
pub fn append_file(app: AppHandle, path: String, content: String) -> FileResult<()> {
    let full_path = resolve_path(&app, &path)?;

    ensure_parent_dir(&full_path)?;

    // 追加内容（使用 OpenOptions 以追加模式打开）
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&full_path)
        .map_err(|e| FileError::IoError {
            message: format!("打开文件失败: {}", e),
            source: e,
        })?;

    // 写入内容
    use std::io::Write;
    writeln!(file, "{}", content).map_err(|e| FileError::IoError {
        message: format!("追加文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}

/// 写入文件（覆盖模式）
/// 用于配置文件等需要覆盖的场景
#[tauri::command]
pub fn write_file(app: AppHandle, path: String, content: String) -> FileResult<()> {
    let full_path = resolve_path(&app, &path)?;

    ensure_parent_dir(&full_path)?;

    // 写入文件（覆盖）
    fs::write(&full_path, content).map_err(|e| FileError::IoError {
        message: format!("写入文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}

/// 读取文件
#[tauri::command]
pub fn read_file(app: AppHandle, path: String) -> FileResult<String> {
    let full_path = resolve_path(&app, &path)?;

    // 检查文件是否存在
    if !full_path.exists() {
        return Err(FileError::NotFound {
            path: full_path.to_string_lossy().to_string(),
        });
    }

    // 读取文件
    fs::read_to_string(&full_path).map_err(|e| FileError::IoError {
        message: format!("读取文件失败: {}", e),
        source: e,
    })
}

/// 读取文件（字节流，用于二进制文件）
#[tauri::command]
pub fn read_file_binary(app: AppHandle, path: String) -> FileResult<Vec<u8>> {
    let full_path = resolve_path(&app, &path)?;

    // 检查文件是否存在
    if !full_path.exists() {
        return Err(FileError::NotFound {
            path: full_path.to_string_lossy().to_string(),
        });
    }

    fs::read(&full_path).map_err(|e| FileError::IoError {
        message: format!("读取二进制文件失败: {}", e),
        source: e,
    })
}

/// 删除文件
#[tauri::command]
pub fn delete_file(_app: AppHandle, path: String) -> FileResult<()> {
    let full_path = PathBuf::from(&path);

    // 检查文件是否存在
    if !full_path.exists() {
        return Ok(());
    }

    fs::remove_file(&full_path).map_err(|e| FileError::IoError {
        message: format!("删除文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}

/// 检查文件是否存在
#[tauri::command]
pub fn file_exists(_app: AppHandle, path: String) -> bool {
    PathBuf::from(path).exists()
}

/// 列出目录中的文件
#[tauri::command]
pub fn list_files(app: AppHandle, dir: String) -> FileResult<Vec<String>> {
    let full_path = resolve_path(&app, &dir)?;

    if !full_path.exists() {
        return Ok(vec![]);
    }

    if !full_path.is_dir() {
        return Err(FileError::InvalidPath {
            path: full_path.to_string_lossy().to_string(),
        });
    }

    let entries = fs::read_dir(&full_path).map_err(|e| FileError::IoError {
        message: format!("读取目录失败: {}", e),
        source: e,
    })?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| FileError::IoError {
            message: format!("读取目录项失败: {}", e),
            source: e,
        })?;
        if entry.path().is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }

    Ok(files)
}

/// 追加内容到 Markdown 文件
/// 用于导出消息记录到 .md 文件
#[tauri::command]
pub fn append_to_markdown(app: AppHandle, filename: String, content: String) -> FileResult<()> {
    let mut full_path = resolve_path(&app, &filename)?;

    // 如果文件名不包含 .md 后缀，自动添加
    if !filename.to_lowercase().ends_with(".md") {
        full_path = full_path.with_extension("md");
    }

    ensure_parent_dir(&full_path)?;

    // 追加内容（如果文件存在则追加，否则创建新文件）
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&full_path)
        .map_err(|e| FileError::IoError {
            message: format!("打开文件失败: {}", e),
            source: e,
        })?;

    // 写入内容
    use std::io::Write;
    writeln!(file, "{}", content).map_err(|e| FileError::IoError {
        message: format!("写入文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}

/// 导出所有消息到 Markdown 文件
/// 格式化消息为标准 Markdown 格式
#[tauri::command]
pub fn export_messages_to_markdown(
    app: AppHandle,
    filename: String,
    title: String,
    messages: String, // JSON 序列化的消息数组
) -> FileResult<()> {
    let mut full_path = resolve_path(&app, &filename)?;

    // 如果文件名不包含 .md 后缀，自动添加
    if !filename.to_lowercase().ends_with(".md") {
        full_path = full_path.with_extension("md");
    }

    ensure_parent_dir(&full_path)?;

    // 构建 Markdown 内容
    let mut md_content = String::new();

    // 添加 YAML front matter
    md_content.push_str("---\n");
    md_content.push_str("exported_at: ");
    md_content.push_str(&chrono::Utc::now().to_rfc3339());
    md_content.push_str("\nmessage_count: ");
    // 计算消息数量（粗略估算）
    let count = messages.matches("\"id\"").count() / 3;
    md_content.push_str(&count.to_string());
    md_content.push_str("\n---\n\n");

    // 添加标题
    md_content.push_str("# ");
    md_content.push_str(&title);
    md_content.push_str("\n\n");

    // 解析消息并添加到 Markdown
    // 消息格式: [{id, content, timestamp, direction, senderId, receiverId}]
    if !messages.is_empty() {
        md_content.push_str("## 消息记录\n\n");

        // 简单的消息解析（假设是 JSON 数组格式）
        // 提取消息内容块
        let msg_pattern = r#"{"id":"([^"]+)","content":"([^"]+)","timestamp":(\d+),"direction":"([^"]+)","senderId":"([^"]+)","receiverId":"([^"]+)"[^}]*}"#;

        let re = regex::Regex::new(msg_pattern).map_err(|e| FileError::Unknown {
            message: format!("正则表达式编译失败: {}", e),
        })?;

        for cap in re.captures_iter(&messages) {
            let _id = cap.get(1).unwrap().as_str();
            let content = cap.get(2).unwrap().as_str();
            let timestamp: i64 = cap.get(3).unwrap().as_str().parse().unwrap_or(0);
            let direction = cap.get(4).unwrap().as_str();
            let sender = cap.get(5).unwrap().as_str();
            let receiver = cap.get(6).unwrap().as_str();

            let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp)
                .map(|dt| dt.with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap()))
                .unwrap_or_else(|| chrono::Utc::now().into());

            // 判断发送者方向
            let is_outgoing = direction == "outgoing";

            md_content.push_str("### ");
            md_content.push_str(if is_outgoing { "发送" } else { "接收" });
            md_content.push_str("\n\n");

            md_content.push_str(&format!("- **时间**: {}\n", dt.format("%Y-%m-%d %H:%M:%S")));
            md_content.push_str(&format!("- **发送者**: {}\n", sender));
            md_content.push_str(&format!("- **接收者**: {}\n", receiver));
            md_content.push_str("- **内容**:\n");
            md_content.push_str(&format!("  > {}\n", content.replace('\n', "\n  > ")));

            md_content.push_str("\n---\n\n");
        }
    }

    // 写入文件
    fs::write(&full_path, md_content).map_err(|e| FileError::IoError {
        message: format!("写入文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}
