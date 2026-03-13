//! EventLog HTTP routes for the standalone runtime.
//!
//! Mirrors the Tauri commands from `eventlog_commands.rs` as REST endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::eventlog::{EventRecord, MirrorStatus};

// ── Request / query types ───────────────────────────────────────

#[derive(Debug, Deserialize)]
struct EventLogQuery {
    user_id: Option<String>,
    limit: Option<usize>,
    since_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImportQuery {
    user_id: Option<String>,
    strategy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EventLogBackupJsonPayload {
    version: u32,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    events: Vec<EventRecord>,
}

#[derive(Debug, Serialize)]
struct EventLogBackupSqlitePayload {
    version: u32,
    file_name: String,
    content_base64: String,
    event_count: usize,
}

#[derive(Debug, Deserialize)]
struct EventLogBackupSqliteImportPayload {
    content_base64: String,
}

#[derive(Debug, Serialize)]
struct EventLogImportResult {
    imported: usize,
    skipped: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
struct EventLogBackendStatusResponse {
    backend: &'static str,
    supports_json_backup: bool,
    supports_sqlite_snapshot: bool,
}

enum EventLogImportStrategy {
    Merge,
    Overwrite,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

fn internal_error(msg: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: msg }),
    )
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /eventlog — list all events (optionally filtered by user_id, limit, since_id).
async fn list_events(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<Vec<EventRecord>>, (StatusCode, Json<ErrorResponse>)> {
    let mut events = state
        .eventlog_store
        .list_events(query.user_id.as_deref())
        .map_err(internal_error)?;

    // Filter by since_id: keep only events that come *after* the given ID
    // (i.e., newer events — list is sorted desc by timestamp).
    if let Some(ref since_id) = query.since_id {
        if let Some(pos) = events.iter().position(|e| e.id == *since_id) {
            // Events before `pos` are newer (desc order).
            events.truncate(pos);
        }
        // If since_id not found, return all events.
    }

    if let Some(limit) = query.limit {
        events.truncate(limit);
    }

    Ok(Json(events))
}

/// POST /eventlog — append (or upsert) a single event.
async fn append_event(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
    Json(event): Json<EventRecord>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .eventlog_store
        .append_event(query.user_id.as_deref(), event)
        .map_err(internal_error)?;
    Ok(StatusCode::CREATED)
}

/// GET /eventlog/:id — get a single event by ID.
async fn get_event(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<EventRecord>, (StatusCode, Json<ErrorResponse>)> {
    let event = state
        .eventlog_store
        .get_event(query.user_id.as_deref(), &id)
        .map_err(internal_error)?;

    match event {
        Some(e) => Ok(Json(e)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("event not found: {id}"),
            }),
        )),
    }
}

/// DELETE /eventlog — clear all events for the given user.
async fn clear_events(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .eventlog_store
        .clear_events(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /eventlog/mirror-status — return mirror synchronisation status.
async fn mirror_status_handler(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<MirrorStatus>, (StatusCode, Json<ErrorResponse>)> {
    let status = state
        .eventlog_store
        .mirror_status(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(Json(status))
}

/// POST /eventlog/rebuild — rebuild the markdown mirror and return status.
async fn rebuild_handler(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<MirrorStatus>, (StatusCode, Json<ErrorResponse>)> {
    let status = state
        .eventlog_store
        .rebuild_markdown(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(Json(status))
}

async fn export_eventlog_json(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<EventLogBackupJsonPayload>, (StatusCode, Json<ErrorResponse>)> {
    let events = state
        .eventlog_store
        .list_events(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(Json(EventLogBackupJsonPayload {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        events,
    }))
}

async fn export_eventlog_sqlite(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<EventLogBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let events = state
        .eventlog_store
        .list_events(query.user_id.as_deref())
        .map_err(internal_error)?;
    let bytes = build_eventlog_sqlite_snapshot_bytes(&state, query.user_id.as_deref(), &events)
        .map_err(internal_error)?;
    Ok(Json(EventLogBackupSqlitePayload {
        version: 1,
        file_name: "exomind-eventlog.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        event_count: events.len(),
    }))
}

async fn import_eventlog_json(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<EventLogBackupJsonPayload>,
) -> Result<Json<EventLogImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())
        .map_err(internal_error)?;
    let result = apply_event_import(
        &state,
        query.user_id.as_deref(),
        payload.events,
        strategy,
    )
    .map_err(internal_error)?;
    Ok(Json(result))
}

async fn import_eventlog_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<EventLogBackupSqliteImportPayload>,
) -> Result<Json<EventLogImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())
        .map_err(internal_error)?;
    let bytes = STANDARD
        .decode(payload.content_base64)
        .map_err(|error| internal_error(format!("invalid sqlite snapshot: {error}")))?;
    let imported_events = read_events_from_sqlite_snapshot(&bytes, query.user_id.as_deref())
        .map_err(internal_error)?;
    let result = apply_event_import(
        &state,
        query.user_id.as_deref(),
        imported_events,
        strategy,
    )
    .map_err(internal_error)?;
    Ok(Json(result))
}

async fn eventlog_backend_status(
    State(state): State<AppState>,
) -> Json<EventLogBackendStatusResponse> {
    let supports_sqlite_snapshot = matches!(
        state.eventlog_store.backend_kind(),
        crate::eventlog::EventLogBackendKind::Sqlite
    );
    Json(EventLogBackendStatusResponse {
        backend: if supports_sqlite_snapshot { "rt-sqlite" } else { "json-files" },
        supports_json_backup: true,
        supports_sqlite_snapshot,
    })
}

// ── Router assembly ─────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/eventlog/backend/status", get(eventlog_backend_status))
        .route(
            "/eventlog",
            get(list_events).post(append_event).delete(clear_events),
        )
        .route("/eventlog/backup/json", get(export_eventlog_json))
        .route("/eventlog/backup/sqlite", get(export_eventlog_sqlite))
        .route("/eventlog/import/json", post(import_eventlog_json))
        .route("/eventlog/import/sqlite", post(import_eventlog_sqlite))
        // Mirror sub-routes use a distinct prefix to avoid conflict with
        // the dynamic `:id` capture below.
        .route("/eventlog/mirror/status", get(mirror_status_handler))
        .route("/eventlog/mirror/rebuild", post(rebuild_handler))
        .route("/eventlog/events/:id", get(get_event))
}

fn parse_import_strategy(raw: Option<&str>) -> Result<EventLogImportStrategy, String> {
    match raw.unwrap_or("merge") {
        "merge" => Ok(EventLogImportStrategy::Merge),
        "overwrite" => Ok(EventLogImportStrategy::Overwrite),
        value => Err(format!("unsupported eventlog import strategy: {value}")),
    }
}

fn apply_event_import(
    state: &AppState,
    user_id: Option<&str>,
    incoming: Vec<EventRecord>,
    strategy: EventLogImportStrategy,
) -> Result<EventLogImportResult, String> {
    let existing = state.eventlog_store.list_events(user_id)?;
    let result = match strategy {
        EventLogImportStrategy::Overwrite => {
            state.eventlog_store.replace_all_events(user_id, &incoming)?;
            EventLogImportResult {
                imported: incoming.len(),
                skipped: 0,
                total: incoming.len(),
            }
        }
        EventLogImportStrategy::Merge => {
            let mut merged = std::collections::BTreeMap::new();
            for event in &existing {
                merged.insert(event.id.clone(), event.clone());
            }

            let mut imported = 0usize;
            let mut skipped = 0usize;
            for event in incoming {
                if merged.contains_key(&event.id) {
                    skipped += 1;
                } else {
                    imported += 1;
                }
                merged.insert(event.id.clone(), event);
            }

            let next = merged.into_values().collect::<Vec<_>>();
            state.eventlog_store.replace_all_events(user_id, &next)?;
            EventLogImportResult {
                imported,
                skipped,
                total: next.len(),
            }
        }
    };

    Ok(result)
}

fn build_eventlog_sqlite_snapshot_bytes(
    state: &AppState,
    user_id: Option<&str>,
    events: &[EventRecord],
) -> Result<Vec<u8>, String> {
    if user_id.is_none() {
        return state
            .eventlog_store
            .sqlite_snapshot_bytes()?
            .ok_or_else(|| "eventlog sqlite snapshot is unavailable on non-sqlite backend".to_string());
    }

    let temp_root = std::env::temp_dir().join(format!("exomind-eventlog-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)
        .map_err(|error| format!("failed to create temp eventlog export dir: {error}"))?;
    let sqlite_path = temp_root.join("eventlog-export.sqlite");
    let scoped_store = crate::eventlog::EventLogStore::with_sqlite_path(temp_root.clone(), &sqlite_path)?;
    scoped_store.replace_all_events(user_id, events)?;
    let bytes = scoped_store
        .sqlite_snapshot_bytes()?
        .ok_or_else(|| "failed to produce scoped sqlite snapshot".to_string())?;
    drop(scoped_store);
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok(bytes)
}

fn read_events_from_sqlite_snapshot(bytes: &[u8], user_id: Option<&str>) -> Result<Vec<EventRecord>, String> {
    let temp_root = std::env::temp_dir().join(format!("exomind-eventlog-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)
        .map_err(|error| format!("failed to create temp eventlog dir: {error}"))?;
    let sqlite_path = temp_root.join("eventlog-import.sqlite");
    std::fs::write(&sqlite_path, bytes)
        .map_err(|error| format!("failed to write temp sqlite snapshot: {error}"))?;
    let store = crate::eventlog::EventLogStore::with_sqlite_path(temp_root.clone(), &sqlite_path)?;
    let events = store.list_events(user_id)?;
    drop(store);
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok(events)
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use crate::eventlog::EventLogStore;
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state_with_eventlog(store: Arc<EventLogStore>) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "eventlog-test".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            timeblock_store: Arc::new(crate::timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(crate::tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store: store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn append_and_list() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append an event.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"e1","timestamp":1700000000000,"content":"hello","tags":["note"]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // List events.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["id"], "e1");
        assert_eq!(events[0]["content"], "hello");
    }

    #[tokio::test]
    async fn get_by_id() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"g1","timestamp":1000,"content":"get-me","tags":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Get by ID.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/events/g1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let event: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(event["id"], "g1");
        assert_eq!(event["content"], "get-me");
    }

    #[tokio::test]
    async fn get_nonexistent_returns_404() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/events/no-such-id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn clear_removes_all() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append two events.
        for id in &["c1", "c2"] {
            let _ = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/eventlog")
                        .header("content-type", "application/json")
                        .body(Body::from(format!(
                            r#"{{"id":"{id}","timestamp":1,"content":"x","tags":[]}}"#
                        )))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        // Clear.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        // Verify empty.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn list_with_limit() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append 5 events.
        for i in 0..5 {
            let _ = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/eventlog")
                        .header("content-type", "application/json")
                        .body(Body::from(format!(
                            r#"{{"id":"l{i}","timestamp":{ts},"content":"event {i}","tags":[]}}"#,
                            ts = 1000 + i
                        )))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        // List with limit=2.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog?limit=2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(events.len(), 2);
    }

    #[tokio::test]
    async fn mirror_status_route() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append an event first.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"ms1","timestamp":5000,"content":"mirror test","tags":["note"]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/mirror/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let status: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status["totalEvents"], 1);
    }

    #[tokio::test]
    async fn rebuild_route() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"rb1","timestamp":9000,"content":"rebuild test","tags":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog/mirror/rebuild")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let status: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status["totalEvents"], 1);
        assert_eq!(status["needsRebuild"], false);
    }

    #[tokio::test]
    async fn export_eventlog_json_backup() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        store
            .append_event(
                None,
                EventRecord {
                    id: "backup-1".to_string(),
                    timestamp: 1234,
                    content: "json backup".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: Some(serde_json::json!({
                        "source": { "deviceId": "dev-1" }
                    })),
                },
            )
            .unwrap();
        let app = test_router(test_state_with_eventlog(store));

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/backup/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["version"], 1);
        assert_eq!(payload["events"][0]["id"], "backup-1");
        assert_eq!(payload["events"][0]["metadata"]["source"]["deviceId"], "dev-1");
    }

    #[tokio::test]
    async fn export_eventlog_sqlite_snapshot() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");
        let store = Arc::new(EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap());
        store
            .append_event(
                None,
                EventRecord {
                    id: "sql-backup-1".to_string(),
                    timestamp: 5678,
                    content: "sqlite backup".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        let app = test_router(test_state_with_eventlog(store));

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/backup/sqlite")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let encoded = payload["content_base64"].as_str().expect("base64 snapshot");
        let bytes = STANDARD.decode(encoded).expect("valid sqlite bytes");
        assert!(!bytes.is_empty());
    }

    #[tokio::test]
    async fn export_eventlog_sqlite_snapshot_honors_user_id_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog-users.sqlite");
        let store = Arc::new(EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap());
        store.append_event(Some("user-a"), EventRecord {
            id: "user-a-1".to_string(),
            timestamp: 1000,
            content: "from user a".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        }).unwrap();
        store.append_event(Some("user-b"), EventRecord {
            id: "user-b-1".to_string(),
            timestamp: 2000,
            content: "from user b".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        }).unwrap();

        let app = test_router(test_state_with_eventlog(store));
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/backup/sqlite?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let bytes = STANDARD
            .decode(payload["content_base64"].as_str().expect("base64 snapshot"))
            .expect("valid sqlite bytes");

        let import_dir = tempdir().unwrap();
        let import_sqlite_path = import_dir.path().join("scoped-export.sqlite");
        std::fs::write(&import_sqlite_path, bytes).unwrap();
        let imported_store = EventLogStore::with_sqlite_path(import_dir.path().to_path_buf(), &import_sqlite_path).unwrap();
        let user_a_events = imported_store.list_events(Some("user-a")).unwrap();
        let user_b_events = imported_store.list_events(Some("user-b")).unwrap();

        assert_eq!(user_a_events.len(), 1);
        assert_eq!(user_a_events[0].id, "user-a-1");
        assert!(user_b_events.is_empty(), "scoped sqlite export should not leak other users");
    }

    #[tokio::test]
    async fn import_eventlog_json_backup_with_merge_strategy() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        store
            .append_event(
                None,
                EventRecord {
                    id: "existing-1".to_string(),
                    timestamp: 1000,
                    content: "existing".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        let app = test_router(test_state_with_eventlog(store.clone()));

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog/import/json?strategy=merge")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{
                        "version": 1,
                        "exportedAt": "2026-03-11T00:00:00.000Z",
                        "events": [
                            {
                                "id": "existing-1",
                                "timestamp": 2000,
                                "content": "existing replaced",
                                "tags": ["note"]
                            },
                            {
                                "id": "incoming-2",
                                "timestamp": 3000,
                                "content": "incoming event",
                                "tags": ["note"],
                                "metadata": {
                                    "source": { "deviceId": "dev-2" }
                                }
                            }
                        ]
                    }"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], 1);
        assert_eq!(result["skipped"], 1);
        assert_eq!(result["total"], 2);

        let events = store.list_events(None).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|event| event.content == "existing replaced"));
        assert!(events.iter().any(|event| event.id == "incoming-2"));
    }

    #[tokio::test]
    async fn import_eventlog_sqlite_snapshot_respects_user_id_scope() {
        let import_dir = tempdir().unwrap();
        let import_sqlite_path = import_dir.path().join("import-eventlog.sqlite");
        let import_store = EventLogStore::with_sqlite_path(import_dir.path().to_path_buf(), &import_sqlite_path).unwrap();
        import_store.append_event(Some("user-a"), EventRecord {
            id: "user-a-import".to_string(),
            timestamp: 1234,
            content: "imported for user a".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        }).unwrap();
        let import_bytes = import_store.sqlite_snapshot_bytes().unwrap().unwrap();

        let target_dir = tempdir().unwrap();
        let target_store = Arc::new(EventLogStore::with_sqlite_path(target_dir.path().to_path_buf(), &target_dir.path().join("target.sqlite")).unwrap());
        let app = test_router(test_state_with_eventlog(target_store.clone()));

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog/import/sqlite?user_id=user-a&strategy=overwrite")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({
                        "content_base64": STANDARD.encode(import_bytes),
                    }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let user_a_events = target_store.list_events(Some("user-a")).unwrap();
        assert_eq!(user_a_events.len(), 1);
        assert_eq!(user_a_events[0].id, "user-a-import");
    }

