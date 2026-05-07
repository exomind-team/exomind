//! EventLog store for the standalone runtime.
//!
//! Extracted from `src-tauri/src/commands/eventlog_commands.rs` — identical
//! JSON format, but no Tauri dependency.  Uses a plain `data_dir: PathBuf`
//! instead of `AppHandle`.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

use crate::config::types::USER_CONFIG_SCOPE;
use crate::eventlog_sqlite::SqliteEventLogStore;

const EVENTLOG_DIR_NAME: &str = "eventlog";
pub const PERF_LOGGING_ENABLED_CONFIG_KEY: &str = "exomind:perfLoggingEnabled";

// ── Public types ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRef {
    pub kind: String,
    pub event_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub timestamp: i64,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<EventRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default)]
pub struct EventListFilter {
    pub since_timestamp: Option<i64>,
    pub until_timestamp: Option<i64>,
    pub tags: Vec<String>,
    pub limit: Option<usize>,
    /// Filter events whose metadata contains any of these task_ids.
    pub task_ids: Vec<String>,
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
    config_store: Mutex<Option<Arc<crate::config::ConfigStore>>>,
}

impl EventLogStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            backend: EventLogBackend::JsonFiles,
            watch_tx: Mutex::new(None),
            config_store: Mutex::new(None),
        }
    }

    pub fn with_sqlite_path(data_dir: PathBuf, sqlite_path: &Path) -> Result<Self, String> {
        Ok(Self {
            data_dir,
            backend: EventLogBackend::Sqlite(SqliteEventLogStore::open(sqlite_path)?),
            watch_tx: Mutex::new(None),
            config_store: Mutex::new(None),
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

    pub fn set_config_store(&self, config_store: Arc<crate::config::ConfigStore>) {
        *self.config_store.lock().unwrap() = Some(config_store);
    }

    /// Fire-and-forget: notify SSE watchers for the given user scope.
    /// Silently ignores send failures (no active receivers).
    fn notify_watchers(&self, user_id: Option<&str>) {
        if let Some(tx) = self.watch_tx.lock().unwrap().as_ref() {
            let _ = tx.send(sanitize_user_id(user_id));
        }
    }

    fn is_perf_logging_enabled(&self) -> bool {
        let Some(config_store) = self.config_store.lock().unwrap().clone() else {
            return false;
        };

        match config_store.get(USER_CONFIG_SCOPE, PERF_LOGGING_ENABLED_CONFIG_KEY) {
            Ok(Some(entry)) => entry.value.trim() == "true",
            Ok(None) => false,
            Err(_) => false,
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

    pub fn list_events_after_cursor_filtered(
        &self,
        user_id: Option<&str>,
        since_id: &str,
        filter: &EventListFilter,
        limit: Option<usize>,
    ) -> Result<(Vec<EventRecord>, bool), String> {
        let Some(cursor_event) = self.get_event(user_id, since_id)? else {
            return self.list_cursor_fallback_snapshot(user_id, filter, limit, "cursor_missing");
        };

        if !event_matches_filter(&cursor_event, filter) {
            return self.list_cursor_fallback_snapshot(
                user_id,
                filter,
                limit,
                "cursor_outside_filter",
            );
        }

        let normalized_user = sanitize_user_id(user_id);
        match &self.backend {
            EventLogBackend::JsonFiles => {
                let mut events = self.list_events_filtered(user_id, filter)?;
                events.retain(|event| {
                    event.timestamp > cursor_event.timestamp
                        || (event.timestamp == cursor_event.timestamp && event.id > cursor_event.id)
                });
                if let Some(limit) = limit {
                    events.truncate(limit);
                }
                Ok((events, true))
            }
            EventLogBackend::Sqlite(store) => store
                .list_events_after_cursor_filtered(&normalized_user, &cursor_event, filter, limit)
                .map(|events| (events, true)),
        }
    }

    fn list_cursor_fallback_snapshot(
        &self,
        user_id: Option<&str>,
        filter: &EventListFilter,
        limit: Option<usize>,
        reason: &'static str,
    ) -> Result<(Vec<EventRecord>, bool), String> {
        let started_at = Instant::now();
        let fallback_filter = build_fallback_snapshot_filter(filter, limit);
        let events = self.list_events_filtered(user_id, &fallback_filter)?;
        if self.is_perf_logging_enabled() {
            tracing::info!(
                scope_key = %sanitize_user_id(user_id),
                reason,
                requested_limit = ?limit,
                effective_limit = ?fallback_filter.limit,
                result_count = events.len(),
                "[PERF] ({}ms) runtime.eventlog.cursor_fallback_full_snapshot",
                started_at.elapsed().as_millis()
            );
        }
        Ok((events, false))
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
                write_checkpoint(&paths.checkpoint, latest_event_id(&events))
            }
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.append_event(&normalized_user, &event)?;
                write_checkpoint(&paths.checkpoint, Some(event.id.clone()))
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
                write_checkpoint(&paths.checkpoint, None)
            }
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.clear_events(&normalized_user)?;
                write_checkpoint(&paths.checkpoint, None)
            }
        };
        if result.is_ok() {
            self.notify_watchers(user_id);
        }
        result
    }

    pub fn current_revision(&self, user_id: Option<&str>) -> Result<Option<i64>, String> {
        let paths = self.resolve_paths(user_id)?;
        Ok(read_checkpoint(&paths.checkpoint)?.map(|checkpoint| checkpoint.updated_at_ms))
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
                write_checkpoint(&paths.checkpoint, latest_event_id(&ordered))
            }
            EventLogBackend::Sqlite(store) => {
                let paths = self.resolve_paths(user_id)?;
                store.replace_all(&normalized_user, events)?;
                write_checkpoint(&paths.checkpoint, latest_event_id(events))
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

    if let Some(limit) = filter.limit {
        events.truncate(limit);
    }

    if !filter.task_ids.is_empty() {
        let ids: std::collections::HashSet<_> = filter.task_ids.iter().map(|s| s.as_str()).collect();
        events.retain(|event| {
            event.metadata.as_ref()
                .and_then(|m| m.get("taskId").or_else(|| m.get("task_id")))
                .and_then(|v| v.as_str())
                .map_or(false, |s| ids.contains(s))
        });
    }
}

fn build_fallback_snapshot_filter(
    filter: &EventListFilter,
    requested_limit: Option<usize>,
) -> EventListFilter {
    let mut fallback_filter = filter.clone();
    fallback_filter.limit = merge_event_list_limits(filter.limit, requested_limit);
    fallback_filter
}

fn merge_event_list_limits(existing: Option<usize>, requested: Option<usize>) -> Option<usize> {
    match (existing, requested) {
        (Some(existing), Some(requested)) => Some(existing.min(requested)),
        (Some(existing), None) => Some(existing),
        (None, Some(requested)) => Some(requested),
        (None, None) => None,
    }
}

fn event_matches_filter(event: &EventRecord, filter: &EventListFilter) -> bool {
    if let Some(since_timestamp) = filter.since_timestamp {
        if event.timestamp < since_timestamp {
            return false;
        }
    }

    if let Some(until_timestamp) = filter.until_timestamp {
        if event.timestamp > until_timestamp {
            return false;
        }
    }

    filter
        .tags
        .iter()
        .all(|tag| event.tags.iter().any(|event_tag| event_tag == tag))
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

// ── Unit tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ConfigStore, PutConfigEntryInput};
    use tempfile::tempdir;

    fn make_event(id: &str, timestamp: i64) -> EventRecord {
        EventRecord {
            id: id.to_string(),
            timestamp,
            content: format!("event-{id}"),
            tags: vec!["note".to_string()],
            refs: Vec::new(),
            metadata: None,
        }
    }

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
    fn build_fallback_snapshot_filter_applies_requested_limit() {
        let filter = EventListFilter {
            since_timestamp: Some(1_700_000_000_000),
            until_timestamp: Some(1_700_000_000_999),
            tags: vec!["note".to_string()],
            limit: None,
            task_ids: vec![],
        };

        let fallback = build_fallback_snapshot_filter(&filter, Some(2));

        assert_eq!(fallback.since_timestamp, filter.since_timestamp);
        assert_eq!(fallback.until_timestamp, filter.until_timestamp);
        assert_eq!(fallback.tags, filter.tags);
        assert_eq!(fallback.limit, Some(2));
    }

    #[test]
    fn build_fallback_snapshot_filter_keeps_smallest_limit() {
        let filter = EventListFilter {
            limit: Some(1),
            ..EventListFilter::default()
        };

        let fallback = build_fallback_snapshot_filter(&filter, Some(3));

        assert_eq!(fallback.limit, Some(1));
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
            refs: Vec::new(),
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
            refs: Vec::new(),
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
    fn sqlite_cursor_missing_fallback_applies_limit() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");
        let store =
            EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap();

        for index in 0..5 {
            let event = make_event(
                format!("sql-{index}").as_str(),
                1_700_000_000_000_i64 + index,
            );
            store.append_event(None, event).unwrap();
        }

        let (events, cursor_found) = store
            .list_events_after_cursor_filtered(
                None,
                "missing-cursor",
                &EventListFilter::default(),
                Some(2),
            )
            .unwrap();

        assert!(!cursor_found);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "sql-4");
        assert_eq!(events[1].id, "sql-3");
    }

    #[test]
    fn sqlite_cursor_outside_filter_fallback_applies_limit() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");
        let store =
            EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap();

        store
            .append_event(None, make_event("sql-old", 1_700_000_000_000))
            .unwrap();
        store
            .append_event(None, make_event("sql-mid", 1_700_000_000_100))
            .unwrap();
        store
            .append_event(None, make_event("sql-new", 1_700_000_000_200))
            .unwrap();

        let (events, cursor_found) = store
            .list_events_after_cursor_filtered(
                None,
                "sql-old",
                &EventListFilter {
                    since_timestamp: Some(1_700_000_000_050),
                    ..EventListFilter::default()
                },
                Some(1),
            )
            .unwrap();

        assert!(!cursor_found);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "sql-new");
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
                    refs: Vec::new(),
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
                    refs: Vec::new(),
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
                    refs: Vec::new(),
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
                    refs: Vec::new(),
                    metadata: None,
                },
            )
            .unwrap();

        let events = store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content, "updated");
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
                    refs: Vec::new(),
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
                    refs: Vec::new(),
                    metadata: None,
                },
            )
            .unwrap();

        assert_eq!(store.list_events(Some("alice")).unwrap().len(), 1);
        assert_eq!(store.list_events(Some("bob")).unwrap().len(), 1);
        assert_eq!(store.list_events(None).unwrap().len(), 0);
    }
}
