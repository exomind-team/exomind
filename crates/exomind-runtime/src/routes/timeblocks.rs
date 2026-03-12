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
) -> Result<Json<Vec<TimeBlockData>>, (StatusCode, Json<ErrorResponse>)> {
    let blocks = state
        .timeblock_store
        .list_completed()
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(Json(blocks))
}

async fn replace_timeblocks(
    State(state): State<AppState>,
    Json(payload): Json<Vec<TimeBlockData>>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .timeblock_store
        .replace_completed(&payload)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_active_timeblock(
    State(state): State<AppState>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    match state
        .timeblock_store
        .get_active()
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
    Json(payload): Json<ActiveBlockData>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .timeblock_store
        .put_active(payload)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_active_timeblock(
    State(state): State<AppState>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .timeblock_store
        .delete_active()
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
) -> Result<Json<TimeBlockBackupJsonPayload>, (StatusCode, Json<ErrorResponse>)> {
    let time_blocks = state
        .timeblock_store
        .list_completed()
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block = state
        .timeblock_store
        .get_active()
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(Json(TimeBlockBackupJsonPayload {
        version: 1,
        time_blocks,
        active_block,
    }))
}

async fn export_timeblocks_sqlite(
    State(state): State<AppState>,
) -> Result<Json<TimeBlockBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let bytes = state
        .timeblock_store
        .sqlite_snapshot_bytes()
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "timeblock sqlite snapshot is unavailable on non-sqlite backend".to_string(),
                }),
            )
        })?;

    let time_blocks = state
        .timeblock_store
        .list_completed()
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block_present = state
        .timeblock_store
        .get_active()
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
    let result = apply_timeblock_import(&state, payload.time_blocks, payload.active_block, strategy)?;
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
    let (time_blocks, active_block) = read_timeblocks_from_sqlite_snapshot(&bytes)
        .map_err(|error| internal_error(error.to_string()))?;
    let result = apply_timeblock_import(&state, time_blocks, active_block, strategy)?;
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
    imported_blocks: Vec<TimeBlockData>,
    imported_active_block: Option<ActiveBlockData>,
    strategy: TimeBlockImportStrategy,
) -> Result<TimeBlockImportResult, (StatusCode, Json<ErrorResponse>)> {
    let existing_blocks = state
        .timeblock_store
        .list_completed()
        .map_err(|error| internal_error(error.to_string()))?;
    let existing_active_block = state
        .timeblock_store
        .get_active()
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
        .replace_completed(&next_blocks)
        .map_err(|error| internal_error(error.to_string()))?;

    let next_active_block = match strategy {
        TimeBlockImportStrategy::Overwrite => imported_active_block,
        TimeBlockImportStrategy::Merge => imported_active_block.or(existing_active_block),
    };

    let active_block_updated = next_active_block.is_some();
    match next_active_block {
        Some(block) => state
            .timeblock_store
            .put_active(block)
            .map_err(|error| internal_error(error.to_string()))?,
        None => state
            .timeblock_store
            .delete_active()
            .map_err(|error| internal_error(error.to_string()))?,
    }

    Ok(TimeBlockImportResult {
        imported,
        skipped,
        total: next_blocks.len(),
        active_block_updated,
    })
}

fn read_timeblocks_from_sqlite_snapshot(
    bytes: &[u8],
) -> Result<(Vec<TimeBlockData>, Option<ActiveBlockData>), crate::timeblock::TimeBlockStoreError> {
    let temp_root = std::env::temp_dir().join(format!("exomind-timeblocks-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)?;
    let sqlite_path = temp_root.join("timeblocks-import.sqlite");
    std::fs::write(&sqlite_path, bytes)?;
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    let time_blocks = store.list_completed()?;
    let active_block = store.get_active()?;
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