    fn remove_temp_dirs_with_prefix(prefix: &str) {
        let temp_dir = std::env::temp_dir();
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if name.starts_with(prefix) {
                    let _ = std::fs::remove_dir_all(&path);
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    fn count_temp_dirs_with_prefix(prefix: &str) -> usize {
        let temp_dir = std::env::temp_dir();
        std::fs::read_dir(&temp_dir)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(prefix))
            })
            .count()
    }

    #[tokio::test]
    async fn scoped_sqlite_export_and_import_leave_no_temp_dirs() {
        remove_temp_dirs_with_prefix("exomind-eventlog-export-");
        remove_temp_dirs_with_prefix("exomind-eventlog-import-");

        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog-temp-cleanup.sqlite");
        let store = Arc::new(EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap());
        store.append_event(Some("user-a"), EventRecord {
            id: "cleanup-a-1".to_string(),
            timestamp: 1111,
            content: "cleanup export".to_string(),
            tags: vec!["note".to_string()],
            metadata: None,
        }).unwrap();

        let app = test_router(test_state_with_eventlog(store));
        let export_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/eventlog/backup/sqlite?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(export_response.status(), StatusCode::OK);
        let export_body = export_response.into_body().collect().await.unwrap().to_bytes();
        let export_payload: Value = serde_json::from_slice(&export_body).unwrap();
        let import_bytes = STANDARD
            .decode(export_payload["content_base64"].as_str().unwrap())
            .unwrap();

        let import_dir = tempdir().unwrap();
        let target_store = Arc::new(EventLogStore::with_sqlite_path(import_dir.path().to_path_buf(), &import_dir.path().join("target.sqlite")).unwrap());
        let import_app = test_router(test_state_with_eventlog(target_store));
        let import_response = import_app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog/import/sqlite?user_id=user-a&strategy=overwrite")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({
                        "content_base64": STANDARD.encode(import_bytes),
                    }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(import_response.status(), StatusCode::OK);
        assert_eq!(count_temp_dirs_with_prefix("exomind-eventlog-export-"), 0);
        assert_eq!(count_temp_dirs_with_prefix("exomind-eventlog-import-"), 0);
    }
}
