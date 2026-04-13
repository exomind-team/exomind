//! EventLog 命令
//! 提供 Tauri 端最小闭环：append/list/get/clear + markdown mirror

use crate::dev_instance_paths::resolve_instance_app_data_dir;
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const EVENTLOG_DIR_NAME: &str = "eventlog";
const MIRROR_HEADER: &str = "# EventLog Mirror\n\n";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRef {
    pub kind: String,
    pub event_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub timestamp: i64,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<EventRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MirrorCheckpoint {
    last_event_id: Option<String>,
    updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStatus {
    pub mirror_file_path: String,
    pub checkpoint_event_id: Option<String>,
    pub total_events: usize,
    pub mirrored_events: usize,
    pub needs_rebuild: bool,
}

struct EventLogPaths {
    events: PathBuf,
    mirror: PathBuf,
    checkpoint: PathBuf,
}

fn sanitize_user_id(user_id: Option<&str>) -> String {
    let raw = user_id.unwrap_or("anonymous").trim();
    if raw.is_empty() {
        return "anonymous".to_string();
    }

    raw.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn resolve_eventlog_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = resolve_instance_app_data_dir(app)?;
    let eventlog_dir = data_dir.join(EVENTLOG_DIR_NAME);
    if !eventlog_dir.exists() {
        fs::create_dir_all(&eventlog_dir)
            .map_err(|err| format!("failed to create eventlog dir: {err}"))?;
    }

    Ok(eventlog_dir)
}

fn resolve_eventlog_paths(app: &AppHandle, user_id: Option<&str>) -> Result<EventLogPaths, String> {
    let eventlog_dir = resolve_eventlog_dir(app)?;
    let normalized_user = sanitize_user_id(user_id);

    Ok(EventLogPaths {
        events: eventlog_dir.join(format!("{normalized_user}.json")),
        mirror: eventlog_dir.join(format!("{normalized_user}.md")),
        checkpoint: eventlog_dir.join(format!("{normalized_user}.checkpoint.json")),
    })
}

fn read_events(path: &Path) -> Result<Vec<EventRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(path).map_err(|err| format!("failed to read eventlog file: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(&raw).map_err(|err| format!("failed to parse eventlog file: {err}"))
}

fn write_events(path: &Path, events: &[EventRecord]) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(events)
        .map_err(|err| format!("failed to serialize eventlog data: {err}"))?;
    fs::write(path, serialized).map_err(|err| format!("failed to write eventlog file: {err}"))
}

fn read_checkpoint(path: &Path) -> Result<Option<MirrorCheckpoint>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        fs::read_to_string(path).map_err(|err| format!("failed to read checkpoint file: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }

    let checkpoint: MirrorCheckpoint = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse checkpoint file: {err}"))?;
    Ok(Some(checkpoint))
}

fn write_checkpoint(path: &Path, last_event_id: Option<String>) -> Result<(), String> {
    let checkpoint = MirrorCheckpoint {
        last_event_id,
        updated_at_ms: Utc::now().timestamp_millis(),
    };

    let serialized = serde_json::to_string_pretty(&checkpoint)
        .map_err(|err| format!("failed to serialize checkpoint: {err}"))?;
    fs::write(path, serialized).map_err(|err| format!("failed to write checkpoint file: {err}"))
}

fn sort_events_desc(events: &mut [EventRecord]) {
    events.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| right.id.cmp(&left.id))
    });
}

