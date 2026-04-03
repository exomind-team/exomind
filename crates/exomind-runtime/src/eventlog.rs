//! EventLog store for the standalone runtime.
//!
//! Extracted from `src-tauri/src/commands/eventlog_commands.rs` — identical
//! JSON format, but no Tauri dependency.  Uses a plain `data_dir: PathBuf`
//! instead of `AppHandle`.

use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use std::sync::Mutex;
use tokio::sync::broadcast;

use crate::eventlog_sqlite::SqliteEventLogStore;

const EVENTLOG_DIR_NAME: &str = "eventlog";
const MIRROR_HEADER: &str = "# EventLog Mirror\n\n";

// ── Public types ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub timestamp: i64,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default)]
pub struct EventListFilter {
    pub since_timestamp: Option<i64>,
    pub until_timestamp: Option<i64>,
    pub tags: Vec<String>,
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

// ── Internal types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MirrorCheckpoint {
    last_event_id: Option<String>,
    updated_at_ms: i64,
}

struct EventLogPaths {
    events: PathBuf,
    mirror: PathBuf,
    checkpoint: PathBuf,
}

// ── Store ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventLogBackendKind {
    JsonFiles,
    Sqlite,
}

enum EventLogBackend {
    JsonFiles,
    Sqlite(SqliteEventLogStore),
}

pub struct EventLogStore {
    data_dir: PathBuf,
    backend: EventLogBackend,
    /// Optional broadcast sender for SSE notifications.
    /// When present, every mutation (append / clear / replace) automatically
    /// notifies watchers so callers never need to do it manually.
    watch_tx: Mutex<Option<broadcast::Sender<String>>>,
}

