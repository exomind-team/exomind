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

/// 追加内容到 Markdown 文件
/// 用于导出消息记录到 .md 文件
#[tauri::command]
pub async fn append_to_markdown<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
    content: String,
) -> Result<(), String> {
    use std::io::Write;

    let data_dir = get_data_dir(&app);
    let mut full_path = data_dir.join(&filename);

    // 如果文件名不包含 .md 后缀，自动添加
    if !filename.to_lowercase().ends_with(".md") {
        full_path = full_path.with_extension("md");
    }

    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 追加内容（如果文件存在则追加，否则创建新文件）
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&full_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    // 写入内容
    writeln!(file, "{}", content)
        .map_err(|e| format!("Failed to write to file: {}", e))?;

    Ok(())
}

/// 导出所有消息到 Markdown 文件
/// 格式化消息为标准 Markdown 格式
#[tauri::command]
pub async fn export_messages_to_markdown<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
    title: String,
    messages: String, // JSON 序列化的消息数组
) -> Result<(), String> {
    use std::io::Write;

    let data_dir = get_data_dir(&app);
    let mut full_path = data_dir.join(&filename);

    // 如果文件名不包含 .md 后缀，自动添加
    if !filename.to_lowercase().ends_with(".md") {
        full_path = full_path.with_extension("md");
    }

    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

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

        let re = regex::Regex::new(msg_pattern).unwrap();

        for cap in re.captures_iter(&messages) {
            let id = cap.get(1).unwrap().as_str();
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
    fs::write(&full_path, md_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}
