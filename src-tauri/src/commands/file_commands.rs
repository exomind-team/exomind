//! 文件操作命令
//! 用于消息持久化存储 - 重构版（同步版本）

use crate::dev_instance_paths::resolve_instance_app_data_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{ipc::InvokeError, AppHandle};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};
use thiserror::Error;

/// 文件操作错误类型
#[derive(Error, Debug)]
pub enum FileError {
    #[error("文件不存在: {path}")]
    NotFound { path: String },

    #[error("权限被拒绝: {path}")]
    PermissionDenied { path: String },

    #[error("IO 错误: {message}")]
    IoError {
        message: String,
        source: std::io::Error,
    },

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
    let path = resolve_instance_app_data_dir(app).map_err(|e| FileError::IoError {
        message: format!("获取应用数据目录失败: {}", e),
        source: std::io::Error::other(e),
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

#[derive(Debug, Deserialize)]
struct MarkdownMessage {
    #[serde(default)]
    id: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    timestamp: i64,
    #[serde(default)]
    direction: String,
    #[serde(rename = "senderId", default)]
    sender_id: String,
    #[serde(rename = "receiverId", default)]
    receiver_id: String,
}

fn parse_markdown_messages(messages_json: &str) -> FileResult<Vec<MarkdownMessage>> {
    let trimmed = messages_json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<MarkdownMessage>>(trimmed).map_err(|e| FileError::Unknown {
        message: format!("消息 JSON 解析失败: {}", e),
    })
}

fn format_markdown_time(timestamp_ms: i64, fallback: chrono::DateTime<chrono::Utc>) -> String {
    let tz_utc8 = chrono::FixedOffset::east_opt(8 * 3600)
        .expect("fixed offset +08:00 should always be valid");

    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.with_timezone(&tz_utc8))
        .unwrap_or_else(|| fallback.with_timezone(&tz_utc8))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn quote_markdown_content(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    if normalized.is_empty() {
        return "  > ".to_string();
    }

    normalized
        .split('\n')
        .map(|line| format!("  > {}", line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_markdown_document(
    title: &str,
    messages_json: &str,
    exported_at: chrono::DateTime<chrono::Utc>,
) -> FileResult<String> {
    let messages = parse_markdown_messages(messages_json)?;
    let mut md_content = String::new();

    md_content.push_str("---\n");
    md_content.push_str("exported_at: ");
    md_content.push_str(&exported_at.to_rfc3339());
    md_content.push_str("\nmessage_count: ");
    md_content.push_str(&messages.len().to_string());
    md_content.push_str("\n---\n\n");

    md_content.push_str("# ");
    md_content.push_str(title);
    md_content.push_str("\n\n");

    if !messages.is_empty() {
        md_content.push_str("## 消息记录\n\n");

        for message in messages {
            let when = format_markdown_time(message.timestamp, exported_at);
            let is_outgoing = message.direction == "outgoing";

            md_content.push_str("### ");
            md_content.push_str(if is_outgoing { "发送" } else { "接收" });
            md_content.push_str("\n\n");

            md_content.push_str(&format!("- **时间**: {}\n", when));
            md_content.push_str(&format!("- **发送者**: {}\n", message.sender_id));
            md_content.push_str(&format!("- **接收者**: {}\n", message.receiver_id));
            md_content.push_str(&format!("- **消息ID**: {}\n", message.id));
            md_content.push_str("- **内容**:\n");
            md_content.push_str(&quote_markdown_content(&message.content));
            md_content.push_str("\n\n---\n\n");
        }
    }

    Ok(md_content)
}

fn persist_export_content_for_selected_file<PW, UW>(
    selected: FilePath,
    content: &[u8],
    path_writer: PW,
    uri_writer: UW,
) -> FileResult<String>
where
    PW: FnOnce(&std::path::Path, &[u8]) -> std::io::Result<()>,
    UW: FnOnce(&FilePath, &[u8]) -> std::io::Result<()>,
{
    match selected {
        FilePath::Path(path) => {
            path_writer(&path, content).map_err(|e| FileError::IoError {
                message: format!("写入导出文件失败: {}", e),
                source: e,
            })?;

            Ok(path.to_string_lossy().to_string())
        }
        uri_like => {
            let display = uri_like.to_string();
            uri_writer(&uri_like, content).map_err(|e| FileError::IoError {
                message: format!("写入导出文件失败: {}", e),
                source: e,
            })?;
            Ok(display)
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PickedJsonFile {
    // path（文件路径/URI）for user feedback（用于前端提示导入来源）
    path: String,
    // content（文件文本内容）in UTF-8（UTF-8 文本）
    content: String,
}

#[derive(Debug, Serialize)]
pub struct PickedAudioFile {
    path: String,
    name: String,
}

fn resolve_selected_file_path(selected: &FilePath) -> String {
    match selected {
        FilePath::Path(path) => path.to_string_lossy().to_string(),
        uri_like => uri_like.to_string(),
    }
}

fn resolve_selected_file_name(selected: &FilePath) -> String {
    match selected {
        FilePath::Path(path) => path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        uri_like => {
            let display = uri_like.to_string();
            display
                .split('/')
                .next_back()
                .map(|value| value.to_string())
                .unwrap_or(display)
        }
    }
}

fn read_import_content_from_selected_file<PR, UR>(
    selected: FilePath,
    path_reader: PR,
    uri_reader: UR,
) -> FileResult<PickedJsonFile>
where
    PR: FnOnce(&std::path::Path) -> std::io::Result<Vec<u8>>,
    UR: FnOnce(&FilePath) -> std::io::Result<Vec<u8>>,
{
    let (display, bytes) = match selected {
        FilePath::Path(path) => {
            let bytes = path_reader(&path).map_err(|e| FileError::IoError {
                message: format!("读取导入文件失败: {}", e),
                source: e,
            })?;
            (path.to_string_lossy().to_string(), bytes)
        }
        uri_like => {
            let display = uri_like.to_string();
            let bytes = uri_reader(&uri_like).map_err(|e| FileError::IoError {
                message: format!("读取导入文件失败: {}", e),
                source: e,
            })?;
            (display, bytes)
        }
    };

    let content = String::from_utf8(bytes).map_err(|e| FileError::Unknown {
        message: format!("导入文件不是 UTF-8 文本: {}", e),
    })?;

    Ok(PickedJsonFile {
        path: display,
        content,
    })
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

    let md_content = build_markdown_document(&title, &messages, chrono::Utc::now())?;

    // 写入文件
    fs::write(&full_path, md_content).map_err(|e| FileError::IoError {
        message: format!("写入文件失败: {}", e),
        source: e,
    })?;

    Ok(())
}

/// 保存 JSON 内容到系统文件选择路径
#[tauri::command]
pub fn save_json_file(
    app: AppHandle,
    content: String,
    default_name: String,
) -> FileResult<Option<String>> {
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let saved = persist_export_content_for_selected_file(
        file_path,
        content.as_bytes(),
        |path, bytes| fs::write(path, bytes),
        |uri_like, bytes| {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);

            let mut file = app.fs().open(uri_like.clone(), options)?;
            use std::io::Write;
            file.write_all(bytes)?;
            Ok(())
        },
    )?;

    Ok(Some(saved))
}

/// 保存二进制内容到系统文件选择路径
#[tauri::command]
pub fn save_binary_file(
    app: AppHandle,
    content: Vec<u8>,
    default_name: String,
    filters: Option<Vec<String>>,
) -> FileResult<Option<String>> {
    let mut dialog = app.dialog().file().set_file_name(&default_name);

    if let Some(filters) = filters.as_ref() {
        if !filters.is_empty() {
            let owned_filters: Vec<String> = filters
                .iter()
                .map(|value| value.trim().trim_start_matches('.').to_string())
                .filter(|value| !value.is_empty())
                .collect();
            let filter_refs: Vec<&str> = owned_filters.iter().map(String::as_str).collect();
            if !filter_refs.is_empty() {
                dialog = dialog.add_filter("Binary", &filter_refs);
            }
        }
    }

    let file_path = dialog.blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let saved = persist_export_content_for_selected_file(
        file_path,
        &content,
        |path, bytes| fs::write(path, bytes),
        |uri_like, bytes| {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);

            let mut file = app.fs().open(uri_like.clone(), options)?;
            use std::io::Write;
            file.write_all(bytes)?;
            Ok(())
        },
    )?;

    Ok(Some(saved))
}

/// 从系统文件选择器选择 JSON 文件并读取内容
#[tauri::command]
pub fn pick_json_file(app: AppHandle) -> FileResult<Option<PickedJsonFile>> {
    let selected = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let picked = read_import_content_from_selected_file(
        selected,
        |path| fs::read(path),
        |uri_like| {
            let mut options = OpenOptions::new();
            options.read(true);

            let mut file = app.fs().open(uri_like.clone(), options)?;
            let mut bytes = Vec::new();
            use std::io::Read;
            file.read_to_end(&mut bytes)?;
            Ok(bytes)
        },
    )?;

    Ok(Some(picked))
}

#[tauri::command]
pub fn pick_audio_files(app: AppHandle) -> FileResult<Option<Vec<PickedAudioFile>>> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "wav", "ogg", "m4a", "flac"])
        .blocking_pick_files();

    let Some(selected) = selected else {
        return Ok(None);
    };

    Ok(Some(
        selected
            .iter()
            .map(|file| PickedAudioFile {
                path: resolve_selected_file_path(file),
                name: resolve_selected_file_name(file),
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::path::PathBuf;

    #[test]
    fn builds_markdown_from_structured_json_and_counts_exactly() {
        let exported_at = chrono::Utc
            .timestamp_millis_opt(1_700_000_000_000)
            .single()
            .unwrap();
        let messages = r#"[
            {"timestamp":1700000000000,"id":"m1","receiverId":"bob","content":"hello","direction":"outgoing","senderId":"alice"},
            {"id":"m2","content":"line1\nline2 \"quoted\" 😀","timestamp":1700000001000,"direction":"incoming","senderId":"bob","receiverId":"alice"}
        ]"#;

        let markdown = build_markdown_document("导出测试", messages, exported_at)
            .expect("should render markdown");

        assert!(markdown.contains("message_count: 2"));
        assert!(markdown.contains("### 发送"));
        assert!(markdown.contains("### 接收"));
        assert!(markdown.contains("line1"));
        assert!(markdown.contains("line2 \"quoted\" 😀"));
    }

    #[test]
    fn builds_markdown_for_empty_message_list() {
        let exported_at = chrono::Utc
            .timestamp_millis_opt(1_700_000_000_000)
            .single()
            .unwrap();
        let markdown = build_markdown_document("空导出", "[]", exported_at)
            .expect("should render empty markdown");

        assert!(markdown.contains("message_count: 0"));
        assert!(!markdown.contains("## 消息记录"));
    }

    #[test]
    fn rejects_invalid_messages_json() {
        let exported_at = chrono::Utc
            .timestamp_millis_opt(1_700_000_000_000)
            .single()
            .unwrap();
        let err =
            build_markdown_document("坏数据", "{not-json}", exported_at).expect_err("should fail");
        let text = format!("{}", err);

        assert!(text.contains("JSON"));
    }

    #[test]
    fn persists_export_content_to_regular_path() {
        let selected = tauri_plugin_dialog::FilePath::Path(PathBuf::from("C:\\temp\\export.json"));
        let mut wrote_path = false;

        let saved = persist_export_content_for_selected_file(
            selected,
            b"{\"ok\":true}",
            |path, content| {
                wrote_path = true;
                assert_eq!(path, PathBuf::from("C:\\temp\\export.json").as_path());
                assert_eq!(content, b"{\"ok\":true}");
                Ok(())
            },
            |_selected, _content| {
                panic!("url writer should not be called for regular path");
            },
        )
        .expect("path variant should be persisted");

        assert!(wrote_path);
        assert_eq!(saved, "C:\\temp\\export.json");
    }

    #[test]
    fn persists_export_content_to_android_content_uri() {
        let selected = tauri_plugin_dialog::FilePath::Url(
            url::Url::parse("content://com.android.providers.downloads/doc/42")
                .expect("valid content uri"),
        );
        let mut wrote_url = false;

        let saved = persist_export_content_for_selected_file(
            selected,
            b"{\"ok\":true}",
            |_path, _content| {
                panic!("path writer should not be called for URI");
            },
            |uri, content| {
                wrote_url = true;
                assert_eq!(
                    uri.to_string(),
                    "content://com.android.providers.downloads/doc/42"
                );
                assert_eq!(content, b"{\"ok\":true}");
                Ok(())
            },
        )
        .expect("url variant should be persisted");

        assert!(wrote_url);
        assert_eq!(saved, "content://com.android.providers.downloads/doc/42");
    }

    #[test]
    fn reads_import_content_from_regular_path() {
        let selected = tauri_plugin_dialog::FilePath::Path(PathBuf::from("C:\\temp\\import.json"));
        let mut read_path = false;

        let picked = read_import_content_from_selected_file(
            selected,
            |path| {
                read_path = true;
                assert_eq!(path, PathBuf::from("C:\\temp\\import.json").as_path());
                Ok(br#"{"version":1,"events":[]}"#.to_vec())
            },
            |_selected| {
                panic!("uri reader should not be called for regular path");
            },
        )
        .expect("path variant should be readable");

        assert!(read_path);
        assert_eq!(picked.path, "C:\\temp\\import.json");
        assert!(picked.content.contains("\"version\":1"));
    }

    #[test]
    fn reads_import_content_from_android_content_uri() {
        let selected = tauri_plugin_dialog::FilePath::Url(
            url::Url::parse("content://com.android.providers.downloads/doc/42")
                .expect("valid content uri"),
        );
        let mut read_uri = false;

        let picked = read_import_content_from_selected_file(
            selected,
            |_path| {
                panic!("path reader should not be called for URI");
            },
            |uri| {
                read_uri = true;
                assert_eq!(
                    uri.to_string(),
                    "content://com.android.providers.downloads/doc/42"
                );
                Ok(br#"{"version":1,"events":[]}"#.to_vec())
            },
        )
        .expect("url variant should be readable");

        assert!(read_uri);
        assert_eq!(
            picked.path,
            "content://com.android.providers.downloads/doc/42"
        );
        assert!(picked.content.contains("\"version\":1"));
    }
}