impl EventLogStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            backend: EventLogBackend::JsonFiles,
            watch_tx: Mutex::new(None),
        }
    }

    pub fn with_sqlite_path(data_dir: PathBuf, sqlite_path: &Path) -> Result<Self, String> {
        Ok(Self {
            data_dir,
            backend: EventLogBackend::Sqlite(SqliteEventLogStore::open(sqlite_path)?),
            watch_tx: Mutex::new(None),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Attach a broadcast sender for automatic SSE notifications on mutations.
    /// Can be called after construction (even through `&self` / `Arc<Self>`).
    pub fn set_watch_tx(&self, tx: broadcast::Sender<String>) {
        *self.watch_tx.lock().unwrap() = Some(tx);
    }

    /// Fire-and-forget: notify SSE watchers for the given user scope.
    /// Silently ignores send failures (no active receivers).
    fn notify_watchers(&self, user_id: Option<&str>) {
        if let Some(tx) = self.watch_tx.lock().unwrap().as_ref() {
            let _ = tx.send(sanitize_user_id(user_id));
        }
    }

    // ── public API ──────────────────────────────────────────────

    pub fn list_events(&self, user_id: Option<&str>) -> Result<Vec<EventRecord>, String> {
        self.list_events_filtered(user_id, &EventListFilter::default())
    }

    pub fn list_events_filtered(
        &self,
        user_id: Option<&str>,
        filter: &EventListFilter,
    ) -> Result<Vec<EventRecord>, String> {
        let normalized_user = sanitize_user_id(user_id);
        match &self.backend {
            EventLogBackend::JsonFiles => {
                let paths = self.resolve_paths(user_id)?;
                let mut events = read_events(&paths.events)?;
                sort_events_desc(&mut events);
                apply_event_filters(&mut events, filter);
                Ok(events)
            }
            EventLogBackend::Sqlite(store) => store.list_events_filtered(&normalized_user, filter),
        }
    }

    pub fn append_event(&self, user_id: Option<&str>, event: EventRecord) -> Result<(), String> {
        let normalized_user = sanitize_user_id(user_id);
        let result = match &self.backend {
            EventLogBackend::JsonFiles => {
                let paths = self.resolve_paths(user_id)?;
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
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.append_event(&normalized_user, &event)?;
                let events = store.list_events(&normalized_user)?;
                sync_markdown_mirror(&paths, &events)
            }
        };
        if result.is_ok() {
            self.notify_watchers(user_id);
        }
        result
    }

    pub fn get_event(
        &self,
        user_id: Option<&str>,
        id: &str,
    ) -> Result<Option<EventRecord>, String> {
        let normalized_user = sanitize_user_id(user_id);
        match &self.backend {
            EventLogBackend::JsonFiles => {
                let paths = self.resolve_paths(user_id)?;
                let events = read_events(&paths.events)?;
                Ok(events.into_iter().find(|event| event.id == id))
            }
            EventLogBackend::Sqlite(store) => store.get_event(&normalized_user, id),
        }
    }

    pub fn clear_events(&self, user_id: Option<&str>) -> Result<(), String> {
        let normalized_user = sanitize_user_id(user_id);
        let result = match &self.backend {
            EventLogBackend::JsonFiles => {
                let paths = self.resolve_paths(user_id)?;
                write_events(&paths.events, &[])?;
                sync_markdown_mirror(&paths, &[])
            }
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.clear_events(&normalized_user)?;
                sync_markdown_mirror(&paths, &[])
            }
        };
        if result.is_ok() {
            self.notify_watchers(user_id);
        }
        result
    }

    pub fn mirror_status(&self, user_id: Option<&str>) -> Result<MirrorStatus, String> {
        let paths = self.resolve_paths(user_id)?;
        let events = self.list_events(user_id)?;
        let checkpoint = read_checkpoint(&paths.checkpoint)?;
        let checkpoint_event_id = checkpoint.and_then(|v| v.last_event_id);
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

    pub fn current_revision(&self, user_id: Option<&str>) -> Result<Option<i64>, String> {
        let paths = self.resolve_paths(user_id)?;
        Ok(read_checkpoint(&paths.checkpoint)?.map(|checkpoint| checkpoint.updated_at_ms))
    }

    pub fn rebuild_markdown(&self, user_id: Option<&str>) -> Result<MirrorStatus, String> {
        let paths = self.resolve_paths(user_id)?;
        let events = self.list_events(user_id)?;
        sync_markdown_mirror(&paths, &events)?;
        // Re-compute status after rebuild.
        self.mirror_status(user_id)
    }

    pub fn replace_all_events(
        &self,
        user_id: Option<&str>,
        events: &[EventRecord],
    ) -> Result<(), String> {
        let normalized_user = sanitize_user_id(user_id);
        let result = match &self.backend {
            EventLogBackend::JsonFiles => {
                let paths = self.resolve_paths(user_id)?;
                let mut ordered = events.to_vec();
                sort_events_desc(&mut ordered);
                write_events(&paths.events, &ordered)?;
                sync_markdown_mirror(&paths, &ordered)
            }
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.replace_all(&normalized_user, events)?;
                let current = store.list_events(&normalized_user)?;
                sync_markdown_mirror(&paths, &current)
            }
        };
        if result.is_ok() {
            self.notify_watchers(user_id);
        }
        result
    }

    pub fn sqlite_snapshot_bytes(&self) -> Result<Option<Vec<u8>>, String> {
        match &self.backend {
            EventLogBackend::JsonFiles => Ok(None),
            EventLogBackend::Sqlite(store) => store.snapshot_bytes().map(Some),
        }
    }

    pub fn backend_kind(&self) -> EventLogBackendKind {
        match &self.backend {
            EventLogBackend::JsonFiles => EventLogBackendKind::JsonFiles,
            EventLogBackend::Sqlite(_) => EventLogBackendKind::Sqlite,
        }
    }

    pub fn list_known_user_ids(&self) -> Result<Vec<String>, String> {
        match &self.backend {
            EventLogBackend::JsonFiles => self.list_known_user_ids_from_json(),
            EventLogBackend::Sqlite(store) => store.list_known_user_ids(),
        }
    }

    // ── internal helpers ────────────────────────────────────────

    fn resolve_paths(&self, user_id: Option<&str>) -> Result<EventLogPaths, String> {
        let eventlog_dir = self.data_dir.join(EVENTLOG_DIR_NAME);
        if !eventlog_dir.exists() {
            fs::create_dir_all(&eventlog_dir)
                .map_err(|err| format!("failed to create eventlog dir: {err}"))?;
        }

        let normalized_user = sanitize_user_id(user_id);

        Ok(EventLogPaths {
            events: eventlog_dir.join(format!("{normalized_user}.json")),
            mirror: eventlog_dir.join(format!("{normalized_user}.md")),
            checkpoint: eventlog_dir.join(format!("{normalized_user}.checkpoint.json")),
        })
    }

    fn list_known_user_ids_from_json(&self) -> Result<Vec<String>, String> {
        let eventlog_dir = self.data_dir.join(EVENTLOG_DIR_NAME);
        if !eventlog_dir.exists() {
            return Ok(vec![]);
        }

        let mut users = fs::read_dir(&eventlog_dir)
            .map_err(|error| format!("failed to read eventlog dir: {error}"))?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    return None;
                }
                let name = path.file_name()?.to_str()?;
                if name.ends_with(".checkpoint.json") {
                    return None;
                }
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();

        users.sort();
        users.dedup();
        Ok(users)
    }
}