fn sort_events_asc(events: &mut [EventRecord]) {
    events.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn latest_event_id(events: &[EventRecord]) -> Option<String> {
    events
        .iter()
        .max_by(|left, right| {
            left.timestamp
                .cmp(&right.timestamp)
                .then_with(|| left.id.cmp(&right.id))
        })
        .map(|event| event.id.clone())
}

fn format_event_time_iso(timestamp: i64) -> String {
    Utc.timestamp_millis_opt(timestamp)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn format_event_markdown(event: &EventRecord) -> String {
    let tags = serde_json::to_string(&event.tags).unwrap_or_else(|_| "[]".to_string());
    format!(
        "---\nevent_id: {}\nevent_time_ms: {}\nevent_time_iso: {}\ntags: {}\n---\n{}\n\n",
        event.id,
        event.timestamp,
        format_event_time_iso(event.timestamp),
        tags,
        event.content
    )
}

fn rebuild_markdown(paths: &EventLogPaths, events: &[EventRecord]) -> Result<(), String> {
    let mut ordered = events.to_vec();
    sort_events_asc(&mut ordered);

    let mut markdown = String::from(MIRROR_HEADER);
    for event in &ordered {
        markdown.push_str(&format_event_markdown(event));
    }

    fs::write(&paths.mirror, markdown)
        .map_err(|err| format!("failed to write markdown mirror: {err}"))?;
    let checkpoint_event = ordered.last().map(|event| event.id.clone());
    write_checkpoint(&paths.checkpoint, checkpoint_event)
}

fn sync_markdown_mirror(paths: &EventLogPaths, events: &[EventRecord]) -> Result<(), String> {
    rebuild_markdown(paths, events)
}

fn count_mirrored_events(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }

    let raw =
        fs::read_to_string(path).map_err(|err| format!("failed to read markdown mirror: {err}"))?;
    Ok(raw
        .lines()
        .filter(|line| line.trim_start().starts_with("event_id: "))
        .count())
}

#[tauri::command]
pub fn eventlog_list(app: AppHandle, user_id: Option<String>) -> Result<Vec<EventRecord>, String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    let mut events = read_events(&paths.events)?;
    sort_events_desc(&mut events);
    Ok(events)
}

#[tauri::command]
pub fn eventlog_append(
    app: AppHandle,
    user_id: Option<String>,
    event: EventRecord,
) -> Result<(), String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    let mut events = read_events(&paths.events)?;

    if let Some(existing) = events.iter_mut().find(|item| item.id == event.id) {
        *existing = event;
    } else {
        events.push(event);
    }

    sort_events_desc(&mut events);
    write_events(&paths.events, &events)?;
    sync_markdown_mirror(&paths, &events)
}

#[tauri::command]
pub fn eventlog_get(
    app: AppHandle,
    user_id: Option<String>,
    id: String,
) -> Result<Option<EventRecord>, String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    let events = read_events(&paths.events)?;
    Ok(events.into_iter().find(|event| event.id == id))
}

#[tauri::command]
pub fn eventlog_clear(app: AppHandle, user_id: Option<String>) -> Result<(), String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    write_events(&paths.events, &[])?;
    sync_markdown_mirror(&paths, &[])
}

#[tauri::command]
pub fn eventlog_mirror_status(
    app: AppHandle,
    user_id: Option<String>,
) -> Result<MirrorStatus, String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    let events = read_events(&paths.events)?;
    let checkpoint = read_checkpoint(&paths.checkpoint)?;
    let checkpoint_event_id = checkpoint.and_then(|value| value.last_event_id);
    let mirrored_events = count_mirrored_events(&paths.mirror)?;
    let latest = latest_event_id(&events);

    let needs_rebuild = if events.is_empty() {
        mirrored_events != 0 || checkpoint_event_id.is_some()
    } else {
        checkpoint_event_id.clone() != latest || mirrored_events < events.len()
    };

    Ok(MirrorStatus {
        mirror_file_path: paths.mirror.to_string_lossy().to_string(),
        checkpoint_event_id,
        total_events: events.len(),
        mirrored_events,
        needs_rebuild,
    })
}

#[tauri::command]
pub fn eventlog_rebuild_markdown(
    app: AppHandle,
    user_id: Option<String>,
) -> Result<MirrorStatus, String> {
    let paths = resolve_eventlog_paths(&app, user_id.as_deref())?;
    let events = read_events(&paths.events)?;
    sync_markdown_mirror(&paths, &events)?;
    eventlog_mirror_status(app, user_id)
}
