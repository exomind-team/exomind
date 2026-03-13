use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::timeblock::{ActiveBlockData, TimeBlockData};

#[derive(Debug, Deserialize)]
struct ImportQuery {
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TimeBlockBackupJsonPayload {
    version: u32,
    time_blocks: Vec<TimeBlockData>,
    active_block: Option<ActiveBlockData>,
}

#[derive(Debug, Serialize)]
struct TimeBlockBackupSqlitePayload {
    version: u32,
    file_name: String,
    content_base64: String,
    timeblock_count: usize,
    active_block_present: bool,
}

#[derive(Debug, Deserialize)]
struct TimeBlockBackupSqliteImportPayload {
    content_base64: String,
}

#[derive(Debug, Serialize)]
struct TimeBlockImportResult {
    imported: usize,
    skipped: usize,
    total: usize,
    active_block_updated: bool,
}

#[derive(Debug, Serialize)]
struct TimeBlockBackendStatusResponse {
    backend: &'static str,
    supports_json_backup: bool,
    supports_sqlite_snapshot: bool,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

enum TimeBlockImportStrategy {
    Merge,
    Overwrite,
}

fn internal_error(message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: message }),
    )
}

async fn list_timeblocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Vec<TimeBlockData>>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(Json(blocks))
}

async fn replace_timeblocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<Vec<TimeBlockData>>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &payload)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    match state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
    {
        Some(block) => Ok(Json(block)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "active timeblock not found".to_string(),
            }),
        )),
    }
}

async fn put_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<ActiveBlockData>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .timeblock_store
        .put_active_scoped(scope_key, payload)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .timeblock_store
        .delete_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn timeblock_backend_status(
    State(state): State<AppState>,
) -> Json<TimeBlockBackendStatusResponse> {
    let supports_sqlite_snapshot = matches!(
        state.timeblock_store.backend_kind(),
        crate::timeblock::TimeBlockStoreBackendKind::Sqlite
    );
    Json(TimeBlockBackendStatusResponse {
        backend: if supports_sqlite_snapshot { "rt-sqlite" } else { "memory" },
        supports_json_backup: true,
        supports_sqlite_snapshot,
    })
}

async fn export_timeblocks_json(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TimeBlockBackupJsonPayload>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let time_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(Json(TimeBlockBackupJsonPayload {
        version: 1,
        time_blocks,
        active_block,
    }))
}

async fn export_timeblocks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TimeBlockBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let time_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let bytes = build_timeblocks_sqlite_snapshot_bytes(&state, scope_key, &time_blocks)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block_present = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
        .is_some();

    Ok(Json(TimeBlockBackupSqlitePayload {
        version: 1,
        file_name: "exomind-timeblocks.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        timeblock_count: time_blocks.len(),
        active_block_present,
    }))
}

async fn import_timeblocks_json(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TimeBlockBackupJsonPayload>,
) -> Result<Json<TimeBlockImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let result = apply_timeblock_import(&state, scope_key, payload.time_blocks, payload.active_block, strategy)?;
    Ok(Json(result))
}

async fn import_timeblocks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TimeBlockBackupSqliteImportPayload>,
) -> Result<Json<TimeBlockImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let bytes = STANDARD
        .decode(payload.content_base64)
        .map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("invalid sqlite snapshot: {error}"),
                }),
            )
        })?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let (time_blocks, active_block) = read_timeblocks_from_sqlite_snapshot(&bytes, scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let result = apply_timeblock_import(&state, scope_key, time_blocks, active_block, strategy)?;
    Ok(Json(result))
}

fn parse_import_strategy(
    raw: Option<&str>,
) -> Result<TimeBlockImportStrategy, (StatusCode, Json<ErrorResponse>)> {
    match raw.unwrap_or("merge") {
        "merge" => Ok(TimeBlockImportStrategy::Merge),
        "overwrite" => Ok(TimeBlockImportStrategy::Overwrite),
        other => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unsupported import strategy: {other}"),
            }),
        )),
    }
}

fn apply_timeblock_import(
    state: &AppState,
    scope_key: Option<&str>,
    imported_blocks: Vec<TimeBlockData>,
    imported_active_block: Option<ActiveBlockData>,
    strategy: TimeBlockImportStrategy,
) -> Result<TimeBlockImportResult, (StatusCode, Json<ErrorResponse>)> {
    let existing_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let existing_active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let (next_blocks, imported, skipped) = match strategy {
        TimeBlockImportStrategy::Overwrite => {
            let imported = imported_blocks.len();
            (imported_blocks, imported, 0)
        }
        TimeBlockImportStrategy::Merge => {
            let existing_by_id = existing_blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<std::collections::HashSet<_>>();
            let imported = imported_blocks
                .iter()
                .filter(|block| !existing_by_id.contains(block.id.as_str()))
                .count();
            let skipped = imported_blocks.len().saturating_sub(imported);
            let mut merged = existing_blocks;
            for block in imported_blocks {
                if let Some(index) = merged.iter().position(|existing| existing.id == block.id) {
                    merged[index] = block;
                } else {
                    merged.push(block);
                }
            }
            merged.sort_by(|left, right| right.end_time.cmp(&left.end_time).then_with(|| right.id.cmp(&left.id)));
            (merged, imported, skipped)
        }
    };

    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &next_blocks)
        .map_err(|error| internal_error(error.to_string()))?;

    let next_active_block = match strategy {
        TimeBlockImportStrategy::Overwrite => imported_active_block,
        TimeBlockImportStrategy::Merge => imported_active_block.or(existing_active_block),
    };

    let active_block_updated = next_active_block.is_some();
    match next_active_block {
        Some(block) => state
            .timeblock_store
            .put_active_scoped(scope_key, block)
            .map_err(|error| internal_error(error.to_string()))?,
        None => state
            .timeblock_store
            .delete_active_scoped(scope_key)
            .map_err(|error| internal_error(error.to_string()))?,
    }

    Ok(TimeBlockImportResult {
        imported,
        skipped,
        total: next_blocks.len(),
        active_block_updated,
    })
}