// ── Free functions ──────────────────────────────────────────────

pub fn sanitize_user_id(user_id: Option<&str>) -> String {
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

fn apply_event_filters(events: &mut Vec<EventRecord>, filter: &EventListFilter) {
    if let Some(since_timestamp) = filter.since_timestamp {
        events.retain(|event| event.timestamp >= since_timestamp);
    }

    if let Some(until_timestamp) = filter.until_timestamp {
        events.retain(|event| event.timestamp <= until_timestamp);
    }

    if !filter.tags.is_empty() {
        events.retain(|event| {
            filter
                .tags
                .iter()
                .all(|tag| event.tags.iter().any(|event_tag| event_tag == tag))
        });
    }
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

fn rebuild_markdown_file(paths: &EventLogPaths, events: &[EventRecord]) -> Result<(), String> {
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
    rebuild_markdown_file(paths, events)
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

// ── Unit tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sanitize_user_id_defaults() {
        assert_eq!(sanitize_user_id(None), "anonymous");
        assert_eq!(sanitize_user_id(Some("")), "anonymous");
        assert_eq!(sanitize_user_id(Some("  ")), "anonymous");
    }

    #[test]
    fn sanitize_user_id_replaces_special_chars() {
        assert_eq!(sanitize_user_id(Some("user@host.com")), "user_host_com");
        assert_eq!(sanitize_user_id(Some("hello-world_1")), "hello-world_1");
    }

    #[test]
    fn roundtrip_append_list() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        let event = EventRecord {
            id: "evt-1".to_string(),
            timestamp: 1700000000000,
            content: "hello".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        };

        store.append_event(None, event.clone()).unwrap();
        let events = store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "evt-1");
        assert_eq!(events[0].content, "hello");
    }

    #[test]
    fn sqlite_store_persists_events_across_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");

        let store =
            EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap();
        let event = EventRecord {
            id: "evt-sql-1".to_string(),
            timestamp: 1700000000000,
            content: "persist me".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        };
        store.append_event(None, event.clone()).unwrap();
        drop(store);

        let reopened =
            EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap();
        let events = reopened.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "evt-sql-1");
        assert_eq!(events[0].content, "persist me");
    }

    #[test]
    fn get_event_by_id() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        store
            .append_event(
                None,
                EventRecord {
                    id: "a".to_string(),
                    timestamp: 1,
                    content: "first".to_string(),
                    tags: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        assert!(store.get_event(None, "a").unwrap().is_some());
        assert!(store.get_event(None, "nonexistent").unwrap().is_none());
    }

    #[test]
    fn clear_removes_all() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        store
            .append_event(
                None,
                EventRecord {
                    id: "x".to_string(),
                    timestamp: 1,
                    content: "data".to_string(),
                    tags: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        store.clear_events(None).unwrap();
        let events = store.list_events(None).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn upsert_updates_existing_event() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        store
            .append_event(
                None,
                EventRecord {
                    id: "u1".to_string(),
                    timestamp: 100,
                    content: "original".to_string(),
                    tags: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        store
            .append_event(
                None,
                EventRecord {
                    id: "u1".to_string(),
                    timestamp: 200,
                    content: "updated".to_string(),
                    tags: vec!["changed".to_string()],
                    metadata: None,
                },
            )
            .unwrap();

        let events = store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content, "updated");
    }

    #[test]
    fn mirror_status_and_rebuild() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        store
            .append_event(
                None,
                EventRecord {
                    id: "m1".to_string(),
                    timestamp: 1000,
                    content: "mirror test".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();

        let status = store.mirror_status(None).unwrap();
        assert_eq!(status.total_events, 1);
        assert!(!status.needs_rebuild);

        let rebuilt = store.rebuild_markdown(None).unwrap();
        assert_eq!(rebuilt.total_events, 1);
        assert!(!rebuilt.needs_rebuild);
    }

    #[test]
    fn user_isolation() {
        let dir = tempdir().unwrap();
        let store = EventLogStore::new(dir.path().to_path_buf());

        store
            .append_event(
                Some("alice"),
                EventRecord {
                    id: "a1".to_string(),
                    timestamp: 1,
                    content: "alice data".to_string(),
                    tags: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        store
            .append_event(
                Some("bob"),
                EventRecord {
                    id: "b1".to_string(),
                    timestamp: 1,
                    content: "bob data".to_string(),
                    tags: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        assert_eq!(store.list_events(Some("alice")).unwrap().len(), 1);
        assert_eq!(store.list_events(Some("bob")).unwrap().len(), 1);
        assert_eq!(store.list_events(None).unwrap().len(), 0);
    }
}