fn build_timeblocks_sqlite_snapshot_bytes(
    state: &AppState,
    scope_key: Option<&str>,
    time_blocks: &[TimeBlockData],
) -> Result<Vec<u8>, crate::timeblock::TimeBlockStoreError> {
    let temp_root = std::env::temp_dir().join(format!("exomind-timeblocks-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)?;
    let sqlite_path = temp_root.join("timeblocks-export.sqlite");
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    store.replace_completed_scoped(scope_key, time_blocks)?;
    if let Some(active_block) = state.timeblock_store.get_active_scoped(scope_key)? {
        store.put_active_scoped(scope_key, active_block)?;
    }
    let bytes = store.sqlite_snapshot_bytes()?.ok_or_else(|| crate::timeblock::TimeBlockStoreError::Io(std::io::Error::other("failed to produce scoped timeblock snapshot")))?;
    drop(store);
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok(bytes)
}

fn read_timeblocks_from_sqlite_snapshot(
    bytes: &[u8],
    scope_key: Option<&str>,
) -> Result<(Vec<TimeBlockData>, Option<ActiveBlockData>), crate::timeblock::TimeBlockStoreError> {
    let temp_root = std::env::temp_dir().join(format!("exomind-timeblocks-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)?;
    let sqlite_path = temp_root.join("timeblocks-import.sqlite");
    std::fs::write(&sqlite_path, bytes)?;
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    let time_blocks = store.list_completed_scoped(scope_key)?;
    let active_block = store.get_active_scoped(scope_key)?;
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok((time_blocks, active_block))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/timeblocks", get(list_timeblocks).put(replace_timeblocks))
        .route("/timeblocks/active", get(get_active_timeblock).put(put_active_timeblock).delete(delete_active_timeblock))
        .route("/timeblocks/backend/status", get(timeblock_backend_status))
        .route("/timeblocks/backup/json", get(export_timeblocks_json))
        .route("/timeblocks/backup/sqlite", get(export_timeblocks_sqlite))
        .route("/timeblocks/import/json", post(import_timeblocks_json))
        .route("/timeblocks/import/sqlite", post(import_timeblocks_sqlite))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state_with_timeblock_store(timeblock_store: Arc<crate::timeblock::TimeBlockStore>) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "timeblocks-test-host".to_string();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(host_id.clone(), Arc::clone(&signal_pool), None)),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            timeblock_store,
            energy_registry: crate::energy::EnergyRegistry::new(),
            life_agents: std::collections::HashMap::new(),
            eventlog_store: Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join("exomind-test-timeblocks"),
            )),
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(Arc::clone(&signal_pool), host_id)),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn timeblock_routes_isolate_profile_id_scope_and_keep_default_anonymous() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-scoped.sqlite");
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&vec![TimeBlockData {
                            id: "tb-anonymous".to_string(),
                            name: "Anonymous block".to_string(),
                            start_id: "start-anonymous".to_string(),
                            end_id: "end-anonymous".to_string(),
                            note: None,
                            tags: vec!["focus".to_string()],
                            start_time: 1_700_000_000_000,
                            end_time: 1_700_000_060_000,
                        }])
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&vec![TimeBlockData {
                            id: "tb-profile-a".to_string(),
                            name: "Profile A block".to_string(),
                            start_id: "start-profile-a".to_string(),
                            end_id: "end-profile-a".to_string(),
                            note: Some("scoped".to_string()),
                            tags: vec!["focus".to_string()],
                            start_time: 1_700_000_100_000,
                            end_time: 1_700_000_160_000,
                        }])
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            start_id: "active-profile-a".to_string(),
                            name: "Scoped active".to_string(),
                            mode: "countdown".to_string(),
                            target_minutes: Some(25),
                            elapsed: 30_000,
                            updated_at: Some(1_700_000_101_000),
                            phase: Some("running".to_string()),
                            version: Some(1),
                            actor_id: Some("actor-a".to_string()),
                            last_transition_at: Some(1_700_000_101_000),
                            last_resumed_at: Some(1_700_000_101_000),
                            accumulated_run_ms: Some(30_000),
                            start_time: 1_700_000_100_000,
                            action_ended_at: None,
                            feedback_started_at: None,
                            feedback_submitted_at: None,
                            pause_accumulated_ms: Some(0),
                            paused: false,
                            paused_at: None,
                            task_id: Some("task-profile-a".to_string()),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/timeblocks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let anonymous_blocks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/timeblocks?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile_a_blocks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/timeblocks/active?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile_a_active: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(anonymous_blocks.len(), 1);
        assert_eq!(anonymous_blocks[0]["id"], "tb-anonymous");
        assert_eq!(profile_a_blocks.len(), 1);
        assert_eq!(profile_a_blocks[0]["id"], "tb-profile-a");
        assert_eq!(profile_a_active["taskId"], "task-profile-a");
        assert_eq!(timeblock_store.list_completed().unwrap().len(), 1);
        assert_eq!(timeblock_store.list_completed_in_scope(Some("profile-a")).unwrap().len(), 1);
    }
}
